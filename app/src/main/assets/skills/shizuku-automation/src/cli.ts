#!/usr/bin/env node
// @ts-nocheck
export {}
'use strict';

const { BridgeClient } = require('./lib/bridge-client');
const { UIEngine } = require('./lib/ui-engine');
const { Actions } = require('./lib/actions');
const { CliCallLogger } = require('./lib/cli-call-logger');
const { CliArgumentParser } = require('./lib/cli-argument-parser');
const { ForegroundPackageMonitor } = require('./lib/foreground-package-monitor');
const { ExecCommandRouter } = require('./lib/exec-command-router');
const { CliRuntimeServices } = require('./lib/cli-runtime-services');
const { CliRuntime } = require('./lib/cli-runtime');
const { CliCommandHandler } = require('./lib/cli-command-handler');
const { isRecordObject } = require('./lib/type-guards');

const cliRuntimeServices = new CliRuntimeServices();
const cliCallLogger = new CliCallLogger(cliRuntimeServices.logFilePath);
const cliArgumentParser = new CliArgumentParser();
const foregroundPackageMonitor = new ForegroundPackageMonitor();
const execCommandRouter = new ExecCommandRouter();

const cliRuntime = new CliRuntime(
  cliCallLogger,
  cliRuntimeServices.localTmpPathResolver,
  cliRuntimeServices.termuxFileService,
  cliRuntimeServices.imageProcessor,
  cliArgumentParser,
  foregroundPackageMonitor,
  execCommandRouter
);
const cliCommandHandler = new CliCommandHandler(cliRuntime);

const LOCAL_EXEC_HOME = cliRuntimeServices.localExecHome;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    cliCommandHandler.showHelp();
    process.exit(0);
  }

  const [command, ...rest] = argv;
  if (!command) {
    cliRuntime.fail('INVALID_ARGS', 'Usage: <command> [args...]');
  }

  const args = cliRuntime.parseArgs(rest);
  const bridgeConfigPath = typeof args.flags.config === 'string' ? args.flags.config : undefined;
  const bridge = new BridgeClient(bridgeConfigPath);
  const session = {
    command,
    args,
    startMs: Date.now(),
    pid: process.pid,
    runtime: {
      home: LOCAL_EXEC_HOME || process.env.HOME || null,
      cwd: process.cwd(),
      shell: process.env.SHELL || null,
      pid: process.pid,
      nodeVersion: process.version,
    },
    bridgeConfigPath: bridge.getConfigPath ? bridge.getConfigPath() : (bridgeConfigPath || null),
  };

  cliRuntime.beginSession(session, bridge.getConfigInfo ? bridge.getConfigInfo() : null);
  const ui = new UIEngine(bridge);
  const actions = new Actions(bridge, ui);

  await cliCommandHandler.execute(command, args, bridge, actions);
}

main().catch((err: unknown) => {
  cliRuntime.fail(
    'UNCAUGHT',
    isRecordObject(err) && typeof err.message === 'string'
      ? err.message
      : 'Unexpected uncaught error'
  );
});
