'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const calculateReconnectDelay = require('../lib/reconnect-delay');

test('reconnect delay starts at one second and stays inside jitter bounds', () => {
   assert.equal(calculateReconnectDelay(1, () => 0), 1000);
   assert.equal(calculateReconnectDelay(1, () => 0.999999), 1249);
});

test('reconnect backoff caps at sixty seconds before jitter', () => {
   assert.equal(calculateReconnectDelay(7, () => 0), 60000);
   assert.equal(calculateReconnectDelay(7, () => 0.999999), 61999);
});

test('invalid attempt values fall back to the first retry', () => {
   assert.equal(calculateReconnectDelay(0, () => 0), 1000);
   assert.equal(calculateReconnectDelay('bad', () => 0), 1000);
});
