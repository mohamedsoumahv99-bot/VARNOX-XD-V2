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
   const calls = { follow: [], liveUpdates: [], sent: [], reactions: 0, reactionRequests: [] };
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
       async newsletterReactMessage(...args) {
           calls.reactions += 1;
           calls.reactionRequests.push(args);
       },
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
   fakeReactCommand.stopPrimaryChannelUpdates(first);
});

test('reconnection restores live updates only for an opted-in account', async () => {
   const optedIn = mockSocket('224600000003');
   const other = mockSocket('224600000004');
   await fakeReactCommand(optedIn, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   const reconnected = mockSocket('224600000003');

   assert.equal(await fakeReactCommand.restoreChannelAlerts(reconnected), true);
   assert.deepEqual(reconnected.calls.liveUpdates, [channelJid]);
   assert.equal(optedIn.calls.follow.length, 1);
   assert.equal(reconnected.calls.follow.length, 0);
   assert.equal(await fakeReactCommand.restoreChannelAlerts(other), false);
   assert.equal(other.calls.liveUpdates.length, 0);
   fakeReactCommand.stopPrimaryChannelUpdates(optedIn);
   fakeReactCommand.stopPrimaryChannelUpdates(reconnected);
});

test('newsletter append batches are reacted to once and retain opt-in private alerts', async () => {
   const sock = mockSocket('224600000005');
   await fakeReactCommand(sock, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   sock.calls.sent.length = 0;

   const post = { key: { remoteJid: channelJid, server_id: '987654321', serverMessageId: '987654321', id: '987654321' } };
   const result = await fakeReactCommand.handleChannelMessages(sock, [post, post], 'append');
   assert.deepEqual(result, { received: 2, notified: 1, reacted: 1, failed: 0 });
   assert.equal(sock.calls.sent.length, 1);
   assert.equal(sock.calls.sent[0].jid, '224600000005@s.whatsapp.net');
   assert.ok(sock.calls.sent[0].message.text.includes('whatsapp.com/channel/INVITECODE/987654321'));
   assert.equal(sock.calls.reactions, 1);
   assert.deepEqual(sock.calls.reactionRequests[0], [channelJid, '987654321', '❤️']);
   fakeReactCommand.stopPrimaryChannelUpdates(sock);
});

test('off disables channel alerts and reconnect subscription for that account', async () => {
   const sock = mockSocket('224600000006');
   await fakeReactCommand(sock, 'group', null, 'https://whatsapp.com/channel/INVITECODE');
   await fakeReactCommand(sock, 'group', null, 'off');
   assert.match(sock.calls.sent.at(-1).message.text, /désactivées/i);
   sock.calls.sent.length = 0;

   const result = await fakeReactCommand.handleChannelMessages(sock, [{
       key: { remoteJid: channelJid, server_id: '123456789', serverMessageId: '123456789', id: '123456789' },
   }], 'append');
   assert.deepEqual(result, { received: 1, notified: 0, reacted: 1, failed: 0 });
   assert.equal(await fakeReactCommand.restoreChannelAlerts(sock), false);
   assert.equal(sock.calls.sent.length, 0);
   assert.equal(sock.calls.reactions, 1);
   fakeReactCommand.stopPrimaryChannelUpdates(sock);
});

test('does not claim live notifications when Baileys gives no subscription confirmation', async () => {
   const sock = mockSocket('224600000007');
   sock.subscribeNewsletterUpdates = async jid => { sock.calls.liveUpdates.push(jid); return null; };

   await fakeReactCommand(sock, 'group', null, 'https://whatsapp.com/channel/INVITECODE');

   assert.deepEqual(sock.calls.follow, [channelJid]);
   assert.deepEqual(sock.calls.liveUpdates, [channelJid]);
   assert.match(sock.calls.sent.at(-1).message.text, /pas confirmé/i);
   assert.doesNotMatch(sock.calls.sent.at(-1).message.text, /réception en direct confirmée/i);
   fakeReactCommand.stopPrimaryChannelUpdates(sock);
});

test('official channel follow is acknowledged once per account and live updates renew per socket', async () => {
   const first = mockSocket('224600000008');
   const firstResult = await fakeReactCommand.restorePrimaryChannel(first);

   assert.equal(firstResult.follow.status, 'acknowledged');
   assert.deepEqual(first.calls.follow, [channelJid]);
   assert.deepEqual(first.calls.liveUpdates, [channelJid]);

   const reconnected = mockSocket('224600000008');
   const reconnectResult = await fakeReactCommand.restorePrimaryChannel(reconnected);
   assert.equal(reconnectResult.follow.status, 'already-acknowledged');
   assert.deepEqual(reconnected.calls.follow, []);
   assert.deepEqual(reconnected.calls.liveUpdates, [channelJid]);

   fakeReactCommand.stopPrimaryChannelUpdates(first);
   fakeReactCommand.stopPrimaryChannelUpdates(reconnected);
});

test('automatic reactions use Baileys key.server_id and persist deduplication across sockets', async () => {
   const sock = mockSocket('224600000009');
   const post = {
       key: { remoteJid: channelJid, id: 'message-id', server_id: '987654322' },
   };

   assert.deepEqual(
       await fakeReactCommand.handleChannelMessages(sock, [post, post], 'append'),
       { received: 2, notified: 0, reacted: 1, failed: 0 },
   );
   assert.deepEqual(sock.calls.reactionRequests, [[channelJid, '987654322', '❤️']]);

   const reconnected = mockSocket('224600000009');
   assert.deepEqual(
       await fakeReactCommand.handleChannelMessages(reconnected, [post], 'append'),
       { received: 1, notified: 0, reacted: 0, failed: 0 },
   );
   assert.deepEqual(reconnected.calls.reactionRequests, []);
});

test('automatic reactions accept only newsletter server ids, including Baileys numeric key.id fallback', async () => {
   const sock = mockSocket('224600000011');
   const result = await fakeReactCommand.handleChannelMessages(sock, [{
       key: { remoteJid: channelJid, id: '987654324' },
   }], 'append');
   assert.deepEqual(result, { received: 1, notified: 0, reacted: 1, failed: 0 });
   assert.deepEqual(sock.calls.reactionRequests, [[channelJid, '987654324', '❤️']]);

   const unusable = mockSocket('224600000012');
   const skipped = await fakeReactCommand.handleChannelMessages(unusable, [{
       key: { remoteJid: channelJid, id: 'not-a-server-id' },
   }], 'append');
   assert.deepEqual(skipped, { received: 1, notified: 0, reacted: 0, failed: 0 });
   assert.deepEqual(unusable.calls.reactionRequests, []);
});

test('failed autojoin is not reported as successful and can be retried on a replacement socket', async () => {
   const disconnected = mockSocket('224600000013');
   disconnected.newsletterFollow = async jid => {
       disconnected.calls.follow.push(jid);
       throw new Error('WhatsApp rejected follow request');
   };
   await assert.rejects(
       fakeReactCommand.ensurePrimaryChannelFollow(disconnected),
       /rejected follow request/,
   );
   assert.deepEqual(disconnected.calls.follow, [channelJid]);

   const replacement = mockSocket('224600000013');
   const result = await fakeReactCommand.ensurePrimaryChannelFollow(replacement);
   assert.equal(result.status, 'acknowledged');
   assert.deepEqual(replacement.calls.follow, [channelJid]);
});

test('failed reaction requests are logged as failed and are not retried for the same post', async () => {
   const sock = mockSocket('224600000010');
   sock.newsletterReactMessage = async (...args) => {
       sock.calls.reactionRequests.push(args);
       throw new Error('WhatsApp rejected the reaction');
   };
   const post = {
       key: { remoteJid: channelJid, id: 'message-id', server_id: '987654323' },
   };

   assert.deepEqual(
       await fakeReactCommand.handleChannelMessages(sock, [post], 'append'),
       { received: 1, notified: 0, reacted: 0, failed: 1 },
   );
   assert.deepEqual(
       await fakeReactCommand.handleChannelMessages(sock, [post], 'append'),
       { received: 1, notified: 0, reacted: 0, failed: 0 },
   );
   assert.equal(sock.calls.reactionRequests.length, 1);
});

test.after(() => {
   fs.rmSync(sessionDir, { recursive: true, force: true });
});
