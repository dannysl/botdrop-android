export {};
'use strict';

import type { ParsedArgs } from '../types';
const { isRecordObject } = require('./type-guards');
import type { UiElement, UiSelector } from '../types';
const { matchesSelector } = require('./ui-engine');

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
  type: (
    text: string,
    timeoutMs?: number,
    method?: 'auto' | 'input-text' | 'clipboard' | 'adb-keyboard',
    options?: {
      focus?: boolean;
      focusSelector?: Record<string, unknown>;
      focusTimeoutMs?: number;
      inputMode?: 'append' | 'new';
    }
  ) => Promise<{ ok: true; method: 'input-text' | 'clipboard' | 'adb-keyboard'; text: string; focus?: Record<string, unknown> }>;
  uiDump: (selector?: Record<string, unknown> | null) => Promise<unknown[]>;
  waitFor: (selector: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
  deviceInfo: () => Promise<{ ok: true; model: string; androidVersion: string; sdkVersion: string; manufacturer: string }>;
  batteryInfo: () => Promise<{ ok: true; level: string | null; charging: boolean; temperature: string | null; raw: string }>;
  installedApps: () => Promise<{ ok: true; packages: string[] }>;
  screenSize: () => Promise<{ ok: true; width: number | null; height: number | null; raw?: string }>;
  exec: (command: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
}

interface PageElementTransition {
  nodeId: string;
  signature: string;
  text: string;
  description: string;
  className: string;
  resourceId: string;
  bounds: string | null;
  clickable: boolean;
  focusable: boolean;
  enabled: boolean;
}

interface PageStateSnapshot {
  packageName: string | null;
  activity: string | null;
  raw: string;
  timestampMs: number;
  ui: {
    available: boolean;
    error?: string;
    summary?: {
      totalElements: number;
      interactiveCount: number;
      editableCount: number;
      fingerprint: string;
      allSignatures: string[];
      allNodes: PageElementTransition[];
      topInteractive: PageElementTransition[];
      topEditTexts: PageElementTransition[];
      topNodes: PageElementTransition[];
      interactiveNodes: PageElementTransition[];
      editableNodes: PageElementTransition[];
      interactiveSignatures: string[];
      editableSignatures: string[];
      allSignaturesSample: string[];
    };
  };
  visualFallback?: VisualFallbackSnapshot;
}

interface PageTransitionDiff {
  changed: boolean;
  activityChanged: boolean;
  packageChanged: boolean;
  appRawChanged: boolean;
  beforePopupCandidatesCount: number;
  afterPopupCandidatesCount: number;
  beforeUiAvailable: boolean;
  afterUiAvailable: boolean;
  uiFingerprintChanged: boolean;
  uiNodeCountDelta: number;
  uiElementCountDelta: number;
  interactiveCountDelta: number;
  editableCountDelta: number;
  addedSignaturesCount: number;
  removedSignaturesCount: number;
  added: PageElementTransition[];
  removed: PageElementTransition[];
}

interface CompactObservedState {
  packageName: string | null;
  activity: string | null;
  raw: string;
  timestampMs: number;
  ui: {
    available: boolean;
    summary?: {
      totalElements: number;
      interactiveCount: number;
      editableCount: number;
      fingerprint: string;
      topNodes: PageElementTransition[];
      topInteractive: PageElementTransition[];
      topEditTexts: PageElementTransition[];
      interactiveNodes: PageElementTransition[];
    };
    error?: string;
    };
  visualFallback?: VisualFallbackSnapshot;
}

interface ObservedActionDecision {
  needsAttention: boolean;
  reasons: string[];
  suggest: Array<{ command: string; reason: string }>;
}

interface ActionOutcomePolicy<T extends Record<string, unknown>> {
  evaluate: (context: {
    command: string;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
    transition: PageTransitionDiff;
    actionResult: T | null;
    actionError: unknown;
  }) => Promise<boolean> | boolean;
  failureReasons?: (context: {
    command: string;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
    transition: PageTransitionDiff;
    actionResult: T | null;
    actionError: unknown;
  }) => string[] | null;
  onFailure?: (context: {
    actions: ActionsLike;
    attempt: number;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
    transition: PageTransitionDiff;
    actionResult: T | null;
    actionError: unknown;
  }) => Promise<void>;
}

interface TransitionWaitProfile {
  timedOut: boolean;
  observeWaitMs: number;
  observePollMs: number;
  waitedMs: number;
  attempts: number;
}

interface VisualFallbackSnapshot {
  ok: boolean;
  path?: string;
  androidPath?: string;
  requestedPath?: string | null;
  capturedAtMs: number;
  command: string;
  reason: string;
  error?: string;
}

const delayMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const POPUP_DISMISS_SELECTORS: Array<{ selector: UiSelector; reason: string }> = [
  { selector: { text: '关闭', clickable: true }, reason: 'close-button' },
  { selector: { text: '取消', clickable: true }, reason: 'cancel-button' },
  { selector: { textContains: '取消', clickable: true }, reason: 'cancel-text-contains' },
  { selector: { text: '确定', clickable: true }, reason: 'confirm-button' },
  { selector: { textContains: '确定', clickable: true }, reason: 'confirm-text-contains' },
  { selector: { text: '知道了', clickable: true }, reason: 'acknowledge' },
  { selector: { textContains: '知道了', clickable: true }, reason: 'acknowledge-contains' },
  { selector: { text: '允许', clickable: true }, reason: 'allow-button' },
  { selector: { textContains: '允许', clickable: true }, reason: 'allow-text-contains' },
  { selector: { text: '稍后', clickable: true }, reason: 'later' },
  { selector: { text: '以后再说', clickable: true }, reason: 'later-text' },
  { selector: { text: '暂不', clickable: true }, reason: 'skip' },
  { selector: { className: 'android.widget.ImageView', descriptionContains: '关闭', clickable: true }, reason: 'close-icon' },
  { selector: { className: 'android.widget.ImageView', descriptionContains: 'Close', clickable: true }, reason: 'close-icon-en' },
  { selector: { className: 'android.widget.Button', descriptionContains: 'Close', clickable: true }, reason: 'close-button-desc' },
  { selector: { className: 'android.widget.Button', textContains: 'Not now', clickable: true }, reason: 'later-text-en' },
  { selector: { className: 'android.widget.Button', textContains: 'Skip', clickable: true }, reason: 'skip-button' },
  { selector: { descriptionContains: 'Not now', clickable: true }, reason: 'later-desc-en' },
  { selector: { textContains: '关闭', clickable: true }, reason: 'close-text-contains' },
  { selector: { resourceId: 'android:id/button1', clickable: true }, reason: 'android-button1' },
  { selector: { resourceId: 'android:id/button2', clickable: true }, reason: 'android-button2' },
  { selector: { textContains: '确定关闭', clickable: true }, reason: 'close-with-confirm' },
  { selector: { textContains: '暂时不', clickable: true }, reason: 'temporarily-no' },
];

const DEFAULT_POPUP_RECOVERY_RETRIES = 1;
const DEFAULT_POPUP_RECOVERY_DELAY_MS = 350;
const MAX_POPUP_DISMISS_ROUNDS = 3;
const MAX_TAP_FALLBACK_SELECTORS = 14;
const MAX_TAP_DERIVED_SELECTORS = 10;
const OBSERVE_WAIT_MS_DEFAULT = 280;
const OBSERVE_POLL_MS_DEFAULT = 90;
const OBSERVE_WAIT_MS_AUTO_CLOSE_AD = 4200;
const TYPE_FOCUS_TIMEOUT_MS = 1500;
const OBSERVE_MAX_INTERACTIVE_NODES = 160;
const OBSERVE_MAX_DIFF_NODES = 20;
const DEFAULT_ALLOW_HEURISTIC_TAP = false;
const AUTO_CLOSE_POLL_MS = 220;
const AUTO_CLOSE_STABILIZE_TIMEOUT_MS = 1800;
const POPUP_DISMISS_KEYWORDS = Array.from(new Set([
  '关闭',
  '取消',
  '稍后',
  '知道了',
  'skip',
  '不感兴趣',
  'close',
  '广告',
]));
const AUTO_CLOSE_KEYWORDS = Array.from(new Set([
  '跳过',
  '关闭',
  'skip',
  'close',
  '不感兴趣',
  '稍后',
  '取消',
  '广告',
  '知道了',
]));
const VISUAL_FALLBACK_COMMANDS = new Set(['launch', 'tap', 'tap-element', 'swipe', 'press', 'type']);

interface PopupRecoveryOptions {
  command: string;
  action: () => Promise<unknown>;
  actions: ActionsLike;
  retries?: number;
  retryDelayMs?: number;
  dismissBefore?: boolean;
}

interface TapFallbackCandidate {
  reason: string;
  score: number;
  element: UiElement;
  tapped: { x: number; y: number };
}

interface PopupDismissCandidate {
  selector: UiSelector;
  reason: string;
  element: UiElement;
}

interface PopupHint {
  text: string;
  className: string;
  reason: string;
  resourceId: string;
  description: string;
}


interface TapCandidate {
  source: string;
  selector: Record<string, unknown>;
}

class CliCommandHandler {
  private static readonly DEFAULT_TEXT_LENGTH = 20;
  private static readonly DEFAULT_READ_FILE_BYTES = 10 * 1024 * 1024;
  private static readonly DEFAULT_IMAGE_CHARS = 120000;

  constructor(
    private readonly runtime: CliRuntimeLike
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
          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'launch',
              actions,
              action: () => this.handleLaunch(args, actions) as Promise<Record<string, unknown>>,
              observeWaitMs: this.getObserveWaitMs(args),
              observePollMs: this.getObservePollMs(args),
              visualFallback: this.isVisualFallbackEnabled(args),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'launch',
              actions,
              action: () => this.handleLaunch(args, actions),
            });
            ok(res as Record<string, unknown>);
          }
          break;
        }

        case 'wait-foreground': {
          const pkg = args.positional[0];
          if (!pkg) {
            fail('INVALID_ARGS', 'Usage: wait-foreground <package>');
          }
          const wait = await this.runtime.waitForForegroundPackage(
            actions,
            pkg,
            this.runtime.getPostLaunchWaitOptions(args.flags)
          );
          if (!wait.ok) {
            fail('APP_NOT_STABLE', `Target app not in foreground: ${pkg}`, {
              packageName: pkg,
              timeoutMs: wait.timeoutMs,
              waitedMs: wait.waitedMs,
              lastPackage: wait.packageName,
              lastActivity: wait.activity,
              raw: wait.raw,
            });
          }
          ok({
            packageName: pkg,
            stable: wait.stable,
            activity: wait.activity,
            waitedMs: wait.waitedMs,
            reason: wait.reason || 'foreground-stable',
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
          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'tap',
              actions,
              action: () => actions.tap(x, y) as Promise<Record<string, unknown>>,
              observeWaitMs: this.getObserveWaitMs(args),
              observePollMs: this.getObservePollMs(args),
              visualFallback: this.isVisualFallbackEnabled(args),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'tap',
              actions,
              action: () => actions.tap(x, y),
            });
            ok(res);
          }
          break;
        }

        case 'tap-element': {
          const raw = args.positional[0];
          if (!raw) fail('INVALID_ARGS', `Usage: tap-element '{\"text\":\"OK\"}'`);

          const selector = parseSelector(raw);
          const fallbackSelectors = this.parseSelectorArray(this.runtime.getFlagString(args.flags, 'fallback-selectors'));
          const retries = this.runtime.parsePositiveInt(
            this.runtime.getFlagString(args.flags, 'retries'),
            0,
            0
          );
          const retryDelayMs = this.runtime.parsePositiveInt(
            this.runtime.getFlagString(args.flags, 'fallback-retry-delay-ms'),
            250,
            0
          );
          const allowHeuristicTap = this.runtime.hasFlag(args.flags, 'allow-heuristic');
          const isAutoCloseSelector = this.isAutoCloseOrInterstitialSelector(selector);
          const effectiveHeuristicTap = allowHeuristicTap || DEFAULT_ALLOW_HEURISTIC_TAP || isAutoCloseSelector;

          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'tap-element',
              actions,
              action: () => this.handleTapElementWithFallback({
                primarySelector: selector,
                fallbackSelectors,
                retries,
                retryDelayMs,
                allowHeuristicTap: effectiveHeuristicTap,
                includeCloseCandidateHints: isAutoCloseSelector,
                actions,
              }) as Promise<Record<string, unknown>>,
              postTransitionValidator: async ({ transition, actionResult }) => this.suggestForTapElementNoTransition({
                actionResult: actionResult as Record<string, unknown> | null,
                transition,
                actions,
                primarySelector: selector,
                fallbackSelectors,
              }),
              probeAutoClosePopup: isAutoCloseSelector,
              observeWaitMs: this.getTapObserveWaitMs(args, selector),
              observePollMs: this.getObservePollMs(args),
              visualFallback: this.isVisualFallbackEnabled(args) && !isAutoCloseSelector,
              ignoreActionError: ({ actionError, pre, post, transition }) => (
                this.isTapElementNotFoundError(actionError)
                && (transition.changed || this.hasPopupCandidateDropped(pre, post))
                && isAutoCloseSelector
              ),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'tap-element',
              actions,
              action: () => this.handleTapElementWithFallback({
                primarySelector: selector,
                fallbackSelectors,
                retries,
                retryDelayMs,
                allowHeuristicTap: effectiveHeuristicTap,
                includeCloseCandidateHints: isAutoCloseSelector,
                actions,
              }),
            });
            ok(res as Record<string, unknown>);
          }
          break;
        }

        case 'swipe': {
          const [x1, y1, x2, y2, dur] = args.positional.map(Number);
          if ([x1, y1, x2, y2].some(isNaN)) {
            fail('INVALID_ARGS', 'Usage: swipe <x1> <y1> <x2> <y2> [durationMs]');
          }
          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'swipe',
              actions,
              action: () => actions.swipe(x1, y1, x2, y2, dur || 300) as Promise<Record<string, unknown>>,
              observeWaitMs: this.getObserveWaitMs(args),
              observePollMs: this.getObservePollMs(args),
              visualFallback: this.isVisualFallbackEnabled(args),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'swipe',
              actions,
              action: () => actions.swipe(x1, y1, x2, y2, dur || 300),
            });
            ok(res);
          }
          break;
        }

        case 'press': {
          const key = args.positional[0];
          if (!key) fail('INVALID_ARGS', 'Usage: press <key> (home/back/enter/recent/paste/...)');
          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'press',
              actions,
              action: () => actions.press(key) as Promise<Record<string, unknown>>,
              observeWaitMs: this.getObserveWaitMs(args),
              observePollMs: this.getObservePollMs(args),
              visualFallback: this.isVisualFallbackEnabled(args),
              postTransitionValidator: async ({ transition, actionResult, pre, post }) =>
                this.suggestForPressNoTransition({
                  transition,
                  actionResult: actionResult as Record<string, unknown> | null,
                  pre,
                  post,
                }),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'press',
              actions,
              action: () => actions.press(key),
            });
            ok(res);
          }
          break;
        }

        case 'type': {
          const text = args.positional[0] !== undefined ? args.positional.join(' ') : this.runtime.getFlagString(args.flags, 'text');
          if (text === undefined) {
            fail('INVALID_ARGS', 'Usage: type <text>');
            break;
          }
          const timeoutMs = this.runtime.parsePositiveInt(
            this.runtime.getFlagString(args.flags, 'timeout-ms'),
            30000,
            1
          );
          const methodRaw = this.runtime.getFlagString(args.flags, 'method') || 'auto';
          const method = methodRaw === 'input-text' || methodRaw === 'clipboard' || methodRaw === 'auto' || methodRaw === 'adb-keyboard'
            ? methodRaw
            : 'auto';
          if (methodRaw !== method) {
            fail('INVALID_ARGS', `Invalid --method value for type: ${methodRaw}. Use auto|input-text|clipboard|adb-keyboard`);
          }
          const inputModeRaw = this.runtime.getFlagString(args.flags, 'input-mode') || 'new';
          const inputMode = inputModeRaw === 'append' || inputModeRaw === 'new' ? inputModeRaw : 'new';
          if (inputModeRaw !== inputMode) {
            fail('INVALID_ARGS', `Invalid --input-mode value for type: ${inputModeRaw}. Use new|append`);
          }
          const noFocus = this.runtime.hasFlag(args.flags, 'no-focus');
          const focusSelectorRaw = this.runtime.getFlagString(args.flags, 'focus-selector');
          const focusSelector = focusSelectorRaw ? this.runtime.parseSelector(focusSelectorRaw) : undefined;
          const focusTimeoutMs = this.runtime.parsePositiveInt(
            this.runtime.getFlagString(args.flags, 'focus-timeout-ms'),
            TYPE_FOCUS_TIMEOUT_MS,
            300
          );
          const focusOptions = {
            focus: !noFocus,
            focusSelector: focusSelector as Record<string, unknown> | undefined,
            focusTimeoutMs,
            inputMode: inputMode as 'append' | 'new',
          };
          const shouldObserve = this.shouldObserveState(args, false);
          if (shouldObserve) {
            const typeTimeout = this.getObserveWaitMs(args);
            const typedText = this.normalizeUiText(text);
            const res = await this.runActionWithTransition<Record<string, unknown>>({
              command: 'type',
              actions,
              action: () => actions.type(text, timeoutMs, method, focusOptions) as Promise<Record<string, unknown>>,
              retries: 2,
              retryDelayMs: 500,
              observeWaitMs: typeTimeout,
              observePollMs: this.getObservePollMs(args),
              isActionSettled: ({ pre, post }) => this.isTypedTextDetectedInTransition({
                pre,
                post,
                typedText,
              }),
              visualFallback: this.isVisualFallbackEnabled(args),
              actionOutcome: {
                evaluate: ({ pre, post, actionError }) => !actionError && this.isTypedTextDetectedInTransition({
                  pre,
                  post,
                  typedText,
                }),
                failureReasons: ({ actionError }) => {
                  const reason = actionError && typeof actionError === 'object' && (actionError as { message?: string }).message;
                  return [
                    reason ? `type action failed before verifying input: ${reason}` : 'type action did not inject text into editable fields',
                  ];
                },
                onFailure: async ({ actions, attempt }) => {
                  await this.dismissBlockingPopups(actions);
                  if (attempt >= 1) {
                    await delayMs(150);
                  }
                  try {
                    await actions.press('back');
                  } catch {
                    // keep retry loop moving; back key may be blocked or irrelevant in this context.
                  }
                  await delayMs(120);
                },
              },
              postTransitionValidator: async ({ transition, pre, post }) => this.suggestForTypeNoTransition({
                transition,
                pre,
                post,
                typedText: text,
              }),
            });
            ok(res);
          } else {
            const res = await this.runWithPopupRecovery({
              command: 'type',
              actions,
              retries: 2,
              retryDelayMs: 500,
              action: () => actions.type(text, timeoutMs, method, focusOptions),
            });
            ok(res as Record<string, unknown>);
          }
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
          try {
            const data = await this.runWithPopupRecovery({
              command: 'ui-dump',
              actions,
              action: () => actions.uiDump(selector),
            });
            ok(data as unknown[]);
          } catch (error) {
            const visualFallback = await this.captureActionVisualFallback({
              command: 'ui-dump',
              actions,
              reason: 'ui-dump command failed; fallback to screenshot for page recognition',
            });
            fail('UI_DUMP_FAILED', `ui-dump failed${packageName ? ` for ${packageName}` : ''}`, {
              packageName: packageName || null,
              error: this.runtime.getFailureMessage(error, 'Unknown ui-dump error'),
              details: this.runtime.getFailureDetails(error),
              visualFallback,
            });
          }
          break;
        }

        case 'wait-for': {
          const raw = args.positional[0];
          if (!raw) fail('INVALID_ARGS', "Usage: wait-for '{\"text\":\"OK\"}' [--timeout ms]");
          const selector = parseSelector(raw);
          const timeout = parseInt(this.runtime.getFlagString(args.flags, 'timeout') || '10000', 10);
          const el = await this.runWithPopupRecovery({
            command: 'wait-for',
            actions,
            action: () => actions.waitFor(selector, timeout),
          });
          ok({ element: el as unknown });
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

        case 'dismiss-popups': {
          const rounds = this.runtime.parsePositiveInt(
            this.runtime.getFlagString(args.flags, 'rounds'),
            MAX_POPUP_DISMISS_ROUNDS,
            1
          );
          const dismissed = await this.dismissBlockingPopups(actions, rounds);
          ok({
            ok: true,
            dismissed,
            rounds,
          });
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

  private parseSelectorArray(raw: string | undefined): Record<string, unknown>[] {
    if (!raw) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const parseError = error instanceof Error ? error.message : String(error);
      this.runtime.fail('INVALID_ARGS', `Invalid fallback-selectors JSON: ${parseError}`, {
        raw,
      });
    }

    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is Record<string, unknown> => isRecordObject(entry));
    }

    if (isRecordObject(parsed)) {
      return [parsed as Record<string, unknown>];
    }

    this.runtime.fail('INVALID_ARGS', 'fallback-selectors must be a JSON array of selector objects', { raw });
    return [];
  }

  private shouldObserveState(args: ParsedArgs, defaultWhenMissing = true): boolean {
    const rawObserve = this.runtime.getFlagString(args.flags, 'observe');
    if (rawObserve === undefined) {
      return defaultWhenMissing;
    }
    const normalized = String(rawObserve).trim().toLowerCase();
    if (!normalized) {
      return defaultWhenMissing;
    }
    return !['0', 'false', 'off', 'no'].includes(normalized);
  }

  private getObserveWaitMs(args: ParsedArgs): number {
    return this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'observe-wait-ms'),
      OBSERVE_WAIT_MS_DEFAULT,
      0
    );
  }

  private getObservePollMs(args: ParsedArgs): number {
    return this.runtime.parsePositiveInt(
      this.runtime.getFlagString(args.flags, 'observe-poll-ms'),
      OBSERVE_POLL_MS_DEFAULT,
      40
    );
  }

  private getTapObserveWaitMs(args: ParsedArgs, selector: Record<string, unknown>): number {
    const explicit = this.runtime.getFlagString(args.flags, 'observe-wait-ms');
    if (explicit !== undefined) {
      return this.getObserveWaitMs(args);
    }
    if (this.isAutoCloseOrInterstitialSelector(selector)) {
      return OBSERVE_WAIT_MS_AUTO_CLOSE_AD;
    }
    return OBSERVE_WAIT_MS_DEFAULT;
  }

  private isAutoCloseOrInterstitialSelector(selector: Record<string, unknown>): boolean {
    const getText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
    const candidates = [
      getText(selector.text),
      getText(selector.textContains),
      getText(selector.description),
      getText(selector.descriptionContains),
    ];
    const signals = AUTO_CLOSE_KEYWORDS;
    return candidates.some((candidate) => signals.some((signal) => candidate.toLowerCase().includes(signal.toLowerCase())));
  }

  private hasPopupCandidateDropped(pre: PageStateSnapshot, post: PageStateSnapshot): boolean {
    const before = this.countLikelyPopupControls(pre);
    const after = this.countLikelyPopupControls(post);
    return before > 0 && after < before;
  }

  private countLikelyPopupControls(snapshot: PageStateSnapshot): number {
    return this.collectPopupDismissCandidatesFromState(snapshot).length;
  }

  private isPopupControlText(value: string): boolean {
    const normalized = String(value || '').toLowerCase().replace(/\s+/g, '');
    if (!normalized) {
      return false;
    }
    return POPUP_DISMISS_KEYWORDS.some((keyword) => {
      const target = String(keyword || '').toLowerCase().replace(/\s+/g, '');
      return target && normalized.includes(target);
    });
  }

  private collectPopupDismissCandidatesFromState(state: PageStateSnapshot): PopupDismissCandidate[] {
    if (!state.ui.available || !state.ui.summary?.allNodes || !state.ui.summary.allNodes.length) {
      return [];
    }
    return this.collectPopupDismissCandidates(
      state.ui.summary.allNodes.map((entry) => ({
        text: entry.text,
        description: entry.description,
        resourceId: entry.resourceId,
        className: entry.className,
        bounds: null,
        center: null,
        clickable: entry.clickable,
        enabled: entry.enabled,
        focusable: entry.focusable,
        scrollable: false,
        packageName: '',
      }))
    );
  }

  private async waitForAutoCloseStabilization(params: {
    actions: ActionsLike;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
  }): Promise<{ stabilized: boolean; state: PageStateSnapshot; attempts: number; waitedMs: number }> {
    const timeoutMs = AUTO_CLOSE_STABILIZE_TIMEOUT_MS;
    const pollMs = AUTO_CLOSE_POLL_MS;
    const startMs = Date.now();
    let attempts = 1;
    const prePopupCandidates = this.countLikelyPopupControls(params.pre);
    let observedPopupPeak = prePopupCandidates;
    let sawPopupIncrease = false;
    let state = params.post;
    while (Date.now() - startMs < timeoutMs) {
      await delayMs(Math.min(pollMs, Math.max(0, timeoutMs - (Date.now() - startMs))));
      state = await this.capturePageState(params.actions);
      attempts += 1;
      const popupCount = this.countLikelyPopupControls(state);
      if (popupCount > observedPopupPeak) {
        observedPopupPeak = popupCount;
        sawPopupIncrease = true;
      }
      if (
        state.packageName !== params.pre.packageName
        || state.activity !== params.pre.activity
        || (sawPopupIncrease && popupCount <= prePopupCandidates)
        || this.hasPopupCandidateDropped(params.pre, state)
      ) {
        return {
          stabilized: true,
          state,
          attempts,
          waitedMs: Date.now() - startMs,
        };
      }
    }

    return {
      stabilized: false,
      state,
      attempts,
      waitedMs: Date.now() - startMs,
    };
  }

  private isTapElementNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const errorRecord = error as Record<string, unknown>;
    return typeof errorRecord.code === 'string' && errorRecord.code === 'ELEMENT_NOT_FOUND';
  }

  private isVisualFallbackEnabled(args: ParsedArgs): boolean {
    if (this.runtime.hasAnyFlag(args.flags, 'no-visual-fallback', 'disable-visual-fallback', 'skip-visual-fallback')) {
      return false;
    }
    return !this.runtime.hasFlag(args.flags, 'no-visual');
  }

  private async runActionWithTransition<T extends Record<string, unknown>>(options: {
    command: string;
    actions: ActionsLike;
    action: () => Promise<T>;
    retries?: number;
    retryDelayMs?: number;
    observeWaitMs?: number;
    observePollMs?: number;
    visualFallback?: boolean;
    probeAutoClosePopup?: boolean;
    isActionSettled?: (context: {
      pre: PageStateSnapshot;
      post: PageStateSnapshot;
      transition: PageTransitionDiff;
    }) => boolean;
    ignoreActionError?: (context: {
      command: string;
      pre: PageStateSnapshot;
      post: PageStateSnapshot;
      transition: PageTransitionDiff;
      actionError: unknown;
    }) => boolean | Promise<boolean>;
    postTransitionValidator?: (context: {
      command: string;
      pre: PageStateSnapshot;
      post: PageStateSnapshot;
      transition: PageTransitionDiff;
      actionResult: T | null;
      actionError: unknown;
    }) => Promise<ObservedActionDecision | null> | ObservedActionDecision | null;
    actionOutcome?: ActionOutcomePolicy<T>;
  }): Promise<Record<string, unknown>> {
    const maxAttempts = Math.max(1, Number.isFinite(options.retries as number) ? Number(options.retries) + 1 : 1);
    const attemptDelayMs = Math.max(0, Number.isFinite(options.retryDelayMs as number) ? Number(options.retryDelayMs) : 350);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const pre = await this.capturePageState(options.actions);
      let actionResult: T | null = null;
      let actionError: unknown = null;
      let shouldIgnoreActionError = false;
      let suggestion: ObservedActionDecision = {
        needsAttention: false,
        reasons: ['Action executed'],
        suggest: [],
      };

      try {
        actionResult = await this.runWithPopupRecovery({
          command: options.command,
          actions: options.actions,
          retries: options.retries,
          retryDelayMs: options.retryDelayMs,
          action: options.action,
        }) as T;
        if (options.command === 'tap' || options.command === 'tap-element' || options.command === 'swipe' || options.command === 'press') {
          const resultIsFailure = actionResult && typeof actionResult === 'object' && (actionResult as { ok?: unknown }).ok === false;
          if (resultIsFailure) {
            const failure = actionResult as Record<string, unknown>;
            const error = new Error(String(failure.message || 'interaction command reported failure'));
            (error as { code?: string }).code = typeof failure.error === 'string' ? failure.error : 'ACTION_FAILED';
            (error as { details?: Record<string, unknown> }).details = {
              command: options.command,
              actionResult,
            };
            actionError = error;
          }
        }
      } catch (error) {
        actionError = error;
      }

      const actionSettled = options.isActionSettled;
      const waitProfile = await this.waitForObservableTransition({
        actions: options.actions,
        pre,
        timeoutMs: Math.max(0, options.observeWaitMs ?? 0),
        pollMs: Math.max(40, options.observePollMs ?? OBSERVE_POLL_MS_DEFAULT),
        isActionSettled: actionSettled ? (post, transition) =>
          actionSettled({
            pre,
            post,
            transition,
          }) : undefined,
      });
      const post = waitProfile.post;
      const transition = this.buildPageTransition(pre, post);
      let adaptivePost = post;
      let adaptiveAttempts = 0;
      let finalTransition = transition;
      let autoCloseRecovered = false;
      const isTapNotFound = this.isTapElementNotFoundError(actionError);

      const shouldAutoCloseProbe = Boolean(options.probeAutoClosePopup)
        && options.command === 'tap-element'
        && !actionError
        && waitProfile.timedOut
        && !transition.changed
        && !this.hasPopupCandidateDropped(pre, post);

      if (
        options.command === 'tap-element'
        && options.ignoreActionError
        && isTapNotFound
        && waitProfile.timedOut
        && !transition.changed
      ) {
        const autoCloseProbe = await this.waitForAutoCloseStabilization({
          actions: options.actions,
          pre,
          post,
        });
        adaptivePost = autoCloseProbe.state;
        adaptiveAttempts = autoCloseProbe.attempts;
        finalTransition = this.buildPageTransition(pre, adaptivePost);
        if (autoCloseProbe.stabilized) {
          actionError = null;
          autoCloseRecovered = true;
        }
      }

      if (shouldAutoCloseProbe && !isTapNotFound) {
        const autoCloseProbe = await this.waitForAutoCloseStabilization({
          actions: options.actions,
          pre,
          post,
        });
        adaptiveAttempts = autoCloseProbe.attempts;
        adaptivePost = autoCloseProbe.state;
        finalTransition = this.buildPageTransition(pre, adaptivePost);
        if (autoCloseProbe.stabilized) {
          actionError = null;
          autoCloseRecovered = true;
        }
      }

      if (options.ignoreActionError) {
        shouldIgnoreActionError = Boolean(await options.ignoreActionError({
          command: options.command,
          pre,
          post: finalTransition.changed ? adaptivePost : post,
          transition: finalTransition.changed ? finalTransition : transition,
          actionError,
        }));
      }
      if (shouldIgnoreActionError) {
        actionError = null;
      }
      const shouldCaptureVisualFallback = (
        options.visualFallback !== false
        && VISUAL_FALLBACK_COMMANDS.has(options.command)
        && !finalTransition.changed
        && waitProfile.timedOut
        && !actionError
      );
      const capturedVisual = shouldCaptureVisualFallback
        ? await this.captureActionVisualFallback({
            command: options.command,
            actions: options.actions,
            reason: `No UI transition detected after ${options.command} within ${waitProfile.waitedMs}ms`,
          })
        : null;
      const popupHints = this.collectPopupHintsFromState(adaptivePost);
      suggestion = this.suggestNextAction(finalTransition, {
        command: options.command,
        actionResult,
      }, popupHints);
      if (options.postTransitionValidator) {
        const overridden = await options.postTransitionValidator({
          command: options.command,
          pre,
          post: adaptivePost,
          transition: finalTransition,
          actionResult: actionResult,
          actionError,
        });
        if (overridden) {
          suggestion = overridden;
        }
      }

      if (autoCloseRecovered && options.command === 'tap-element') {
        suggestion.needsAttention = false;
        suggestion.reasons = ['Transient popup overlay was observed and stabilized during post-action stabilization'];
        suggestion.suggest = [];
      }
      if (!pre.ui.available || !adaptivePost.ui.available) {
        suggestion.needsAttention = true;
        suggestion.reasons.push(
          'UI tree unavailable during this step; please use screenshot analysis to infer current page context'
        );
        const preScreenshot = pre.visualFallback && (pre.visualFallback.path || pre.visualFallback.requestedPath);
        if (preScreenshot) {
          suggestion.reasons.push(`pre-state screenshot: ${preScreenshot}`);
        }
        const postScreenshot = adaptivePost.visualFallback && (adaptivePost.visualFallback.path || adaptivePost.visualFallback.requestedPath);
        if (postScreenshot) {
          suggestion.reasons.push(`post-state screenshot: ${postScreenshot}`);
        }
        suggestion.suggest.push({
          command: 'screenshot',
          reason: 'take current screenshot for vision based page identification',
        });
      }

      if (!finalTransition.changed && suggestion.needsAttention && capturedVisual && options.visualFallback !== false) {
        suggestion.reasons.push(
          capturedVisual.ok
            ? `visualFallback captured: ${capturedVisual.path || capturedVisual.requestedPath}`
            : `visualFallback failed: ${capturedVisual.error || 'capture error'}`
        );
      }

      let actionPassed = Boolean(!actionError);
      if (options.actionOutcome) {
        actionPassed = Boolean(await options.actionOutcome.evaluate({
          command: options.command,
          pre,
          post: adaptivePost,
          transition: finalTransition,
          actionResult,
          actionError,
        }));
      }

      if (!actionPassed && options.actionOutcome && options.actionOutcome.failureReasons) {
        const reasons = options.actionOutcome.failureReasons({
          command: options.command,
          pre,
          post: adaptivePost,
          transition: finalTransition,
          actionResult,
          actionError,
        }) || [];
        if (reasons.length > 0) {
          suggestion.needsAttention = true;
          for (const reason of reasons) {
            if (reason) {
              suggestion.reasons.push(reason);
            }
          }
        }
      }

      if (!actionPassed && options.actionOutcome && options.actionOutcome.onFailure && attempt < maxAttempts) {
        try {
          await options.actionOutcome.onFailure({
            actions: options.actions,
            attempt,
            pre,
            post: adaptivePost,
            transition: finalTransition,
            actionResult,
            actionError,
          });
        } catch {
          // Ignore recovery failures and keep retrying action path.
        }
        if (attemptDelayMs > 0) {
          await delayMs(attemptDelayMs);
        }
        continue;
      }

      const baseState = {
        state_before: this.sanitizeObservedState(pre),
        state_after: this.sanitizeObservedState(adaptivePost),
        transition: finalTransition,
        observeProfile: waitProfile,
        autoCloseProbe: {
          attempts: adaptiveAttempts,
          stabilized: adaptiveAttempts > 0,
          waitedMs: adaptiveAttempts > 0 ? adaptiveAttempts * AUTO_CLOSE_POLL_MS : 0,
        },
        visualFallback: capturedVisual,
        suggestion,
      };
      if (actionError) {
        const failMeta = this.extractErrorMeta(actionError);
        return {
          ok: false,
          command: options.command,
          error: failMeta.code,
          message: failMeta.message,
          actionFailure: failMeta.details,
          ...baseState,
        };
      }

      const safeActionResult = actionResult || { ok: true };
      return {
        ...(safeActionResult as Record<string, unknown>),
        ...(shouldIgnoreActionError ? { actionErrorRecovered: true } : {}),
        ...baseState,
      };
    }

    return {
      ok: false,
      command: options.command,
      error: 'ACTION_LOOP_EXHAUSTED',
      message: `Action loop exhausted after ${maxAttempts} attempts`,
    };
  }

  private async waitForObservableTransition(params: {
    actions: ActionsLike;
    pre: PageStateSnapshot;
    timeoutMs: number;
    pollMs: number;
    isActionSettled?: (post: PageStateSnapshot, transition: PageTransitionDiff) => boolean;
  }): Promise<TransitionWaitProfile & { post: PageStateSnapshot }> {
    const startMs = Date.now();
    if (params.timeoutMs <= 0) {
      return {
        timedOut: false,
        attempts: 1,
        observeWaitMs: 0,
        observePollMs: Math.max(40, params.pollMs),
        waitedMs: 0,
        post: await this.capturePageState(params.actions),
      };
    }

    let post = await this.capturePageState(params.actions);
    let transition = this.buildPageTransition(params.pre, post);
    let attempts = 1;
    let settled = params.isActionSettled ? params.isActionSettled(post, transition) : false;

    while (
      params.timeoutMs > 0
      && !transition.changed
      && !settled
      && (Date.now() - startMs) < params.timeoutMs
    ) {
      await delayMs(Math.min(params.pollMs, Math.max(0, params.timeoutMs - (Date.now() - startMs))));
      post = await this.capturePageState(params.actions);
      transition = this.buildPageTransition(params.pre, post);
      attempts += 1;
      if (!settled) {
        settled = params.isActionSettled ? params.isActionSettled(post, transition) : false;
      }
    }

    const waitedMs = Date.now() - startMs;
    return {
      timedOut: !transition.changed && !settled && waitedMs >= params.timeoutMs,
      attempts,
      observeWaitMs: params.timeoutMs,
      observePollMs: params.pollMs,
      waitedMs,
      post,
    };
  }

  private async captureActionVisualFallback(params: {
    command: string;
    actions: ActionsLike;
    reason: string;
  }): Promise<VisualFallbackSnapshot | null> {
    const timestamp = Date.now();
    const outputPath = `/data/local/tmp/botdrop_tmp/screenshots/shizuku-visual-fallback-${timestamp}.png`;
    try {
      const shot = await params.actions.screenshot(outputPath);
      return {
        ok: true,
        path: shot.path,
        androidPath: shot.androidPath,
        requestedPath: shot.requestedPath,
        capturedAtMs: timestamp,
        command: params.command,
        reason: params.reason,
      };
    } catch (error) {
      return {
        ok: false,
        requestedPath: outputPath,
        path: outputPath,
        capturedAtMs: timestamp,
        command: params.command,
        reason: `${params.reason}: screenshot capture failed`,
        error: this.extractErrorMessage(error),
      };
    }
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (error && typeof error === 'object') {
      const errorRecord = error as Record<string, unknown>;
      const message = errorRecord.message;
      if (typeof message === 'string') {
        return message;
      }
      if (typeof errorRecord.error === 'string') {
        return String(errorRecord.error);
      }
      return JSON.stringify(errorRecord);
    }
    return String(error);
  }

  private async suggestForTapElementNoTransition(params: {
    actionResult: Record<string, unknown> | null;
    transition: PageTransitionDiff;
    actions: ActionsLike;
    primarySelector: Record<string, unknown>;
    fallbackSelectors: Array<Record<string, unknown>>;
  }): Promise<ObservedActionDecision | null> {
    const selectorList: Record<string, unknown>[] = [
      params.primarySelector,
      ...params.fallbackSelectors,
    ];
    const seen = new Set<string>();
    const normalizedSelectors = selectorList
      .map((selector) => this.normalizeSelector(selector))
      .filter((selector): selector is Record<string, unknown> => Boolean(selector))
      .filter((selector) => {
        const signature = JSON.stringify(selector);
        if (seen.has(signature)) {
          return false;
        }
        seen.add(signature);
        return true;
      });

    if (!normalizedSelectors.length) {
      return null;
    }

    let postElements: unknown;
    try {
      postElements = await params.actions.uiDump();
    } catch (error) {
      return {
        needsAttention: params.transition.changed ? false : true,
        reasons: ['tap-element produced no transition and post UI state is not readable'],
        suggest: [
          { command: 'ui-dump', reason: 'recheck current page before retry' },
          { command: 'dismiss-popups', reason: 'possible overlay blocked the tap target' },
        ],
      };
    }

    if (!Array.isArray(postElements) || !postElements.length) {
      return {
        needsAttention: params.transition.changed ? false : true,
        reasons: ['tap-element produced no transition and post UI dump is empty'],
        suggest: [
          { command: 'ui-dump', reason: 'verify whether page content is still available' },
          { command: 'dismiss-popups', reason: 'clear blocking dialog, then retry' },
        ],
      };
    }

    const targetStillPresent = (postElements as UiElement[]).some((entry) =>
      normalizedSelectors.some((selector) => matchesSelector(entry, selector as UiSelector))
    );

    if (params.transition.changed && !targetStillPresent) {
      return {
        needsAttention: false,
        reasons: ['tap-element target not found after transition; likely page moved on or an auto-dismissed overlay left the page'],
        suggest: [
          { command: 'current-app', reason: 'reconfirm package/activity after transition' },
          { command: 'ui-dump', reason: 'read the new page and continue from current state' },
        ],
      };
    }

    if (!targetStillPresent) {
      if (params.transition.changed) {
        return {
          needsAttention: false,
          reasons: ['tap-element target disappeared after action with state change; stop target-locked retry and re-evaluate context'],
          suggest: [
            { command: 'ui-dump', reason: 'inspect current page before next action' },
          ],
        };
      }
      return null;
    }

    const attemptsRaw = params.actionResult ? params.actionResult.attempts : undefined;
    const attempts = typeof attemptsRaw === 'number'
      ? String(attemptsRaw)
      : 'unknown';
    return {
      needsAttention: true,
      reasons: [
        `tap-element no transition after ${attempts} attempt(s)`,
        'target selector is still present after tap; likely tap missed or was blocked',
      ],
      suggest: [
        { command: 'dismiss-popups', reason: 'clear popup/overlay before retrying' },
        { command: 'tap-element', reason: 'retry target element after state refreshed' },
      ],
    };
  }

  private suggestForPressNoTransition(params: {
    transition: PageTransitionDiff;
    actionResult: Record<string, unknown> | null;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
  }): ObservedActionDecision | null {
    const key = typeof params.actionResult?.key === 'string' ? String(params.actionResult.key) : '';
    if (key !== 'back') {
      return null;
    }

    if (!params.transition.changed && params.pre.packageName === params.post.packageName) {
      const preActivity = String(params.pre.activity || '');
      const postActivity = String(params.post.activity || '');
      const hints = [preActivity, postActivity].filter(Boolean).join(' -> ');
      return {
        needsAttention: true,
        reasons: [
          `press back produced no state transition (${hints || 'same activity context'})`,
          'press back may be blocked by keyboard/focus state or overlay',
        ],
        suggest: [
          { command: 'dismiss-popups', reason: 'clear overlay before retrying back' },
          { command: 'press back', reason: 'retry back in same context' },
          { command: 'current-app', reason: 'confirm package/activity after retry' },
        ],
      };
    }

    return null;
  }

  private async suggestForTypeNoTransition(params: {
    transition: PageTransitionDiff;
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
    typedText: string;
  }): Promise<ObservedActionDecision | null> {
    if (params.transition.changed) {
      return null;
    }

    if (!params.typedText || !params.typedText.trim()) {
      return null;
    }

    const typedText = this.normalizeUiText(params.typedText);
    const beforeEditTexts = this.extractEditableTextsFromSnapshot(params.pre);
    const afterEditTexts = this.extractEditableTextsFromSnapshot(params.post);
    const beforeCounts = this.buildTextFrequencyMap(beforeEditTexts);
    const afterCounts = this.buildTextFrequencyMap(afterEditTexts);
    const hasVisibleInjection = this.hasInjectedText(beforeCounts, afterCounts, typedText);

    if (hasVisibleInjection) {
      return {
        needsAttention: false,
        reasons: [
          `typed text appears in page content (${typedText.slice(0, 24)}). Input is considered successful`,
        ],
        suggest: [],
      };
    }

    return {
      needsAttention: true,
      reasons: [
        `type command produced no visible UI transition and typed text not detected in text input fields (${typedText.slice(0, 24)})`,
      ],
      suggest: [
        { command: 'dismiss-popups', reason: 'clear possible overlay before retrying text input' },
        { command: 'ui-dump', reason: 're-read current page state and confirm editable target' },
        { command: 'type', reason: 'retry current text after state refresh' },
      ],
    };
  }

  private extractEditableTextsFromSnapshot(snapshot: PageStateSnapshot): string[] {
    if (!snapshot.ui.available || !snapshot.ui.summary?.allNodes) {
      return [];
    }
    return snapshot.ui.summary.allNodes
      .filter((entry) => this.isLikelyEditableNode(entry))
      .map((entry) => entry.text || '');
  }

  private isLikelyEditableNode(entry: PageElementTransition): boolean {
    const className = String(entry.className || '').toLowerCase();
    if (!className) {
      return false;
    }
    if (className.includes('edittext') || className.includes('input') || className.includes('search')) {
      return true;
    }
    const hasText = Boolean(
      String(entry.text || '').trim() || String(entry.description || '').trim()
    );
    return (
      ((entry.focusable || entry.clickable) && className.includes('textfield'))
      || (entry.focusable && className.includes('text') && hasText)
    );
  }

  private isTypedTextDetectedInTransition(params: {
    pre: PageStateSnapshot;
    post: PageStateSnapshot;
    typedText: string;
  }): boolean {
    if (!params.typedText) {
      return false;
    }
    const beforeCounts = this.buildTextFrequencyMap(this.extractEditableTextsFromSnapshot(params.pre));
    const afterCounts = this.buildTextFrequencyMap(this.extractEditableTextsFromSnapshot(params.post));
    return this.hasInjectedText(beforeCounts, afterCounts, params.typedText);
  }

  private hasInjectedText(beforeCounts: Map<string, number>, afterCounts: Map<string, number>, typedText: string): boolean {
    const target = this.normalizeUiText(typedText);
    if (!target) {
      return false;
    }
    for (const [normalized, afterCount] of afterCounts.entries()) {
      if (!normalized) {
        continue;
      }
      if (!normalized.includes(target) && !target.includes(normalized)) {
        continue;
      }
      if (!beforeCounts.has(normalized)) {
        return true;
      }
      if (afterCount > (beforeCounts.get(normalized) || 0)) {
        return true;
      }
    }
    return false;
  }

  private normalizeUiText(raw: string): string {
    return String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildTextFrequencyMap(values: string[]): Map<string, number> {
    const map = new Map<string, number>();
    values
      .map((entry) => this.normalizeUiText(entry))
      .filter(Boolean)
      .forEach((text) => {
        map.set(text, (map.get(text) || 0) + 1);
      });
    return map;
  }

  private extractErrorMeta(error: unknown): { code: string; message: string; details: Record<string, unknown> } {
    const details: Record<string, unknown> = {};

    if (isRecordObject(error)) {
      const errorRecord = error as Record<string, unknown>;
      for (const [key, value] of Object.entries(errorRecord)) {
        if (key === 'code' || key === 'message') {
          continue;
        }
        details[key] = value;
      }
      return {
        code: typeof errorRecord.code === 'string' ? errorRecord.code : 'ERROR',
        message: typeof errorRecord.message === 'string' ? errorRecord.message : 'Action failed',
        details,
      };
    }

    if (error instanceof Error) {
      return {
        code: error.name || 'ERROR',
        message: error.message || 'Action failed',
        details: { name: error.name, stack: error.stack },
      };
    }

    return {
      code: 'ERROR',
      message: String(error),
      details: {},
    };
  }

  private collectPopupHintsFromState(state: PageStateSnapshot): PopupHint[] {
    if (!state.ui.available || !state.ui.summary?.allNodes || !state.ui.summary.allNodes.length) {
      return [];
    }

    const popupCandidates = this.collectPopupDismissCandidatesFromState(state);

    const seen = new Set<string>();
    return popupCandidates
      .slice(0, 12)
      .map((candidate) => ({
        text: String(candidate.element.text || '').trim(),
        className: String(candidate.element.className || ''),
        reason: candidate.reason,
        resourceId: String(candidate.element.resourceId || ''),
        description: String(candidate.element.description || ''),
      }))
      .filter((hint) => {
        const signature = JSON.stringify({
          text: hint.text,
          className: hint.className,
          reason: hint.reason,
          resourceId: hint.resourceId,
        });
        if (seen.has(signature)) {
          return false;
        }
        seen.add(signature);
        return Boolean(hint.text || hint.className);
      });
  }

  private sanitizeObservedState(snapshot: PageStateSnapshot): CompactObservedState {
    return {
      packageName: snapshot.packageName,
      activity: snapshot.activity,
      raw: snapshot.raw,
      timestampMs: snapshot.timestampMs,
      ui: snapshot.ui.available && snapshot.ui.summary
        ? {
          available: true,
          summary: {
            totalElements: snapshot.ui.summary.totalElements,
            interactiveCount: snapshot.ui.summary.interactiveCount,
            editableCount: snapshot.ui.summary.editableCount,
            fingerprint: snapshot.ui.summary.fingerprint,
            topNodes: snapshot.ui.summary.topNodes,
            topInteractive: snapshot.ui.summary.topInteractive,
            topEditTexts: snapshot.ui.summary.topEditTexts,
            interactiveNodes: snapshot.ui.summary.interactiveNodes,
          },
        }
        : {
          available: false,
          error: snapshot.ui.error,
        },
      visualFallback: snapshot.visualFallback,
    };
  }

  private suggestNextAction(
    transition: PageTransitionDiff,
    context: { command: string; actionResult?: Record<string, unknown> | null } = { command: '' },
    popupHints: PopupHint[] = []
  ): ObservedActionDecision {
    if (
      context.command === 'launch'
      && !transition.changed
      && transition.beforeUiAvailable
      && transition.afterUiAvailable
      && !transition.packageChanged
      && !transition.activityChanged
      && transition.interactiveCountDelta === 0
      && transition.editableCountDelta === 0
      && transition.uiNodeCountDelta === 0
      && context.actionResult
    ) {
      return {
        needsAttention: false,
        reasons: ['launch command completed and app context is already stable'],
        suggest: [],
      };
    }

    const reasons: string[] = [];
    const suggest: Array<{ command: string; reason: string }> = [];

    if (transition.activityChanged) {
      reasons.push('page activity changed, continue in new page context');
      return { needsAttention: false, reasons, suggest };
    }

    if (transition.packageChanged) {
      reasons.push('foreground package changed');
      return { needsAttention: true, reasons, suggest: [{ command: 'current-app', reason: 'reconfirm package and recover correct session context' }] };
    }

    if (!transition.afterUiAvailable) {
      reasons.push('post ui-dump unavailable');
      suggest.push({ command: 'current-app', reason: 'UI dump failed, check app foreground and recover' });
      suggest.push({ command: 'dismiss-popups', reason: 'potential popup overlay interfering' });
      return { needsAttention: true, reasons, suggest };
    }

    if (!transition.beforeUiAvailable && transition.afterUiAvailable) {
      reasons.push('UI available only after action');
      return { needsAttention: false, reasons, suggest };
    }

    if (!transition.changed) {
      reasons.push('no UI transition detected');
      if (popupHints.length > 0) {
        const names = popupHints
          .map((item) => item.text || item.className || item.reason)
          .filter(Boolean)
          .slice(0, 8)
          .join(' / ');
        reasons.push(`popup-like controls detected: ${names}`);
      }
      suggest.push({ command: 'dismiss-popups', reason: 'try clear potential blocking dialog/overlay' });
      suggest.push({ command: 'ui-dump', reason: 're-read tree and verify target selector availability' });
      return { needsAttention: true, reasons, suggest };
    }

    if (transition.appRawChanged) {
      reasons.push('foreground dump raw changed; check for transient dialogs');
      suggest.push({ command: 'ui-dump', reason: 're-validate current page state' });
    }

    const popupDelta = transition.afterPopupCandidatesCount - transition.beforePopupCandidatesCount;
    if (popupDelta > 0) {
      reasons.push(`popup-like controls increased by ${popupDelta}`);
      suggest.push({ command: 'dismiss-popups', reason: 'potential popup appeared during action' });
      suggest.push({ command: 'ui-dump', reason: 're-verify interactive controls after popup change' });
    }
    if (popupDelta < 0 && transition.packageChanged === false && transition.activityChanged === false) {
      reasons.push('popup-like controls removed');
      suggest.push({ command: 'ui-dump', reason: 'check whether the overlay was removed and continue' });
    }
    if (popupDelta !== 0 && popupHints.length > 0) {
      reasons.push(`popup hints: ${popupHints.map((hint) => hint.text || hint.reason || hint.className).slice(0, 6).join(' / ')}`);
    }

    const popupNeedsAttention = popupDelta > 0
      || (popupDelta < 0 && transition.afterPopupCandidatesCount === 0 && transition.beforePopupCandidatesCount > 0);
    return {
      needsAttention: popupNeedsAttention,
      reasons,
      suggest,
    };
  }

  private async capturePageState(actions: ActionsLike): Promise<PageStateSnapshot> {
    const timestampMs = Date.now();
    let app: { packageName: string | null; activity: string | null; raw: string };
    try {
      app = await actions.currentApp();
    } catch (error: unknown) {
      app = {
        packageName: null,
        activity: null,
        raw: String(error),
      };
    }

    try {
      const dump = await actions.uiDump();
      const elements = Array.isArray(dump) ? (dump as UiElement[]) : [];
      const uiSummary = this.buildUiSummary(elements);
      return {
        packageName: app.packageName,
        activity: app.activity,
        raw: app.raw,
        timestampMs,
        ui: {
          available: true,
          summary: uiSummary,
        },
      };
    } catch (error: unknown) {
      const visualFallback = await this.captureActionVisualFallback({
        command: 'ui-state-capture',
        actions,
        reason: 'ui-dump failed when reading current page state',
      });
      return {
        packageName: app.packageName,
        activity: app.activity,
        raw: app.raw,
        timestampMs,
        visualFallback: visualFallback || undefined,
        ui: {
          available: false,
          error: String(error),
        },
      };
    }
  }

  private buildUiSummary(elements: UiElement[]): {
    totalElements: number;
    interactiveCount: number;
    editableCount: number;
    fingerprint: string;
    allSignatures: string[];
    allNodes: PageElementTransition[];
    topInteractive: PageElementTransition[];
    topEditTexts: PageElementTransition[];
    topNodes: PageElementTransition[];
    interactiveNodes: PageElementTransition[];
    editableNodes: PageElementTransition[];
    interactiveSignatures: string[];
    editableSignatures: string[];
    allSignaturesSample: string[];
  } {
    const totalElements = elements.length;
    const indexedNodes = elements.map((entry, index) => ({
      entry,
      node: this.buildTransitionNode(entry, index),
    }));
    const editableElements = indexedNodes.filter((entry) => entry.entry.className === 'android.widget.EditText');
    const interactiveElements = indexedNodes.filter((entry) => entry.entry.clickable || entry.entry.focusable);
    const allSortedElements = [...indexedNodes].sort((left, right) =>
      this.compareElementsByPosition(left.entry, right.entry)
    );

    const sortedInteractive = [...interactiveElements].sort((left, right) =>
      this.compareElementsByPosition(left.entry, right.entry)
    );
    const sortedEditable = [...editableElements].sort((left, right) =>
      this.compareElementsByPosition(left.entry, right.entry)
    );
    const sortedAll = allSortedElements;
    const topInteractive = sortedInteractive.slice(0, 8).map((entry) => entry.node);
    const topEditTexts = sortedEditable.slice(0, 8).map((entry) => entry.node);
    const topNodes = sortedAll.slice(0, 12).map((entry) => entry.node);
    const interactiveNodes = sortedInteractive
      .slice(0, OBSERVE_MAX_INTERACTIVE_NODES)
      .map((entry) => entry.node);
    const editableNodes = sortedEditable
      .slice(0, OBSERVE_MAX_INTERACTIVE_NODES)
      .map((entry) => entry.node);

    const allNodes = [...indexedNodes].map((entry) => entry.node);
    const allSignatures = allNodes.map((entry) => entry.signature);
    const interactiveSignatures = interactiveNodes.map((entry) => entry.signature);
    const editableSignatures = editableNodes.map((entry) => entry.signature);
    const allSignaturesSample = allSignatures.slice(0, 120);

    return {
      totalElements,
      interactiveCount: interactiveElements.length,
      editableCount: editableElements.length,
      fingerprint: this.computeUiFingerprint(elements),
      allSignatures,
      allNodes,
      topInteractive,
      topEditTexts,
      topNodes,
      interactiveNodes,
      editableNodes,
      interactiveSignatures,
      editableSignatures,
      allSignaturesSample,
    };
  }

  private compareElementsByPosition(a: UiElement, b: UiElement): number {
    const aTop = a.bounds ? a.bounds.top : 0;
    const bTop = b.bounds ? b.bounds.top : 0;
    if (aTop !== bTop) {
      return aTop - bTop;
    }
    const aLeft = a.bounds ? a.bounds.left : 0;
    const bLeft = b.bounds ? b.bounds.left : 0;
    return aLeft - bLeft;
  }

  private buildTransitionNode(element: UiElement, index: number): PageElementTransition {
    return {
      nodeId: `n:${index}`,
      signature: this.buildTransitionSignature(element),
      text: String(element.text || ''),
      description: String(element.description || ''),
      className: String(element.className || ''),
      resourceId: String(element.resourceId || ''),
      bounds: element.bounds ? `${element.bounds.left},${element.bounds.top},${element.bounds.right},${element.bounds.bottom}` : null,
      clickable: Boolean(element.clickable),
      focusable: Boolean(element.focusable),
      enabled: Boolean(element.enabled),
    };
  }

  private buildTransitionSignature(element: UiElement): string {
    const text = String(element.text || '').replace(/\s+/g, ' ').trim().slice(0, 64);
    const description = String(element.description || '').replace(/\s+/g, ' ').trim().slice(0, 64);
    const bounds = element.bounds
      ? `${element.bounds.left},${element.bounds.top},${element.bounds.right},${element.bounds.bottom}`
      : '';
    return JSON.stringify({
      resourceId: String(element.resourceId || ''),
      className: String(element.className || ''),
      text,
      description,
      bounds,
      clickable: Boolean(element.clickable),
      focusable: Boolean(element.focusable),
      enabled: Boolean(element.enabled),
    });
  }

  private computeUiFingerprint(elements: UiElement[]): string {
    const signatures = elements
      .map((entry) => this.buildTransitionSignature(entry))
      .sort();
    let hash = 0;
    for (const signature of signatures) {
      for (let index = 0; index < signature.length; index += 1) {
        hash = ((hash << 5) - hash + signature.charCodeAt(index)) | 0;
      }
    }
    return `${signatures.length}:${(hash >>> 0).toString(16)}`;
  }

  private buildPageTransition(before: PageStateSnapshot, after: PageStateSnapshot): PageTransitionDiff {
    const beforeUi = before.ui.available && before.ui.summary;
    const afterUi = after.ui.available && after.ui.summary;
    const beforeSignatures = beforeUi ? beforeUi.allSignatures : [];
    const afterSignatures = afterUi ? afterUi.allSignatures : [];
    const beforePopupDismissCount = this.countLikelyPopupControls(before);
    const afterPopupDismissCount = this.countLikelyPopupControls(after);
    const popupCandidatesDelta = afterPopupDismissCount - beforePopupDismissCount;

    const buildSignatureBuckets = (
      nodes: PageElementTransition[] | undefined,
      signatures: string[] | undefined,
    ): Map<string, PageElementTransition[]> => {
      const buckets = new Map<string, PageElementTransition[]>();
      if (!nodes || !signatures) {
        return buckets;
      }

      const total = Math.min(nodes.length, signatures.length);
      for (let index = 0; index < total; index += 1) {
        const signature = signatures[index];
        const node = nodes[index];
        const existing = buckets.get(signature) || [];
        existing.push(node);
        buckets.set(signature, existing);
      }

      return buckets;
    };
    const beforeBuckets = buildSignatureBuckets(beforeUi ? beforeUi.allNodes : undefined, beforeUi ? beforeUi.allSignatures : undefined);
    const afterBuckets = buildSignatureBuckets(afterUi ? afterUi.allNodes : undefined, afterUi ? afterUi.allSignatures : undefined);

    const beforeAllSet = new Map<string, number>();
    const afterAllSet = new Map<string, number>();
    const buildMultiSet = (values: string[]) => {
      const map = new Map<string, number>();
      values.forEach((signature) => map.set(signature, (map.get(signature) || 0) + 1));
      return map;
    };
    const beforeCounts = buildMultiSet(beforeSignatures);
    const afterCounts = buildMultiSet(afterSignatures);
    const allSignatureKeys = new Set<string>([
      ...beforeCounts.keys(),
      ...afterCounts.keys(),
    ]);

    const addedSignatures: string[] = [];
    const removedSignatures: string[] = [];
    for (const signature of allSignatureKeys) {
      const beforeCount = beforeCounts.get(signature) || 0;
      const afterCount = afterCounts.get(signature) || 0;
      if (afterCount > beforeCount) {
        const delta = afterCount - beforeCount;
        for (let i = 0; i < delta; i += 1) {
          addedSignatures.push(signature);
        }
      } else if (beforeCount > afterCount) {
        const delta = beforeCount - afterCount;
        for (let i = 0; i < delta; i += 1) {
          removedSignatures.push(signature);
        }
      }
    }

    const added = addedSignatures
      .map((signature) => {
        const bucket = afterBuckets.get(signature);
        const candidate = bucket && bucket.length > 0 ? bucket.shift() : null;
        return candidate || null;
      })
      .filter((value): value is PageElementTransition => Boolean(value))
      .slice(0, OBSERVE_MAX_DIFF_NODES)
      .map((entry) => entry);

    const removed = removedSignatures
      .map((signature) => {
        const bucket = beforeBuckets.get(signature);
        const candidate = bucket && bucket.length > 0 ? bucket.shift() : null;
        return candidate || null;
      })
      .filter((value): value is PageElementTransition => Boolean(value))
      .slice(0, OBSERVE_MAX_DIFF_NODES)
      .map((entry) => entry);

    const uiFingerprintChanged = Boolean(beforeUi && afterUi && beforeUi.fingerprint !== afterUi.fingerprint);
    const activityChanged = before.activity !== after.activity;
    const packageChanged = before.packageName !== after.packageName;
    const appRawChanged = before.raw !== after.raw;
    const interactiveCountDelta = (afterUi ? afterUi.interactiveCount : 0) - (beforeUi ? beforeUi.interactiveCount : 0);
    const editableCountDelta = (afterUi ? afterUi.editableCount : 0) - (beforeUi ? beforeUi.editableCount : 0);
    const uiNodeCountDelta = (afterUi ? afterUi.totalElements : 0) - (beforeUi ? beforeUi.totalElements : 0);
    const beforeTotal = beforeUi ? beforeUi.totalElements : 0;
    const afterTotal = afterUi ? afterUi.totalElements : 0;
    const uiElementCountDelta = afterTotal - beforeTotal;
    const changed = activityChanged
      || packageChanged
      || uiFingerprintChanged
      || uiNodeCountDelta !== 0
      || interactiveCountDelta !== 0
      || editableCountDelta !== 0
      || popupCandidatesDelta !== 0
      || (afterPopupDismissCount > 0 && beforePopupDismissCount === 0)
      || (beforePopupDismissCount > 0 && afterPopupDismissCount === 0);

    return {
      changed,
      activityChanged,
      packageChanged,
      appRawChanged,
      uiNodeCountDelta,
      beforeUiAvailable: Boolean(beforeUi),
      afterUiAvailable: Boolean(afterUi),
      uiFingerprintChanged,
      beforePopupCandidatesCount: beforePopupDismissCount,
      afterPopupCandidatesCount: afterPopupDismissCount,
      uiElementCountDelta,
      addedSignaturesCount: addedSignatures.length,
      removedSignaturesCount: removedSignatures.length,
      interactiveCountDelta,
      editableCountDelta,
      added,
      removed,
    };
  }

  private async handleTapElementWithFallback(params: {
    primarySelector: Record<string, unknown>;
    fallbackSelectors: Array<Record<string, unknown>>;
    retries: number;
    retryDelayMs: number;
    allowHeuristicTap: boolean;
    includeCloseCandidateHints: boolean;
    actions: ActionsLike;
  }): Promise<Record<string, unknown>> {
    const {
      primarySelector,
      fallbackSelectors,
      retries,
      retryDelayMs,
      actions,
      allowHeuristicTap,
      includeCloseCandidateHints,
    } = params;
    const candidates = this.buildTapCandidates(primarySelector, fallbackSelectors, includeCloseCandidateHints);
    const maxAttempts = Math.max(0, retries) + 1;
    const attemptedSelectors: string[] = [];
    const attemptedSelectorDetails: Array<{ source: string; selector: Record<string, unknown> }> = [];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      for (const candidate of candidates) {
        attemptedSelectors.push(candidate.source);
        attemptedSelectorDetails.push({ source: candidate.source, selector: candidate.selector });
        try {
          const res = await actions.tapElement(candidate.selector as Record<string, unknown>);
          return {
            ...res,
            attempts: attempt + 1,
            selectorUsed: candidate.source,
            attemptedSelectors,
          } as Record<string, unknown>;
        } catch (error) {
          lastError = error;
        }
      }

      if (attempt < maxAttempts - 1) {
        await delayMs(retryDelayMs);
      }
    }

    if (allowHeuristicTap) {
      const heuristic = await this.findHeuristicTapPointFromSelectors(actions, candidates.map((entry) => entry.selector));
      if (heuristic) {
        await actions.tap(heuristic.tapped.x, heuristic.tapped.y);
        return {
          element: heuristic.element,
          tapped: heuristic.tapped,
          attempts: maxAttempts,
          selectorUsed: `heuristic-${heuristic.reason}`,
          attemptedSelectors,
        } as Record<string, unknown>;
      }
    }

    if (lastError instanceof Error && (lastError as { code?: string }).code) {
      throw lastError;
    }

    const fallbackError = new Error('tap-element failed after retries');
    (fallbackError as { code?: string }).code = 'ELEMENT_NOT_FOUND';
    (fallbackError as { details?: Record<string, unknown> }).details = {
      command: 'tap-element',
      selectorUsed: attemptedSelectors.length ? attemptedSelectors[attemptedSelectors.length - 1] : 'primary',
      attempts: maxAttempts,
      attemptedSelectors,
      attemptedSelectorDetails,
      selectorCandidates: candidates.map((entry) => ({ source: entry.source, selector: entry.selector })),
      candidateCount: candidates.length,
      primarySelector,
    };
    throw fallbackError;
  }

  private buildTapCandidates(
    primarySelector: Record<string, unknown>,
    fallbackSelectors: Array<Record<string, unknown>>,
    includeCloseCandidateHints = false
  ): TapCandidate[] {
    const candidates: TapCandidate[] = [];
    const seen = new Set<string>();

    const add = (source: string, selector: Record<string, unknown>) => {
      if (candidates.length >= MAX_TAP_FALLBACK_SELECTORS) {
        return;
      }
      const normalized = this.normalizeSelector(selector);
      if (!normalized) {
        return;
      }
      const signature = JSON.stringify(normalized);
      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);
      candidates.push({ source, selector: normalized });
    };

    const pushDerived = (selector: Record<string, unknown>, baseLabel: string) => {
      add(baseLabel, selector);
      const derived = this.deriveFallbackSelectors(selector, includeCloseCandidateHints);
      derived.forEach((item, index) => add(`${baseLabel}-derived-${index + 1}`, item));
    };

    pushDerived(primarySelector, 'primary');
    fallbackSelectors.forEach((selector, index) => {
      pushDerived(selector, `fallback-${index + 1}`);
    });

    return candidates;
  }

  private normalizeSelector(selector: Record<string, unknown>): Record<string, unknown> | null {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(selector)) {
      if (typeof value === 'boolean') {
        normalized[key] = value;
      } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          normalized[key] = trimmed;
        }
      }
    }
    return Object.keys(normalized).length ? normalized : null;
  }

  private deriveFallbackSelectors(selector: Record<string, unknown>, includeCloseCandidateHints = false): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];
    const add = (item: Record<string, unknown>) => {
      const normalized = this.normalizeSelector(item);
      if (normalized) {
        items.push(normalized);
      }
    };
    const hasExplicitClickable = Object.prototype.hasOwnProperty.call(selector, 'clickable');
    const clickModes = hasExplicitClickable
      ? [Boolean(selector.clickable)]
      : [true, false];
    const withClickModes = (base: Record<string, unknown>) => {
      if (hasExplicitClickable) {
        add({ ...base, clickable: Boolean(selector.clickable) });
        return;
      }
      clickModes.forEach((clickable) => {
        add({ ...base, clickable });
      });
    };

    const text = typeof selector.text === 'string' ? selector.text.trim() : '';
    const textContains = typeof selector.textContains === 'string' ? selector.textContains.trim() : '';
    const description = typeof selector.description === 'string' ? selector.description.trim() : '';
    const descriptionContains = typeof selector.descriptionContains === 'string' ? selector.descriptionContains.trim() : '';
    const className = typeof selector.className === 'string' ? selector.className.trim() : '';
    const resourceId = typeof selector.resourceId === 'string' ? selector.resourceId.trim() : '';

    const fallbackTextValues = [text, textContains].filter(Boolean) as string[];
    const fallbackDescValues = [description, descriptionContains].filter(Boolean) as string[];
    const candidateTexts = Array.from(new Set([...fallbackTextValues, ...fallbackDescValues]));

    for (const value of candidateTexts) {
      withClickModes({ textContains: value });
      withClickModes({ text: value });
      withClickModes({ descriptionContains: value });
      withClickModes({ description: value });
      if (className) {
        withClickModes({ className, textContains: value });
        withClickModes({ className, descriptionContains: value });
        withClickModes({ className, text: value });
      }
    }

    if (className) {
      withClickModes({ className });
      if (!hasExplicitClickable) {
        add({ className: 'android.widget.Button' });
      }
    }

    if (resourceId) {
      withClickModes({ resourceId });
    }

    if (includeCloseCandidateHints) {
      for (const keyword of AUTO_CLOSE_KEYWORDS) {
        if (!keyword) {
          continue;
        }
        withClickModes({ textContains: keyword });
        withClickModes({ descriptionContains: keyword });
        add({ className: 'android.widget.Button', textContains: keyword, clickable: true });
        add({ className: 'android.widget.Button', descriptionContains: keyword, clickable: true });
        add({ className: 'android.widget.ImageView', descriptionContains: keyword, clickable: true });
        add({ className: 'android.widget.ImageButton', descriptionContains: keyword, clickable: true });
      }
    }

    return items.slice(0, MAX_TAP_DERIVED_SELECTORS);
  }

  private async findHeuristicTapPointFromSelectors(
    actions: ActionsLike,
    selectors: Array<Record<string, unknown>>
  ): Promise<TapFallbackCandidate | null> {
    let dump: unknown;
    try {
      dump = await actions.uiDump();
    } catch {
      return null;
    }

    if (!Array.isArray(dump)) {
      return null;
    }

    const candidate = this.findHeuristicTapCandidate(
      dump as UiElement[],
      selectors
    );
    return candidate;
  }

  private findHeuristicTapCandidate(
    elements: UiElement[],
    selectors: Array<Record<string, unknown>>
  ): TapFallbackCandidate | null {
    const seeds = this.extractSeedKeywords(selectors);
    const classNames = this.extractClassNames(selectors);
    const resourceIds = this.extractResourceIds(selectors);
    const exactTexts = this.extractExactTexts(selectors);
    const exactDescriptions = this.extractExactDescriptions(selectors);

    if (
      seeds.length === 0
      && classNames.length === 0
      && resourceIds.length === 0
      && exactTexts.size === 0
      && exactDescriptions.size === 0
    ) {
      return null;
    }

    let best: TapFallbackCandidate | null = null;

    for (const element of elements) {
      if (!element.center) {
        continue;
      }

      const score = this.scoreHeuristicCandidate(
        element,
        seeds,
        classNames,
        resourceIds,
        exactTexts,
        exactDescriptions
      );
      if (score <= 0) {
        continue;
      }
      const candidate: TapFallbackCandidate = {
        reason: 'heuristic',
        score,
        element,
        tapped: { x: element.center.x, y: element.center.y },
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    return best;
  }

  private scoreHeuristicCandidate(
    element: UiElement,
    seeds: string[],
    classNames: string[],
    resourceIds: string[],
    exactTexts: Set<string>,
    exactDescriptions: Set<string>
  ): number {
    const text = String(element.text || '');
    const description = String(element.description || '');
    const elementClassName = String(element.className || '');
    const elementResourceId = String(element.resourceId || '');
    let score = 0;

    if (element.clickable) {
      score += 8;
    }
    if (element.focusable) {
      score += 2;
    }
    if (!element.enabled) {
      score -= 2;
    }

    for (const item of classNames) {
      if (elementClassName === item) {
        score += 5;
      }
    }

    for (const resourceId of resourceIds) {
      if (elementResourceId === resourceId) {
        score += 4;
      }
    }

    for (const exactText of exactTexts) {
      if (text === exactText) {
        score += 10;
      }
      if (text.includes(exactText)) {
        score += 6;
      }
    }

    for (const exactDescription of exactDescriptions) {
      if (description === exactDescription) {
        score += 10;
      }
      if (description.includes(exactDescription)) {
        score += 6;
      }
    }

    for (const seed of seeds) {
      if (!seed) {
        continue;
      }
      if (text.includes(seed)) {
        score += 6;
      }
      if (description.includes(seed)) {
        score += 4;
      }
    }

    if (!text && !description && elementClassName === 'android.widget.EditText') {
      score -= 20;
    }
    if (elementClassName === 'android.widget.ScrollView' || elementClassName === 'android.view.View') {
      score -= 6;
    }

    return score;
  }

  private extractSeedKeywords(selectors: Array<Record<string, unknown>>): string[] {
    const values = new Set<string>();

    const add = (raw: unknown) => {
      if (typeof raw !== 'string') {
        return;
      }
      const value = raw.trim();
      if (!value) {
        return;
      }
      values.add(value);
      values.add(value.replace(/\s+/g, ''));
      if (value.length > 2) {
        values.add(value.slice(0, 2));
      }
    };

    for (const selector of selectors) {
      add(selector.text);
      add(selector.textContains);
      add(selector.description);
      add(selector.descriptionContains);
    }

    return Array.from(values).slice(0, 8);
  }

  private extractClassNames(selectors: Array<Record<string, unknown>>): string[] {
    return selectors
      .map((selector) => (typeof selector.className === 'string' ? selector.className.trim() : ''))
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 6);
  }

  private extractResourceIds(selectors: Array<Record<string, unknown>>): string[] {
    return selectors
      .map((selector) => (typeof selector.resourceId === 'string' ? selector.resourceId.trim() : ''))
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, 6);
  }

  private extractExactTexts(selectors: Array<Record<string, unknown>>): Set<string> {
    const values = selectors
      .map((selector) => (typeof selector.text === 'string' ? selector.text.trim() : ''))
      .filter(Boolean);
    return new Set(values);
  }

  private extractExactDescriptions(selectors: Array<Record<string, unknown>>): Set<string> {
    const values = selectors
      .map((selector) => (typeof selector.description === 'string' ? selector.description.trim() : ''))
      .filter(Boolean);
    return new Set(values);
  }

  private async dismissBlockingPopups(actions: ActionsLike, maxRounds = MAX_POPUP_DISMISS_ROUNDS): Promise<number> {
    let dismissed = 0;
    for (let round = 0; round < Math.max(1, Math.min(maxRounds, 10)); round += 1) {
      let dismissedThisRound = 0;
      try {
        const dump = await actions.uiDump();
        const elements = Array.isArray(dump) ? dump as UiElement[] : [];
        const popupCandidates = this.collectPopupDismissCandidates(elements);
        if (!this.isLikelyPopupContext(popupCandidates)) {
          if (!popupCandidates.length) {
            break;
          }
          return dismissed;
        }

        for (const candidate of popupCandidates) {
          try {
            await actions.tapElement(candidate.selector as Record<string, unknown>);
            dismissed += 1;
            dismissedThisRound += 1;
            await delayMs(220);
          } catch {
            continue;
          }
        }
      } catch {
        // uiDump failure means we cannot safely detect popups now; continue with heuristic recovery.
      }

      if (dismissedThisRound === 0) {
        break;
      }
    }
    return dismissed;
  }

  private collectPopupDismissCandidates(elements: UiElement[]): PopupDismissCandidate[] {
    const candidates: PopupDismissCandidate[] = [];

    for (const candidate of POPUP_DISMISS_SELECTORS) {
      const selector = candidate.selector;
      for (const element of elements) {
        if (!matchesSelector(element, selector)) {
          continue;
        }
        candidates.push({
          selector,
          reason: candidate.reason,
          element,
        });
      }
    }

    // keep deterministic, dedupe by selector + bounds + reason.
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const signature = JSON.stringify({
        selector: candidate.selector,
        bounds: candidate.element.bounds,
        reason: candidate.reason,
      });
      if (seen.has(signature)) {
        return false;
      }
      seen.add(signature);
      return true;
    });
  }

  private isLikelyPopupContext(candidates: PopupDismissCandidate[]): boolean {
    if (!candidates.length) {
      return false;
    }

    const hasSystemButton = candidates.some((candidate) => this.isSystemPopupButton(candidate.element));
    if (hasSystemButton) {
      return true;
    }

    const popupActionCount = candidates.length;
    if (popupActionCount >= 2) {
      return true;
    }

    const hasCloseLike = candidates.some((candidate) => candidate.reason.startsWith('close-'));
    if (hasCloseLike && popupActionCount > 0) {
      return true;
    }

    return false;
  }

  private isSystemPopupButton(element: UiElement): boolean {
    if (!element.resourceId) {
      return false;
    }
    const resourceId = String(element.resourceId).trim();
    return resourceId.startsWith('android:id/button');
  }

  private async runWithPopupRecovery<T>(options: PopupRecoveryOptions): Promise<T> {
    const maxAttempts = Math.max(1, Number.isFinite(options.retries as number) ? Number(options.retries) + 1 : DEFAULT_POPUP_RECOVERY_RETRIES + 1);
    const retryDelayMs = Math.max(0, Number.isFinite(options.retryDelayMs as number)
      ? Number(options.retryDelayMs)
      : DEFAULT_POPUP_RECOVERY_DELAY_MS);
    const dismissBefore = Boolean(options.dismissBefore);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt === 1 && dismissBefore) {
        await this.dismissBlockingPopups(options.actions);
      }
      try {
        return await options.action() as T;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          throw error;
        }
        await this.dismissBlockingPopups(options.actions);
        await delayMs(retryDelayMs);
      }
    }

    throw lastError;
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
  dismiss-popups [--rounds N]         Dismiss blocking dialogs that match common skip/allow/close patterns
  current-app                         Get foreground app info
  launch <pkg> [activity]             Launch app by package name, then wait for foreground stability
                                      Optional flags: --post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms --post-launch-transient-tolerance-ms
                                      Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  wait-foreground <package>           Wait until target package is in foreground and stable
                                      Optional flags: --post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms --post-launch-transient-tolerance-ms
  kill <pkg>                          Force stop app
  tap <x> <y>                         Tap screen coordinates
                                      Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  tap-element '<selector>'             Find element and tap it
                                     Add optional --retries, --fallback-selectors, --fallback-retry-delay-ms
                                     Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  swipe <x1> <y1> <x2> <y2> [ms]     Swipe gesture
                                      Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  press <key>                         Press key (home/back/enter/recent/paste)
                                      Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  type <text>                         Input text (auto handles Chinese)
                                     Optional flags: --method (auto|input-text|clipboard|adb-keyboard), --input-mode (new|append, default new), --timeout-ms, --focus-selector '<selector>', --focus-timeout-ms, --no-focus
                                     Decision flags: --observe, --observe-wait-ms, --observe-poll-ms, --visual-fallback/--no-visual-fallback
  ui-dump [--find '<selector>'] [--package com.xx] [--post-launch-timeout-ms --post-launch-stable-cycles --post-launch-settle-ms --post-launch-transient-tolerance-ms]
                                      Dump UI tree (optionally filtered); if --package passed, waits until package stable before dumping
  wait-for '<selector>' [--timeout]   Wait for element to appear
  device-info                         Device model, Android version
  battery                             Battery status
  installed-apps                      List installed packages
  screen-size                         Screen dimensions
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
  {\"text\":\"Send\"}                      Exact text match
  {\"textContains\":\"Save\"}             Text contains
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
