export {};
'use strict';

import type { ParsedArgs } from '../types';
const { isRecordObject } = require('./type-guards');

interface CliRuntimeLike {
  ok(data: unknown): never;
  fail(error: string, message: string, extra?: Record<string, unknown>): never;
  parseSelector(raw: string): Record<string, unknown>;
  parseImageFit(rawFit: string | undefined): string;
  getFlagString(flags: Record<string, string | boolean>, key: string): string | undefined;
  hasAnyFlag(flags: Record<string, string | boolean>, ...keys: string[]): boolean;
  hasFlag(flags: Record<string, string | boolean>, key: string): boolean;
  parsePositiveInt(value: unknown, fallback: number, min?: number): number;
  getPostLaunchWaitOptions(flags: Record<string, string | boolean>): {
    timeoutMs: number;
    stableCycles: number;
    pollMs: number;
    transientToleranceMs: number;
  };
  getShizukuExecSupportedCommands(): string[];
  waitForForegroundPackage(
    actions: { currentApp: () => Promise<{ packageName: string | null; activity: string | null; raw: string }> },
    packageName: string,
    options: { timeoutMs: number; stableCycles: number; pollMs: number; transientToleranceMs: number; }
  ): Promise<{ ok: boolean; stable: boolean; packageName: string | null; activity: string | null; raw: string; waitedMs: number; timeoutMs?: number; }>;
  resolveExecRouting(command: string): { mode: 'shizuku'; command: string } | { mode: 'unsupported'; command: string; reason: string };
  resolveReadableLocalPath(filePath: string): { ok: boolean; path: string; size: number | null; attempts: Array<Record<string, unknown>> };
  readLocalFileAsBase64(filePath: string, maxChars: number): unknown;
  readLocalFileAsText(filePath: string, maxBytes: number): unknown;
  imageToBase64(filePath: string, maxChars: number, options: Record<string, unknown>): Promise<unknown>;
  getImageMetadata(filePath: string): Promise<unknown>;
  getFailureMessage(value: unknown, fallback: string): string;
  getFailureDetails(value: unknown): Record<string, unknown>;
}

interface ActionsLike {
  screenshot: (outputPath: string | null) => Promise<{ path: string; androidPath: string; requestedPath: string | null }>;
  currentApp: () => Promise<{ packageName: string | null; activity: string | null; raw: string }>;
  launch: (packageName: string, activity: string | null) => Promise<{ ok: true; packageName: string; activity: string | null }>;
  kill: (packageName: string) => Promise<{ ok: true; packageName: string }>;
  tap: (x: number, y: number) => Promise<{ ok: true; x: number; y: number }>;
  tapElement: (selector: Record<string, unknown>) => Promise<{ element: unknown; tapped: { x: number; y: number } }>;
  swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<{ ok: true }>;
  press: (key: string) => Promise<{ ok: true; key: string; keycode: number }>;
  type: (text: string) => Promise<{ ok: true; method: 'input-text' | 'clipboard'; text: string }>;
  uiDump: (selector?: Record<string, unknown> | null) => Promise<unknown[]>;
  waitFor: (selector: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  deviceInfo: () => Promise<{ ok: true; model: string; androidVersion: string; sdkVersion: string; manufacturer: string }>;
  batteryInfo: () => Promise<{ ok: true; level: string | null; charging: boolean; temperature: string | null; raw: string }>;
  installedApps: () => Promise<{ ok: true; packages: string[] }>;
  screenSize: () => Promise<{ ok: true; width: number | null; height: number | null; raw?: string }>;
  exec: (command: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

interface LatestTweetAnalyzerLike {
  extractLatestTweetFromUiDump(
    dump: unknown,
    options: { packageName?: string | null; minTextLength?: number }
  ): {
    ok: false; error: string; message: string; packageName: string | null; count: number;
  } | {
    ok: true; mode: 'uiautomator'; method: 'row-child-text' | 'row-description'; packageName: string | null;
    selectedRow: { bounds: unknown; description: string; resourceId: string; top: number; };
    content: string; contentCandidates: unknown[]; candidateCount: number; source: 'ui-dump'; stats: { rows: number; totalElements: number; };
  };
}

class CliCommandHandler {
  private static readonly DEFAULT_TEXT_LENGTH = 20;
  private static readonly DEFAULT_READ_FILE_BYTES = 10 * 1024 * 1024;
  private static readonly DEFAULT_IMAGE_CHARS = 120000;

  constructor(
    private readonly runtime: CliRuntimeLike,
    private readonly latestTweetAnalyzer: LatestTweetAnalyzerLike
  ) {}

  public async execute(
    command: string,
    args: ParsedArgs,
    bridgeClient: { isAvailable: () => Promise<unknown> },
    actions: ActionsLike
  ): Promise<void> {
    const ok = this.runtime.ok.bind(this.runtime);
    const fail = this.runtime.fail.bind(this.runtime);
    const parseSelector = this.runtime.parseSelector.bind(this.runtime);

    try {
      switch (command) {
        case 'status': {
          const res = await (bridgeClient as unknown as { isAvailable: () => Promise<unknown> }).isAvailable();
          ok(res);
          break;
        }

        case 'screenshot': {
          ok(await this.handleScreenshot(args, actions));
          break;
        }

        case 'current-app': {
          const res = await actions.currentApp();
          ok(res);
          break;
        }

        case 'launch': {
          ok(await this.handleLaunch(args, actions));
          break;
        }

        case 'kill': {
          const pkg = args.positional[0];
          if (!pkg) fail('INVALID_ARGS', 'Usage: kill <package>');
          const res = await actions.kill(pkg);
          ok(res);
          break;
        }

        case 'tap': {
          const x = parseFloat(args.positional[0]);
          const y = parseFloat(args.positional[1]);
          if (isNaN(x) || isNaN(y)) fail('INVALID_ARGS', 'Usage: tap <x> <y>');
          const res = await actions.tap(x, y);
          ok(res);
          break;
        }

        case 'tap-element': {
          const raw = args.positional[0];
          if (!raw) fail('INVALID_ARGS', `Usage: tap-element '{\"text\":\"OK\"}'`);
          const selector = parseSelector(raw);
          const res = await actions.tapElement(selector);
          ok(res);
          break;
        }

        case 'swipe': {
          const [x1, y1, x2, y2, dur] = args.positional.map(Number);
          if ([x1, y1, x2, y2].some(isNaN)) {
            fail('INVALID_ARGS', 'Usage: swipe <x1> <y1> <x2> <y2> [durationMs]');
          }
          const res = await actions.swipe(x1, y1, x2, y2, dur || 300);
          ok(res);
          break;
        }

        case 'press': {
          const key = args.positional[0];
          if (!key) fail('INVALID_ARGS', 'Usage: press <key> (home/back/enter/recent/paste/...)');
          const res = await actions.press(key);
          ok(res);
          break;
        }

        case 'type': {
          const text = args.positional[0] !== undefined ? args.positional.join(' ') : this.runtime.getFlagString(args.flags, 'text');
          if (text === undefined) {
            fail('INVALID_ARGS', 'Usage: type <text>');
            break;
          }
          const res = await actions.type(text);
          ok(res);
          break;
        }

        case 'ui-dump': {
          const rawSelector = this.runtime.getFlagString(args.flags, 'find');
          const selector = rawSelector ? parseSelector(rawSelector) : null;
          const packageName = this.runtime.getFlagString(args.flags, 'package')
            || this.runtime.getFlagString(args.flags, 'app-package')
            || null;
          if (packageName) {
            const wait = await this.runtime.waitForForegroundPackage(
              actions,
              packageName,
              this.runtime.getPostLaunchWaitOptions(args.flags)
            );
            if (!wait.ok) {
              fail('APP_NOT_STABLE', `Target app not stable in foreground before ui-dump: ${packageName}`, {
                packageName,
                timeoutMs: wait.timeoutMs,
                waitedMs: wait.waitedMs,
                lastPackage: wait.packageName,
                lastActivity: wait.activity,
                raw: wait.raw,
              });
            }
          }
          const data = await actions.uiDump(selector);
          ok(data);
          break;
        }

        case 'wait-for': {
          const raw = args.positional[0];
          if (!raw) fail('INVALID_ARGS', "Usage: wait-for '{\"text\":\"OK\"}' [--timeout ms]");
          const selector = parseSelector(raw);
          const timeout = parseInt(this.runtime.getFlagString(args.flags, 'timeout') || '10000', 10);
          const el = await actions.waitFor(selector, timeout);
          ok({ element: el });
          break;
        }

        case 'device-info': {
          const res = await actions.deviceInfo();
          ok(res);
          break;
        }

        case 'battery': {
          const res = await actions.batteryInfo();
          ok(res);
          break;
        }

        case 'installed-apps': {
          const res = await actions.installedApps();
          ok(res);
          break;
        }

        case 'screen-size': {
          const res = await actions.screenSize();
          ok(res);
          break;
        }

        case 'latest-tweet': {
          ok(await this.handleLatestTweet(args, actions));
          break;
        }

        case 'read-file': {
          ok(await this.handleReadFile(args));
          break;
        }

        case 'image-meta': {
          ok(await this.handleImageMeta(args));
          break;
        }

        case 'image-to-base64': {
          ok(await this.handleImageToBase64(args));
          break;
        }

        case 'exec': {
          ok(await this.handleExec(args, actions));
          break;
        }

        default:
          fail('UNKNOWN_COMMAND', `Unknown command: ${command}. Run 'help' for usage.`);
      }
    } catch (err) {
      const failExtra: Record<string, unknown> = {};
      const errRecord = isRecordObject(err) ? (err as Record<string, unknown>) : null;
      if (errRecord) {
        for (const [key, value] of Object.entries(errRecord)) {
          if (key === 'code' || key === 'message' || key === 'stack') {
            continue;
          }
          failExtra[key] = value;
        }
        if (errRecord.dumpDiagnostics) {
          failExtra.dumpDiagnostics = errRecord.dumpDiagnostics;
        }
        if (errRecord.originalCode) {
          failExtra.originalCode = errRecord.originalCode;
        }
        if (errRecord.originalMessage) {
          failExtra.originalMessage = errRecord.originalMessage;
        }
        failExtra.stack = errRecord.stack || null;
      }
      const failCode = errRecord && typeof errRecord.code === 'string'
        ? String(errRecord.code)
        : errRecord && typeof errRecord.code === 'number'
          ? String(errRecord.code)
          : 'ERROR';
      const failMessage = errRecord && typeof errRecord.message === 'string'
        ? String(errRecord.message)
        : 'Unexpected error';
      fail(failCode, failMessage, failExtra);
    }
  }

  private async handleScreenshot(args: ParsedArgs, actions: ActionsLike): Promise<Record<string, unknown>> {
    const requestedOutput = this.runtime.getFlagString(args.flags, 'output')
      ? this.runtime.getFlagString(args.flags, 'output')!.trim()
      : null;
    const res = await actions.screenshot(requestedOutput);
    const sourcePath = (res as { termuxPath?: string; path: string }).termuxPath || res.path;
    const localResolved = this.runtime.resolveReadableLocalPath(sourcePath);

    const response: Record<string, unknown> = {
      ...(res as Record<string, unknown>),
      androidPath: (res as { androidPath?: string; path: string }).androidPath || res.path,
      termuxPath: (localResolved as { ok: boolean; path?: string }).ok
        ? (localResolved as { path: string }).path
        : sourcePath,
      pathResolution: localResolved,
    };

    if (!this.runtime.hasAnyFlag(args.flags, 'base64', 'as-base64')) {
      return response;
    }

    const rawFormat = this.runtime.getFlagString(args.flags, 'format') || 'png';
    const maxChars = parseInt(this.runtime.getFlagString(args.flags, 'max-chars') || '', 10);
    const safeMaxChars = Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 120000;

    if (!localResolved.ok) {
      this.runtime.fail(
        'TERMUX_FILE_UNREADABLE',
        'Failed to resolve screenshot path in Termux',
        {
          requestedPath: res.path,
          attempts: localResolved.attempts,
        }
      );
    }

    const resolvedPath = (localResolved as { path: string }).path;
    const width = parseInt(this.runtime.getFlagString(args.flags, 'width') || '', 10);
    const height = parseInt(this.runtime.getFlagString(args.flags, 'height') || '', 10);
    const qualityRaw = parseInt(this.runtime.getFlagString(args.flags, 'quality') || '', 10);
    const transform = {
      format: String(rawFormat || 'png').toLowerCase(),
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      fit: this.runtime.parseImageFit(this.runtime.getFlagString(args.flags, 'fit')),
      rotate: parseInt(this.runtime.getFlagString(args.flags, 'rotate') || '', 10),
      grayscale: Boolean(args.flags.grayscale),
      normalize: Boolean(args.flags.normalize),
      quality: Number.isFinite(qualityRaw)
        ? Math.max(1, Math.min(100, qualityRaw))
        : null,
    };

    const base64Res = await this.runtime.imageToBase64(
      resolvedPath,
      safeMaxChars,
      transform
    ) as Record<string, unknown>;

    if (!isRecordObject(base64Res) || !base64Res.ok) {
      this.runtime.fail(
        this.runtime.getFailureMessage(base64Res, 'TERMUX_FILE_READ_FAILED'),
        this.runtime.getFailureMessage(base64Res, 'Failed to read screenshot file'),
        isRecordObject(base64Res) ? this.runtime.getFailureDetails(base64Res) : {}
      );
    }

    response.base64 = String(base64Res.base64 || '');
    response.base64Source = String(base64Res.path || '');
    response.base64Length = String(base64Res.base64 || '').length;
    response.base64Clipped = Boolean(base64Res.clipped);
    response.base64Tool = base64Res.tool ? String(base64Res.tool) : 'sharp';
    const base64Bytes = typeof (base64Res as { bytes?: number }).bytes === 'number'
      ? (base64Res as { bytes?: number }).bytes
      : undefined;
    const totalBytes = typeof (base64Res as { totalBytes?: number }).totalBytes === 'number'
      ? (base64Res as { totalBytes?: number }).totalBytes
      : undefined;
    if (base64Bytes !== undefined || totalBytes !== undefined) {
      response.base64SourceBytes = base64Bytes || totalBytes || 0;
    }
    if (base64Res.width !== undefined && base64Res.width !== null) {
      response.base64Width = base64Res.width;
    }
    if (base64Res.height !== undefined && base64Res.height !== null) {
      response.base64Height = base64Res.height;
    }
    if (base64Res.format !== undefined) {
      response.base64Format = base64Res.format;
    }

    return response;
  }

  private async handleLatestTweet(args: ParsedArgs, actions: ActionsLike): Promise<Record<string, unknown>> {
    const packageName = this.runtime.getFlagString(args.flags, 'package')
      || this.runtime.getFlagString(args.flags, 'app-package')
      || args.positional[0]
      || null;
    const minTextLength = this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'min-text-length'),
      CliCommandHandler.DEFAULT_TEXT_LENGTH,
      1
    );

    const dump = await actions.uiDump();
    if (!Array.isArray(dump)) {
      this.runtime.fail('INTERNAL_ERROR', 'Unexpected ui-dump result', {
        type: typeof dump,
      });
    }

    const extracted = this.latestTweetAnalyzer.extractLatestTweetFromUiDump(dump || [], {
      packageName,
      minTextLength,
    });
    if (!extracted.ok) {
      this.runtime.fail(extracted.error, extracted.message, {
        packageName: packageName || null,
        totalElements: dump.length,
      });
    }

    return extracted;
  }

  private async handleReadFile(args: ParsedArgs): Promise<Record<string, unknown>> {
    const filePath = args.positional[0];
    if (!filePath) {
      this.runtime.fail('INVALID_ARGS', 'Usage: read-file <path> [--max-bytes N] [--base64]');
    }

    const safeMaxBytes = this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'max-bytes'),
      CliCommandHandler.DEFAULT_READ_FILE_BYTES,
      1
    );
    const resolved = this.runtime.resolveReadableLocalPath(filePath);
    if (!resolved.ok) {
      this.runtime.fail('LOCAL_FILE_NOT_FOUND', 'No readable file in Termux', {
        requestedPath: filePath,
        attempts: resolved.attempts,
      });
    }

    const safeMaxChars = this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'max-chars'),
      CliCommandHandler.DEFAULT_IMAGE_CHARS,
      1
    );
    const wantBase64 = this.runtime.hasAnyFlag(args.flags, 'base64', 'b64', 'as-base64');

    if (wantBase64) {
      const readBase64Result = this.runtime.readLocalFileAsBase64((resolved as { path: string }).path, safeMaxChars) as Record<
        string,
        unknown
      >;
      if (!readBase64Result.ok) {
        this.runtime.fail(
          String(readBase64Result.error || 'LOCAL_FILE_READ_FAILED'),
          String(readBase64Result.message || '')
        );
      }

      return {
        path: filePath,
        resolvedPath: resolved.path,
        attempts: resolved.attempts,
        mode: 'termux',
        size: readBase64Result.size || 0,
        totalChars: readBase64Result.totalChars,
        base64Length: String(readBase64Result.base64 || '').length,
        base64Clipped: readBase64Result.clipped || false,
        base64: readBase64Result.base64,
      };
    }

    const readTextResult = this.runtime.readLocalFileAsText((resolved as { path: string }).path, safeMaxBytes) as Record<
      string,
      unknown
    >;
    if (!readTextResult.ok) {
      this.runtime.fail(
        String(readTextResult.error || 'LOCAL_FILE_READ_FAILED'),
        String(readTextResult.message || '')
      );
    }

    return {
      path: filePath,
      resolvedPath: resolved.path,
      attempts: resolved.attempts,
      mode: 'termux',
      size: readTextResult.size || null,
      text: readTextResult.text || '',
    };
  }

  private async handleImageMeta(args: ParsedArgs): Promise<Record<string, unknown>> {
    const imagePath = args.positional[0];
    if (!imagePath) {
      this.runtime.fail('INVALID_ARGS', 'Usage: image-meta <imagePath>');
    }

    const localResolved = this.runtime.resolveReadableLocalPath(imagePath);
    if (!localResolved.ok) {
      this.runtime.fail('LOCAL_FILE_NOT_FOUND', 'No readable image path in Termux', {
        requestedPath: imagePath,
        attempts: localResolved.attempts,
      });
    }

    const metaRes = (await this.runtime.getImageMetadata((localResolved as { path: string }).path)) as Record<string, unknown>;
    if (!metaRes.ok) {
      this.runtime.fail(
        String(metaRes.error || 'IMAGE_METADATA_FAILED'),
        String(metaRes.message || ''),
        (metaRes.details as Record<string, unknown>) || {}
      );
    }

    return localResolved.path !== imagePath
      ? { ...metaRes, requestedPath: imagePath, pathResolution: localResolved }
      : metaRes;
  }

  private async handleImageToBase64(args: ParsedArgs): Promise<Record<string, unknown>> {
    const imagePath = args.positional[0];
    if (!imagePath) {
      this.runtime.fail(
        'INVALID_ARGS',
        'Usage: image-to-base64 <imagePath> [--format png|jpeg|webp] [--width N] [--height N]'
      );
    }

    const localResolved = this.runtime.resolveReadableLocalPath(imagePath);
    if (!localResolved.ok) {
      this.runtime.fail('LOCAL_FILE_NOT_FOUND', 'No readable image path in Termux', {
        requestedPath: imagePath,
        attempts: localResolved.attempts,
      });
    }

    const transform = {
      format: String(this.runtime.getFlagString(args.flags, 'format') || 'png').toLowerCase(),
      width: this.runtime.parsePositiveInt(this.runtime.getFlagString(args.flags, 'width'), 0, 1) || null,
      height: this.runtime.parsePositiveInt(this.runtime.getFlagString(args.flags, 'height'), 0, 1) || null,
      quality: this.runtime.parsePositiveInt(this.runtime.getFlagString(args.flags, 'quality'), 0, 1) || null,
      fit: this.runtime.parseImageFit(this.runtime.getFlagString(args.flags, 'fit')),
      rotate: this.runtime.parsePositiveInt(this.runtime.getFlagString(args.flags, 'rotate'), 0, 0),
      grayscale: Boolean(args.flags.grayscale),
      normalize: Boolean(args.flags.normalize),
    };

    if (transform.quality !== null && transform.quality > 100) {
      transform.quality = 100;
    }

    const base64Res = (await this.runtime.imageToBase64(
      (localResolved as { path: string }).path,
      this.runtime.parsePositiveInt(this.runtime.getFlagString(args.flags, 'max-chars'), CliCommandHandler.DEFAULT_IMAGE_CHARS, 1),
      transform
    )) as Record<string, unknown>;

    if (!base64Res.ok) {
      this.runtime.fail(
        String(base64Res.error || 'IMAGE_CONVERT_FAILED'),
        String(base64Res.message || ''),
        (base64Res.details as Record<string, unknown>) || {}
      );
    }

    return {
      requestedPath: imagePath,
      resolvedPath: localResolved.path,
      pathResolution: localResolved,
      ...base64Res,
    };
  }

  private async handleExec(args: ParsedArgs, actions: ActionsLike): Promise<Record<string, unknown>> {
    const cmd = args.positional.join(' ');
    if (!cmd) {
      this.runtime.fail('INVALID_ARGS', 'Usage: exec <shell command>');
    }

    const safeTimeout = this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'timeout'),
      30000,
      1
    );
    const routing = this.runtime.resolveExecRouting(cmd);
    if (routing.mode === 'unsupported') {
      this.runtime.fail('UNSUPPORTED_COMMAND', routing.reason || `Unsupported exec command: ${cmd}`, {
        command: routing.command,
        supported: [...this.runtime.getShizukuExecSupportedCommands()],
      });
    }

    const res = await actions.exec(routing.command, safeTimeout);
    const execResult = isRecordObject(res) ? { ...res } : {};
    if (!('mode' in execResult)) {
      (execResult as { mode: string }).mode = routing.mode;
    }

    return execResult;
  }

  private async handleLaunch(args: ParsedArgs, actions: ActionsLike): Promise<Record<string, unknown>> {
    const pkg = args.positional[0];
    const activity = args.positional[1] || this.runtime.getFlagString(args.flags, 'activity') || null;
    if (!pkg) {
      this.runtime.fail('INVALID_ARGS', 'Usage: launch <package> [activity]');
    }

    const res = await actions.launch(pkg, activity);
    const wait = await this.runtime.waitForForegroundPackage(
      actions,
      pkg,
      this.runtime.getPostLaunchWaitOptions(args.flags)
    );
    if (!wait.ok) {
      this.runtime.fail('APP_NOT_STABLE', `App did not stabilize in foreground after launch: ${pkg}`, {
        packageName: pkg,
        timeoutMs: wait.timeoutMs,
        waitedMs: wait.waitedMs,
        lastPackage: wait.packageName,
        lastActivity: wait.activity,
        raw: wait.raw,
      });
    }

    return {
      ...res,
      stable: wait.stable,
      waitedMs: wait.waitedMs,
      foregroundPackage: wait.packageName,
      foregroundActivity: wait.activity,
    };
  }

  public showHelp(): void {
    console.log(`
Shizuku Android Automation — OpenClaw Skill

  USAGE: node cli.js <command> [args...]

  COMMANDS:
  status                              Check Bridge + Shizuku status
  screenshot [--base64] [--format png|jpeg|webp] [--width N] [--height N] [--quality 1-100] [--fit]
                                      Take screenshot (returns file path; --base64 always re-encodes via sharp)
                                      Output path must be under /data/local/tmp.
  current-app                         Get foreground app info
  launch <pkg> [activity]             Launch app by package name, then wait for foreground stability
                                      Optional flags: --post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms --post-launch-transient-tolerance-ms
  kill <pkg>                          Force stop app
  tap <x> <y>                         Tap screen coordinates
  tap-element '<selector>'             Find element and tap it
  swipe <x1> <y1> <x2> <y2> [ms]     Swipe gesture
  press <key>                         Press key (home/back/enter/recent/paste)
  type <text>                         Input text (auto handles Chinese)
  ui-dump [--find '<selector>'] [--package com.xx] [--post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms --post-launch-transient-tolerance-ms]
                                      Dump UI tree (optionally filtered); if --package passed, waits until package stable before dumping
  wait-for '<selector>' [--timeout]   Wait for element to appear
  device-info                         Device model, Android version
  battery                             Battery status
  installed-apps                      List installed packages
  screen-size                         Screen dimensions
  latest-tweet [package] [--package com.twitter.android] [--min-text-length 20]
                                      Read latest feed item text from ui-dump
  image-meta <path>                   Read image metadata via sharp
  image-to-base64 <path>              Re-encode image with resize/format and return base64
  read-file <path> [--base64]         Read local file in termux; --base64 for binary-safe text. Must be under /data/local/tmp.
  exec <cmd>                          Execute shell command.
                                       Only whitelist commands use Shizuku bridge; unsupported commands return error.

PATH POLICY:
  All skill file operations only accept /data/local/tmp/... paths. No shared-root remapping is performed.

OPENING RULE:
  Default: use ui-dump/tap-element first for open/click actions.
  The exception is app launch (launch command), which must use am start.

SELECTOR FORMAT (JSON):
  {\"text\":\"发送\"}                     Exact text match
  {\"textContains\":\"发\"}               Text contains
  {\"resourceId\":\"com.xx:id/btn\"}      Resource ID
  {\"className\":\"android.widget.Button\"}
  {\"description\":\"Send\"}              Content description
  {\"text\":\"OK\",\"clickable\":true}      Combined (AND logic)

OUTPUT: Always JSON — {\"ok\":true,\"data\":{...}} or {\"ok\":false,\"error\":\"CODE\",\"message\":\"...\"}
`.trim());
  }
}

module.exports = {
  CliCommandHandler,
};
