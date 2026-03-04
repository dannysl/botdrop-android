export {};
'use strict';

type CliResponseWriterLike = {
  ok: (data: unknown) => never;
  fail: (error: string, message: string, extra?: Record<string, unknown>) => never;
};

interface CliCurrentCall {
  command: string;
  args: Record<string, unknown>;
  startMs: number;
  pid: number;
  runtime: {
    home: string | null;
    cwd: string;
    shell: string | null;
    pid: number;
    nodeVersion: string;
  };
  bridgeConfigPath: string | null;
}

interface CliCallLoggerLike {
  finish: (session: CliCurrentCall, status: 'ok' | 'error', data?: unknown, error?: unknown) => void;
}

class CliResponseWriter {
  constructor(
    private readonly logger: CliCallLoggerLike,
    private readonly session: CliCurrentCall
  ) {}

  public ok(data: unknown): never {
    this.logger.finish(this.session, 'ok', data);
    process.stdout.write(JSON.stringify({ ok: true, data }) + '\n');
    process.exit(0);
  }

  public fail(error: string, message: string, extra: Record<string, unknown> = {}): never {
    this.logger.finish(this.session, 'error', null, { error, message, ...extra });
    process.stdout.write(JSON.stringify({ ok: false, error, message, ...extra }) + '\n');
    process.exit(1);
  }
}

module.exports = {
  CliResponseWriter,
};
