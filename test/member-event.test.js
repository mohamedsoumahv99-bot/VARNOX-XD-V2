'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildGoodbyeMessage,
  buildWelcomeMessage,
  formatConakryDate,
  getMemberCount,
  memberCountAfterChange,
  participantNumber,
  sendMemberEvent,
} = require('../lib/memberEvent');

test('formats event timestamps in the Conakry timezone', () => {
  assert.equal(formatConakryDate(new Date('2026-10-15T12:54:59.000Z')), '2026-10-15 12:54:59');
});

test('uses the participant phone number when the group update has a LID', () => {
  assert.equal(participantNumber({ id: '12345@lid', phoneNumber: '224610835573@s.whatsapp.net' }), '224610835573');
});

test('calculates post-join and post-leave counts without double-counting JID aliases', () => {
  const departing = { id: '224610835573@lid', phoneNumber: '224610835573@s.whatsapp.net' };
  const existing = [{ id: '224600000000@s.whatsapp.net' }, departing];
  assert.equal(memberCountAfterChange(existing, [departing], 'remove'), 1);
  assert.equal(memberCountAfterChange(existing.slice(0, 1), [departing], 'remove'), 1);
  assert.equal(memberCountAfterChange(existing.slice(0, 1), [departing], 'add'), 2);
});

test('uses current group metadata to calculate membership after a join', async () => {
  const count = await getMemberCount({ groupMetadata: async () => ({ participants: [{ id: '224600000000@s.whatsapp.net' }] }) }, 'group@g.us', ['224610835573@s.whatsapp.net'], 'add');
  assert.equal(count, 2);
});

test('renders the requested welcome and goodbye templates', () => {
  const shared = { senderNum: '224610835573', groupName: 'VARNOX Test', memberCount: 17, date: new Date('2026-10-15T12:54:59.000Z') };
  const welcome = buildWelcomeMessage(shared);
  const goodbye = buildGoodbyeMessage(shared);
  assert.match(welcome, /\*〔 NEW MEMBER 〕\*/);
  assert.match(welcome, /\*▢  WELCOME\* 🎉🎊/);
  assert.match(welcome, /\*▢ DATE :\* 2026-10-15 12:54:59/);
  assert.match(welcome, /\*▢ Members :\* 17/);
  assert.match(welcome, /> powerde by vArnox_Tech/);
  assert.match(goodbye, /\*〔 OLD  MEMBER 〕\*/);
  assert.match(goodbye, /\*▢  👋GOODBYE 👋\*/);
  assert.match(goodbye, /\*▢ DATE :\* 2026-10-15 12:54:59/);
  assert.match(goodbye, /\*▢ Members :\* 17/);
  assert.match(goodbye, /> powered by vArnox_tech/);
});

test('sends a text fallback with official-channel forwarding context when the photo is unavailable', async () => {
  const calls = [];
  const sock = {
    profilePictureUrl: async () => { throw new Error('not available'); },
    sendMessage: async (...args) => calls.push(args),
  };
  await sendMemberEvent(sock, 'group@g.us', '224610835573@s.whatsapp.net', 'Welcome');
  assert.equal(calls[0][1].text, 'Welcome');
  assert.equal(calls[0][1].contextInfo.isForwarded, true);
  assert.equal(calls[0][1].contextInfo.forwardedNewsletterMessageInfo.newsletterJid, '120363424782348922@newsletter');
});
