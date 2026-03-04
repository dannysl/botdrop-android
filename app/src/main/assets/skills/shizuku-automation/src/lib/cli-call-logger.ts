export {};
'use strict';

type JsonRecord = Record<string, unknown>;
type ParsedJsonResult = {
  value: unknown;
  serialized: string | null;
  type: string;
};

const LOG_MAX_STRING_CHARS = 4096;
const LOG_MAX_ARRAY_LENGTH = 64;
const LOG_MAX_OBJECT_KEYS = 64;
const LOG_MAX_OBJECT_DEPTH = 8;

const toRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' ? (value as JsonRecord) : null;

interface CliCurrentCall {
  command: string;
  args: Record<string, unknown>;
  startMs: number;
  pid: number;
  runtime: {
    home: string | null;
    cwd: string;
    shell: string | null;
    pid: number;
    nodeVersion: string;
  };
  bridgeConfigPath: string | null;
}

class CliCallLogger {
  private readonly _logFilePath: string | null;

  constructor(logFilePath: string | null) {
    this._logFilePath = logFilePath;
  }

  private safeSerialize(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ unserializable: true });
    }
  }

  private truncateLongText(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }
    if (value.length <= LOG_MAX_STRING_CHARS) {
      return value;
    }
    return `${value.slice(0, LOG_MAX_STRING_CHARS)}...(${value.length} chars total)`;
  }

  private inferType(value: unknown): string {
    if (Array.isArray(value)) {
      return 'array';
    }
    if (value === null) {
      return 'null';
    }
    if (value === undefined) {
      return 'undefined';
    }
    return typeof value;
  }

  private normalizeLogPayload(value: unknown): ParsedJsonResult {
    if (value === undefined) {
      return { value: null, serialized: null, type: 'undefined' };
    }
    const sanitized = this.sanitizeForLog(value);
    const serialized = this.safeSerialize(sanitized);
    return {
      value: sanitized,
      serialized,
      type: this.inferType(value),
    };
  }

  private sanitizeForLog(value: unknown, depth = 0, seen: Set<unknown> = new Set()): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'string') {
      return this.truncateLongText(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'bigint') {
      return `${value}n`;
    }

    if (typeof value === 'function') {
      return '[function]';
    }

    if (typeof value === 'symbol') {
      return value.toString();
    }

    if (Buffer.isBuffer(value)) {
      return `[Buffer:${value.length} bytes]`;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (value instanceof Error) {
      const error = value as { code?: string | number | null };
      return this.sanitizeForLog({
        name: value.name,
        message: value.message,
        code: error.code || null,
        stack: value.stack,
      }, depth, seen);
    }

    if (depth >= LOG_MAX_OBJECT_DEPTH) {
      return '[Object depth limit reached]';
    }

    if (Array.isArray(value)) {
      const limitedItems = value.slice(0, LOG_MAX_ARRAY_LENGTH).map((item) => this.sanitizeForLog(item, depth + 1, seen));
      if (value.length > LOG_MAX_ARRAY_LENGTH) {
        limitedItems.push(`...truncated ${value.length - LOG_MAX_ARRAY_LENGTH} items`);
      }
      return limitedItems;
    }

    if (typeof value === 'object') {
      const recordValue = value as Record<string, unknown>;
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
      const keys = Object.keys(recordValue);
      const limitedKeys = keys.slice(0, LOG_MAX_OBJECT_KEYS);
      const output: Record<string, unknown> = {};
      for (const key of limitedKeys) {
        output[key] = this.sanitizeForLog(recordValue[key], depth + 1, seen);
      }
      if (keys.length > LOG_MAX_OBJECT_KEYS) {
        output.__truncatedKeys = `...${keys.length - LOG_MAX_OBJECT_KEYS} keys truncated`;
      }
      seen.delete(value);
      return output;
    }

    return String(value);
  }

  private append(payload: JsonRecord): void {
    if (!this._logFilePath) {
      return;
    }

    const safePayload = this.sanitizeForLog(payload);
    const safeObject = toRecord(safePayload) || { value: safePayload };
    const record = {
      ...(safeObject as JsonRecord),
      ts: new Date().toISOString(),
    };
    try {
      const fs = require('fs');
      fs.appendFileSync(this._logFilePath, JSON.stringify(record) + '\n', 'utf8');
    } catch (error) {
      const writeError = error instanceof Error ? error : null;
      process.stderr.write(
        `[cli-log] write failed: ${writeError ? writeError.message : String(error)}\n`
      );
    }
  }

  public start(session: CliCurrentCall, bridgeConfigInfo: unknown = null): void {
    this.append({
      event: 'start',
      command: session.command,
      requestParams: this.sanitizeForLog(session.args),
      resultStatus: 'start',
      pid: session.pid,
      startMs: session.startMs,
      bridgeConfigPath: session.bridgeConfigPath || null,
      bridgeConfigInfo: this.sanitizeForLog(bridgeConfigInfo),
      runtime: this.sanitizeForLog(session.runtime),
    });
  }

  public finish(session: CliCurrentCall, status: 'ok' | 'error', data: unknown = null, error: unknown = null): void {
    if (!session) {
      return;
    }
    const finish = Date.now();
    const durationMs = finish - session.startMs;
    const payload = status === 'ok' ? this.normalizeLogPayload(data) : null;
    const errPayload = status === 'error' ? this.normalizeLogPayload(error) : null;
    const errorRecord = errPayload ? toRecord(errPayload.value) : null;

    this.append({
      event: 'finish',
      command: session.command,
      requestParams: session.args,
      bridgeConfigPath: session.bridgeConfigPath || null,
      resultStatus: status,
      responseTimeMs: durationMs,
      data: payload ? payload.value : null,
      dataSerialized: payload ? payload.serialized : null,
      dataType: payload ? payload.type : null,
      error: errPayload ? errPayload.value : null,
      errorSerialized: errPayload ? errPayload.serialized : null,
      errorType: errPayload ? errPayload.type : null,
      errorCode: errorRecord && typeof errorRecord.error === 'string' ? errorRecord.error : null,
      runtime: session.runtime || null,
      success: status === 'ok',
    });
  }
}

module.exports = {
  CliCallLogger,
};
