export {};
'use strict';

const LAUNCH_STABILITY_TIMEOUT_MS = 12000;
const LAUNCH_STABILITY_STABLE_CYCLES = 2;
const LAUNCH_STABILITY_POLL_MS = 600;
const LAUNCH_TRANSIENT_TOLERANCE_MS = 3000;

type ArgValue = string | boolean;
type ArgFlags = Record<string, ArgValue>;
type ParsedArgs = {
  flags: ArgFlags;
  positional: string[];
};

type PostLaunchWaitOptions = {
  timeoutMs: number;
  stableCycles: number;
  pollMs: number;
  transientToleranceMs: number;
};

class CliArgumentParser {
  public parse(argv: string[]): ParsedArgs {
    const args: ParsedArgs = {
      flags: {},
      positional: [],
    };

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

  public getFlagString(flags: ArgFlags, key: string): string | undefined {
    const value = flags[key];
    return typeof value === 'string' ? value : undefined;
  }

  public hasFlag(flags: ArgFlags, key: string): boolean {
    return flags[key] === true || typeof flags[key] === 'string';
  }

  public hasAnyFlag(flags: ArgFlags, ...keys: string[]): boolean {
    return keys.some((key) => this.hasFlag(flags, key));
  }

  public parsePositiveInt(value: unknown, fallback: number, min = 1): number {
    const normalized = typeof value === 'string' ? value : String(value ?? '');
    const parsed = parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || parsed < min) {
      return fallback;
    }
    return parsed;
  }

  public getPostLaunchWaitOptions(flags: ArgFlags): PostLaunchWaitOptions {
  const timeoutMs = this.parsePositiveInt(
      flags && flags['post-launch-timeout-ms'],
      LAUNCH_STABILITY_TIMEOUT_MS,
      1
    );
    const stableCycles = this.parsePositiveInt(
      flags && flags['post-launch-stable-cycles'],
      LAUNCH_STABILITY_STABLE_CYCLES,
      1
    );
    const pollMs = this.parsePositiveInt(
      flags && flags['post-launch-settle-ms'],
      LAUNCH_STABILITY_POLL_MS,
      50
    );
    const transientToleranceMs = this.parsePositiveInt(
      flags && flags['post-launch-transient-tolerance-ms'],
      LAUNCH_TRANSIENT_TOLERANCE_MS,
      0
    );
    return {
      timeoutMs,
      stableCycles,
      pollMs,
      transientToleranceMs,
    };
  }
}

module.exports = {
  CliArgumentParser,
  LAUNCH_STABILITY_TIMEOUT_MS,
  LAUNCH_STABILITY_STABLE_CYCLES,
  LAUNCH_STABILITY_POLL_MS,
  LAUNCH_TRANSIENT_TOLERANCE_MS,
};
