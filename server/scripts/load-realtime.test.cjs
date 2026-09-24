'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { stageFailed, verifyConvergence } = require('./load-realtime.cjs');

const complete = {
  failedUsers: 0,
  successfulUpdates: 20,
  expectedUpdates: 20,
  resources: { persistenceFailuresDelta: 0 },
  fanoutEvents: 180,
  uniqueFanoutEvents: 180,
  expectedFanout: 180,
  concurrency: 10,
  convergence: { checkedClients: 10, convergedClients: 10, documents: 1 },
  undeliveredUpdates: 0,
  serverErrors: [],
};

test('complete acknowledged and correlated peer delivery passes', () => {
  assert.equal(stageFailed(complete), false);
});

for (const [name, patch] of [
  ['missing peer delivery despite all acknowledgments', { uniqueFanoutEvents: 179 }],
  ['extra unique peer delivery', { uniqueFanoutEvents: 181 }],
  ['duplicate replacing a missing delivery', { fanoutEvents: 180, uniqueFanoutEvents: 179, duplicateFanoutEvents: 1 }],
  ['divergent editor', { convergence: { checkedClients: 10, convergedClients: 9 } }],
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

test('valid recovery and idempotent replay do not inflate the delivery metric', () => {
  assert.equal(stageFailed({ ...complete, fanoutEvents: 201, recoveryFanoutEvents: 20, duplicateFanoutEvents: 1 }), false);
});

test('convergence requires all submitted edits, not just agreement between clients', () => {
  const reference = new Y.Doc();
  reference.getText('content').insert(0, 'complete');
  const update = Y.encodeStateAsUpdate(reference);
  const clients = [new Y.Doc(), new Y.Doc()];
  const submissions = new Map([['update', { documentId: 'doc', update }]]);
  const check = () => verifyConvergence(clients.map(ydoc => ({ documentId: 'doc', ydoc })), submissions);
  assert.equal(check().convergedClients, 0);
  Y.applyUpdate(clients[0], update);
  assert.equal(check().convergedClients, 1);
  Y.applyUpdate(clients[1], update);
  assert.equal(check().convergedClients, 2);
  clients.forEach(doc => doc.destroy());
  reference.destroy();
});
