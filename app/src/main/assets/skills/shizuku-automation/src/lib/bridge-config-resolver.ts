export {};
'use strict';

const fs = require('fs');
const path = require('path');
const { getBotdropTmpDir } = require('./path-utils');

import type { BridgeConfig as SkillBridgeConfig } from '../types';

const DEFAULT_SHARED_HOME = '/data/local/tmp/botdrop_tmp';
const FALLBACK_TERMUX_HOME = '/data/data/com.termux/files/home';

const SHARED_ROOT_CANDIDATES = [
  DEFAULT_SHARED_HOME,
] as const;
const TERMUX_HOME_CANDIDATES = [
  process.env.BOTDROP_TERMUX_HOME,
  process.env.TERMUX_HOME,
  process.env.HOME,
  '/data/data/app.botdrop/files/home',
  '/data/data/app.botdrop/files/usr/home',
  FALLBACK_TERMUX_HOME,
];

const BRIDGE_CONFIG_RELATIVE_PATH = path.join('.openclaw', 'shizuku-bridge.json');

interface ConfigInfo {
  path: string;
  exists: boolean;
  home: string | null;
  cwd: string;
  lastError: string | null;
}

interface BridgeConfigContext {
  automationHome: string;
  termuxHome: string;
  candidateConfigPaths: string[];
  defaultConfigPath: string;
  resolveConfigPath: (explicitConfigPath?: string) => string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBridgeConfig(value: unknown): value is SkillBridgeConfig {
  if (!isObject(value)) {
    return false;
  }

  const host = value.host;
  const port = value.port;
  const token = value.token;

  return (
    typeof host === 'string'
    && host.length > 0
    && typeof port === 'number'
    && port > 0
    && Number.isFinite(port)
    && typeof token === 'string'
    && token.length > 0
  );
}

function parseBridgeConfig(raw: string): SkillBridgeConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isBridgeConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSharedDirectoryCandidate(candidate = ''): boolean {
  const normalized = String(candidate || '').trim();
  return normalized.startsWith('/data/local/tmp/');
}

function isTermuxHomeCandidate(candidate = ''): boolean {
  const normalized = String(candidate || '').trim();
  return normalized.startsWith('/data/data/');
}

function collectDirectoryCandidates(
  candidates: Array<string | undefined>,
  validator: (candidate: string) => boolean,
): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
  }

    if (validator(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      collected.push(candidate);
    }
  }

  return collected;
}

function addUniqueCandidate(values: string[], seen: Set<string>, candidate?: string): void {
  if (!candidate) {
    return;
  }

  const normalized = String(candidate);
  if (seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  values.push(normalized);
}

function addHomeCandidate(values: string[], seen: Set<string>, home: string): void {
  if (!home) {
    return;
  }

  const normalized = String(home || '').trim();
  if (!normalized) {
    return;
  }

  addUniqueCandidate(values, seen, path.join(normalized, BRIDGE_CONFIG_RELATIVE_PATH));

  const parentHome = path.dirname(normalized);
  if (parentHome && parentHome !== normalized) {
    addUniqueCandidate(values, seen, path.join(parentHome, BRIDGE_CONFIG_RELATIVE_PATH));
  }
}

function resolveAutomationHome(): string {
  const candidateSet = [
    process.env.BOTDROP_AUTOMATION_HOME,
    getBotdropTmpDir(),
    ...SHARED_ROOT_CANDIDATES,
  ];

  const candidates = collectDirectoryCandidates(candidateSet, isSharedDirectoryCandidate);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_SHARED_HOME;
}

function resolveTermuxHome(): string {
  const candidates = [...TERMUX_HOME_CANDIDATES];

  for (const candidate of candidates) {
    if (!candidate || !isTermuxHomeCandidate(candidate)) {
      continue;
    }

    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // best effort
    }
  }

  return FALLBACK_TERMUX_HOME;
}

function collectCandidateConfigPaths(termuxHome: string, automationHome: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const directCandidates = [
    process.env.BOTDROP_SHIZUKU_BRIDGE_CONFIG_PATH,
    process.env.SHIZUKU_BRIDGE_CONFIG_PATH,
  ];

  for (const directCandidate of directCandidates) {
    addUniqueCandidate(candidates, seen, directCandidate);
  }

  const termuxHomes = [termuxHome, ...TERMUX_HOME_CANDIDATES];
  for (const home of termuxHomes) {
    if (!home || seen.has(home)) {
      continue;
    }
    addHomeCandidate(candidates, seen, home);
  }

  const sharedHomes = [automationHome, ...SHARED_ROOT_CANDIDATES];
  for (const home of sharedHomes) {
    if (!home || seen.has(home)) {
      continue;
    }
    addHomeCandidate(candidates, seen, home);
  }

  addUniqueCandidate(candidates, seen, path.join(termuxHome, BRIDGE_CONFIG_RELATIVE_PATH));

  return candidates;
}

function createBridgeConfigContext(): BridgeConfigContext {
  const automationHome = resolveAutomationHome();
  const termuxHome = resolveTermuxHome();
  const candidateConfigPaths = collectCandidateConfigPaths(termuxHome, automationHome);

  const defaultConfigPath = (() => {
    const configured = candidateConfigPaths.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });

    return configured || path.join(termuxHome, BRIDGE_CONFIG_RELATIVE_PATH);
  })();

  const resolveConfigPath = (explicitConfigPath?: string): string => {
    const normalized = String(explicitConfigPath || '').trim();
    if (normalized) {
      return normalized;
    }
    return defaultConfigPath;
  };

  return {
    automationHome,
    termuxHome,
    candidateConfigPaths,
    defaultConfigPath,
    resolveConfigPath,
  };
}

class BridgeConfigResolver {
  private readonly _context: BridgeConfigContext;
  private readonly _configPath: string;
  private _lastError: string | null = null;

  constructor(configPath?: string, context: BridgeConfigContext = createBridgeConfigContext()) {
    this._context = context;
    this._configPath = context.resolveConfigPath(configPath);
  }

  getConfigPath(): string {
    return this._configPath;
  }

  getDefaultConfigPath(): string {
    return this._context.defaultConfigPath;
  }

  getConfigInfo(): ConfigInfo {
    const exists = (() => {
      try {
        return fs.existsSync(this._configPath);
      } catch {
        return false;
      }
    })();

    return {
      path: this._configPath,
      exists,
      home: this._context.automationHome || null,
      cwd: process.cwd(),
      lastError: this._lastError,
    };
  }

  get lastError(): string | null {
    return this._lastError;
  }

  set lastError(value: string | null) {
    this._lastError = value;
  }

  readConfig(): SkillBridgeConfig | null {
    this._lastError = null;

    try {
      const raw = fs.readFileSync(this._configPath, 'utf8');
      const parsed = parseBridgeConfig(raw);
      if (!parsed) {
        this._lastError = 'Invalid config format: host/port/token missing';
        return null;
      }

      return parsed;
    } catch (error) {
      const err = error as { message?: unknown };
      this._lastError = err && typeof err.message === 'string' ? err.message : String(error);
      return null;
    }
  }
}

module.exports = {
  BridgeConfigResolver,
  BRIDGE_CONFIG_RELATIVE_PATH,
  DEFAULT_SHARED_HOME,
  FALLBACK_TERMUX_HOME,
};
