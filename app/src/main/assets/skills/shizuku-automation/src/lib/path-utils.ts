// @ts-nocheck
export {};
'use strict';

const fs = require('fs');
const path = require('path');

const BOTDROP_TMP_ROOT_CANDIDATES = [
  '/data/local/tmp/botdrop_tmp',
];
const DEFAULT_LOCAL_TMP_ROOT = '/data/local/tmp';

const resolveBotdropTmpRoot = (): string => {
  for (const candidate of BOTDROP_TMP_ROOT_CANDIDATES) {
    if (!candidate) {
      continue;
    }
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
      return candidate;
    } catch {
      // ignore and try next candidate
    }
  }

  const fallback = BOTDROP_TMP_ROOT_CANDIDATES[0] || path.join('/data/local/tmp', 'botdrop_tmp');
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch {
    // keep fallback even if create fails
  }
  return fallback;
};

const BOTDROP_TMP_ROOT_DIR = resolveBotdropTmpRoot();
const BOTDROP_TMP_UI_DUMP_DIR = path.join(BOTDROP_TMP_ROOT_DIR, 'uiautomator');
const BOTDROP_TMP_SCREENSHOT_DIR = path.join(BOTDROP_TMP_ROOT_DIR, 'screenshots');

function getBotdropTmpDir(): string {
  return BOTDROP_TMP_ROOT_DIR;
}

function getBotdropUiDumpDir(): string {
  return BOTDROP_TMP_UI_DUMP_DIR;
}

function getBotdropScreenshotDir(): string {
  return BOTDROP_TMP_SCREENSHOT_DIR;
}

function getBotdropUiDumpPath(filename = 'shizuku-ui-dump.xml'): string {
  return `${getBotdropUiDumpDir()}/${filename}`;
}

function getReadablePathCandidates(rawPath = ''): string[] {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return [];
  }
  const normalized = path.resolve(trimmed);

  // Keep strict scope to /data/local/tmp only, no cross-root sharing.
  if (!isUnderLocalTmpRoot(normalized, DEFAULT_LOCAL_TMP_ROOT)) {
    return [];
  }
  return [normalized];
}

function resolveExistingAncestorRealpath(candidate: string): string | null {
  let current = path.resolve(String(candidate || '').trim());
  while (true) {
    if (fs.existsSync(current)) {
      return fs.realpathSync(current);
    }
    const parent = path.dirname(current);
    if (!parent || parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function isUnderLocalTmpRoot(candidate: string, root = DEFAULT_LOCAL_TMP_ROOT): boolean {
  const normalized = path.resolve(String(candidate || '').trim());
  const normalizedRoot = path.resolve(String(root || '').trim() || DEFAULT_LOCAL_TMP_ROOT);
  return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`);
}

function resolveSafeLocalTmpPath(
  candidate: string,
  root = DEFAULT_LOCAL_TMP_ROOT
): { ok: boolean; path: string; resolved: string | null; detail?: string } {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      path: trimmed,
      resolved: null,
      detail: 'empty-path',
    };
  }

  const normalized = path.resolve(trimmed);
  if (!isUnderLocalTmpRoot(normalized, root)) {
    return {
      ok: false,
      path: normalized,
      resolved: null,
      detail: 'invalid-path-prefix',
    };
  }

  try {
    const resolved = fs.realpathSync(normalized);
    if (!isUnderLocalTmpRoot(resolved, root)) {
      return {
        ok: false,
        path: normalized,
        resolved,
        detail: 'symlink-escape',
      };
    }
    return { ok: true, path: normalized, resolved };
  } catch (error: unknown) {
    const codeValue =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
    const code =
      typeof codeValue === 'string'
        ? codeValue
        : typeof codeValue === 'number'
          ? String(codeValue)
          : null;
    if (code && code !== 'ENOENT' && code !== 'ENOTDIR') {
      return {
        ok: false,
        path: normalized,
        resolved: null,
        detail: `path-access-error:${String(code)}`,
      };
    }

    const realAncestor = resolveExistingAncestorRealpath(normalized);
    if (!realAncestor || !isUnderLocalTmpRoot(realAncestor, root)) {
      return {
        ok: false,
        path: normalized,
        resolved: realAncestor,
        detail: !realAncestor ? 'path-no-existing-ancestor' : 'ancestor-escape',
      };
    }

    return { ok: true, path: normalized, resolved: realAncestor, detail: 'ancestor-ok' };
  }
}

module.exports = {
  BOTDROP_TMP_ROOT_DIR,
  BOTDROP_TMP_UI_DUMP_DIR,
  BOTDROP_TMP_SCREENSHOT_DIR,
  getBotdropTmpDir,
  getBotdropUiDumpDir,
  getBotdropScreenshotDir,
  getBotdropUiDumpPath,
  getReadablePathCandidates,
  DEFAULT_LOCAL_TMP_ROOT,
  isUnderLocalTmpRoot,
  resolveSafeLocalTmpPath,
};
