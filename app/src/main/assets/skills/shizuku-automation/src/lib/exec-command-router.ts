export {};
'use strict';

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

type ExecRouting = (
  | { mode: 'shizuku'; command: string }
  | { mode: 'unsupported'; command: string; reason: string }
);

class ExecCommandRouter {
  private readonly _commands = SHIZUKU_EXEC_COMMANDS;
  private readonly _commandPrefixSet = new Set(this._commands);

  private stripAdbShellPrefix(command: string): string {
    const normalized = String(command || '').trim();
    return normalized.replace(/^adb\s+shell\b/i, '').trim();
  }

  private getCommandTokens(command: string): string[] {
    const normalized = String(command || '').trim();
    if (!normalized) {
      return [];
    }
    const match = normalized.match(/"[^"]*"|'[^']*'|\S+/g);
    return (match || []).map((token) => token.replace(/^['"]|['"]$/g, '').toLowerCase());
  }

  public route(command: string): ExecRouting {
    const normalized = String(command || '').trim();
    if (!normalized) {
      return { mode: 'unsupported', command: '', reason: 'EMPTY_COMMAND' };
    }

    const routed = this.stripAdbShellPrefix(normalized);
    const tokens = this.getCommandTokens(routed);
    if (tokens.length === 0) {
      return { mode: 'unsupported', command: routed, reason: 'EMPTY_COMMAND' };
    }

    const first = tokens[0];
    const firstTwo = `${first} ${tokens[1] || ''}`.trim();
    const routeKey = this._commandPrefixSet.has(firstTwo) ? firstTwo : first;

    if (this._commandPrefixSet.has(routeKey)) {
      return { mode: 'shizuku', command: routed };
    }

    return {
      mode: 'unsupported',
      command: routed,
      reason: `Unsupported exec command: ${first}. Supported: ${this._commands.join(', ')}`,
    };
  }

  public getSupportedCommands(): string[] {
    return [...this._commands];
  }
}

module.exports = {
  ExecCommandRouter,
};
