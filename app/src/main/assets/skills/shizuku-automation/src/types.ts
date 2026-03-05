export enum ErrorCode {
  BRIDGE_NOT_FOUND = 'BRIDGE_NOT_FOUND',
  BRIDGE_UNREACHABLE = 'BRIDGE_UNREACHABLE',
  SHIZUKU_NOT_READY = 'SHIZUKU_NOT_READY',
  EXEC_FAILED = 'EXEC_FAILED',
  TIMEOUT = 'TIMEOUT',
  TERMUX_FILE_NOT_FOUND = 'LOCAL_FILE_NOT_FOUND',
  TERMUX_FILE_TOO_LARGE = 'LOCAL_FILE_TOO_LARGE',
  TERMUX_FILE_READ_FAILED = 'LOCAL_FILE_READ_FAILED',
  TERMUX_EXEC_FAILED = 'TERMUX_EXEC_FAILED',
  INVALID_ARGS = 'INVALID_ARGS',
  IMAGE_TOOL_MISSING = 'IMAGE_TOOL_MISSING',
  IMAGE_FORMAT_UNSUPPORTED = 'IMAGE_FORMAT_UNSUPPORTED',
  IMAGE_FORMAT_INVALID = 'IMAGE_FORMAT_INVALID',
  IMAGE_CONVERT_FAILED = 'IMAGE_CONVERT_FAILED',
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  ELEMENT_NO_BOUNDS = 'ELEMENT_NO_BOUNDS',
  NO_TWEET_ROW_FOUND = 'NO_TWEET_ROW_FOUND',
  INVALID_KEY = 'INVALID_KEY',
  INVALID_PATH = 'INVALID_PATH',
  TIMEOUT_WAIT = 'TIMEOUT',
  APP_NOT_STABLE = 'APP_NOT_STABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  UNKNOWN_COMMAND = 'UNKNOWN_COMMAND',
  DUMP_FAILED = 'DUMP_FAILED',
  FLOW_STEP_FAILED = 'FLOW_STEP_FAILED',
  UNCAUGHT = 'UNCAUGHT',
}

export interface ResultOk<T extends Record<string, unknown>> {
  ok: true;
  [key: string]: unknown;
}

export interface ResultErr<E extends string = string> {
  ok: false;
  error: E;
  message: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export type Result<T extends Record<string, unknown> = Record<string, never>, E extends string = ErrorCode> =
  (ResultOk<T> & { ok: true }) | (ResultErr<E> & { ok: false });

export type JsonDictionary = Record<string, unknown>;

export interface BridgeConfig {
  host: string;
  port: number;
  token: string;
  [key: string]: JsonDictionary[keyof JsonDictionary];
}

export interface BridgeResponseText {
  ok: boolean;
  error?: string;
  message?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  type: 'text';
  [key: string]: unknown;
}

export interface BridgeResponseFile {
  ok: boolean;
  error?: string;
  message?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  path: string;
  bytes?: number;
  type: 'file';
  [key: string]: unknown;
}

export type BridgeResponseUnion = BridgeResponseText | BridgeResponseFile;

export interface ParsedArgs {
  flags: ArgFlags;
  positional: string[];
}

export type ArgValue = string | boolean;
export type ArgFlags = Record<string, ArgValue>;

export interface PostLaunchOptions {
  timeoutMs: number;
  stableCycles: number;
  pollMs: number;
  transientToleranceMs: number;
}

export interface ReadPathAttempt {
  path: string;
  reason: string;
  size?: number;
  message?: string;
  code?: string | null;
  detail?: string;
}

export interface ReadablePathResolution {
  ok: boolean;
  path: string;
  size: number | null;
  attempts: ReadPathAttempt[];
}

export interface UiBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiPoint {
  x: number;
  y: number;
}

export interface UiElement {
  text: string;
  resourceId: string;
  className: string;
  description: string;
  bounds: UiBounds | null;
  center: UiPoint | null;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  packageName: string;
}

export interface UiSelector {
  text?: string;
  textContains?: string;
  resourceId?: string;
  className?: string;
  description?: string;
  descriptionContains?: string;
  clickable?: boolean;
  enabled?: boolean;
  packageName?: string;
  [key: string]: unknown;
}

export interface UiEngineDumpResult {
  ok: true;
  elements: UiElement[];
}

export interface BridgeClientConfigInfo {
  path: string;
  exists: boolean;
  home: string | null;
  cwd: string;
  lastError: string | null;
}

export interface ScreenshotResult {
  ok: true;
  path: string;
  androidPath: string;
  requestedPath: string | null;
}

export interface Base64Result {
  ok: boolean;
  mode: 'termux';
  path: string;
  base64: string;
  totalChars: number;
  clipped: boolean;
}

export interface TermuxFileReadTextResult {
  ok: true;
  mode: 'termux';
  path: string;
  size: number;
  text: string;
  attempts: ReadPathAttempt[];
}

export interface ReadFileResult {
  ok: true;
  path: string;
  size: number | null;
  attempts: ReadPathAttempt[];
}

export interface LatestTweetCandidate {
  text: string;
  bounds: UiBounds | null;
  className: string;
  resourceId: string;
  description: string;
}

export interface LatestTweetResult {
  ok: true;
  mode: 'uiautomator';
  method: 'row-child-text' | 'row-description';
  packageName: string | null;
  selectedRow: {
    bounds: UiBounds | null;
    description: string;
    resourceId: string;
    top: number;
  };
  content: string;
  contentCandidates: LatestTweetCandidate[];
  candidateCount: number;
  source: 'ui-dump';
  stats: {
    rows: number;
    totalElements: number;
  };
}

export interface FailureCandidate {
  error: ErrorCode;
  message: string;
  [key: string]: unknown;
}

export type BridgeExecFailure = ResultErr<ErrorCode | string>;
