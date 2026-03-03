#!/usr/bin/env node
// @ts-nocheck
export {}
'use strict';

const fs = require('fs');
const path = require('path');
const { exec: execInShell } = require('child_process');
const Module = require('module');
const { BridgeClient } = require('./lib/bridge-client');
const { UIEngine } = require('./lib/ui-engine');
const { Actions } = require('./lib/actions');
const { getBotdropTmpDir, getReadablePathCandidates } = require('./lib/path-utils');

const DEFAULT_SHARED_HOME = '/data/local/tmp/botdrop_tmp';
const SHARED_ROOT_CANDIDATES = [
  DEFAULT_SHARED_HOME
];
const BOTDROP_TERMUX_HOME = (() => {
  const candidates = [
    process.env.BOTDROP_TERMUX_HOME,
    process.env.TERMUX_HOME,
    process.env.HOME,
    '/data/data/com.termux/files/home',
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim();
    if (!normalized) continue;
    try {
      fs.mkdirSync(normalized, { recursive: true });
      fs.accessSync(normalized, fs.constants.R_OK | fs.constants.W_OK);
      return normalized;
    } catch (_) {
      // ignore and try next candidate
    }
  }
  return '/tmp';
})();

// Commands that are Android/ADB-context centric: run only in Shizuku shell.
const SHIZUKU_EXEC_COMMANDS = Object.freeze([
  'am',
  'cmd',
  'dumpsys',
  'getprop',
  'input',
  'input-keyevent',
  'monkey',
  'pm',
  'service',
  'settings',
  'setprop',
  'screencap',
  'svc',
  'uiautomator',
  'ui automator',
  'wm',
]);
const SHIZUKU_EXEC_COMMAND_PREFIXES = new Set(SHIZUKU_EXEC_COMMANDS);

const LOCAL_EXEC_MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_SCREENSHOT_BASE64_CHARS = 120000;
const DEFAULT_SCREENSHOT_OCR_TIMEOUT_MS = 30000;
const READ_FILE_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;
const DEFAULT_IMAGE_TRANSFORM_MAX_CHARS = 120000;
const LOG_MAX_STRING_CHARS = 4096;
const LOG_MAX_ARRAY_LENGTH = 64;
const LOG_MAX_OBJECT_KEYS = 64;
const LOG_MAX_OBJECT_DEPTH = 8;
const SHARED_ROOT_DIR = (() => {
  const envSharedRoot = process.env.BOTDROP_SHARED_ROOT;
  const preferred = getBotdropTmpDir();
  const candidates = [envSharedRoot, preferred, ...SHARED_ROOT_CANDIDATES];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (!isSharedDirectoryCandidate(candidate)) continue;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return candidate;
    } catch (_) {
      // ignore and continue
    }
  }
  return DEFAULT_SHARED_HOME;
})();
const LAUNCH_STABILITY_TIMEOUT_MS = 12000;
const LAUNCH_STABILITY_STABLE_CYCLES = 2;
const LAUNCH_STABILITY_POLL_MS = 600;

function isSharedDirectoryCandidate(candidate = '') {
  const normalized = path.resolve(String(candidate || '').trim());
  return (
    normalized === '/data/local/tmp'
    || normalized.startsWith('/data/local/tmp/')
  );
}
const isLocalTmpPath = isSharedDirectoryCandidate;

function resolveLocalExecHome() {
  const candidates = [
    BOTDROP_TERMUX_HOME,
    process.cwd(),
    path.join(SHARED_ROOT_DIR, '.openclaw'),
    path.join(SHARED_ROOT_DIR, '.openclaw', 'shizuku'),
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

const LOCAL_EXEC_HOME = resolveLocalExecHome();
if (LOCAL_EXEC_HOME) {
  process.env.HOME = LOCAL_EXEC_HOME;
  try {
    process.chdir(LOCAL_EXEC_HOME);
  } catch (_) {
    // best effort: keep running from current directory if chdir is blocked
  }
}

function bootstrapGlobalNodePath() {
  try {
    const execDir = path.dirname(process.execPath);
    const globalNodeModules = path.join(path.dirname(execDir), 'lib', 'node_modules');
    const existing = (process.env.NODE_PATH || '')
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    const nextNodePaths = [];
    const seen = new Set();
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

bootstrapGlobalNodePath();

let sharpLib = undefined;

function tryResolveSharp(requirePath) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(requirePath);
  } catch {
    return null;
  }
}

function getGlobalNodeModulesPath() {
  const execDir = path.dirname(process.execPath);
  const parentDir = path.dirname(execDir);
  return path.join(parentDir, 'lib', 'node_modules');
}

function getConfiguredNodePaths() {
  return (process.env.NODE_PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry);
}

function resolveCliLogCandidates() {
  const candidates = [];
  const envHome = LOCAL_EXEC_HOME || process.env.HOME;
  if (envHome) {
    candidates.push(path.join(envHome, '.openclaw', 'shizuku-automation-cli.log'));
    const parentHome = path.dirname(envHome);
    if (parentHome && parentHome !== envHome) {
      candidates.push(path.join(parentHome, '.openclaw', 'shizuku-automation-cli.log'));
    }
  }
  const sharedHome = SHARED_ROOT_DIR;
  candidates.push(path.join(sharedHome, '.openclaw', 'shizuku-automation-cli.log'));
  return candidates;
}

const LOG_FILE_PATH = (() => {
  const candidates = [];
  if (process.env.BOTDROP_AUTOMATION_LOG_FILE) {
    candidates.push(process.env.BOTDROP_AUTOMATION_LOG_FILE);
  }
  candidates.push(...resolveCliLogCandidates());

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
})();

let currentCall = null;

function safeSerialize(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ unserializable: true });
  }
}

function truncateLongText(value) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= LOG_MAX_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, LOG_MAX_STRING_CHARS)}...(${value.length} chars total)`;
}

function sanitizeForLog(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return truncateLongText(value);
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
    return sanitizeForLog({
      name: value.name,
      message: value.message,
      code: value.code || null,
      stack: value.stack,
    }, depth, seen);
  }

  if (depth >= LOG_MAX_OBJECT_DEPTH) {
    return '[Object depth limit reached]';
  }

  if (Array.isArray(value)) {
    const limitedItems = value.slice(0, LOG_MAX_ARRAY_LENGTH).map(
      (item) => sanitizeForLog(item, depth + 1, seen)
    );
    if (value.length > LOG_MAX_ARRAY_LENGTH) {
      limitedItems.push(`...truncated ${value.length - LOG_MAX_ARRAY_LENGTH} items`);
    }
    return limitedItems;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const keys = Object.keys(value);
    const limitedKeys = keys.slice(0, LOG_MAX_OBJECT_KEYS);
    const output = {};
    for (const key of limitedKeys) {
      output[key] = sanitizeForLog(value[key], depth + 1, seen);
    }
    if (keys.length > LOG_MAX_OBJECT_KEYS) {
      output.__truncatedKeys = `...${keys.length - LOG_MAX_OBJECT_KEYS} keys truncated`;
    }
    seen.delete(value);
    return output;
  }

  return String(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value, fallback, min = 1) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return parsed;
}

function getPostLaunchWaitOptions(flags) {
  const timeoutMs = parsePositiveInt(
    flags && flags['post-launch-timeout-ms'],
    LAUNCH_STABILITY_TIMEOUT_MS,
    1
  );
  const stableCycles = parsePositiveInt(
    flags && flags['post-launch-stable-cycles'],
    LAUNCH_STABILITY_STABLE_CYCLES,
    1
  );
  const pollMs = parsePositiveInt(
    flags && flags['post-launch-settle-ms'],
    LAUNCH_STABILITY_POLL_MS,
    50
  );
  return { timeoutMs, stableCycles, pollMs };
}

async function waitForForegroundPackage(actions, packageName, options) {
  const target = String(packageName || '').trim();
  if (!target) {
    return {
      ok: true,
      stable: false,
      packageName: null,
      activity: null,
      raw: '',
      waitedMs: 0,
      reason: 'NO_TARGET_PACKAGE',
    };
  }

  const timeoutMs = parsePositiveInt(
    options && options.timeoutMs,
    LAUNCH_STABILITY_TIMEOUT_MS,
    1
  );
  const stableCycles = parsePositiveInt(
    options && options.stableCycles,
    LAUNCH_STABILITY_STABLE_CYCLES,
    1
  );
  const pollMs = parsePositiveInt(
    options && options.pollMs,
    LAUNCH_STABILITY_POLL_MS,
    50
  );

  const start = Date.now();
  let consecutiveMatches = 0;
  let lastResult = { packageName: null, activity: null, raw: '' };

  while (Date.now() - start < timeoutMs) {
    let current;
    try {
      current = await actions.currentApp();
    } catch (err) {
      current = {
        packageName: null,
        activity: null,
        raw: String(err && err.message ? err.message : err || ''),
      };
    }

    const pkg = current && current.packageName ? String(current.packageName) : null;
    const activity = current && current.activity ? String(current.activity) : null;
    lastResult = {
      packageName: pkg,
      activity,
      raw: current && current.raw ? String(current.raw).trim() : '',
    };

    if (pkg === target) {
      consecutiveMatches += 1;
      if (consecutiveMatches >= stableCycles) {
        return {
          ok: true,
          stable: true,
          packageName: pkg,
          activity,
          raw: lastResult.raw,
          waitedMs: Date.now() - start,
        };
      }
    } else {
      consecutiveMatches = 0;
    }

    if (Date.now() - start < timeoutMs) {
      await sleep(pollMs);
    }
  }

  return {
    ok: false,
    stable: false,
    timeoutMs,
    packageName: lastResult.packageName,
    activity: lastResult.activity,
    raw: lastResult.raw,
    waitedMs: Date.now() - start,
  };
}

function inferType(value) {
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

function normalizeLogPayload(value) {
  if (value === undefined) {
    return { value: null, serialized: null, type: 'undefined' };
  }
  const sanitized = sanitizeForLog(value);
  const serialized = safeSerialize(sanitized);
  return {
    value: sanitized,
    serialized,
    type: inferType(value),
  };
}

function appendCallLog(payload) {
  if (!LOG_FILE_PATH) {
    return;
  }
  const safePayload = sanitizeForLog(payload);
  const record = {
    ...safePayload,
    ts: new Date().toISOString(),
  };
  try {
    fs.appendFileSync(LOG_FILE_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch (error) {
    // keep CLI response stable; do not fail on logging issues
    process.stderr.write(
      `[cli-log] write failed: ${error && error.message ? error.message : String(error)}\n`
    );
  }
}

function finishCall(status, data = null, error = null) {
  if (!currentCall) {
    return;
  }
  const finish = Date.now();
  const durationMs = finish - currentCall.startMs;
  const payload = status === 'ok' ? normalizeLogPayload(data) : null;
  const errPayload = status === 'error' ? normalizeLogPayload(error) : null;
  appendCallLog({
    event: 'finish',
    command: currentCall.command,
    requestParams: currentCall.args,
    bridgeConfigPath: currentCall.bridgeConfigPath || null,
    resultStatus: status,
    responseTimeMs: durationMs,
    data: payload ? payload.value : null,
    dataSerialized: payload ? payload.serialized : null,
    dataType: payload ? payload.type : null,
    error: errPayload ? errPayload.value : null,
    errorSerialized: errPayload ? errPayload.serialized : null,
    errorType: errPayload ? errPayload.type : null,
    errorCode: errPayload && errPayload.value && errPayload.value.error ? errPayload.value.error : null,
    runtime: currentCall.runtime || null,
    success: status === 'ok',
  });
}

function collectRuntimeMeta() {
  return {
    home: LOCAL_EXEC_HOME || process.env.HOME || null,
    cwd: process.cwd(),
    shell: process.env.SHELL || null,
    pid: process.pid,
    nodeVersion: process.version,
  };
}

function ok(data) {
  finishCall('ok', data);
  process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
  process.exit(0);
}

function fail(error, message, extra = {}) {
  finishCall('error', null, { error, message, ...extra });
  process.stdout.write(JSON.stringify({ ok: false, error, message, ...extra }) + '\n');
  process.exit(1);
}

function parseSelector(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    fail('INVALID_ARGS', 'Selector must be valid JSON: ' + raw);
  }
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    showHelp();
    process.exit(0);
  }

  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  currentCall = {
    command,
    args,
    startMs: Date.now(),
    pid: process.pid,
    runtime: collectRuntimeMeta(),
  };

  const bridge = new BridgeClient(args.flags.config || undefined);
  currentCall.bridgeConfigPath = bridge.getConfigPath ? bridge.getConfigPath() : (args.flags.config || null);
  appendCallLog({
    event: 'start',
    command,
    requestParams: sanitizeForLog(args),
    resultStatus: 'start',
    pid: currentCall.pid,
    startMs: currentCall.startMs,
    bridgeConfigPath: currentCall.bridgeConfigPath || null,
    bridgeConfigInfo: bridge.getConfigInfo ? bridge.getConfigInfo() : null,
    runtime: sanitizeForLog(currentCall.runtime),
  });
  const ui = new UIEngine(bridge);
  const actions = new Actions(bridge, ui);

  try {
    switch (command) {
      case 'status': {
        const res = await bridge.isAvailable();
        ok(res);
        break;
      }

      case 'screenshot': {
        const requestedOutput = args.flags.output && typeof args.flags.output === 'string'
          ? args.flags.output.trim()
          : null;
        const res = await actions.screenshot(requestedOutput);
        const sourcePath = res.termuxPath || res.path;
        const localResolved = resolveReadableLocalPath(sourcePath);
        const response = {
          ...res,
          androidPath: res.androidPath || res.path,
          termuxPath: localResolved.ok ? localResolved.path : sourcePath,
          pathResolution: localResolved,
        };

        if (hasTermuxFlag(args.flags, 'base64', 'as-base64')) {
          const rawFormat = args.flags.format || 'png';
          const hasImageTransform =
            args.flags.width !== undefined ||
            args.flags.height !== undefined ||
            args.flags.format !== undefined ||
            args.flags.fit !== undefined ||
            args.flags.quality !== undefined ||
            args.flags.rotate !== undefined ||
            args.flags.grayscale !== undefined ||
            args.flags.normalize !== undefined;
          const rawMaxChars = args.flags['max-chars'];
          const maxChars = parseInt(rawMaxChars, 10);
          const safeMaxChars =
            Number.isFinite(maxChars) && maxChars > 0
              ? maxChars
              : DEFAULT_SCREENSHOT_BASE64_CHARS;

          if (!localResolved.ok) {
            fail(
              'TERMUX_FILE_UNREADABLE',
              'Failed to resolve screenshot path in Termux',
              {
                requestedPath: res.path,
                attempts: localResolved.attempts,
              }
            );
          }

          let base64Res = null;
          if (hasImageTransform) {
            const width = parseInt(args.flags.width, 10);
            const height = parseInt(args.flags.height, 10);
            const qualityRaw = parseInt(args.flags.quality, 10);
            const quality = Number.isFinite(qualityRaw)
              ? Math.max(1, Math.min(100, qualityRaw))
              : null;
            base64Res = await imageToBase64(localResolved.path, safeMaxChars, {
              format: String(rawFormat || 'png').toLowerCase(),
              width: Number.isFinite(width) && width > 0 ? width : null,
              height: Number.isFinite(height) && height > 0 ? height : null,
              fit: args.flags.fit || 'inside',
              rotate: parseInt(args.flags.rotate, 10),
              grayscale: Boolean(args.flags.grayscale),
              normalize: Boolean(args.flags.normalize),
              quality,
            });
          } else {
            base64Res = readLocalFileAsBase64(localResolved.path, safeMaxChars);
          }

          if (!base64Res.ok) {
            fail(base64Res.error || 'TERMUX_FILE_READ_FAILED', base64Res.message, base64Res.details || {});
          }
          response.base64 = base64Res.base64;
          response.base64Source = base64Res.path;
          response.base64Length = base64Res.base64.length;
          response.base64Clipped = base64Res.clipped;
          response.base64Tool = base64Res.tool || (hasImageTransform ? 'sharp' : 'file');
          if (base64Res.bytes || base64Res.totalBytes) {
            response.base64SourceBytes = base64Res.bytes || base64Res.totalBytes;
          }
          if (base64Res.width) {
            response.base64Width = base64Res.width;
          }
          if (base64Res.height) {
            response.base64Height = base64Res.height;
          }
          if (base64Res.format) {
            response.base64Format = base64Res.format;
          }
        }

        ok(response);
        break;
      }

      case 'current-app': {
        const res = await actions.currentApp();
        ok(res);
        break;
      }

      case 'launch': {
        const pkg = args.positional[0];
        const activity = args.positional[1] || args.flags.activity || null;
        if (!pkg) fail('INVALID_ARGS', 'Usage: launch <package> [activity]');
        const res = await actions.launch(pkg, activity);
        const wait = await waitForForegroundPackage(actions, pkg, getPostLaunchWaitOptions(args.flags));
        if (!wait.ok) {
          fail('APP_NOT_STABLE', `App did not stabilize in foreground after launch: ${pkg}`, {
            packageName: pkg,
            timeoutMs: wait.timeoutMs,
            waitedMs: wait.waitedMs,
            lastPackage: wait.packageName,
            lastActivity: wait.activity,
            raw: wait.raw,
          });
        }
        ok({
          ...res,
          stable: wait.stable,
          waitedMs: wait.waitedMs,
          foregroundPackage: wait.packageName,
          foregroundActivity: wait.activity,
        });
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
        if (!raw) fail('INVALID_ARGS', 'Usage: tap-element \'{"text":"OK"}\'');
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
        const text = args.positional[0] !== undefined
          ? args.positional.join(' ')
          : args.flags.text;
        if (text === undefined) fail('INVALID_ARGS', 'Usage: type <text>');
        const res = await actions.type(text);
        ok(res);
        break;
      }

      case 'ui-dump': {
        const rawSelector = args.flags.find || null;
        const selector = rawSelector ? parseSelector(rawSelector) : null;
        const packageName = args.flags.package || args.flags['app-package'] || null;
        if (packageName) {
          const wait = await waitForForegroundPackage(actions, packageName, getPostLaunchWaitOptions(args.flags));
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
        const timeout = parseInt(args.flags.timeout || '10000', 10);
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

      case 'ocr': {
        const imagePath = args.positional[0];
        if (!imagePath) fail('INVALID_ARGS', 'Usage: ocr <imagePath> [--timeout ms]');
        const timeout = parseInt(args.flags.timeout || String(DEFAULT_SCREENSHOT_OCR_TIMEOUT_MS), 10);
        const safeTimeout = Number.isFinite(timeout) ? timeout : DEFAULT_SCREENSHOT_OCR_TIMEOUT_MS;
        const localResolved = resolveReadableLocalPath(imagePath);
        if (!localResolved.ok) {
          fail('LOCAL_FILE_NOT_FOUND', 'No readable image path for OCR in Termux', {
            requestedPath: imagePath,
            attempts: localResolved.attempts,
          });
        }
        const maxCharsRaw = args.flags['max-chars'];
        const res = await readImageText(localResolved.path, safeTimeout, maxCharsRaw);
        if (res && localResolved.path !== imagePath) {
          res.requestedPath = imagePath;
          res.pathUsed = localResolved.path;
          res.pathResolution = localResolved;
        }
        ok(res);
        break;
      }

      case 'latest-tweet': {
        const packageName = args.flags.package || args.flags['app-package'] || args.positional[0] || null;
        const minTextLengthRaw = parseInt(args.flags['min-text-length'], 10);
        const minTextLength =
          Number.isFinite(minTextLengthRaw) && minTextLengthRaw > 0 ? minTextLengthRaw : 20;

        const dump = await actions.uiDump();
        if (!Array.isArray(dump)) {
          fail('INTERNAL_ERROR', 'Unexpected ui-dump result', {
            type: typeof dump,
          });
        }
        const extracted = extractLatestTweetFromUiDump(dump || [], {
          packageName: packageName || null,
          minTextLength,
        });
        if (!extracted.ok) {
          fail(extracted.error, extracted.message, {
            packageName: packageName || null,
            totalElements: Array.isArray(dump) ? dump.length : 0,
          });
        }
        ok(extracted);
        break;
      }

      case 'read-file': {
        const filePath = args.positional[0];
        const maxBytesRaw = args.flags['max-bytes'];
        const maxBytes = parseInt(maxBytesRaw, 10);
        if (!filePath) fail('INVALID_ARGS', 'Usage: read-file <path> [--max-bytes N] [--base64]');

        const safeMaxBytes =
          Number.isFinite(maxBytes) && maxBytes > 0
            ? maxBytes
            : READ_FILE_MAX_BYTES_DEFAULT;
        const resolved = resolveReadableLocalPath(filePath);
        if (!resolved.ok) {
          fail('LOCAL_FILE_NOT_FOUND', 'No readable file in Termux', {
            requestedPath: filePath,
            attempts: resolved.attempts,
          });
        }

        const maxCharsRaw = args.flags['max-chars'];
        const maxChars = parseInt(maxCharsRaw, 10);
        const safeMaxChars =
          Number.isFinite(maxChars) && maxChars > 0
            ? maxChars
            : DEFAULT_SCREENSHOT_BASE64_CHARS;
        const mode = hasTermuxFlag(args.flags, 'base64', 'b64', 'as-base64')
          ? 'base64'
          : 'none';

        const readResult = mode === 'base64'
          ? readLocalFileAsBase64(resolved.path, safeMaxChars)
          : readLocalFileAsText(resolved.path, safeMaxBytes);

        if (!readResult.ok) {
          fail(readResult.error || 'LOCAL_FILE_READ_FAILED', readResult.message);
        }
        if (mode === 'base64') {
          ok({
            path: filePath,
            resolvedPath: resolved.path,
            attempts: resolved.attempts,
            mode: 'termux',
            size: readResult.size || 0,
            totalChars: readResult.totalChars,
            base64Length: readResult.base64.length,
            base64Clipped: readResult.clipped || false,
            base64: readResult.base64,
          });
          break;
        }

        ok({
          path: filePath,
          resolvedPath: resolved.path,
          attempts: resolved.attempts,
          mode: 'termux',
          size: readResult.size || null,
          text: readResult.text || '',
        });
        break;
      }

      case 'image-meta': {
        const imagePath = args.positional[0];
        if (!imagePath) fail('INVALID_ARGS', 'Usage: image-meta <imagePath>');
        const localResolved = resolveReadableLocalPath(imagePath);
        if (!localResolved.ok) {
          fail('LOCAL_FILE_NOT_FOUND', 'No readable image path in Termux', {
            requestedPath: imagePath,
            attempts: localResolved.attempts,
          });
        }
        const metaRes = await getImageMetadata(localResolved.path);
        if (!metaRes.ok) {
          fail(metaRes.error || 'IMAGE_METADATA_FAILED', metaRes.message, metaRes.details || {});
        }
        if (metaRes.path !== imagePath) {
          metaRes.requestedPath = imagePath;
          metaRes.pathResolution = localResolved;
        }
        ok(metaRes);
        break;
      }

      case 'image-to-base64': {
        const imagePath = args.positional[0];
        if (!imagePath) fail('INVALID_ARGS', 'Usage: image-to-base64 <imagePath> [--format png|jpeg|webp] [--width N] [--height N]');
        const localResolved = resolveReadableLocalPath(imagePath);
        if (!localResolved.ok) {
          fail('LOCAL_FILE_NOT_FOUND', 'No readable image path in Termux', {
            requestedPath: imagePath,
            attempts: localResolved.attempts,
          });
        }

        const format = String(args.flags.format || 'png').toLowerCase();
        const width = parseInt(args.flags.width, 10);
        const height = parseInt(args.flags.height, 10);
        const qualityRaw = parseInt(args.flags.quality, 10);
        const quality = Number.isFinite(qualityRaw)
          ? Math.max(1, Math.min(100, qualityRaw))
          : null;
        const maxCharsRaw = args.flags['max-chars'];
        const maxChars = parseInt(maxCharsRaw, 10);
        const safeMaxChars =
          Number.isFinite(maxChars) && maxChars > 0
            ? maxChars
            : DEFAULT_IMAGE_TRANSFORM_MAX_CHARS;

        const transform = {
          format,
          width: Number.isFinite(width) && width > 0 ? width : null,
          height: Number.isFinite(height) && height > 0 ? height : null,
          quality,
          fit: args.flags.fit || 'inside',
          rotate: parseInt(args.flags.rotate, 10),
          grayscale: Boolean(args.flags.grayscale),
          normalize: Boolean(args.flags.normalize),
        };

        const base64Res = await imageToBase64(localResolved.path, safeMaxChars, transform);
        if (!base64Res.ok) {
          fail(base64Res.error || 'IMAGE_CONVERT_FAILED', base64Res.message, base64Res.details || {});
        }
        ok({
          requestedPath: imagePath,
          resolvedPath: localResolved.path,
          pathResolution: localResolved,
          ...base64Res,
        });
        break;
      }

      case 'exec': {
        const cmd = args.positional.join(' ');
        if (!cmd) fail('INVALID_ARGS', 'Usage: exec <shell command>');
        const timeout = parseInt(args.flags.timeout || '30000', 10);
        const safeTimeout = Number.isFinite(timeout) ? timeout : 30000;
        const routing = resolveExecRouting(cmd);
        if (routing.mode === 'unsupported') {
          fail('UNSUPPORTED_COMMAND', routing.reason || `Unsupported exec command: ${cmd}`, {
            command: routing.command,
            supported: [...SHIZUKU_EXEC_COMMANDS],
          });
        }

        const res = await actions.exec(routing.command, safeTimeout);
        if (res && typeof res === 'object' && !res.mode) {
          res.mode = routing.mode;
        }
        ok(res);
        break;
      }

      default:
        fail('UNKNOWN_COMMAND', `Unknown command: ${command}. Run 'help' for usage.`);
    }
  } catch (err) {
    const failExtra = {};
    if (err && typeof err === 'object') {
      for (const [key, value] of Object.entries(err)) {
        if (key === 'code' || key === 'message' || key === 'stack') {
          continue;
        }
        failExtra[key] = value;
      }
      if (err.dumpDiagnostics) {
        failExtra.dumpDiagnostics = err.dumpDiagnostics;
      }
      if (err.originalCode) failExtra.originalCode = err.originalCode;
      if (err.originalMessage) failExtra.originalMessage = err.originalMessage;
      failExtra.stack = err.stack || null;
    }
    fail(err.code || 'ERROR', err.message, failExtra);
  }
}

function showHelp() {
  console.log(`
Shizuku Android Automation — OpenClaw Skill

  USAGE: node cli.js <command> [args...]

  COMMANDS:
  status                              Check Bridge + Shizuku status
  screenshot [--base64] [--format png|jpeg|webp] [--width N] [--height N] [--quality 1-100] [--fit]
                                      Take screenshot (returns file path; --base64 supports optional sharp transform)
                                      Output path must be under /data/local/tmp.
  current-app                         Get foreground app info
  launch <pkg> [activity]             Launch app by package name, then wait for foreground stability
                                      Optional flags: --post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms
  kill <pkg>                          Force stop app
  tap <x> <y>                         Tap screen coordinates
  tap-element '<selector>'             Find element and tap it
  swipe <x1> <y1> <x2> <y2> [ms]     Swipe gesture
  press <key>                         Press key (home/back/enter/recent/paste)
  type <text>                         Input text (auto handles Chinese)
  ui-dump [--find '<selector>'] [--package com.xx] [--post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms]
                                      Dump UI tree (optionally filtered); if --package passed, waits until package stable before dumping
  wait-for '<selector>' [--timeout]   Wait for element to appear
  device-info                         Device model, Android version
  battery                             Battery status
  installed-apps                      List installed packages
  screen-size                         Screen dimensions
  ocr <imagePath> [--timeout]         Extract text using local OCR (optional, requires tesseract). imagePath must be /data/local/tmp.
  latest-tweet [package] [--package com.twitter.android] [--min-text-length 20]
                                      Read latest feed item text from ui-dump
  image-meta <path>                   Read image metadata via sharp (if available)
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
  {"text":"发送"}                     Exact text match
  {"textContains":"发"}               Text contains
  {"resourceId":"com.xx:id/btn"}      Resource ID
  {"className":"android.widget.Button"}
  {"description":"Send"}              Content description
  {"text":"OK","clickable":true}      Combined (AND logic)

OUTPUT: Always JSON — {"ok":true,"data":{...}} or {"ok":false,"error":"CODE","message":"..."}
`.trim());
}

main().catch((err) => {
  fail('UNCAUGHT', err.message);
});

function resolveExecRouting(command) {
  const normalized = String(command || '').trim();
  if (!normalized) {
    return { mode: 'unsupported', command: '', reason: 'EMPTY_COMMAND' };
  }

  const routed = stripAdbShellPrefix(normalized);
  const tokens = getCommandTokens(routed);
  if (tokens.length === 0) {
    return { mode: 'unsupported', command: routed, reason: 'EMPTY_COMMAND' };
  }

  const first = tokens[0];
  const firstTwo = `${first} ${tokens[1] || ''}`.trim();
  const routeKey = SHIZUKU_EXEC_COMMAND_PREFIXES.has(firstTwo) ? firstTwo : first;

  if (SHIZUKU_EXEC_COMMAND_PREFIXES.has(routeKey)) {
    return { mode: 'shizuku', command: routed };
  }
  return {
    mode: 'unsupported',
    command: routed,
    reason: `Unsupported exec command: ${first}. Supported: ${SHIZUKU_EXEC_COMMANDS.join(', ')}`,
  };
}

function stripAdbShellPrefix(command) {
  const normalized = String(command || '').trim();
  return normalized.replace(/^adb\s+shell\b/i, '').trim();
}

function getCommandTokens(command) {
  const normalized = String(command || '').trim();
  if (!normalized) return [];
  const match = normalized.match(/"[^"]*"|'[^']*'|\S+/g);
  return (match || []).map((token) => token.replace(/^['"]|['"]$/g, '').toLowerCase());
}

function hasTermuxFlag(flags, ...keys) {
  return keys.some((key) => !!flags[key]);
}

function resolveReadableLocalPath(filePath) {
  const rawPath = String(filePath || '').trim();
  const candidates = getReadablePathCandidates(rawPath).filter((candidate) => {
    if (!candidate) {
      return false;
    }
    return isLocalTmpPath(candidate);
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

  const attempts = [];

  for (const candidate of candidates) {
    try {
      if (!candidate) {
        attempts.push({ path: candidate, reason: 'empty' });
        continue;
      }
      fs.accessSync(candidate, fs.constants.R_OK);
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) {
        attempts.push({
          path: candidate,
          reason: 'not_file',
          size: stat.size,
        });
        continue;
      }
      attempts.push({ path: candidate, reason: 'readable', size: stat.size });
      return {
        ok: true,
        path: candidate,
        size: stat.size,
        attempts,
      };
    } catch (error) {
      attempts.push({
        path: candidate,
        reason: 'unreadable',
        message: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : null,
      });
    }
  }

  return {
    ok: false,
    path: rawPath,
    size: null,
    attempts,
  };
}

function readLocalFileAsBase64(filePath, maxChars = DEFAULT_SCREENSHOT_BASE64_CHARS) {
  const resolved = resolveReadableLocalPath(filePath);
  if (!resolved.ok) {
    return {
      ok: false,
      error: 'LOCAL_FILE_NOT_FOUND',
      message: 'No readable file in Termux',
      details: {
        requestedPath: filePath,
        attempts: resolved.attempts,
      },
    };
  }

  let data;
  try {
    data = fs.readFileSync(resolved.path);
  } catch (error) {
    return {
      ok: false,
      error: 'LOCAL_FILE_READ_FAILED',
      message: error && error.message ? error.message : String(error),
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
}

function readLocalFileAsText(filePath, maxBytes = READ_FILE_MAX_BYTES_DEFAULT) {
  const resolved = resolveReadableLocalPath(filePath);
  if (!resolved.ok) {
    return {
      ok: false,
      error: 'LOCAL_FILE_NOT_FOUND',
      message: 'No readable file in Termux',
      details: {
        requestedPath: filePath,
        attempts: resolved.attempts,
      },
    };
  }

  if (Number.isFinite(maxBytes) && maxBytes > 0 && resolved.size > maxBytes) {
    return {
      ok: false,
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
  } catch (error) {
    return {
      ok: false,
      error: 'LOCAL_FILE_READ_FAILED',
      message: error && error.message ? error.message : String(error),
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
}

function runLocalShell(command, timeoutMs = 30000) {
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

  const shellCommand = cmd.includes('|')
    ? `bash -lc ${quoteShellArg(`set -o pipefail; ${cmd}`)}`
    : cmd;

  return new Promise((resolve) => {
    execInShell(
      shellCommand,
      {
        timeout: timeoutMs,
        maxBuffer: LOCAL_EXEC_MAX_BUFFER,
        env: {
          ...process.env,
          BOTDROP_SHARED_ROOT: SHARED_ROOT_DIR || process.env.BOTDROP_SHARED_ROOT || '',
          BOTDROP_TERMUX_HOME: BOTDROP_TERMUX_HOME || process.env.BOTDROP_TERMUX_HOME || '',
          HOME: BOTDROP_TERMUX_HOME || LOCAL_EXEC_HOME || process.env.HOME || '/',
        },
        cwd: LOCAL_EXEC_HOME || BOTDROP_TERMUX_HOME || process.cwd(),
      },
      (error, stdout = '', stderr = '') => {
      if (error) {
        const isTimeout = error.signal === 'SIGTERM';
        const exitCode =
          typeof error.code === 'number' ? error.code : isTimeout ? 124 : 1;
        const stdoutText = String(stdout || '');
        const combinedStderr = `${String(stderr || '')}${stderr && error.stderr ? '\n' : ''}${error.stderr || ''}`.trim();
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
          message: isTimeout ? `Command timed out after ${timeoutMs}ms` : error.message,
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
      });
  });
}

function getSharpLib() {
  if (sharpLib !== undefined) {
    return sharpLib;
  }

  const candidates = [
    'sharp',
    ...getConfiguredNodePaths().map((nodePath) => path.join(nodePath, 'sharp')),
    path.join(getGlobalNodeModulesPath(), 'sharp'),
  ];

  for (const candidate of candidates) {
    const loaded = tryResolveSharp(candidate);
    if (loaded) {
      sharpLib = loaded;
      return sharpLib;
    }
  }

  sharpLib = null;
  return null;
}

function normalizeImageFormat(rawFormat = 'png') {
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
}

function parseImageFit(rawFit = 'inside') {
  const fit = String(rawFit || 'inside').toLowerCase();
  const supported = new Set(['cover', 'contain', 'fill', 'inside', 'outside']);
  return supported.has(fit) ? fit : 'inside';
}

async function getImageMetadata(filePath) {
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
  } catch (error) {
    return {
      ok: false,
      mode: 'termux',
      error: 'IMAGE_METADATA_FAILED',
      message: error && error.message ? error.message : String(error),
      details: {
        path: filePath,
      },
    };
  }
}

async function imageToBase64(filePath, maxChars = DEFAULT_IMAGE_TRANSFORM_MAX_CHARS, options = {}) {
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
  if (Number.isFinite(options.rotate) && Number.isInteger(options.rotate)) {
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

  let buffer;
  try {
    const result = await pipeline.toBuffer({ resolveWithObject: true });
    buffer = result.data;
  } catch (error) {
    return {
      ok: false,
      mode: 'termux',
      error: 'IMAGE_CONVERT_FAILED',
      message: error && error.message ? error.message : String(error),
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
}

async function readImageText(imagePath, timeoutMs = 30000, maxCharsRaw = null) {
  const pathText = String(imagePath || '').trim();
  if (!pathText) {
    return {
      ok: false,
      mode: 'termux',
      error: 'INVALID_ARGS',
      message: 'Image path is required',
    };
  }

  const whichTesseract = await runLocalShell('which tesseract');
  if (!whichTesseract.ok || !String(whichTesseract.stdout || '').trim()) {
    return {
      ok: false,
      mode: 'termux',
      error: 'OCR_TOOL_MISSING',
      message:
        'No OCR tool found in Termux shell. Install tesseract (pkg install tesseract) to use ocr.',
    };
  }

  const escapedPath = quoteShellArg(pathText);
  const result = await runLocalShell(`tesseract ${escapedPath} stdout --psm 6 2>/dev/null`, timeoutMs);
  if (!result.ok) {
    return {
      ok: false,
      mode: 'termux',
      error: result.error || 'OCR_FAILED',
      message: result.message || 'Failed to run OCR command',
      details: {
        exitCode: result.exitCode,
        stderr: result.stderr || '',
      },
    };
  }

  const text = String(result.stdout || '').trim();
  const maxChars = parseInt(maxCharsRaw, 10);
  const clippedText =
    Number.isFinite(maxChars) && maxChars > 0 && text.length > maxChars ? text.slice(0, maxChars) : text;

  return {
    ok: true,
    mode: 'termux',
    path: pathText,
    tool: 'tesseract',
    text: clippedText,
    textLength: text.length,
  };
}

function extractLatestTweetFromUiDump(elements, options = {}) {
  const rows = Array.isArray(elements) ? elements : [];
  const packageName = options.packageName || null;
  const minTextLength = Number.isFinite(options.minTextLength) && options.minTextLength > 0
    ? options.minTextLength
    : 20;

  const rowElements = rows.filter((el) => {
    if (!el || !el.resourceId) return false;
    if (el.resourceId !== 'com.twitter.android:id/row') return false;
    if (packageName && el.packageName && el.packageName !== packageName) return false;
    if (!el.bounds) return false;
    return true;
  });

  if (!rowElements.length) {
    return {
      ok: false,
      mode: 'uiautomator',
      error: 'NO_TWEET_ROW_FOUND',
      message: 'No com.twitter.android:id/row element was found in current ui dump',
      packageName: packageName || null,
      count: rows.length,
    };
  }

  const latestRow = rowElements[0];
  const candidates = rows.filter((el) => {
    if (!el || !el.text) return false;
    if (!isInsideBounds(el.bounds, latestRow.bounds)) return false;
    if (!isLikelyTextForFeed(el.text, minTextLength)) return false;
    return true;
  });

  candidates.sort((a, b) => {
    const aTop = a.bounds ? a.bounds.top : Number.MAX_SAFE_INTEGER;
    const bTop = b.bounds ? b.bounds.top : Number.MAX_SAFE_INTEGER;
    if (aTop !== bTop) {
      return aTop - bTop;
    }
    const aLeft = a.bounds ? a.bounds.left : 0;
    const bLeft = b.bounds ? b.bounds.left : 0;
    return aLeft - bLeft;
  });

  const rowText = latestRow.description || latestRow.text || '';
  const cleanedRowText = normalizeUiText(rowText);
  const normalizedCandidates = candidates
    .map((el) => ({
      text: normalizeUiText(el.text),
      bounds: el.bounds || null,
      className: el.className || '',
      resourceId: el.resourceId || '',
      description: el.description || '',
    }))
    .filter((entry) => isLikelyTextForFeed(entry.text, minTextLength));

  const contentCandidates = [];
  const seen = new Set();
  for (const entry of normalizedCandidates) {
    if (!entry.text || seen.has(entry.text)) continue;
    seen.add(entry.text);
    contentCandidates.push(entry);
  }

  const best = contentCandidates.length > 0 ? contentCandidates[0] : null;
  const content = best ? best.text : cleanedRowText;

  return {
    ok: true,
    mode: 'uiautomator',
    method: best ? 'row-child-text' : 'row-description',
    packageName: packageName || latestRow.packageName || null,
    selectedRow: {
      bounds: latestRow.bounds,
      description: cleanedRowText,
      resourceId: latestRow.resourceId,
      top: latestRow.bounds.top,
    },
    content,
    contentCandidates,
    candidateCount: contentCandidates.length,
    source: 'ui-dump',
    stats: {
      rows: rowElements.length,
      totalElements: rows.length,
    },
  };
}

function isLikelyTextForFeed(text, minLength = 20) {
  if (!text) return false;
  const normalized = normalizeUiText(text).trim();
  if (!normalized || normalized.length < minLength) return false;
  if (/^\d{1,4}\s*(分钟前|小时前|天前|月前|周前|年)/.test(normalized)) return false;
  if (/^(0|[1-9]\d*)\s*个?\s*(转帖|喜欢|查看次数|回复)?$/.test(normalized)) return false;
  if (normalized === '广告' || normalized === '已发布') return false;
  if (normalized.includes('认证查看次数')) return false;
  if (normalized.includes('显示更多')) return false;
  if (normalized.includes('认证企业')) return false;
  return true;
}

function isInsideBounds(child, parent) {
  if (!child || !parent) return false;
  return (
    Number.isFinite(child.left) && Number.isFinite(child.top) &&
    Number.isFinite(child.right) && Number.isFinite(child.bottom) &&
    child.left >= parent.left - 8 &&
    child.top >= parent.top - 8 &&
    child.right <= parent.right + 8 &&
    child.bottom <= parent.bottom + 8
  );
}

function normalizeUiText(rawText) {
  const text = String(rawText || '');
  return text
    .replace(/&#(\d+);/g, (_, code) => {
      const charCode = Number.parseInt(code, 10);
      if (!Number.isFinite(charCode)) return '';
      try {
        return String.fromCodePoint(charCode);
      } catch {
        return '';
      }
    })
    .replace(/\s+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}
