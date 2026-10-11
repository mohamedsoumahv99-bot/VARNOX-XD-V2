'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const calculateReconnectDelay = require('../lib/reconnect-delay');

test('calculates bounded exponential reconnect delays with deterministic jitter', () => {
  assert.equal(calculateReconnectDelay(1, () => 0), 1_000);
  assert.equal(calculateReconnectDelay(2, () => 0.5), 2_200);
  assert.equal(calculateReconnectDelay(10, () => 0), 60_000);
  assert.equal(calculateReconnectDelay(10, () => 0.999), 61_998);
});

test('normalizes invalid and fractional retry counts', () => {
  assert.equal(calculateReconnectDelay(0, () => 0), 1_000);
  assert.equal(calculateReconnectDelay('2.8', () => 0), 2_000);
});
