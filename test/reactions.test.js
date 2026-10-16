'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

function loadReactions(source, root) {
  const filename = path.join(root, 'lib', 'reactions.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(source, filename);
  return loaded.exports;
}

test('restores legacy auto-reactions once and keeps a later opt-out', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-reactions-'));
  try {
    const dataDir = path.join(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const dataFile = path.join(dataDir, 'userGroupData.json');
    fs.writeFileSync(dataFile, JSON.stringify({ autoReaction: false, groups: [], chatbot: {} }));
    const source = fs.readFileSync(path.join(__dirname, '../lib/reactions.js'), 'utf8');

    const firstLoad = loadReactions(source, root);
    let saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(saved.autoReaction, true);
    assert.equal(saved.autoReactionRestoreVersion, 1);

    const replies = [];
    await firstLoad.handleAreactCommand(
      { sendMessage: async (...args) => replies.push(args) },
      'owner@s.whatsapp.net',
      { message: { conversation: '.areact off' } },
      true,
    );
    saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.equal(saved.autoReaction, false);

    const secondLoad = loadReactions(source, root);
    let reactionCount = 0;
    await secondLoad.addAllMessageReaction(
      { sendMessage: async () => { reactionCount += 1; } },
      { key: { id: 'message-id', remoteJid: 'group@g.us', fromMe: false } },
    );
    assert.equal(reactionCount, 0);
    assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).autoReaction, false);
    assert.equal(replies.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
