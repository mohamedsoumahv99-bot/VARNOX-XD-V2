'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PairingRequestRegistry = require('../lib/pairing-request-registry');

test('coalesces same-number requests and releases the slot after success or failure', async () => {
  const registry = new PairingRequestRegistry();
  const first = registry.begin('224610835573');
  const concurrent = registry.begin('224610835573');

  assert.equal(first.owner, true);
  assert.equal(concurrent.owner, false);
  assert.equal(concurrent.promise, first.promise);
  assert.equal(registry.size, 1);
  assert.equal(registry.inFlight, 1);

  const failure = { error: true, httpStatus: 503 };
  assert.equal(first.complete(failure), true);
  assert.equal(await concurrent.promise, failure);
  assert.equal(registry.size, 0);
  assert.equal(registry.inFlight, 0);
  assert.equal(first.complete({ error: false }), false);
});

test('keeps different numbers independent while a request is in flight', async () => {
  const registry = new PairingRequestRegistry();
  const first = registry.begin('224610835573');
  const second = registry.begin('33612345678');

  assert.equal(registry.size, 2);
  first.complete({ error: false, code: 'AAAA-BBBB' });
  assert.equal(registry.size, 1);
  second.complete({ error: true, httpStatus: 502 });
  assert.deepEqual(await first.promise, { error: false, code: 'AAAA-BBBB' });
  assert.deepEqual(await second.promise, { error: true, httpStatus: 502 });
  assert.equal(registry.inFlight, 0);
});
