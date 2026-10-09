'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-channel-alerts-'));
process.env.SESSION_DIR = sessionDir;

const fakeReactCommand = require('../commands/fakeract');
const channelJid = '120363000000000000@newsletter';

function mockSocket(number) {
    const calls = { follow: [], sent: [], reactions: 0 };
    return {
        calls,
        user: { id: `${number}@s.whatsapp.net` },
        async newsletterMetadata(type, inviteCode) {
            assert.equal(type, 'invite');
            assert.equal(inviteCode, 'INVITECODE');
            return { id: channelJid };
        },
        async newsletterFollow(jid) { calls.follow.push(jid); },
        async newsletterReactMessage() { calls.reactions += 1; },
        async sendMessage(jid, message) { calls.sent.push({ jid, message }); },
    };
}

test('channel following is explicitly enabled for only the issuing account', async () => {
    const first = mockSocket('224600000001');
    const second = mockSocket('224600000002');

    await fakeReactCommand(
        first,
        '120363000000000000@g.us',
        { key: { fromMe: true } },
        'https://whatsapp.com/channel/INVITECODE',
    );

    assert.deepEqual(first.calls.follow, [channelJid]);
    assert.equal(second.calls.follow.length, 0);
    assert.equal(first.calls.sent.at(-1).jid, '224600000001@s.whatsapp.net');
    assert.match(first.calls.sent.at(-1).message.text, /aucune réaction automatique/i);
});

test('a followed post generates one private alert and never a reaction', async () => {
    const sock = mockSocket('224600000003');
    await fakeReactCommand(sock, 'chat', null, 'https://whatsapp.com/channel/INVITECODE');
    sock.calls.sent.length = 0;

    const post = {
        key: {
            remoteJid: channelJid,
            serverMessageId: '987654321',
            id: '987654321',
        },
        message: { conversation: 'Publication de test' },
    };

    assert.equal(await fakeReactCommand.handleChannelPost(sock, post), true);
    assert.equal(await fakeReactCommand.handleChannelPost(sock, post), false);
    assert.equal(sock.calls.sent.length, 1);
    assert.equal(sock.calls.sent[0].jid, '224600000003@s.whatsapp.net');
    assert.match(sock.calls.sent[0].message.text, /whatsapp\.com\/channel\/INVITECODE\/987654321/);
    assert.equal(sock.calls.reactions, 0);
});

test('off disables alerts for that account', async () => {
    const sock = mockSocket('224600000004');
    await fakeReactCommand(sock, 'chat', null, 'https://whatsapp.com/channel/INVITECODE');
    await fakeReactCommand(sock, 'chat', null, 'off');
    sock.calls.sent.length = 0;

    assert.equal(await fakeReactCommand.handleChannelPost(sock, {
        key: { remoteJid: channelJid, serverMessageId: '123456789', id: '123456789' },
        message: { conversation: 'Publication de test' },
    }), false);
    assert.equal(sock.calls.sent.length, 0);
    assert.equal(sock.calls.reactions, 0);
});

test.after(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
});
