export {};
'use strict';

const path = require('path');
const {
  getBotdropScreenshotDir,
  getBotdropUiDumpPath,
  resolveSafeLocalTmpPath,
} = require('./path-utils');
const { sleep } = require('./time-utils');
import { ErrorCode } from '../types';
import type { UiElement, UiSelector } from '../types';
const { SkillError } = require('./errors');
const { quoteShellArg } = require('./shell-utils');

const LOCAL_TMP_ROOT = '/data/local/tmp';

interface BridgeClientLike {
  execOrThrow: (command: string, timeoutMs?: number) => Promise<{ ok: boolean; stdout?: string; [key: string]: unknown }>;
  exec: (command: string, timeoutMs?: number) => Promise<{ ok: boolean; stdout?: string; [key: string]: unknown }>;
}

interface UIEngineLike {
  tap: (selector: UiSelector) => Promise<{ element: UiElement; tapped: { x: number; y: number } }>;
  dump: () => Promise<UiElement[]>;
  waitFor: (selector: UiSelector, timeoutMs?: number) => Promise<UiElement>;
}

const { matchesSelector } = require('./ui-engine');

const KEY_MAP = {
  home: 3,
  back: 4,
  call: 5,
  endcall: 6,
  enter: 66,
  delete: 67,
  recent: 187,
  power: 26,
  volumeup: 24,
  volumedown: 25,
  paste: 279,
  copy: 278,
  cut: 277,
  selectall: 232,
  tab: 61,
  space: 62,
  escape: 111,
} as const;

type KeyName = keyof typeof KEY_MAP;

const CLIPBOARD_BROADCAST_ACTION = 'app.botdrop.SET_CLIPBOARD';

class Actions {
  private readonly _bridge: BridgeClientLike;
  private readonly _ui: UIEngineLike;
  private readonly _keyboardPolicy: KeyboardPolicy;
  private readonly _pathPolicy: LocalPathPolicy;
  private readonly _parser: CommandParserLike;
  private readonly _shell: ShellCommandLike;

  constructor(bridgeClient: BridgeClientLike, uiEngine: UIEngineLike) {
    this._bridge = bridgeClient;
    this._ui = uiEngine;
    this._keyboardPolicy = createKeyboardPolicy();
    this._pathPolicy = createLocalTmpPathPolicy(LOCAL_TMP_ROOT);
    this._parser = createCommandParser();
    this._shell = createShellCommand();
  }

  async tap(x: number, y: number): Promise<{ ok: true; x: number; y: number }> {
    await this._bridge.execOrThrow(`input tap ${Math.round(x)} ${Math.round(y)}`);
    return { ok: true, x: Math.round(x), y: Math.round(y) };
  }

  async tapElement(selector: UiSelector): Promise<{ element: UiElement; tapped: { x: number; y: number } }> {
    return this._ui.tap(selector);
  }

  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 300
  ): Promise<{ ok: true }> {
    await this._bridge.execOrThrow(
      `input swipe ${Math.round(x1)} ${Math.round(y1)} ${Math.round(x2)} ${Math.round(y2)} ${durationMs}`
    );
    return { ok: true };
  }

  async press(key: string): Promise<{ ok: true; key: string; keycode: number }> {
    const keycode = this._keyboardPolicy.resolveKeycode(key);
    if (!Number.isFinite(keycode)) {
      const err = new SkillError(
        ErrorCode.INVALID_KEY,
        `Unknown key: ${key}. Valid keys: ${this._keyboardPolicy.formatKeyList()}`
      );
      throw err;
    }

    await this._bridge.execOrThrow(`input keyevent ${keycode}`);
    return { ok: true, key, keycode };
  }

  async type(text: string): Promise<{ ok: true; method: 'input-text' | 'clipboard'; text: string }> {
    const hasNonAscii = /[^\x00-\x7F]/.test(text);
    if (hasNonAscii) {
      await this.typeViaClipboard(text);
      return { ok: true, method: 'clipboard', text };
    }
    await this.typeAscii(text);
    return { ok: true, method: 'input-text', text };
  }

  async typeAscii(text: string): Promise<{ ok: true; method: 'input-text'; text: string }> {
    const escaped = text.replace(/ /g, '%s');
    await this._bridge.execOrThrow(`input text ${this._shell.quoteArg(escaped)}`);
    return { ok: true, method: 'input-text', text };
  }

  async typeViaClipboard(text: string): Promise<{ ok: true; method: 'clipboard'; text: string }> {
    const broadcast = `am broadcast -a ${this._shell.quoteArg(CLIPBOARD_BROADCAST_ACTION)} --es text ${this._shell.quoteArg(text)}`;
    await this._bridge.execOrThrow(broadcast, 10000);
    await this._shell.sleep(200);
    await this._bridge.execOrThrow(`input keyevent ${KEY_MAP.paste}`);
    return { ok: true, method: 'clipboard', text };
  }

  async launch(packageName: string, activity: string | null = null): Promise<{ ok: true; packageName: string; activity: string | null }> {
    const cmd = activity
      ? `am start -n ${this._shell.quoteArg(`${packageName}/${activity}`)}`
      : `monkey -p ${this._shell.quoteArg(packageName)} -c android.intent.category.LAUNCHER 1`;

    await this._bridge.execOrThrow(cmd, 15000);
    return { ok: true, packageName, activity };
  }

  async kill(packageName: string): Promise<{ ok: true; packageName: string }> {
    await this._bridge.execOrThrow(`am force-stop ${this._shell.quoteArg(packageName)}`);
    return { ok: true, packageName };
  }

  async currentApp(): Promise<{ ok: true; packageName: string | null; activity: string | null; raw: string }> {
    const res = await this._bridge.execOrThrow(
      'dumpsys activity top 2>/dev/null | grep -E "ACTIVITY|mCurrentFocus|mResumed=" | head -80',
      10000
    );

    const stdout = String(res.stdout || '');
    const match = this._parser.parseCurrentApp(stdout);

    if (match) {
      return {
        ok: true,
        packageName: match.packageName,
        activity: match.activity,
        raw: stdout.trim(),
      };
    }

    return {
      ok: true,
      packageName: null,
      activity: null,
      raw: stdout.trim(),
    };
  }

  async installedApps(): Promise<{ ok: true; packages: string[] }> {
    const res = await this._bridge.execOrThrow('pm list packages 2>/dev/null', 20000);
    const stdout = String(res.stdout || '');
    const packages = this._parser.parseInstalledPackages(stdout);
    return { ok: true, packages };
  }

  async screenshot(outputPath: string | null = null): Promise<{ ok: true; path: string; androidPath: string; requestedPath: string | null }> {
    const screenshotDir = getBotdropScreenshotDir();
    const defaultDest = path.join(screenshotDir, 'shizuku-screenshot.png');
    const requestedDest = typeof outputPath === 'string' && outputPath.trim() ? outputPath.trim() : null;
    const dest = requestedDest || defaultDest;
    const safeDest = this._pathPolicy.assertLocalTmpPath(dest, 'Screenshot output path');

    const tmpAndroid = getBotdropUiDumpPath('shizuku-shot.png');
    const tmpAndroidDir = path.dirname(tmpAndroid);

    await this._bridge.execOrThrow(`mkdir -p ${this._shell.quoteArg(tmpAndroidDir)} ${this._shell.quoteArg(path.dirname(safeDest))}`);
    await this._bridge.execOrThrow(`screencap -p ${this._shell.quoteArg(tmpAndroid)}`, 15000);
    await this._bridge.execOrThrow(
      `cp ${this._shell.quoteArg(tmpAndroid)} ${this._shell.quoteArg(safeDest)} 2>/dev/null || cat ${this._shell.quoteArg(tmpAndroid)} > ${this._shell.quoteArg(safeDest)}`,
      10000
    );

    return {
      ok: true,
      path: dest,
      androidPath: tmpAndroid,
      requestedPath: requestedDest,
    };
  }

  async screenSize(): Promise<{ ok: true; width: number | null; height: number | null; raw?: string }> {
    const res = await this._bridge.execOrThrow('wm size');
    const stdout = String(res.stdout || '');
    const parsed = this._parser.parseScreenSize(stdout);
    return {
      ok: true,
      width: parsed.width,
      height: parsed.height,
      raw: parsed.raw,
    };
  }

  async deviceInfo(): Promise<{ ok: true; model: string; androidVersion: string; sdkVersion: string; manufacturer: string }> {
    const res = await this._bridge.execOrThrow(
      'getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk; getprop ro.product.manufacturer',
      10000
    );
    const parsed = this._parser.parseDeviceInfo(String(res.stdout || ''));
    return {
      ok: true,
      model: parsed.model,
      androidVersion: parsed.androidVersion,
      sdkVersion: parsed.sdkVersion,
      manufacturer: parsed.manufacturer,
    };
  }

  async batteryInfo(): Promise<{ ok: true; level: string | null; charging: boolean; temperature: string | null; raw: string }> {
    const res = await this._bridge.execOrThrow('dumpsys battery 2>/dev/null | head -20', 10000);
    const stdout = String(res.stdout || '');
    const parsed = this._parser.parseBatteryInfo(stdout);

    return {
      ok: true,
      level: parsed.level,
      charging: parsed.charging,
      temperature: parsed.temperature,
      raw: stdout.trim(),
    };
  }

  async uiDump(filterSelector: UiSelector | null = null): Promise<UiElement[]> {
    const elements = await this._ui.dump();
    if (filterSelector) {
      return elements.filter((el) => matchesSelector(el, filterSelector));
    }
    return elements;
  }

  async waitFor(selector: UiSelector, timeoutMs = 10000): Promise<UiElement> {
    return this._ui.waitFor(selector, timeoutMs);
  }

  async exec(command: string, timeoutMs = 30000): Promise<{ ok: boolean; [key: string]: unknown }> {
    return this._bridge.exec(command, timeoutMs);
  }
}
interface KeyboardPolicy {
  resolveKeycode(rawKey: string): number;
  formatKeyList(): string;
}

interface LocalPathPolicy {
  assertLocalTmpPath(filePath: string, label?: string): string;
}

interface CommandParserLike {
  parseCurrentApp(stdout: string): { packageName: string | null; activity: string | null } | null;
  parseInstalledPackages(stdout: string): string[];
  parseScreenSize(stdout: string): { width: number | null; height: number | null; raw: string };
  parseDeviceInfo(stdout: string): { model: string; androidVersion: string; sdkVersion: string; manufacturer: string };
  parseBatteryInfo(stdout: string): { level: string | null; charging: boolean; temperature: string | null };
}

interface ShellCommandLike {
  quoteArg(value: string): string;
  sleep(ms: number): Promise<void>;
}

function createKeyboardPolicy(): KeyboardPolicy {
  const keyMap = KEY_MAP;

  return {
    resolveKeycode(rawKey: string): number {
      const normalized = rawKey.toLowerCase();
      const numeric = Number(normalized);
      return Number.isFinite(numeric) ? numeric : keyMap[normalized as KeyName];
    },
    formatKeyList() {
      return Object.keys(keyMap).join(', ');
    },
  };
}

function createLocalTmpPathPolicy(root: string): LocalPathPolicy {
  return {
    assertLocalTmpPath(filePath: string, label = 'path'): string {
      const resolved = resolveSafeLocalTmpPath(filePath, root);
      if (!resolved.ok) {
        const err = new SkillError(ErrorCode.INVALID_PATH, `${label} is not safe under ${root}`, {
          path: filePath,
          resolved,
        });
        throw err;
      }

      return resolved.path;
    },
  };
}

function createCommandParser(): CommandParserLike {
  return {
    parseCurrentApp(stdout: string) {
      const lines = String(stdout || '').split('\n');
      let resumeCandidate: { packageName: string | null; activity: string | null } | null = null;
      const fallbackCandidates: Array<{ packageName: string | null; activity: string | null }> = [];
      let currentActivity: { packageName: string | null; activity: string | null } | null = null;

      for (const rawLine of lines) {
        const line = String(rawLine || '');
        const actMatch = line.match(/^\s*ACTIVITY\s+([^/\s]+)\/([^\s]+)/i);
        if (actMatch) {
          if (currentActivity && !fallbackCandidates.includes(currentActivity)) {
            fallbackCandidates.push(currentActivity);
          }
          currentActivity = {
            packageName: actMatch[1] || null,
            activity: actMatch[2] || null,
          };
          continue;
        }

        if (currentActivity && /mResumed=true/.test(line)) {
          resumeCandidate = currentActivity;
          if (!fallbackCandidates.includes(currentActivity)) {
            fallbackCandidates.push(currentActivity);
          }
        }
      }

      if (currentActivity && !fallbackCandidates.includes(currentActivity)) {
        fallbackCandidates.push(currentActivity);
      }

      if (resumeCandidate) {
        return resumeCandidate;
      }

      const focusMatch = stdout.match(/mCurrentFocus=Window\{[^}]+\s+([^/\s]+)\/([^\s}]+)/i);
      if (focusMatch) {
        return {
          packageName: focusMatch[1] || null,
          activity: focusMatch[2] || null,
        };
      }

      if (fallbackCandidates.length > 0) {
        return fallbackCandidates[fallbackCandidates.length - 1];
      }

      return null;
    },
    parseInstalledPackages(stdout: string) {
      return stdout
        .split('\n')
        .map((entry) => String(entry || '').trim().replace(/^package:/, ''))
        .filter(Boolean);
    },
    parseScreenSize(stdout: string) {
      const m = stdout.match(/Physical size:\\s*(\\d+)x(\\d+)/);
      if (m) {
        return {
          width: toPositiveInteger(m[1]),
          height: toPositiveInteger(m[2]),
          raw: stdout.trim(),
        };
      }

      const m2 = stdout.match(/(\\d+)x(\\d+)/);
      if (m2) {
        return {
          width: toPositiveInteger(m2[1]),
          height: toPositiveInteger(m2[2]),
          raw: stdout.trim(),
        };
      }

      return { width: null, height: null, raw: stdout.trim() };
    },
    parseDeviceInfo(stdout: string) {
      const lines = String(stdout || '').split('\n').map((line) => String(line || '').trim());
      return {
        model: lines[0] || '',
        androidVersion: lines[1] || '',
        sdkVersion: lines[2] || '',
        manufacturer: lines[3] || '',
      };
    },
    parseBatteryInfo(stdout: string) {
      const getValue = (key: string): string | null => {
        const m = stdout.match(new RegExp(key + ':\\s*(\\S+)'));
        return m ? m[1] : null;
      };

      return {
        level: getValue('level'),
        charging: getValue('status') === '2',
        temperature: getValue('temperature'),
      };
    },
  };
}

function toPositiveInteger(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function createShellCommand(): ShellCommandLike {
  return {
    quoteArg(value: string): string {
      return quoteShellArg(value);
    },
    sleep(ms: number): Promise<void> {
      return sleep(ms);
    },
  };
}

module.exports = { Actions };
