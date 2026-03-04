export {};
'use strict';

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

module.exports = {
  isRecordObject,
};
