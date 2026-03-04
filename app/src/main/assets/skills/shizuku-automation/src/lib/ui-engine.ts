export {};
'use strict';

const path = require('path');
const { getBotdropUiDumpPath } = require('./path-utils');
const { SkillError } = require('./errors');
const { quoteShellArg } = require('./shell-utils');
const { sleep } = require('./time-utils');

import { ErrorCode } from '../types';
import type { UiElement, UiSelector } from '../types';

const DUMP_TIMEOUT_MS = 15000;
const DEFAULT_WAIT_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 500;
const TMP_DUMP_PATH = getBotdropUiDumpPath('shizuku-ui-dump.xml');
const TMP_DUMP_DIR = path.dirname(TMP_DUMP_PATH);

interface BridgeCommandResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  message?: string;
  error?: string;
  exitCode?: number;
  type?: string;
}

interface BridgeClientLike {
  exec: (command: string, timeoutMs?: number) => Promise<BridgeCommandResult>;
}

interface ParsedUiElement extends UiElement {
  parentIndex: number | null;
}

interface CenterPoint {
  x: number;
  y: number;
}

const ATTRIBUTE_PATTERNS: Record<string, RegExp> = Object.freeze({
  text: /text="([^"]*)"/,
  'resource-id': /resource-id="([^"]*)"/,
  class: /class="([^"]*)"/,
  'content-desc': /content-desc="([^"]*)"/,
  bounds: /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/,
  clickable: /clickable="([^"]*)"/,
  enabled: /enabled="([^"]*)"/,
  focusable: /focusable="([^"]*)"/,
  scrollable: /scrollable="([^"]*)"/,
  package: /package="([^"]*)"/,
});

function parseIntOrNull(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAttribute(attrs: string, name: string): string {
  const re = ATTRIBUTE_PATTERNS[name];
  if (!re) {
    return '';
  }
  const match = attrs.match(re);
  return match ? match[1] : '';
}

function parseBounds(raw: string): UiElement['bounds'] {
  const m = raw.match(ATTRIBUTE_PATTERNS.bounds);
  if (!m) {
    return null;
  }

  const left = parseIntOrNull(m[1]);
  const top = parseIntOrNull(m[2]);
  const right = parseIntOrNull(m[3]);
  const bottom = parseIntOrNull(m[4]);

  if (left === null || top === null || right === null || bottom === null) {
    return null;
  }

  return { left, top, right, bottom };
}

function parseAttrs(attrs: string): UiElement {
  const text = getAttribute(attrs, 'text');
  const resourceId = getAttribute(attrs, 'resource-id');
  const className = getAttribute(attrs, 'class');
  const description = getAttribute(attrs, 'content-desc');
  const bounds = parseBounds(attrs);

  const center: CenterPoint | null = bounds
    ? {
      x: Math.round((bounds.left + bounds.right) / 2),
      y: Math.round((bounds.top + bounds.bottom) / 2),
    }
    : null;

  return {
    text,
    resourceId,
    className,
    description,
    bounds,
    center,
    clickable: getAttribute(attrs, 'clickable') === 'true',
    enabled: getAttribute(attrs, 'enabled') === 'true',
    focusable: getAttribute(attrs, 'focusable') === 'true',
    scrollable: getAttribute(attrs, 'scrollable') === 'true',
    packageName: getAttribute(attrs, 'package'),
  };
}

function matchesSelector(el: UiElement, selector: UiSelector): boolean {
  const expectText = selector.text;
  const expectTextContains = selector.textContains;
  const expectResourceId = selector.resourceId;
  const expectClassName = selector.className;
  const expectDescription = selector.description;
  const expectDescriptionContains = selector.descriptionContains;
  const expectClickable = selector.clickable;
  const expectEnabled = selector.enabled;
  const expectPackageName = selector.packageName;

  if (expectText !== undefined && el.text !== expectText) return false;
  if (expectTextContains !== undefined && !el.text.includes(expectTextContains)) return false;
  if (expectResourceId !== undefined && el.resourceId !== expectResourceId) return false;
  if (expectClassName !== undefined && el.className !== expectClassName) return false;
  if (expectDescription !== undefined && el.description !== expectDescription) return false;
  if (expectDescriptionContains !== undefined && !el.description.includes(expectDescriptionContains)) return false;
  if (expectClickable !== undefined && el.clickable !== expectClickable) return false;
  if (expectEnabled !== undefined && el.enabled !== expectEnabled) return false;
  if (expectPackageName !== undefined && el.packageName !== expectPackageName) return false;

  return true;
}

function parseXml(xml: string): UiElement[] {
  return parseXmlWithTree(xml).map(({ parentIndex, ...element }) => element as UiElement);
}

function parseXmlWithTree(xml: string): ParsedUiElement[] {
  const nodeRe = /<node\b([^>]*?)\/>|<node\b([^>]*?)>|<\/node>/g;
  const elements: ParsedUiElement[] = [];
  const stack: number[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = nodeRe.exec(xml)) !== null) {
    const token = match[0];
    if (token.startsWith('</node')) {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    const attrs = match[1] || match[2] || '';
    const parentIndex = stack.length > 0 ? stack[stack.length - 1] : null;
    const index = elements.length;
    elements.push({ ...parseAttrs(attrs), parentIndex });

    if (!token.endsWith('/>')) {
      stack.push(index);
    }
  }
  return elements;
}

function findTouchableAncestor(elements: ParsedUiElement[], leaf: ParsedUiElement): ParsedUiElement | null {
  let current = leaf.parentIndex;
  let fallback: ParsedUiElement | null = null;
  const visited = new Set<number>();

  while (current !== null && current >= 0 && current < elements.length && !visited.has(current)) {
    visited.add(current);
    const node = elements[current];
    if (!node || !node.bounds || !node.center) {
      current = node ? node.parentIndex : null;
      continue;
    }
    if (node.clickable || node.focusable) {
      return node;
    }
    if (!fallback) {
      fallback = node;
    }
    current = node.parentIndex;
  }

  return fallback;
}

function wrapBridgeCommandError(message: string, diagnostics: Record<string, unknown>): Error {
  const err = new SkillError(ErrorCode.EXEC_FAILED, message, {
    dumpResult: diagnostics,
  });
  return err;
}

function createUiError(code: ErrorCode, message: string, details: Record<string, unknown> = {}): Error {
  const err = new SkillError(code, message, details);
  return err;
}

class UIEngine {
  private readonly _bridge: BridgeClientLike;

  constructor(bridgeClient: BridgeClientLike) {
    this._bridge = bridgeClient;
  }

  private async dumpWithTree(): Promise<ParsedUiElement[]> {
    await this._bridge.exec(`mkdir -p ${quoteShellArg(TMP_DUMP_DIR)}`);

    const dumpRes = await this._bridge.exec(`uiautomator dump ${quoteShellArg(TMP_DUMP_PATH)}`, DUMP_TIMEOUT_MS);
    if (!dumpRes.ok) {
      throw wrapBridgeCommandError(`UI dump command failed: ${String(dumpRes.error || dumpRes.message || 'unknown error')}`, {
        command: `uiautomator dump ${TMP_DUMP_PATH}`,
        ok: dumpRes.ok,
        exitCode: Number.isFinite(dumpRes.exitCode) ? dumpRes.exitCode : null,
        stdout: String(dumpRes.stdout || ''),
        stderr: String(dumpRes.stderr || ''),
        message: dumpRes.message,
        type: dumpRes.type || 'text',
      });
    }

    const outputRes = await this._bridge.exec(`cat ${quoteShellArg(TMP_DUMP_PATH)}`, 5000);
    const stdout = String(outputRes.stdout || '');
    if (!stdout.includes('<hierarchy')) {
      const errorMessage = String(outputRes.stderr || outputRes.message || 'output missing or invalid');
      throw wrapBridgeCommandError(`UI dump failed: ${errorMessage}`, {
        command: `cat ${TMP_DUMP_PATH}`,
        ok: outputRes.ok,
        exitCode: Number.isFinite(outputRes.exitCode) ? outputRes.exitCode : null,
        stdout,
        stderr: String(outputRes.stderr || ''),
        message: String(outputRes.message || ''),
        type: outputRes.type || 'text',
      });
    }

    return parseXmlWithTree(stdout);
  }

  async dump(): Promise<UiElement[]> {
    const elements = await this.dumpWithTree();
    return elements.map((element) => this.toUiElement(element));
  }

  private toUiElement(element: ParsedUiElement): UiElement {
    const { parentIndex: _ignore, ...uiElement } = element;
    return uiElement as UiElement;
  }

  private async findWithTree(selector: UiSelector): Promise<ParsedUiElement[]> {
    const elements = await this.dumpWithTree();
    return elements.filter((el) => matchesSelector(el, selector));
  }

  async find(selector: UiSelector): Promise<UiElement[]> {
    const elements = await this.findWithTree(selector);
    return elements.map((element) => this.toUiElement(element));
  }

  async findOne(selector: UiSelector): Promise<UiElement | null> {
    const elements = await this.findWithTree(selector);
    const best = elements.find((el) => Boolean(el.center)) || elements[0];
    return best ? this.toUiElement(best) : null;
  }

  async exists(selector: UiSelector): Promise<boolean> {
    const element = await this.findOne(selector);
    return element !== null;
  }

  async waitFor(selector: UiSelector, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<UiElement> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const element = await this.findOne(selector);
      if (element) {
        return element;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }

    throw createUiError(ErrorCode.ELEMENT_NOT_FOUND, `Element not found within ${timeoutMs}ms: ${JSON.stringify(selector)}`, {
      selector,
      timeoutMs,
    });
  }

  async tap(selector: UiSelector): Promise<{ element: UiElement; tapped: { x: number; y: number } }> {
    const allElements = await this.dumpWithTree();
    const matches = allElements.filter((el) => matchesSelector(el, selector));
    if (!matches.length) {
      throw createUiError(ErrorCode.ELEMENT_NOT_FOUND, `Element not found: ${JSON.stringify(selector)}`, {
        selector,
      });
    }

    let element = matches.find((el) => Boolean(el.center)) || null;
    if (!element) {
      const noBounds = matches.find((el) => !el.center);
      if (noBounds) {
        element = findTouchableAncestor(allElements, noBounds);
      }
    }

    if (!element) {
      throw createUiError(ErrorCode.ELEMENT_NO_BOUNDS, `Element has no bounds: ${JSON.stringify(selector)}`, {
        selector,
        selectorMatchCount: matches.length,
      });
    }

    if (!element.center) {
      throw createUiError(ErrorCode.ELEMENT_NO_BOUNDS, `Element has no bounds: ${JSON.stringify(selector)}`, {
        selector,
        selectorMatchCount: matches.length,
      });
    }

    const tapRes = await this._bridge.exec(`input tap ${element.center.x} ${element.center.y}`);
    if (!tapRes.ok) {
      throw createUiError(ErrorCode.EXEC_FAILED, `Tap failed: ${String(tapRes.stderr || '')}`, {
        command: `input tap ${element.center.x} ${element.center.y}`,
        stderr: tapRes.stderr || '',
      });
    }

    return { element: this.toUiElement(element), tapped: element.center };
  }
}

module.exports = {
  UIEngine,
  parseXml,
  parseBounds,
  parseAttrs,
  matchesSelector,
};
