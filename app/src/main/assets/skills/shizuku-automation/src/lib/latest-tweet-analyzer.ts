export {};
'use strict';

interface UiBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface UiElement {
  text: string;
  resourceId: string;
  className: string;
  description: string;
  bounds: UiBounds | null;
  center: { x: number; y: number } | null;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  scrollable: boolean;
  packageName: string;
}

interface LatestTweetCandidate {
  text: string;
  bounds: UiBounds | null;
  className: string;
  resourceId: string;
  description: string;
}

interface LatestTweetResult {
  ok: true;
  mode: 'uiautomator';
  method: 'row-child-text' | 'row-description';
  packageName: string | null;
  selectedRow: {
    bounds: UiBounds | null;
    description: string;
    resourceId: string;
    top: number;
  };
  content: string;
  contentCandidates: LatestTweetCandidate[];
  candidateCount: number;
  source: 'ui-dump';
  stats: {
    rows: number;
    totalElements: number;
  };
}

interface LatestTweetFailure {
  ok: false;
  mode: 'uiautomator';
  error: string;
  message: string;
  packageName: string | null;
  count: number;
}

class LatestTweetAnalyzer {
  private toRecord(raw: unknown): Record<string, unknown> | null {
    return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  }

  private toUiElement(raw: unknown): UiElement | null {
    const record = this.toRecord(raw);
    if (!record) {
      return null;
    }

    return {
      text: typeof record.text === 'string' ? record.text : '',
      resourceId: typeof record.resourceId === 'string' ? record.resourceId : '',
      className: typeof record.className === 'string' ? record.className : '',
      description: typeof record.description === 'string' ? record.description : '',
      bounds: this.parseUiBounds(record.bounds),
      center: this.parseUiPoint(record.center),
      clickable: typeof record.clickable === 'boolean' ? record.clickable : false,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : false,
      focusable: typeof record.focusable === 'boolean' ? record.focusable : false,
      scrollable: typeof record.scrollable === 'boolean' ? record.scrollable : false,
      packageName: typeof record.packageName === 'string' ? record.packageName : '',
    };
  }

  private parseUiBounds(raw: unknown): UiBounds | null {
    const record = this.toRecord(raw);
    if (!record) {
      return null;
    }
    const { left, top, right, bottom } = record;
    return (
      typeof left === 'number' &&
      typeof top === 'number' &&
      typeof right === 'number' &&
      typeof bottom === 'number'
    ) ? {
      left,
      top,
      right,
      bottom,
    } : null;
  }

  private parseUiPoint(raw: unknown): { x: number; y: number } | null {
    const record = this.toRecord(raw);
    if (!record) {
      return null;
    }
    const x = Number(record.x);
    const y = Number(record.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { x, y };
  }

  private isInsideBounds(child: UiBounds | null, parent: UiBounds | null): boolean {
    if (!child || !parent) return false;
    return (
      Number.isFinite(child.left) &&
      Number.isFinite(child.top) &&
      Number.isFinite(child.right) &&
      Number.isFinite(child.bottom) &&
      child.left >= parent.left - 8 &&
      child.top >= parent.top - 8 &&
      child.right <= parent.right + 8 &&
      child.bottom <= parent.bottom + 8
    );
  }

  private isLikelyTextForFeed(text: string, minLength = 20): boolean {
    if (!text) return false;
    const normalized = this.normalizeUiText(text).trim();
    if (!normalized || normalized.length < minLength) return false;
    if (/^\d{1,4}\s*(分钟前|小时前|天前|月前|周前|年)/.test(normalized)) return false;
    if (/^(0|[1-9]\d*)\s*个?\s*(转帖|喜欢|查看次数|回复)?$/.test(normalized)) return false;
    if (normalized === '广告' || normalized === '已发布') return false;
    if (normalized.includes('认证查看次数')) return false;
    if (normalized.includes('显示更多')) return false;
    if (normalized.includes('认证企业')) return false;
    return true;
  }

  private normalizeUiText(rawText: string): string {
    const text = String(rawText || '');
    return text
      .replace(/&#(\d+);/g, (_, code) => {
        const charCode = Number.parseInt(code, 10);
        if (!Number.isFinite(charCode)) return '';
        try {
          return String.fromCodePoint(charCode);
        } catch {
          return '';
        }
      })
      .replace(/\s+/g, ' ')
      .replace(/\u00A0/g, ' ')
      .trim();
  }

  public extractLatestTweetFromUiDump(
    elements: unknown,
    options: { packageName?: string | null; minTextLength?: number } = {}
  ): LatestTweetResult | LatestTweetFailure {
    const rows: UiElement[] = [];
    const rawRows = Array.isArray(elements) ? elements : [];
    for (const raw of rawRows) {
      const parsed = this.toUiElement(raw);
      if (parsed) {
        rows.push(parsed);
      }
    }

    const packageName = options.packageName || null;
    const minTextLength = typeof options.minTextLength === 'number' && options.minTextLength > 0
      ? options.minTextLength
      : 20;

    const rowElements = rows.filter((el) => {
      if (!el || !el.resourceId) return false;
      if (el.resourceId !== 'com.twitter.android:id/row') return false;
      if (packageName && el.packageName && el.packageName !== packageName) return false;
      if (!el.bounds) return false;
      return true;
    });

    if (!rowElements.length) {
      return {
        ok: false,
        mode: 'uiautomator',
        error: 'NO_TWEET_ROW_FOUND',
        message: 'No com.twitter.android:id/row element was found in current ui dump',
        packageName: packageName || null,
        count: rows.length,
      };
    }

    const latestRow = rowElements[0];
    const candidates = rows.filter((el) => {
      if (!el || !el.text) return false;
      if (!this.isInsideBounds(el.bounds, latestRow.bounds)) return false;
      if (!this.isLikelyTextForFeed(el.text, minTextLength)) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const aTop = a.bounds ? a.bounds.top : Number.MAX_SAFE_INTEGER;
      const bTop = b.bounds ? b.bounds.top : Number.MAX_SAFE_INTEGER;
      if (aTop !== bTop) {
        return aTop - bTop;
      }
      const aLeft = a.bounds ? a.bounds.left : 0;
      const bLeft = b.bounds ? b.bounds.left : 0;
      return aLeft - bLeft;
    });

    const rowText = latestRow.description || latestRow.text || '';
    const cleanedRowText = this.normalizeUiText(rowText);
    const normalizedCandidates = candidates
      .map((el) => ({
        text: this.normalizeUiText(el.text),
        bounds: el.bounds || null,
        className: el.className || '',
        resourceId: el.resourceId || '',
        description: el.description || '',
      }))
      .filter((entry) => this.isLikelyTextForFeed(entry.text, minTextLength));

    const seen = new Set<string>();
    const contentCandidates: LatestTweetCandidate[] = [];
    for (const entry of normalizedCandidates) {
      if (!entry.text || seen.has(entry.text)) continue;
      seen.add(entry.text);
      contentCandidates.push(entry);
    }

    const best = contentCandidates.length > 0 ? contentCandidates[0] : null;
    const content = best ? best.text : cleanedRowText;

    return {
      ok: true,
      mode: 'uiautomator',
      method: best ? 'row-child-text' : 'row-description',
      packageName: packageName || latestRow.packageName || null,
      selectedRow: {
        bounds: latestRow.bounds,
        description: cleanedRowText,
        resourceId: latestRow.resourceId,
        top: latestRow.bounds ? latestRow.bounds.top : 0,
      },
      content,
      contentCandidates,
      candidateCount: contentCandidates.length,
      source: 'ui-dump',
      stats: {
        rows: rowElements.length,
        totalElements: rows.length,
      },
    };
  }
}

module.exports = {
  LatestTweetAnalyzer,
};
