'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMenuCommand } = require('../lib/menu-command');
const { normalizeCommandText } = require('../lib/prefix');

test('parses bare menu/help and category queries', () => {
  assert.deepEqual(parseMenuCommand('menu'), { query: '' });
  assert.deepEqual(parseMenuCommand('help groupe'), { query: 'groupe' });
  assert.deepEqual(parseMenuCommand('menu 5'), { query: '5' });
  assert.deepEqual(parseMenuCommand('allmenu'), { query: 'allmenu' });
});

test('parses every prefixed menu alias through the same route', () => {
  for (const alias of ['.menu', '.help']) {
    assert.deepEqual(parseMenuCommand(alias, { prefixed: true }), { query: '' });
    assert.deepEqual(parseMenuCommand(`${alias} outils`, { prefixed: true }), { query: 'outils' });
  }
  assert.deepEqual(parseMenuCommand('.allmenu', { prefixed: true }), { query: 'allmenu' });
  assert.deepEqual(parseMenuCommand('.list', { prefixed: true }), { query: 'allmenu' });
  assert.deepEqual(parseMenuCommand('.bot', { prefixed: true }), { query: '' });
});

test('normalizes a configured prefix and rejects an inactive prefix as a menu command', () => {
  const normalized = normalizeCommandText('!menu groupe', '!');
  assert.deepEqual(parseMenuCommand(normalized, { prefixed: true }), { query: 'groupe' });
  assert.equal(parseMenuCommand('.menu', { prefixed: false }), null);
  assert.equal(parseMenuCommand('!menu', { prefixed: false }), null);
});

test('does not swallow unrelated text or lookalike command names', () => {
  for (const text of ['menuister', 'please show menu', '.menu', '.menuish', '.list extra']) {
    assert.equal(parseMenuCommand(text), null);
  }
  assert.equal(parseMenuCommand('.list extra', { prefixed: true }), null);
  assert.equal(parseMenuCommand('.menuish', { prefixed: true }), null);
});