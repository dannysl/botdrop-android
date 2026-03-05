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
import type { UiBounds, UiElement, UiSelector } from '../types';
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
  moveend: 123,
} as const;

type KeyName = keyof typeof KEY_MAP;

const CLIPBOARD_BROADCAST_ACTION = 'app.botdrop.SET_CLIPBOARD';
const ADB_KEYBOARD_TEXT_KEY = 'text';
const ADB_KEYBOARD_BROADCAST_ACTION = 'ADB_INPUT_TEXT';
const TYPE_VERIFICATION_ATTEMPTS = 3;
const TYPE_VERIFICATION_INTERVAL_MS = 180;
const ADB_KEYBOARD_BROADCAST_TIMEOUT_MS = 3500;
const TYPE_FOCUS_RETRY_DELAY_MS = 150;
const TYPE_FOCUS_DEFAULT_TIMEOUT_MS = 1500;
const TYPE_FOCUS_MAX_CANDIDATES = 6;

type TypeMethod = 'input-text' | 'clipboard' | 'adb-keyboard';
type TypeInputMode = 'append' | 'new';

interface TypeFocusOptions {
  focus?: boolean;
  focusSelector?: UiSelector | null;
  focusTimeoutMs?: number;
  inputMode?: TypeInputMode;
}

interface TypeFocusResult {
  attempted: boolean;
  selectorUsed: boolean;
  tapped?: { x: number; y: number };
  reason: string;
}

interface TypeResult {
  ok: true;
  method: TypeMethod;
  text: string;
  inputMode: TypeInputMode;
  focus?: TypeFocusResult;
}

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

  async type(
    text: string,
    timeoutMs = 30000,
    method: 'auto' | TypeMethod = 'auto',
    options: TypeFocusOptions = {}
  ): Promise<TypeResult> {
    const inputMode: TypeInputMode = options.inputMode === 'append' ? 'append' : 'new';
    const focusResult = await this.focusTypingTarget({
      focus: options.focus !== false,
      focusSelector: options.focusSelector,
      focusTimeoutMs: options.focusTimeoutMs,
    });
    if (focusResult.attempted === false && options.focus !== false) {
      throw new SkillError(
        ErrorCode.TIMEOUT,
        `Cannot focus typing target before text input: ${focusResult.reason}`,
        { focus: focusResult, text }
      );
    }
    if (inputMode === 'new') {
      await this.prepareInputForNewMode(timeoutMs);
    } else {
      await this.prepareInputForAppendMode(timeoutMs);
    }
    const hasNonAscii = /[^\x00-\x7F]/.test(text);
    if (method === 'clipboard') {
      await this.typeViaClipboard(text, timeoutMs);
      return { ok: true, method: 'clipboard', text, inputMode, focus: focusResult };
    }
    if (method === 'adb-keyboard') {
      const result = await this.typeViaAdbKeyboard(text, timeoutMs, true);
      return { ...result, inputMode, focus: focusResult };
    }
    if (method === 'input-text') {
      await this.typeAscii(text, timeoutMs);
      return { ok: true, method: 'input-text', text, inputMode, focus: focusResult };
    }
    if (hasNonAscii) {
      const typed = await this.typeUnicodeWithFallback(text, timeoutMs);
      return { ...typed, inputMode, focus: focusResult };
    }
    await this.typeAscii(text, timeoutMs);
    return { ok: true, method: 'input-text', text, inputMode, focus: focusResult };
  }

  private async prepareInputForAppendMode(timeoutMs = 30000): Promise<void> {
    await this._bridge.execOrThrow(`input keyevent ${KEY_MAP.moveend}`, Math.min(timeoutMs, 5000));
    await this._shell.sleep(80);
  }

  private async prepareInputForNewMode(timeoutMs = 30000): Promise<void> {
    await this._bridge.execOrThrow(`input keyevent ${KEY_MAP.selectall}`, Math.min(timeoutMs, 5000));
    await this._shell.sleep(80);
    await this._bridge.execOrThrow(`input keyevent ${KEY_MAP.delete}`, Math.min(timeoutMs, 5000));
    await this._shell.sleep(80);

    const afterSelectAllDeleteValues = await this.snapshotEditableTextValues();
    if (this.isEditableListCleared(afterSelectAllDeleteValues)) {
      return;
    }

    await this._bridge.execOrThrow(`input keyevent ${KEY_MAP.moveend}`, Math.min(timeoutMs, 5000));
    await this._shell.sleep(60);

    const deleteCount = this.estimateDeleteCountForNewMode([]);
    const batchedDeleteCommand = `sh -c ${this._shell.quoteArg(
      `i=0; while [ $i -lt ${deleteCount} ]; do input keyevent ${KEY_MAP.delete}; i=$((i+1)); done`
    )}`;
    await this._bridge.execOrThrow(batchedDeleteCommand, Math.min(timeoutMs, 12000));
    await this._shell.sleep(80);
  }

  private isEditableListCleared(values: string[]): boolean {
    if (values.length === 0) {
      return false;
    }
    for (const value of values) {
      if (this.normalizeTypeText(value).length > 0) {
        return false;
      }
    }
    return true;
  }

  private estimateDeleteCountForNewMode(values: string[]): number {
    let maxLen = 0;
    for (const value of values) {
      if (!value) {
        continue;
      }
      if (value.length > maxLen) {
        maxLen = value.length;
      }
    }
    const estimate = maxLen + 24;
    if (estimate < 48) {
      return 48;
    }
    if (estimate > 240) {
      return 240;
    }
    return estimate;
  }

  private async focusTypingTarget(options: TypeFocusOptions = {}): Promise<TypeFocusResult> {
    if (options.focus === false) {
      return { attempted: false, selectorUsed: false, reason: 'type focus disabled by option' };
    }

    const focusTimeoutMs = options.focusTimeoutMs ?? TYPE_FOCUS_DEFAULT_TIMEOUT_MS;
    const deadlineMs = Date.now() + Math.max(300, focusTimeoutMs);

    if (options.focusSelector) {
      try {
        const selected = await this._ui.tap(options.focusSelector);
        await this._shell.sleep(TYPE_FOCUS_RETRY_DELAY_MS);
        return {
          attempted: true,
          selectorUsed: true,
          tapped: selected.tapped,
          reason: 'focused via explicit --focus-selector',
        };
      } catch (error: unknown) {
        if (Date.now() >= deadlineMs) {
          return { attempted: false, selectorUsed: false, reason: 'explicit --focus-selector not found or not clickable' };
        }
      }
    }

    try {
      const elements = await this._ui.dump();
      const candidates = this.getTypeFocusCandidates(elements);
      const limit = Math.min(TYPE_FOCUS_MAX_CANDIDATES, candidates.length);

      if (!limit) {
        return { attempted: false, selectorUsed: false, reason: 'no likely input candidates found in current UI' };
      }

      for (let index = 0; index < limit; index += 1) {
        const candidate = candidates[index];
        const point = this.getTapPoint(candidate.element);
        if (!point) {
          continue;
        }
        try {
          await this.tap(point.x, point.y);
          await this._shell.sleep(TYPE_FOCUS_RETRY_DELAY_MS);
          return {
            attempted: true,
            selectorUsed: false,
            tapped: point,
            reason: `focused by candidate: ${candidate.reason}`,
          };
        } catch (error: unknown) {
          if (Date.now() >= deadlineMs) {
            break;
          }
          continue;
        }
      }
    } catch (error: unknown) {
      if (Date.now() >= deadlineMs) {
        return { attempted: false, selectorUsed: false, reason: 'focus probe failed while reading ui' };
      }
    }

    return { attempted: false, selectorUsed: false, reason: 'focus attempt exhausted without a successful tap' };
  }

  private getTypeFocusCandidates(elements: UiElement[]): Array<{ element: UiElement; reason: string; score: number }> {
    const filtered = elements
      .filter((el) => {
        if (!(el && typeof el === 'object')) {
          return false;
        }
        if (!el.bounds) {
          return false;
        }
        if (!el.clickable && !el.focusable) {
          return false;
        }
        return this.isCandidateVisible(el.bounds);
      });

    const scored = filtered.map((el) => {
      const className = String(el.className || '').toLowerCase();
      const text = String(el.text || '');
      const editableClass = this.isEditableClassName(className);
      const focusedClassSignal = editableClass ? 100 : 0;
      const enabledSignal = el.enabled ? 8 : -20;
      const focusSignal = el.focusable ? 14 : 0;
      const clickSignal = el.clickable ? 12 : 0;
      const areaSignal = Math.min(24, Math.floor(this.getElementArea(el.bounds) / 6500));
      const score = focusedClassSignal + enabledSignal + focusSignal + clickSignal + areaSignal + text.length * 0.04;
      const reason = editableClass
        ? `class=${className || 'unknown'}`
        : 'closest-interactive-control';
      return { element: el, reason, score };
    });

    const ranked = scored.filter((entry) => entry.score > 20).sort((a, b) => b.score - a.score);
    if (ranked.length) {
      return ranked;
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  private getElementArea(bounds: UiBounds | null): number {
    if (!bounds) {
      return 0;
    }
    const width = Math.max(0, bounds.right - bounds.left);
    const height = Math.max(0, bounds.bottom - bounds.top);
    return width * height;
  }

  private isCandidateVisible(bounds: UiBounds | null): boolean {
    if (!bounds) {
      return false;
    }
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    return width > 1 && height > 1 && this.getElementArea(bounds) > 0;
  }

  private getTapPoint(el: UiElement): { x: number; y: number } | null {
    if (el.center && Number.isFinite(el.center.x) && Number.isFinite(el.center.y)) {
      return { x: Math.round(el.center.x), y: Math.round(el.center.y) };
    }
    if (!el.bounds) {
      return null;
    }
    const x = Math.round((el.bounds.left + el.bounds.right) / 2);
    const y = Math.round((el.bounds.top + el.bounds.bottom) / 2);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  private isEditableClassName(className: string): boolean {
    return className.includes('edittext')
      || className.includes('textfield')
      || className.includes('input')
      || className.includes('search');
  }

  async typeAscii(
    text: string,
    timeoutMs = 30000
  ): Promise<{ ok: true; method: 'input-text'; text: string }> {
    const escaped = text.replace(/ /g, '%s');
    await this._bridge.execOrThrow(`input text ${this._shell.quoteArg(escaped)}`, timeoutMs);
    return { ok: true, method: 'input-text', text };
  }

  async typeViaClipboard(
    text: string,
    timeoutMs = 30000
  ): Promise<{ ok: true; method: 'clipboard'; text: string }> {
    const baseline = await this.snapshotEditableTextValues();
    const broadcast = `sh -c ${this._shell.quoteArg(
      `am broadcast -a ${this._shell.quoteArg(CLIPBOARD_BROADCAST_ACTION)} --es text ${this._shell.quoteArg(text)} >/dev/null 2>&1 &`
    )}`;
    const commandTimeout = Math.min(timeoutMs, 1200);
    try {
      await this._bridge.execOrThrow(broadcast, commandTimeout);
    } catch (error: unknown) {
      const e = error as { code?: string };
      const errCode = typeof e?.code === 'string' ? e.code : undefined;
      if (!this.isRecoverableTypeInputError(errCode) || !(await this.verifyTextInjected(text, baseline))) {
        throw error;
      }
      await this._shell.sleep(120);
      return { ok: true, method: 'clipboard', text };
    }

    await this._shell.sleep(200);
    const keyEventError = await this._bridge.exec(`input keyevent ${KEY_MAP.paste}`);
    if (!keyEventError.ok) {
      const normalized = await this.verifyTextInjected(text, baseline);
      if (!normalized) {
        throw new SkillError(
          ErrorCode.TIMEOUT,
          `Clipboard input failed and paste keyevent not executed cleanly for: ${text}`
        );
      }
    }
    if (!(await this.verifyTextInjected(text, baseline))) {
      throw new SkillError(
        ErrorCode.TIMEOUT,
        `Clipboard input verification failed for: ${text}`
      );
    }
    return { ok: true, method: 'clipboard', text };
  }

  async typeViaAdbKeyboard(
    text: string,
    timeoutMs = 30000,
    fallbackToClipboard = false
  ): Promise<{ ok: true; method: 'adb-keyboard' | 'clipboard'; text: string }> {
    const baseline = await this.snapshotEditableTextValues();
    const commandTimeout = Math.min(timeoutMs, 1200);
    const tryCommands = [
      `sh -c ${this._shell.quoteArg(
        `am broadcast -a ${this._shell.quoteArg(ADB_KEYBOARD_BROADCAST_ACTION)} --es msg ${this._shell.quoteArg(text)} >/dev/null 2>&1 &`
      )}`,
      `sh -c ${this._shell.quoteArg(
        `am broadcast -a ${this._shell.quoteArg(ADB_KEYBOARD_BROADCAST_ACTION)} --es ${ADB_KEYBOARD_TEXT_KEY} ${this._shell.quoteArg(text)} >/dev/null 2>&1 &`
      )}`,
    ];

    for (const broadcast of tryCommands) {
      try {
        await this._bridge.execOrThrow(broadcast, commandTimeout);
        await this._shell.sleep(180);
        if (await this.verifyTextInjected(text, baseline)) {
          return { ok: true, method: 'adb-keyboard', text };
        }
        continue;
      } catch (error: unknown) {
        const errCode = (error as { code?: string }).code;
        if (!this.isRecoverableTypeInputError(errCode)) {
          throw error;
        }
        const recovered = await this.verifyTextInjected(text, baseline);
        if (recovered) {
          return { ok: true, method: 'adb-keyboard', text };
        }
      }
    }

    if (!fallbackToClipboard) {
      throw new SkillError(
        ErrorCode.TIMEOUT,
        `ADB keyboard input verification failed for: ${text}`
      );
    }

    await this.typeViaClipboard(text, timeoutMs);
    return { ok: true, method: 'clipboard', text };
  }

  private async typeUnicodeWithFallback(
    text: string,
    timeoutMs = 30000
  ): Promise<{ ok: true; method: 'adb-keyboard' | 'clipboard'; text: string }> {
    try {
      return await this.typeViaAdbKeyboard(text, timeoutMs, true);
    } catch (error: unknown) {
      const e = error as { code?: string };
      if (e && typeof e.code === 'string' && e.code !== ErrorCode.TIMEOUT && e.code !== ErrorCode.EXEC_FAILED) {
        throw error;
      }

      // ADB keyboard may fail on some devices/ROMs. Fallback to clipboard for non-ASCII text to keep flow moving.
      await this.typeViaClipboard(text, timeoutMs);
      return { ok: true, method: 'clipboard', text };
    }
  }

  private isRecoverableTypeInputError(errorCode?: string): boolean {
    if (!errorCode) {
      return false;
    }
    return errorCode === ErrorCode.TIMEOUT
      || errorCode === ErrorCode.EXEC_FAILED
      || errorCode === ErrorCode.BRIDGE_UNREACHABLE
      || errorCode === ErrorCode.BRIDGE_NOT_FOUND
      || errorCode === ErrorCode.SHIZUKU_NOT_READY;
  }

  private async snapshotEditableTextValues(): Promise<string[]> {
    const elements = await this._ui.dump();
    return elements
      .filter((el) => this.isEditableClassName(String(el.className || '').toLowerCase()))
      .map((el) => this.normalizeTypeText(el.text));
  }

  private async verifyTextInjected(text: string, baseline: string[]): Promise<boolean> {
    const expected = this.normalizeTypeText(text);
    if (!expected) {
      return false;
    }

    for (let i = 0; i < TYPE_VERIFICATION_ATTEMPTS; i += 1) {
      const current = await this.snapshotEditableTextValues();
      if (this.hasInjectedTextInEditableTextList(expected, baseline, current)) {
        return true;
      }
      await this._shell.sleep(TYPE_VERIFICATION_INTERVAL_MS);
    }
    return false;
  }

  private hasInjectedTextInEditableTextList(
    expected: string,
    baseline: string[],
    current: string[]
  ): boolean {
    const baselineSet = new Set<string>(baseline);
    const baselineMaxLenByText = new Map<string, number>();
    for (const value of baseline) {
      baselineMaxLenByText.set(value, Math.max(
        baselineMaxLenByText.get(value) || 0,
        value.length
      ));
    }

    for (const value of current) {
      if (!value || !value.includes(expected)) {
        continue;
      }
      if (!baselineSet.has(value)) {
        return true;
      }
      if (value.length > (baselineMaxLenByText.get(value) || 0)) {
        return true;
      }
    }
    return false;
  }

  private normalizeTypeText(rawText: string): string {
    return String(rawText).replace(/\s+/g, ' ').trim();
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
