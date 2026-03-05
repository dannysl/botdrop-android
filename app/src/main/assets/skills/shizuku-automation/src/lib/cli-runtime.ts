export {};
'use strict';

import type {
  ArgFlags,
  ParsedArgs,
  PostLaunchOptions,
  ReadablePathResolution,
  UiSelector,
} from '../types';

const { CliResponseWriter } = require('./cli-response-writer');
const {
  DEFAULT_SCREENSHOT_BASE64_CHARS,
  DEFAULT_IMAGE_TRANSFORM_MAX_CHARS,
  READ_FILE_MAX_BYTES_DEFAULT,
} = require('./cli-runtime-services');

type Base64ResultFail = {
  ok: false;
  mode: 'termux';
  error: string;
  message: string;
  details?: Record<string, unknown>;
};

interface LocalTmpPathResolverLike {
  resolveReadableLocalPath(filePath: string): ReadablePathResolution;
}

type Base64ReadMethod = (
  filePath: string,
  maxChars?: number
) => (
  | {
    ok: true;
    path: string;
    size: number;
    base64: string;
    totalBytes: number;
    totalChars: number;
    clipped: boolean;
    attempts: ReadablePathResolution['attempts'];
  }
  | (Base64ResultFail & { mode: 'termux' })
);

type ReadTextMethod = (
  filePath: string,
  maxBytes?: number
) => (
  | {
    ok: true;
    path: string;
    size: number;
    text: string;
    attempts: ReadablePathResolution['attempts'];
  }
  | (Base64ResultFail & { mode: 'termux'; path?: string })
);

type ReadImageMetadataMethod = (
  filePath: string
) => Promise<
  | { ok: true; mode: 'termux'; path: string; tool: string; metadata: unknown }
  | { ok: false; mode: 'termux'; error: string; message: string; details?: Record<string, unknown> }
>;

type ImageToBase64Method = (
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

type JsonRecord = Record<string, unknown>;

const toRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === 'object' ? (value as JsonRecord) : null;

type ImageProcessorLike = {
  parseImageFit: (rawFit?: string) => UiFit;
  getMetadata: ReadImageMetadataMethod;
  toBase64: ImageToBase64Method;
};

type CliRouting = { mode: 'shizuku'; command: string } | { mode: 'unsupported'; command: string; reason: string };

interface ArgumentParserLike {
  parse(argv: string[]): ParsedArgs;
  getFlagString(flags: ArgFlags, key: string): string | undefined;
  hasFlag(flags: ArgFlags, key: string): boolean;
  hasAnyFlag(flags: ArgFlags, ...keys: string[]): boolean;
  getPostLaunchWaitOptions(flags: ArgFlags): PostLaunchOptions;
  parsePositiveInt(value: unknown, fallback: number, min?: number): number;
}

interface ActionLike {
  screenshot: (outputPath: string | null) => Promise<{ path: string; androidPath: string; requestedPath: string | null }>;
  currentApp: () => Promise<{ packageName: string | null; activity: string | null; raw: string }>;
  launch: (packageName: string, activity: string | null) => Promise<{ ok: true; packageName: string; activity: string | null }>;
  kill: (packageName: string) => Promise<{ ok: true; packageName: string }>;
  tap: (x: number, y: number) => Promise<{ ok: true; x: number; y: number }>;
  tapElement: (selector: UiSelector) => Promise<{ element: unknown; tapped: { x: number; y: number } }>;
  swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<{ ok: true }>;
  press: (key: string) => Promise<{ ok: true; key: string; keycode: number }>;
  type: (
    text: string,
    timeoutMs?: number,
    method?: 'auto' | 'input-text' | 'clipboard' | 'adb-keyboard',
    options?: {
      focus?: boolean;
      focusSelector?: UiSelector | null;
      focusTimeoutMs?: number;
      inputMode?: 'append' | 'new';
    }
  ) => Promise<{ ok: true; method: 'input-text' | 'clipboard' | 'adb-keyboard'; text: string }>;
  uiDump: (selector?: UiSelector | null) => Promise<unknown[]>;
  waitFor: (selector: UiSelector, timeoutMs?: number) => Promise<unknown>;
  deviceInfo: () => Promise<{ ok: true; model: string; androidVersion: string; sdkVersion: string; manufacturer: string }>;
  batteryInfo: () => Promise<{ ok: true; level: string | null; charging: boolean; temperature: string | null; raw: string }>;
  installedApps: () => Promise<{ ok: true; packages: string[] }>;
  screenSize: () => Promise<{ ok: true; width: number | null; height: number | null; raw?: string }>;
  exec: (command: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

interface ExecCommandRouterLike {
  route(command: string): CliRouting;
  getSupportedCommands(): string[];
}

interface PackageMonitorLike {
  waitForForegroundPackage(
    actions: Pick<ActionLike, 'currentApp'>,
    packageName: string,
    options: PostLaunchOptions
  ): Promise<{
    ok: boolean;
    stable: boolean;
    packageName: string | null;
    activity: string | null;
    raw: string;
    waitedMs: number;
    timeoutMs?: number;
    reason?: string;
  }>;
}

interface CliCallLoggerLike {
  start(session: CliCurrentCall, config: unknown): void;
  finish(session: unknown, status: 'ok' | 'error', data?: unknown, error?: unknown): void;
}

interface CliCurrentCall {
  command: string;
  args: ParsedArgs;
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

type UiFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside';

interface CliLoggerWriter {
  ok(data: unknown): void;
  fail(error: string, message: string, extra?: Record<string, unknown>): void;
}

class CliRuntime {
  private activeResponder: CliLoggerWriter | null = null;
  private readonly _logger: CliCallLoggerLike;
  private readonly _pathResolver: LocalTmpPathResolverLike;
  private readonly _fileService: { readLocalFileAsBase64: Base64ReadMethod; readLocalFileAsText: ReadTextMethod };
  private readonly _imageProcessor: ImageProcessorLike;
  private readonly _argumentParser: ArgumentParserLike;
  private readonly _packageMonitor: PackageMonitorLike;
  private readonly _commandRouter: ExecCommandRouterLike;

  constructor(
    logger: CliCallLoggerLike,
    pathResolver: LocalTmpPathResolverLike,
    fileService: { readLocalFileAsBase64: Base64ReadMethod; readLocalFileAsText: ReadTextMethod },
    imageProcessor: ImageProcessorLike,
    argumentParser: ArgumentParserLike,
    packageMonitor: PackageMonitorLike,
    commandRouter: ExecCommandRouterLike
  ) {
    this._logger = logger;
    this._pathResolver = pathResolver;
    this._fileService = fileService;
    this._imageProcessor = imageProcessor;
    this._argumentParser = argumentParser;
    this._packageMonitor = packageMonitor;
    this._commandRouter = commandRouter;
  }

  public beginSession(session: CliCurrentCall, bridgeConfigInfo: unknown = null): void {
    this.activeResponder = new CliResponseWriter(this._logger, session);
    this._logger.start(session, bridgeConfigInfo);
  }

  public ok(data: unknown): void {
    if (this.activeResponder) {
      this.activeResponder.ok(data);
    }
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
    process.exit(0);
  }

  public fail(error: string, message: string, extra: Record<string, unknown> = {}): void {
    if (this.activeResponder) {
      this.activeResponder.fail(error, message, extra);
    }
    process.stdout.write(JSON.stringify({ ok: false, error, message, ...extra }) + '\n');
    process.exit(1);
  }

  public parseArgs(argv: string[]): ParsedArgs {
    return this._argumentParser.parse(argv);
  }

  public parseSelector(raw: string): UiSelector {
    try {
      const parsed = JSON.parse(raw);
      if (!toRecord(parsed)) {
        this.fail('INVALID_ARGS', 'Selector must be a JSON object');
      }
      return parsed as UiSelector;
    } catch {
      this.fail('INVALID_ARGS', `Selector must be valid JSON: ${raw}`);
      return {} as UiSelector;
    }
  }

  public parseImageFit(rawFit: string | undefined): UiFit {
    return this._imageProcessor.parseImageFit(rawFit);
  }

  public getFlagString(flags: ArgFlags, key: string): string | undefined {
    return this._argumentParser.getFlagString(flags, key);
  }

  public hasFlag(flags: ArgFlags, key: string): boolean {
    return this._argumentParser.hasFlag(flags, key);
  }

  public hasAnyFlag(flags: ArgFlags, ...keys: string[]): boolean {
    return this._argumentParser.hasAnyFlag(flags, ...keys);
  }

  public getPostLaunchWaitOptions(flags: ArgFlags): PostLaunchOptions {
    return this._argumentParser.getPostLaunchWaitOptions(flags);
  }

  public parsePositiveInt(value: unknown, fallback: number, min = 1): number {
    return this._argumentParser.parsePositiveInt(value, fallback, min);
  }

  public waitForForegroundPackage(
    actions: Pick<ActionLike, 'currentApp'>,
    packageName: string,
    options: PostLaunchOptions
  ): Promise<{ ok: boolean; stable: boolean; packageName: string | null; activity: string | null; raw: string; waitedMs: number; timeoutMs?: number; }> {
    return this._packageMonitor.waitForForegroundPackage(actions, packageName, options);
  }

  public resolveExecRouting(command: string): CliRouting {
    return this._commandRouter.route(command);
  }

  public getShizukuExecSupportedCommands(): string[] {
    return this._commandRouter.getSupportedCommands();
  }

  public resolveReadableLocalPath(filePath: string): ReadablePathResolution {
    return this._pathResolver.resolveReadableLocalPath(filePath);
  }

  public readLocalFileAsBase64(
    filePath: string,
    maxChars = DEFAULT_SCREENSHOT_BASE64_CHARS
  ): ReturnType<Base64ReadMethod> {
    return this._fileService.readLocalFileAsBase64(filePath, maxChars);
  }

  public readLocalFileAsText(
    filePath: string,
    maxBytes = READ_FILE_MAX_BYTES_DEFAULT
  ): ReturnType<ReadTextMethod> {
    return this._fileService.readLocalFileAsText(filePath, maxBytes);
  }

  public async getImageMetadata(filePath: string): ReturnType<ImageProcessorLike['getMetadata']> {
    return this._imageProcessor.getMetadata(filePath);
  }

  public async imageToBase64(
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
  ): ReturnType<ImageProcessorLike['toBase64']> {
    return this._imageProcessor.toBase64(filePath, maxChars, options);
  }

  public getFailureMessage(value: unknown, fallback: string): string {
    const record = toRecord(value);
    if (!record) {
      return fallback;
    }
    const message = record.message;
    return typeof message === 'string' && message.length > 0 ? message : fallback;
  }

  public getFailureDetails(value: unknown): Record<string, unknown> {
    const record = toRecord(value);
    if (!record) {
      return {};
    }
    return {
      error: record.error,
      message: record.message,
    };
  }
}

module.exports = {
  CliRuntime,
};
