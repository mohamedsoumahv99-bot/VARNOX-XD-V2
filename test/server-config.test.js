'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeListenHost } = require('../lib/server-config');

test('normalizes URL-style IPv6 wildcard HOST values for Railway', () => {
  assert.equal(normalizeListenHost('[::]'), '0.0.0.0');
  assert.equal(normalizeListenHost(' :: '), '0.0.0.0');
  assert.equal(normalizeListenHost('[0:0:0:0:0:0:0:0]'), '0.0.0.0');
});

test('uses IPv4 wildcard binding when HOST is empty', () => {
  assert.equal(normalizeListenHost(undefined), '0.0.0.0');
  assert.equal(normalizeListenHost('   '), '0.0.0.0');
});

test('preserves explicit IPv4 addresses and hostnames', () => {
  assert.equal(normalizeListenHost('0.0.0.0'), '0.0.0.0');
  assert.equal(normalizeListenHost('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeListenHost('localhost'), 'localhost');
});
