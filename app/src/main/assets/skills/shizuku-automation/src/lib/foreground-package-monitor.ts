export {};
'use strict';

const { sleep } = require('./time-utils');

type WaitForForegroundResultSuccess = {
  ok: true;
  stable: boolean;
  packageName: string | null;
  activity: string | null;
  raw: string;
  waitedMs: number;
  reason?: string;
  timeoutMs?: undefined;
};

type WaitForForegroundResultFailure = {
  ok: false;
  stable: boolean;
  packageName: string | null;
  activity: string | null;
  raw: string;
  waitedMs: number;
  timeoutMs: number;
};

type WaitForForegroundResult = WaitForForegroundResultSuccess | WaitForForegroundResultFailure;

type PostLaunchWaitOptions = {
  timeoutMs: number;
  stableCycles: number;
  pollMs: number;
  transientToleranceMs: number;
};

interface ActionsLike {
  currentApp: () => Promise<{ packageName: string | null; activity: string | null; raw: string }>;
}

const LAUNCH_STABILITY_TIMEOUT_MS = 12000;
const LAUNCH_STABILITY_STABLE_CYCLES = 2;
const LAUNCH_STABILITY_POLL_MS = 600;
const LAUNCH_TRANSIENT_TOLERANCE_MS = 3000;

class ForegroundPackageMonitor {
  public async waitForForegroundPackage(
    actions: ActionsLike,
    packageName: string,
    options: PostLaunchWaitOptions
  ): Promise<WaitForForegroundResult> {
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

  const timeoutMs = Number.isFinite(options?.timeoutMs) ? options.timeoutMs : LAUNCH_STABILITY_TIMEOUT_MS;
  const stableCycles = Number.isFinite(options?.stableCycles) ? options.stableCycles : LAUNCH_STABILITY_STABLE_CYCLES;
  const pollMs = Number.isFinite(options?.pollMs) ? options.pollMs : LAUNCH_STABILITY_POLL_MS;
  const transientToleranceMs = Number.isFinite(options?.transientToleranceMs)
    ? options.transientToleranceMs
    : LAUNCH_TRANSIENT_TOLERANCE_MS;

  const start = Date.now();
  let consecutiveMatches = 0;
  let lastResult = { packageName: null as string | null, activity: null as string | null, raw: '' };
  let lastTargetMatchMs = 0;
  let lastTargetActivity: string | null = null;
  let seenStableTarget = false;

  while (Date.now() - start < timeoutMs) {
      let current: { packageName: string | null; activity: string | null; raw: string };
      try {
        current = await actions.currentApp();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || '');
        current = {
          packageName: null,
          activity: null,
          raw: message,
        };
      }

      const pkg = current && current.packageName ? String(current.packageName) : null;
      const activity = current && current.activity ? String(current.activity) : null;
      const now = Date.now();
      lastResult = {
        packageName: pkg,
        activity,
        raw: current && current.raw ? String(current.raw).trim() : '',
      };

      if (pkg === target) {
        consecutiveMatches += 1;
        lastTargetMatchMs = now;
        lastTargetActivity = activity;
        if (consecutiveMatches >= stableCycles) {
          seenStableTarget = true;
        }
        if (consecutiveMatches >= stableCycles) {
          return {
            ok: true,
            stable: true,
            packageName: pkg,
            activity,
            raw: lastResult.raw,
            waitedMs: Date.now() - start,
            reason: 'stable-cycles',
          };
        }
      } else {
        consecutiveMatches = 0;
        if (seenStableTarget && lastTargetMatchMs > 0 && now - lastTargetMatchMs <= transientToleranceMs) {
          return {
            ok: true,
            stable: true,
            packageName: target,
            activity: lastTargetActivity,
            raw: lastResult.raw,
            waitedMs: now - start,
            reason: 'stable-target-recent-transient-loss',
          };
        }
      }

      if (Date.now() - start < timeoutMs) {
        await sleep(pollMs);
      }
    }

    return {
      ok: false,
      stable: false,
      packageName: lastResult.packageName,
      activity: lastResult.activity,
      raw: lastResult.raw,
      timeoutMs,
      waitedMs: Date.now() - start,
    };
  }
}

module.exports = {
  ForegroundPackageMonitor,
};
