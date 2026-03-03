// @ts-nocheck
export {}
'use strict';

const fs = require('fs');
const path = require('path');

const BOTDROP_TMP_ROOT_CANDIDATES = [
  '/data/local/tmp/botdrop_tmp',
];

function resolveBotdropTmpRoot() {
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
}

const BOTDROP_TMP_ROOT_DIR = resolveBotdropTmpRoot();
const BOTDROP_TMP_SCREENSHOT_DIR = path.join(BOTDROP_TMP_ROOT_DIR, 'screenshots');
const BOTDROP_TMP_UI_DUMP_DIR = path.join(BOTDROP_TMP_ROOT_DIR, 'uiautomator');

function getBotdropTmpDir() {
  return BOTDROP_TMP_ROOT_DIR;
}

function getBotdropUiDumpDir() {
  return BOTDROP_TMP_UI_DUMP_DIR;
}

function getBotdropScreenshotDir() {
  return BOTDROP_TMP_SCREENSHOT_DIR;
}

function getBotdropUiDumpPath(filename = 'shizuku-ui-dump.xml') {
  return `${getBotdropUiDumpDir()}/${filename}`;
}

function getReadablePathCandidates(rawPath = '') {
  const normalized = path.resolve(String(rawPath || '').trim());
  if (!normalized || !normalized.startsWith('/')) {
    return [normalized];
  }

  // Keep strict scope to /data/local/tmp only, no cross-root sharing.
  if (!normalized.startsWith('/data/local/tmp/')) {
    return [];
  }
  return [normalized];
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
};
