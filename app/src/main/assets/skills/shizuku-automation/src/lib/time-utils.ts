export {};
'use strict';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  sleep,
};
