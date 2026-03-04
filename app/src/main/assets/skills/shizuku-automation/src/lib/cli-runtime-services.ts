export {};
'use strict';

const fs = require('fs');
const path = require('path');
const { exec: execInShell } = require('child_process');
const Module = require('module');
const {
  getBotdropTmpDir,
  getReadablePathCandidates,
  isUnderLocalTmpRoot,
  resolveSafeLocalTmpPath: resolveSafeLocalTmpPathGlobal,
  DEFAULT_LOCAL_TMP_ROOT,
} = require('./path-utils');
const { quoteShellArg } = require('./shell-utils');

const DEFAULT_SHARED_HOME = '/data/local/tmp/botdrop_tmp';
const SHARED_ROOT_CANDIDATES = [DEFAULT_SHARED_HOME];

const LOCAL_EXEC_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_SCREENSHOT_BASE64_CHARS = 120000;
const READ_FILE_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;
const DEFAULT_IMAGE_TRANSFORM_MAX_CHARS = 120000;

type ErrnoLike = {
  code?: number | string;
  signal?: string | null;
  stderr?: string;
  message?: string;
};

type UiFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
type ReadPathAttempt = {
  path: string;
  reason: string;
  size?: number;
  message?: string;
  code?: string | null;
  detail?: string;
};

type ReadablePathResolution = {
  ok: boolean;
  path: string;
  size: number | null;
  attempts: ReadPathAttempt[];
};

interface LocalTmpPathResolverLike {
  isLocalTmpPath(candidate: string): boolean;
  resolveSafeLocalTmpPath(candidate: string): { ok: boolean; path: string; resolved: string | null; detail?: string };
  resolveReadableLocalPath(filePath: string): ReadablePathResolution;
}

type LocalShellRunResult =
  | { ok: true; mode: 'termux'; exitCode: number; stdout: string; stderr: string; note?: string }
  | {
    ok: false; mode: 'termux'; error: string; message: string; exitCode: number; stdout: string; stderr: string; note?: string;
  };

type Base64TermuxResultOk = {
  ok: true;
  path: string;
  size: number;
  base64: string;
  totalBytes: number;
  totalChars: number;
  clipped: boolean;
  attempts: ReadPathAttempt[];
};

type Base64TermuxResultFail = {
  ok: false;
  mode: 'termux';
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

type ReadTextResultOk = {
  ok: true;
  path: string;
  size: number;
  text: string;
  attempts: ReadPathAttempt[];
};

type JsonRecord = Record<string, unknown>;

const toRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' ? (value as JsonRecord) : null;

const getErrorMessage = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  const record = toRecord(value);
  return record && typeof record.message === 'string' ? record.message : String(value);
};

const getErrorCode = (value: unknown): string | null => {
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') {
      return String(code);
    }
  }
  const record = toRecord(value);
  const rawCode = record && 'code' in record ? (record as { code?: unknown }).code : null;
  if (typeof rawCode === 'string' || typeof rawCode === 'number') {
    return String(rawCode);
  }
  return null;
};

type TermuxFileService = {
  readLocalFileAsBase64: (
    filePath: string,
    maxChars?: number
  ) => (Base64TermuxResultOk | (Base64TermuxResultFail & { mode: 'termux' }));
  readLocalFileAsText: (
    filePath: string,
    maxBytes?: number
  ) => (ReadTextResultOk | (Base64TermuxResultFail & { mode: 'termux'; error: string; message: string; path?: string }));
};

interface SharpInstance {
  metadata(): Promise<unknown>;
  grayscale(): SharpInstance;
  normalize(): SharpInstance;
  rotate(angle: number): SharpInstance;
  resize(width: number | null, height: number | null, options: { fit: UiFit; withoutEnlargement: boolean }): SharpInstance;
  jpeg(options: { quality?: number }): SharpInstance;
  webp(options: { quality?: number }): SharpInstance;
  avif(options: { quality?: number }): SharpInstance;
  png(): SharpInstance;
  gif(): SharpInstance;
  tiff(): SharpInstance;
  heif(): SharpInstance;
  toFormat(format: string): SharpInstance;
  toBuffer<T extends boolean>(options: { resolveWithObject: T }): T extends true ? Promise<{ data: Buffer }> : Promise<Buffer>;
}

type SharpFactory = (input: string) => SharpInstance;

type LocalShellRunner = {
  quoteShellArg: (value: string) => string;
  run: (command: string, timeoutMs?: number) => Promise<LocalShellRunResult>;
};

type ImageProcessor = {
  parseImageFit: (rawFit?: string) => UiFit;
  getMetadata: (filePath: string) => Promise<
    | { ok: true; mode: 'termux'; path: string; tool: string; metadata: unknown }
    | { ok: false; mode: 'termux'; error: string; message: string; details?: Record<string, unknown> }
  >;
  toBase64: (
    filePath: string,
    maxChars?: number,
    options?: {
      format?: string;
      width?: number | null;
      height?: number | null;
      quality?: number | null;
      fit?: UiFit;
      rotate?: number;
      grayscale?: boolean;
      normalize?: boolean;
    }
  ) => Promise<
    | {
      ok: true;
      mode: 'termux';
      path: string;
      tool: string;
      format: string;
      width: number | null;
      height: number | null;
      base64: string;
      bytes: number;
      totalChars: number;
      clipped: boolean;
    }
    | { ok: false; mode: 'termux'; error: string; message: string; details?: Record<string, unknown> }
  >;
};

function isSharedDirectoryCandidate(candidate = ''): boolean {
  const normalized = path.resolve(String(candidate || '').trim());
  return (
    normalized === '/data/local/tmp'
    || normalized.startsWith('/data/local/tmp/')
  );
}

function resolveSharedRootDir(getBotdropTmp: () => string): string {
  const envSharedRoot = process.env.BOTDROP_SHARED_ROOT;
  const preferred = getBotdropTmp();
  const candidates = [envSharedRoot, preferred, ...SHARED_ROOT_CANDIDATES];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (!isSharedDirectoryCandidate(candidate)) {
      continue;
    }
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return candidate;
    } catch (_) {
      // ignore and continue
    }
  }
  return DEFAULT_SHARED_HOME;
}

function resolveBotdropTermuxHome(): string {
  const candidates = [
    process.env.BOTDROP_TERMUX_HOME,
    process.env.TERMUX_HOME,
    process.env.HOME,
    '/data/data/com.termux/files/home',
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) {
      continue;
    }
    try {
      fs.mkdirSync(normalized, { recursive: true });
      fs.accessSync(normalized, fs.constants.R_OK | fs.constants.W_OK);
      return normalized;
    } catch (_) {
      // ignore and try next candidate
    }
  }
  return '/tmp';
}

function resolveLocalExecHome(sharedRootDir: string, termuxHome: string): string {
  const candidates = [
    termuxHome,
    process.cwd(),
    path.join(sharedRootDir, '.openclaw'),
    path.join(sharedRootDir, '.openclaw', 'shizuku'),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK | fs.constants.R_OK);
      return candidate;
    } catch (_) {
      // ignore
    }
  }
  return process.cwd() || '/tmp';
}

function bootstrapGlobalNodePath(): void {
  try {
    const execDir = path.dirname(process.execPath);
    const globalNodeModules = path.join(path.dirname(execDir), 'lib', 'node_modules');
    const existing = (process.env.NODE_PATH || '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const nextNodePaths: string[] = [];
    const seen = new Set<string>();
    for (const entry of existing) {
      if (!seen.has(entry)) {
        seen.add(entry);
        nextNodePaths.push(entry);
      }
    }

    if (globalNodeModules && !seen.has(globalNodeModules)) {
      nextNodePaths.push(globalNodeModules);
    }

    process.env.NODE_PATH = nextNodePaths.join(path.delimiter);
    Module._initPaths();
  } catch (_) {
    // best effort: fallback to existing Node path behavior
  }
}

function parseImageFit(rawFit = 'inside'): UiFit {
  const fit = String(rawFit || 'inside').toLowerCase();
  if (fit === 'cover' || fit === 'contain' || fit === 'fill' || fit === 'inside' || fit === 'outside') {
    return fit;
  }
  return 'inside';
}

class CliRuntimeServices {
  public readonly sharedRootDir: string;
  public readonly botdropTermuxHome: string;
  public readonly localExecHome: string;
  public readonly localTmpPathResolver: LocalTmpPathResolverLike;
  public readonly localShellRunner: LocalShellRunner;
  public readonly termuxFileService: TermuxFileService;
  public readonly imageProcessor: ImageProcessor;
  public readonly logFilePath: string | null;

  constructor() {
    this.sharedRootDir = resolveSharedRootDir(getBotdropTmpDir);
    this.botdropTermuxHome = resolveBotdropTermuxHome();
    this.localExecHome = resolveLocalExecHome(this.sharedRootDir, this.botdropTermuxHome);

    if (this.localExecHome) {
      process.env.HOME = this.localExecHome;
      try {
        process.chdir(this.localExecHome);
      } catch (_) {
        // best effort: keep running from current directory if chdir is blocked
      }
    }

    bootstrapGlobalNodePath();

    this.localTmpPathResolver = this.createLocalTmpPathResolver();
    this.localShellRunner = this.createLocalShellRunner({
      sharedRoot: this.sharedRootDir || '',
      termuxHome: this.botdropTermuxHome || '',
      home: this.botdropTermuxHome || this.localExecHome || process.env.HOME || '/',
      cwd: this.localExecHome || this.botdropTermuxHome || process.cwd(),
    });
    this.termuxFileService = this.createTermuxFileService(this.localTmpPathResolver);
    this.imageProcessor = this.createImageProcessor(this.localShellRunner);
    this.logFilePath = this.resolveCliLogPath(this.localExecHome, this.sharedRootDir);
  }

  private createLocalTmpPathResolver(): LocalTmpPathResolverLike {
    const localTmpRoot = DEFAULT_LOCAL_TMP_ROOT;
    const isLocalTmpPath = (candidate: string): boolean => isUnderLocalTmpRoot(candidate, localTmpRoot);

    const resolveSafeLocalTmpPath = (candidate: string): { ok: boolean; path: string; resolved: string | null; detail?: string } => {
      return resolveSafeLocalTmpPathGlobal(candidate, localTmpRoot);
    };

    const resolveReadableLocalPath = (filePath: string): ReadablePathResolution => {
      const rawPath = String(filePath || '').trim();
      const candidatePaths = getReadablePathCandidates(rawPath) as unknown[];
      const candidates = candidatePaths.filter((candidate: unknown): candidate is string => {
        if (!candidate) {
          return false;
        }
        if (typeof candidate !== 'string') {
          return false;
        }
        return isUnderLocalTmpRoot(candidate, localTmpRoot);
      });

      if (!candidates.length) {
        return {
          ok: false,
          path: rawPath,
          size: null,
          attempts: [
            {
              path: rawPath,
              reason: 'invalid-path-prefix',
              detail: 'only paths under /data/local/tmp are allowed',
            },
          ],
        };
      }

      const attempts: ReadPathAttempt[] = [];

      for (const candidate of candidates) {
        try {
          if (!candidate) {
            attempts.push({ path: String(candidate), reason: 'empty' });
            continue;
          }

          const resolvedCandidate = resolveSafeLocalTmpPath(candidate);
          if (!resolvedCandidate.ok) {
            attempts.push({
              path: candidate,
              reason: resolvedCandidate.detail || 'invalid-path-prefix',
              detail: resolvedCandidate.resolved || undefined,
            });
            continue;
          }

          fs.accessSync(resolvedCandidate.path, fs.constants.R_OK);
          const stat = fs.statSync(resolvedCandidate.path);
          if (!stat.isFile()) {
            attempts.push({
              path: resolvedCandidate.path,
              reason: 'not_file',
              size: stat.size,
            });
            continue;
          }
          attempts.push({ path: resolvedCandidate.path, reason: 'readable', size: stat.size });
          return {
            ok: true,
            path: resolvedCandidate.path,
            size: stat.size,
            attempts,
          };
        } catch (error: unknown) {
          const caughtError = toRecord(error) || (error instanceof Error ? error : null);
          attempts.push({
            path: candidate,
            reason: 'unreadable',
            message: getErrorMessage(caughtError),
            code: getErrorCode(caughtError),
          });
        }
      }

      return {
        ok: false,
        path: rawPath,
        size: null,
        attempts,
      };
    };

    return {
      isLocalTmpPath,
      resolveSafeLocalTmpPath,
      resolveReadableLocalPath,
    };
  }

  private createLocalShellRunner(config: { sharedRoot: string; termuxHome: string; home: string; cwd: string }): LocalShellRunner {
    const sharedRoot = config.sharedRoot;
    const termuxHome = config.termuxHome;
    const home = config.home;
    const cwd = config.cwd;

    const run = (command: string, timeoutMs = 30000): Promise<LocalShellRunResult> => {
      const cmd = String(command || '').trim();
      if (!cmd) {
        return Promise.resolve({
          ok: false,
          mode: 'termux',
          error: 'INVALID_ARGS',
          message: 'Empty command',
          exitCode: -1,
          stdout: '',
          stderr: '',
        });
      }

      const shellCommand = cmd.includes('|') ? `bash -lc ${quoteShellArg(`set -o pipefail; ${cmd}`)}` : cmd;

      return new Promise((resolve: (value: LocalShellRunResult) => void) => {
        execInShell(
          shellCommand,
          {
            timeout: timeoutMs,
            maxBuffer: LOCAL_EXEC_MAX_BUFFER,
            env: {
              ...process.env,
              BOTDROP_SHARED_ROOT: sharedRoot || process.env.BOTDROP_SHARED_ROOT || '',
              BOTDROP_TERMUX_HOME: termuxHome || process.env.BOTDROP_TERMUX_HOME || '',
              HOME: home || '/',
            },
            cwd: cwd || process.cwd(),
          },
          (error: unknown, stdout = '', stderr = '') => {
            const shellError = toRecord(error) as ErrnoLike | null;
            if (error) {
              const isTimeout = shellError && typeof shellError.signal === 'string' && shellError.signal === 'SIGTERM';
              let exitCode = 1;
              if (isTimeout) {
                exitCode = 124;
              } else if (shellError && typeof shellError.code === 'number') {
                exitCode = shellError.code;
              }
              const stdoutText = String(stdout || '');
              const shellErrorStderr = shellError && typeof shellError.stderr === 'string'
                ? shellError.stderr
                : '';
              const combinedStderr = `${String(stderr || '')}${stderr && shellErrorStderr ? '\n' : ''}${shellErrorStderr}`.trim();
              const isExpectedPipeClose =
                exitCode === 141 &&
                !combinedStderr &&
                /\\|/.test(cmd) &&
                !!stdoutText;
              if (isExpectedPipeClose) {
                resolve({
                  ok: true,
                  mode: 'termux',
                  exitCode,
                  stdout: stdoutText,
                  stderr: '',
                  note: 'Command exited via pipe close (SIGPIPE). Output captured successfully.',
                });
                return;
              }
              resolve({
                ok: false,
                mode: 'termux',
                error: isTimeout ? 'TIMEOUT' : 'TERMUX_EXEC_FAILED',
                message:
                  isTimeout
                    ? `Command timed out after ${timeoutMs}ms`
                    : typeof shellError?.message === 'string'
                      ? shellError.message
                      : 'Command failed',
                exitCode,
                stdout: stdoutText,
                stderr: combinedStderr,
              });
              return;
            }
            resolve({
              ok: true,
              mode: 'termux',
              exitCode: 0,
              stdout: String(stdout || ''),
              stderr: String(stderr || ''),
            });
          }
        );
      });
    };

    return { quoteShellArg, run };
  }

  private createTermuxFileService(pathResolver: LocalTmpPathResolverLike): TermuxFileService {
    const readLocalFileAsBase64 = (
      filePath: string,
      maxChars = DEFAULT_SCREENSHOT_BASE64_CHARS
    ): (Base64TermuxResultOk | (Base64TermuxResultFail & { mode: 'termux' })) => {
      const resolved = pathResolver.resolveReadableLocalPath(filePath);
      if (!resolved.ok) {
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_NOT_FOUND',
          message: 'No readable file in Termux',
          details: {
            requestedPath: filePath,
            attempts: resolved.attempts,
          },
        };
      }

      const approxByteLimit = Number.isFinite(maxChars) && maxChars > 0
        ? Math.floor((maxChars * 3) / 4)
        : null;
      if (approxByteLimit !== null && resolved.size !== null && resolved.size > approxByteLimit) {
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_TOO_LARGE',
          message: 'File is too large for requested base64 output limit',
          details: {
            path: resolved.path,
            size: resolved.size,
            limit: approxByteLimit,
            maxChars,
          },
        };
      }

      let data;
      try {
        data = fs.readFileSync(resolved.path);
      } catch (error: unknown) {
        const caughtError = toRecord(error) || (error instanceof Error ? error : null);
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_READ_FAILED',
          message: getErrorMessage(caughtError),
          details: {
            path: resolved.path,
            requestedPath: filePath,
          },
        };
      }

      const base64 = data.toString('base64');
      const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : DEFAULT_SCREENSHOT_BASE64_CHARS;
      const clipped = base64.length > safeMaxChars
        ? base64.slice(0, safeMaxChars)
        : base64;

      return {
        ok: true,
        path: resolved.path,
        size: data.length,
        base64: clipped,
        totalBytes: data.length,
        totalChars: base64.length,
        clipped: clipped !== base64,
        attempts: resolved.attempts,
      };
    };

    const readLocalFileAsText = (
      filePath: string,
      maxBytes = READ_FILE_MAX_BYTES_DEFAULT
    ): (ReadTextResultOk | (Base64TermuxResultFail & { mode: 'termux'; error: string; message: string; path?: string })) => {
      const resolved = pathResolver.resolveReadableLocalPath(filePath);
      if (!resolved.ok) {
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_NOT_FOUND',
          message: 'No readable file in Termux',
          details: {
            requestedPath: filePath,
            attempts: resolved.attempts,
          },
        };
      }

      if (Number.isFinite(maxBytes) && resolved.size !== null && maxBytes > 0 && resolved.size > maxBytes) {
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_TOO_LARGE',
          message: 'File is too large',
          details: {
            path: resolved.path,
            size: resolved.size,
            limit: maxBytes,
          },
        };
      }

      let data;
      try {
        data = fs.readFileSync(resolved.path, 'utf8');
      } catch (error: unknown) {
        const caughtError = toRecord(error) || (error instanceof Error ? error : null);
        return {
          ok: false,
          mode: 'termux',
          error: 'LOCAL_FILE_READ_FAILED',
          message: getErrorMessage(caughtError),
          details: {
            path: resolved.path,
            requestedPath: filePath,
          },
        };
      }

      return {
        ok: true,
        path: resolved.path,
        size: Buffer.byteLength(data, 'utf8'),
        text: data,
        attempts: resolved.attempts,
      };
    };

    return {
      readLocalFileAsBase64,
      readLocalFileAsText,
    };
  }

  private createImageProcessor(shell: { quoteShellArg: (value: string) => string; run: (
    command: string,
    timeoutMs?: number
  ) => Promise<LocalShellRunResult> }): ImageProcessor {
    let sharpLib: SharpFactory | null | undefined;

    const tryResolveSharp = (requirePath: string): unknown => {
      try {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        return require(requirePath);
      } catch {
        return null;
      }
    };

    const getGlobalNodeModulesPath = (): string => {
      const execDir = path.dirname(process.execPath);
      const parentDir = path.dirname(execDir);
      return path.join(parentDir, 'lib', 'node_modules');
    };

    const getConfiguredNodePaths = (): string[] =>
      (process.env.NODE_PATH || '')
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry);

    const getSharpLib = (): SharpFactory | null => {
      if (sharpLib !== undefined) {
        return sharpLib;
      }

      const candidates = [
        'sharp',
        ...getConfiguredNodePaths().map((nodePath) => path.join(nodePath, 'sharp')),
        path.join(getGlobalNodeModulesPath(), 'sharp'),
      ];

      for (const candidate of candidates) {
        const loaded = tryResolveSharp(candidate) as SharpFactory | null;
        if (loaded) {
          sharpLib = loaded as SharpFactory;
          return sharpLib;
        }
      }

      sharpLib = null;
      return null;
    };

    const normalizeImageFormat = (rawFormat = 'png'): { ok: true; format: string; } | {
      ok: false;
      mode: 'termux';
      error: string;
      message: string;
      details?: Record<string, unknown>;
    } => {
      const format = String(rawFormat || 'png').toLowerCase();
      if (!format) {
        return { ok: false, mode: 'termux', error: 'IMAGE_FORMAT_INVALID', message: 'Image format is empty' };
      }

      const normalized = format === 'jpg' ? 'jpeg' : format;
      const supported = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif']);
      if (!supported.has(normalized)) {
        return {
          ok: false,
          mode: 'termux',
          error: 'IMAGE_FORMAT_UNSUPPORTED',
          message: `Unsupported image format: ${format}`,
          details: { format: normalized, supported: Array.from(supported) },
        };
      }

      return { ok: true, format: normalized };
    };

    const getMetadata = async (
      filePath: string
    ): Promise<
      | { ok: true; mode: 'termux'; path: string; tool: string; metadata: unknown }
      | { ok: false; mode: 'termux'; error: string; message: string; details?: Record<string, unknown> }
    > => {
      const sharp = getSharpLib();
      if (!sharp) {
        return {
          ok: false,
          mode: 'termux',
          error: 'IMAGE_TOOL_MISSING',
          message: 'Sharp is unavailable in this environment',
          details: { tool: 'sharp' },
        };
      }

      try {
        const metadata = await sharp(filePath).metadata();
        return {
          ok: true,
          mode: 'termux',
          path: filePath,
          tool: 'sharp',
          metadata,
        };
      } catch (error: unknown) {
        const caughtError = toRecord(error) || (error instanceof Error ? error : null);
        return {
          ok: false,
          mode: 'termux',
          error: 'IMAGE_METADATA_FAILED',
          message: getErrorMessage(caughtError),
          details: {
            path: filePath,
          },
        };
      }
    };

    const toBase64 = async (
      filePath: string,
      maxChars = DEFAULT_IMAGE_TRANSFORM_MAX_CHARS,
      options: {
        format?: string;
        width?: number | null;
        height?: number | null;
        quality?: number | null;
        fit?: UiFit;
        rotate?: number;
        grayscale?: boolean;
        normalize?: boolean;
      } = {}
    ): Promise<
      | {
        ok: true;
        mode: 'termux';
        path: string;
        tool: string;
        format: string;
        width: number | null;
        height: number | null;
        base64: string;
        bytes: number;
        totalChars: number;
        clipped: boolean;
      }
      | { ok: false; mode: 'termux'; error: string; message: string; details?: Record<string, unknown> }
    > => {
      const sharp = getSharpLib();
      if (!sharp) {
        return {
          ok: false,
          mode: 'termux',
          error: 'IMAGE_TOOL_MISSING',
          message: 'Sharp is unavailable in this environment',
          details: { tool: 'sharp' },
        };
      }

      const normalizedFormat = normalizeImageFormat(options.format || 'png');
      if (!normalizedFormat.ok) {
        return normalizedFormat;
      }
      const outputFormat = normalizedFormat.format;

      let pipeline = sharp(filePath);
      if (options.grayscale) {
        pipeline = pipeline.grayscale();
      }
      if (options.normalize) {
        pipeline = pipeline.normalize();
      }
      if (typeof options.rotate === 'number' && Number.isFinite(options.rotate) && Number.isInteger(options.rotate)) {
        pipeline = pipeline.rotate(options.rotate);
      }
      if (options.width || options.height) {
        pipeline = pipeline.resize(
          options.width || null,
          options.height || null,
          {
            fit: parseImageFit(options.fit || 'inside'),
            withoutEnlargement: true,
          }
        );
      }

      const quality = Number.isFinite(options.quality) ? options.quality : null;
      if (outputFormat === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: quality ? quality : 90 });
      } else if (outputFormat === 'webp') {
        pipeline = pipeline.webp({ quality: quality ? quality : 90 });
      } else if (outputFormat === 'avif') {
        pipeline = pipeline.avif({ quality: quality ? quality : 90 });
      } else if (outputFormat === 'png') {
        pipeline = pipeline.png();
      } else if (outputFormat === 'gif') {
        pipeline = pipeline.gif();
      } else if (outputFormat === 'tiff') {
        pipeline = pipeline.tiff();
      } else if (outputFormat === 'heif') {
        pipeline = pipeline.heif();
      } else {
        pipeline = pipeline.toFormat(outputFormat);
      }

      let buffer: Buffer;
      try {
        const result = await pipeline.toBuffer({ resolveWithObject: true });
        buffer = result.data;
      } catch (error: unknown) {
        const caughtError = toRecord(error) || (error instanceof Error ? error : null);
        return {
          ok: false,
          mode: 'termux',
          error: 'IMAGE_CONVERT_FAILED',
          message: getErrorMessage(caughtError),
          details: {
            path: filePath,
            format: outputFormat,
          },
        };
      }

      const base64 = buffer.toString('base64');
      const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0
        ? maxChars
        : DEFAULT_IMAGE_TRANSFORM_MAX_CHARS;
      const clipped = base64.length > safeMaxChars
        ? base64.slice(0, safeMaxChars)
        : base64;

      return {
        ok: true,
        mode: 'termux',
        path: filePath,
        tool: 'sharp',
        format: outputFormat,
        width: options.width || null,
        height: options.height || null,
        base64: clipped,
        bytes: buffer.length,
        totalChars: base64.length,
        clipped: clipped !== base64,
      };
    };

    return {
      parseImageFit,
      getMetadata,
      toBase64,
    };
  }

  private resolveCliLogCandidates(envHome: string | null): string[] {
    const candidates: string[] = [];
    if (envHome) {
      candidates.push(path.join(envHome, '.openclaw', 'shizuku-automation-cli.log'));
      const parentHome = path.dirname(envHome);
      if (parentHome && parentHome !== envHome) {
        candidates.push(path.join(parentHome, '.openclaw', 'shizuku-automation-cli.log'));
      }
    }
    const sharedHome = this.sharedRootDir;
    candidates.push(path.join(sharedHome, '.openclaw', 'shizuku-automation-cli.log'));
    return candidates;
  }

  private resolveCliLogPath(envHome: string, sharedHome: string): string | null {
    const candidates: string[] = [];
    if (process.env.BOTDROP_AUTOMATION_LOG_FILE) {
      candidates.push(process.env.BOTDROP_AUTOMATION_LOG_FILE);
    }
    candidates.push(...this.resolveCliLogCandidates(envHome || process.env.HOME || null));

    for (const filePath of candidates) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.appendFileSync(filePath, '');
        return filePath;
      } catch (_) {
        // ignore and try next candidate
      }
    }
    return null;
  }
}

module.exports = {
  CliRuntimeServices,
  DEFAULT_SCREENSHOT_BASE64_CHARS,
  READ_FILE_MAX_BYTES_DEFAULT,
  DEFAULT_IMAGE_TRANSFORM_MAX_CHARS,
};
