'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-channel-alerts-'));
process.env.SESSION_DIR = sessionDir;

const fakeReactCommand = require('../commands/fakeract');
const channelJid = '120363424782348922@newsletter';

function mockSocket(number) {
   const calls = { follow: [], liveUpdates: [], sent: [], reactions: 0 };
   return {
       calls,
       user: { id: number + '@s.whatsapp.net' },
       async newsletterMetadata(type, inviteCode) {
           assert.equal(type, 'invite');
           assert.equal(inviteCode, 'INVITECODE');
           return { id: channelJid };
       },
       async newsletterFollow(jid) { calls.follow.push(jid); },
       async subscribeNewsletterUpdates(jid) {
           calls.liveUpdates.push(jid);
           return { duration: '86400' };
       },
       async newsletterReactMessage() { calls.reactions += 1; },
       async sendMessage(jid, message) { calls.sent.push({ jid, message }); },
   };
}

test('following and live-update subscription require opt-in from that account', async () => {
   const first = mockSocket('224600000001');
   const second = mockSocket('224600000002');

   await fakeReactCommand(first, 'group', { key: { fromMe: true } }, 'https://whatsapp.com/channel/INVITECODE');

   assert.deepEqual(first.calls.follow, [channelJid]);
   assert.deepEqual(first.calls.liveUpdates, [channelJid]);
   assert.equal(second.calls.follow.length, 0);
   assert.equal(second.calls.liveUpdates.length, 0);
   assert.equal(first.calls.sent.at(-1).jid, '224600000001@s.whatsapp.net');
   assert.match(first.calls.sent.at(-1).message.text, /réception en direct confirmée/i);
});

test('reconnection restores live updates only for an opted-in account', async () => {
   const optedIn = mockSocket('224600000003');
   const other = mockSocket('224600000004');
   await fakeReactCommand(optedIn, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   optedIn.calls.liveUpdates.length = 0;

   assert.equal(await fakeReactCommand.restoreChannelAlerts(optedIn), true);
   assert.deepEqual(optedIn.calls.liveUpdates, [channelJid]);
   assert.equal(optedIn.calls.follow.length, 1);
   assert.equal(await fakeReactCommand.restoreChannelAlerts(other), false);
   assert.equal(other.calls.liveUpdates.length, 0);
});

test('newsletter batches are processed without requiring a message body and are deduplicated', async () => {
   const sock = mockSocket('224600000005');
   await fakeReactCommand(sock, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   sock.calls.sent.length = 0;

   const post = { key: { remoteJid: channelJid, serverMessageId: '987654321', id: '987654321' } };
   const result = await fakeReactCommand.handleChannelMessages(sock, [post, post], 'append');
   assert.deepEqual(result, { received: 2, notified: 1, failed: 0 });
   assert.equal(sock.calls.sent.length, 1);
   assert.equal(sock.calls.sent[0].jid, '224600000005@s.whatsapp.net');
   assert.ok(sock.calls.sent[0].message.text.includes('whatsapp.com/channel/INVITECODE/987654321'));
   assert.equal(sock.calls.reactions, 0);
});

test('off disables channel alerts and reconnect subscription for that account', async () => {
   const sock = mockSocket('224600000006');
   await fakeReactCommand(sock, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   await fakeReactCommand(sock, 'group', null, 'off');
   sock.calls.sent.length = 0;

   const result = await fakeReactCommand.handleChannelMessages(sock, [{
       key: { remoteJid: channelJid, serverMessageId: '123456789', id: '123456789' },
   }], 'append');
   assert.deepEqual(result, { received: 1, notified: 0, failed: 0 });
   assert.equal(await fakeReactCommand.restoreChannelAlerts(sock), false);
   assert.equal(sock.calls.sent.length, 1);
   assert.equal(sock.calls.reactions, 0);
});

test.after(() => {
   fs.rmSync(sessionDir, { recursive: true, force: true });
});
