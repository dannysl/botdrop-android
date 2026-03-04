export {};
'use strict';

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

module.exports = {
  quoteShellArg,
};
