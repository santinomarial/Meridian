'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stageFailed } = require('./load-realtime.cjs');

const complete = {
  failedUsers: 0,
  successfulUpdates: 20,
  expectedUpdates: 20,
  resources: { persistenceFailuresDelta: 0 },
  fanoutEvents: 180,
  expectedFanout: 180,
  unexpectedFanoutEvents: 0,
  undeliveredUpdates: 0,
  serverErrors: [],
};

test('complete acknowledged and correlated peer delivery passes', () => {
  assert.equal(stageFailed(complete), false);
});

for (const [name, patch] of [
  ['missing peer delivery despite all acknowledgments', { fanoutEvents: 179 }],
  ['extra peer delivery', { fanoutEvents: 181 }],
  ['duplicate replacing a missing delivery', { unexpectedFanoutEvents: 1, undeliveredUpdates: 1 }],
  ['uncorrelated delivery', { unexpectedFanoutEvents: 1 }],
  ['incomplete correlation', { undeliveredUpdates: 1 }],
  ['server error', { serverErrors: ['Persistence error'] }],
  ['missing acknowledgment', { successfulUpdates: 19 }],
  ['failed user', { failedUsers: 1 }],
  ['persistence failure', { resources: { persistenceFailuresDelta: 1 } }],
]) {
  test(`rejects ${name}`, () => {
    assert.equal(stageFailed({ ...complete, ...patch }), true);
  });
}
