export {};
'use strict';

import * as http from 'http';
const { BridgeConfigResolver } = require('./bridge-config-resolver');

import type {
  BridgeClientConfigInfo,
  BridgeConfig as SkillBridgeConfig,
  BridgeResponseUnion,
} from '../types';
const { ErrorCode } = require('../types');
const { SkillError } = require('./errors');

type BridgeResponse = BridgeResponseUnion & Record<string, unknown>;
type BridgeResponseFailure = BridgeResponse & { ok: false };
type BridgeResponseSuccess = BridgeResponse & { ok: true };
type ErrorWithResult = Error & {
  code: string;
  result: BridgeResponse;
};

const ERROR = {
  BRIDGE_NOT_FOUND: ErrorCode.BRIDGE_NOT_FOUND,
  BRIDGE_UNREACHABLE: ErrorCode.BRIDGE_UNREACHABLE,
  SHIZUKU_NOT_READY: ErrorCode.SHIZUKU_NOT_READY,
  EXEC_FAILED: ErrorCode.EXEC_FAILED,
  TIMEOUT: ErrorCode.TIMEOUT,
};

const TRACE_BRIDGE =
  !('BOTDROP_AUTOMATION_TRACE' in process.env)
  || process.env.BOTDROP_AUTOMATION_TRACE === '1'
  || process.env.BOTDROP_AUTOMATION_TRACE === 'true';

interface BridgeAvailabilityResult {
  available: boolean;
  status?: string;
  serviceBound?: boolean;
  error?: string;
  message?: string;
}

interface BridgeConfigStore {
  getConfigPath(): string;
  readConfig: () => SkillBridgeConfig | null;
  getConfigInfo: () => ConfigInfo;
}

interface ConfigInfo {
  path: string;
  exists: boolean;
  home: string | null;
  cwd: string;
  lastError: string | null;
}

const BRIDGE_DIAGNOSTICS = {
  enabled: TRACE_BRIDGE,
  summarizeCommand(command: string): string {
    const normalized = String(command || '').trim();
    if (normalized.length <= 120) {
      return normalized;
    }
    return normalized.slice(0, 120) + `...(${normalized.length})`;
  },
  toStringMap(value: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        result[key] = item;
      }
    }
    return result;
  },
  trace(event: string, data: Record<string, unknown> = {}): void {
    if (!BRIDGE_DIAGNOSTICS.enabled) {
      return;
    }
    console.error('[shizuku-bridge][' + event + '] ' + JSON.stringify(data));
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createFailureResponse(error: string, message: string): BridgeResponseFailure {
  return {
    ok: false,
    error,
    message,
    exitCode: -1,
    stdout: '',
    stderr: '',
    type: 'text',
  };
}

function normalizeBridgeResponse(payload: unknown = {}): BridgeResponse {
  if (!isObject(payload)) {
    return createFailureResponse(ERROR.EXEC_FAILED, 'Invalid response payload');
  }

  const normalizedPayload = payload as Record<string, unknown>;
  const type = normalizedPayload.type === 'file' ? 'file' : 'text';
  const rawError = typeof normalizedPayload.error === 'string' ? normalizedPayload.error : ERROR.EXEC_FAILED;
  const rawMessage = typeof normalizedPayload.message === 'string' && normalizedPayload.message.length > 0
    ? normalizedPayload.message
    : rawError === ERROR.EXEC_FAILED
      ? 'Execution failed'
      : `Bridge error: ${rawError}`;

  const exitCode = typeof normalizedPayload.exitCode === 'number' ? normalizedPayload.exitCode : -1;
  const stdout = typeof normalizedPayload.stdout === 'string' ? normalizedPayload.stdout : '';
  const stderr = typeof normalizedPayload.stderr === 'string' ? normalizedPayload.stderr : '';
  const isFileType = type === 'file';

  if (isFileType) {
    const filePath = typeof normalizedPayload.path === 'string' ? normalizedPayload.path : '';
    if (!filePath) {
      return createFailureResponse(
        ERROR.EXEC_FAILED,
        'Bridge returned file result without path',
      );
    }
    const normalized: Extract<BridgeResponseUnion, { type: 'file' }> = {
      ok: payload.ok === true,
      error: rawError,
      message: rawMessage,
      exitCode,
      stdout,
      stderr,
      type,
      path: filePath,
    };
    const bytes = typeof normalizedPayload.bytes === 'number' && Number.isFinite(normalizedPayload.bytes)
      ? normalizedPayload.bytes
      : undefined;
    if (bytes !== undefined) {
      normalized.bytes = bytes;
    }
    return {
      ...normalizedPayload,
      ...normalized,
    };
  }

  const normalized: Extract<BridgeResponseUnion, { type: 'text' }> = {
    ok: payload.ok === true,
    error: rawError,
    message: rawMessage,
    exitCode,
    stdout,
    stderr,
    type,
  };

  return {
    ...normalizedPayload,
    ...normalized,
  };
}

function isBridgeResponse(payload: unknown): payload is BridgeResponse {
  return isObject(payload) && (payload.type === 'text' || payload.type === 'file') && 'ok' in payload;
}

function requestBridge(
  method: 'GET' | 'POST',
  requestPath: string,
  body: unknown,
  timeoutMs: number,
  configStore: BridgeConfigStore
): Promise<BridgeResponse> {
  const resolvedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  const cfg = configStore.readConfig();

  if (!cfg) {
    const info = configStore.getConfigInfo();
    const notFound = createFailureResponse(
      ERROR.BRIDGE_NOT_FOUND,
      `Bridge config not found at ${info.path}`,
    ) as BridgeResponseFailure;
    notFound.bridgeConfigPath = info.path;
    notFound.bridgeConfigExists = info.exists;
    notFound.bridgeConfigHome = info.home;
    notFound.bridgeConfigCwd = info.cwd;
    notFound.bridgeConfigLastError = info.lastError;
    return Promise.resolve(notFound);
  }

  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const startedAt = Date.now();

    const options: http.RequestOptions = {
      hostname: cfg.host,
      port: cfg.port,
      path: requestPath,
      method,
      timeout: resolvedTimeout,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
      },
    };

    BRIDGE_DIAGNOSTICS.trace('request.start', {
      requestId: Math.random().toString(36).slice(2, 10),
      method,
      path: requestPath,
      timeoutMs: resolvedTimeout,
      hasBody: !!payload,
      bridgeConfigPath: configStore.getConfigPath(),
      command: BRIDGE_DIAGNOSTICS.summarizeCommand(
        typeof body === 'object' && body && 'command' in body
          ? String((body as { command?: unknown }).command || '')
          : '',
      ),
    });

    const req = http.request(options, (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const elapsedMs = Date.now() - startedAt;
        BRIDGE_DIAGNOSTICS.trace('response.raw', {
          statusCode: res.statusCode,
          headers: BRIDGE_DIAGNOSTICS.toStringMap(res.headers as Record<string, unknown>),
          elapsedMs,
          rawLen: raw.length,
        });

        let parsed: BridgeResponse;
        try {
          const rawParsed: unknown = JSON.parse(raw);
          parsed = normalizeBridgeResponse(rawParsed);
        } catch {
          parsed = createFailureResponse(
            ERROR.EXEC_FAILED,
            `Invalid JSON response: ${raw.slice(0, 200)}`,
          );
        }

        if (!isBridgeResponse(parsed)) {
          resolve(normalizeBridgeResponse({
            ok: false,
            error: ERROR.EXEC_FAILED,
            message: 'Invalid response payload',
            exitCode: -1,
            stdout: '',
            stderr: '',
          }));
          return;
        }

        BRIDGE_DIAGNOSTICS.trace('response.parsed', {
          method,
          requestPath,
          elapsedMs,
          ok: parsed.ok,
          exitCode: parsed.exitCode,
          type: parsed.type,
          stdoutLen: parsed.type === 'file' && typeof parsed.bytes === 'number'
            ? parsed.bytes
            : parsed.stdout.length,
          stderrLen: parsed.stderr.length,
          resolvedPath: parsed.type === 'file' ? parsed.path : null,
        });

        resolve(parsed);
      });
    });

    req.on('timeout', () => {
      req.destroy();
      BRIDGE_DIAGNOSTICS.trace('request.timeout', {
        method,
        path: requestPath,
        timeoutMs: resolvedTimeout,
        elapsedMs: Date.now() - startedAt,
      });
      resolve(normalizeBridgeResponse({
        ok: false,
        error: ERROR.TIMEOUT,
        message: `Request timed out after ${resolvedTimeout}ms`,
        exitCode: -1,
        stdout: '',
        stderr: '',
        type: 'text',
      }));
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      BRIDGE_DIAGNOSTICS.trace('request.error', {
        method,
        path: requestPath,
        elapsedMs: Date.now() - startedAt,
        error: err.message,
      });
      resolve(createFailureResponse(
        ERROR.BRIDGE_UNREACHABLE,
        `Bridge unreachable: ${err.message}`,
      ));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

const GLOBAL_CONFIG_RESOLVER = new BridgeConfigResolver();
const DEFAULT_CONFIG_PATH = GLOBAL_CONFIG_RESOLVER.getDefaultConfigPath();

class BridgeClient {
  private readonly _configStore: BridgeConfigStore;

  constructor(configPath?: string) {
    this._configStore = new BridgeConfigResolver(configPath);
  }

  getConfigPath(): string {
    return this._configStore.getConfigPath();
  }

  getConfigInfo(): BridgeClientConfigInfo {
    const raw = this._configStore.getConfigInfo();
    return {
      path: raw.path,
      exists: raw.exists,
      home: raw.home,
      cwd: raw.cwd,
      lastError: raw.lastError,
    };
  }

  private _request(method: 'GET' | 'POST', requestPath: string, body: unknown, timeoutMs = 30000): Promise<BridgeResponse> {
    return requestBridge(method, requestPath, body, timeoutMs, this._configStore);
  }

  async isAvailable(): Promise<BridgeAvailabilityResult> {
    const cfg = this._configStore.readConfig();
    if (!cfg) {
      return {
        available: false,
        error: ERROR.BRIDGE_NOT_FOUND,
        message: 'Config file not found',
      };
    }

    const res = await this._request('GET', '/shizuku/status', null, 5000);
    const rawRes = res as Record<string, unknown>;
    const status = typeof rawRes.status === 'string'
      ? String(rawRes.status)
      : null;
    const serviceBound = typeof rawRes.serviceBound === 'boolean'
      ? rawRes.serviceBound
      : undefined;

    if (!res.ok && status) {
      if (status !== 'READY') {
        return {
          available: false,
          error: ErrorCode.SHIZUKU_NOT_READY,
          message: `Shizuku status: ${status}`,
          status,
          serviceBound: typeof serviceBound === 'boolean' ? serviceBound : undefined,
        };
      }
      return {
        available: true,
        status,
        serviceBound: typeof serviceBound === 'boolean' ? serviceBound : true,
      };
    }

    if (!res.ok) {
      return {
        available: false,
        error: typeof res.error === 'string' ? res.error : ERROR.BRIDGE_UNREACHABLE,
        message: res.message || 'Bridge status request failed',
      };
    }

    if (status && status !== 'READY') {
      return {
        available: false,
        error: ErrorCode.SHIZUKU_NOT_READY,
        message: `Shizuku status: ${status}`,
        status,
        serviceBound,
      };
    }

    return {
      available: true,
      status: status || 'READY',
      serviceBound: typeof serviceBound === 'boolean' ? serviceBound : true,
    };
  }

  exec(command: string, timeoutMs = 30000): Promise<BridgeResponse> {
    return this._request('POST', '/shizuku/exec', { command, timeoutMs }, timeoutMs + 5000);
  }

  async execOrThrow(command: string, timeoutMs = 30000): Promise<BridgeResponse> {
    const res = await this.exec(command, timeoutMs);
    if (!res.ok) {
      const message = res.message || res.stderr || res.error || 'exec failed';
      const errorCode = typeof res.error === 'string' && res.error.length > 0
        ? res.error
        : ErrorCode.EXEC_FAILED;
      const resultError: ErrorWithResult = new SkillError(errorCode, message) as ErrorWithResult;
      resultError.result = res;
      throw resultError;
    }
    return res;
  }
}

module.exports = {
  BridgeClient,
  ERROR,
  DEFAULT_CONFIG_PATH,
};
