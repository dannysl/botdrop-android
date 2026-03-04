export class SkillError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  public constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
    this.details = details;
  }
}

export function toErrorCodeValue(error: unknown): string {
  if (error instanceof SkillError) {
    return error.code;
  }
  if (error instanceof Error && typeof error.message === 'string' && error.message) {
    return error.message;
  }
  return String(error);
}

export function serializeFailureExtra(error: unknown): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (!error || typeof error !== 'object') {
    return extra;
  }

  const e = error as Record<string, unknown>;
  for (const [key, value] of Object.entries(e)) {
    if (key === 'code' || key === 'message' || key === 'stack') {
      continue;
    }
    extra[key] = value;
  }

  if ('code' in e && e.code !== undefined) {
    extra.originalCode = e.code;
  }
  if ('message' in e && typeof e.message === 'string') {
    extra.originalMessage = e.message;
  }
  if ('stack' in e && e.stack) {
    extra.stack = e.stack;
  }

  return extra;
}
