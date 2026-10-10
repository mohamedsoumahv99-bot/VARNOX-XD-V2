'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-fakeract-')), 'state.json');
process.env.FAKERACT_STATE_FILE = stateFile;
const {
    parseChannelLink,
    handleChannelPost,
    handleChannelMessages,
    resumeChannelSubscription
} = require('../commands/fakeract');

test('parses a WhatsApp channel post link into its invite and post ids', () => {
    assert.deepEqual(
        parseChannelLink('https://whatsapp.com/channel/AbCdEf123/987654321'),
        { inviteCode: 'AbCdEf123', serverMessageId: '987654321' }
    );
});

test('does not accept non-channel links or links without a post id', () => {
    assert.equal(parseChannelLink('https://example.com/channel/AbCdEf123/987654321'), null);
    assert.equal(parseChannelLink('https://whatsapp.com/channel/AbCdEf123'), null);
});

test('handles each incoming channel post once, only on the configured bot account', async () => {
    const channelJid = '120363000000000000@newsletter';
    fs.writeFileSync(stateFile, JSON.stringify({
        global: {
            enabled: true,
            channelJid,
            accountNumber: '224669288332',
            nextEmoji: 0,
            reactedPosts: {}
        }
    }));
    const reactions = [];
    const sock = {
        user: { id: '224669288332:7@s.whatsapp.net' },
        newsletterReactMessage: async (...args) => reactions.push(args)
    };
    const post = {
        key: { remoteJid: channelJid, id: '123456789' },
        message: { conversation: 'New channel post' }
    };

    assert.equal(await handleChannelPost(sock, post), true);
    assert.equal(await handleChannelPost(sock, post), false);
    assert.equal(reactions.length, 1);
    assert.equal(reactions[0][0], channelJid);
    assert.equal(reactions[0][1], '123456789');
    assert.equal(typeof reactions[0][2], 'string');

    const otherSock = {
        user: { id: '224610000000:2@s.whatsapp.net' },
        newsletterReactMessage: async (...args) => reactions.push(args)
    };
    assert.equal(await handleChannelPost(otherSock, {
        key: { remoteJid: channelJid, id: '123456790' },
        message: { conversation: 'Another post' }
    }), false);
    assert.equal(reactions.length, 1);
});

test('handles every bodyless newsletter post in a batch and ignores duplicate posts', async () => {
    const channelJid = '120363000000000000@newsletter';
    fs.writeFileSync(stateFile, JSON.stringify({
        global: {
            enabled: true,
            channelJid,
            accountNumber: '224669288332',
            nextEmoji: 0,
            reactedPosts: {}
        }
    }));
    const reactions = [];
    const sock = {
        user: { id: '224669288332:7@s.whatsapp.net' },
        newsletterReactMessage: async (...args) => reactions.push(args)
    };
    const post1 = { key: { remoteJid: channelJid, id: '123456791' } };
    const post2 = { key: { remoteJid: channelJid, id: '123456792' } };

    assert.deepEqual(
        await handleChannelMessages(sock, [post1, post1, post2]),
        { received: 3, reacted: 2, failed: 0 }
    );
    assert.deepEqual(reactions.map(args => args[1]), ['123456791', '123456792']);

    assert.deepEqual(
        await handleChannelMessages(sock, [post1, post2]),
        { received: 2, reacted: 0, failed: 0 }
    );
    assert.equal(reactions.length, 2);
});

test('automatically follows and reacts to the official channel without per-session fakeract state', async () => {
    const officialJid = '120363424782348922@newsletter';
    fs.writeFileSync(stateFile, JSON.stringify({}));
    const reactions = [];
    const follows = [];
    const subscriptions = [];
    const sock = {
        user: { id: '224669288332:7@s.whatsapp.net' },
        newsletterFollow: async jid => follows.push(jid),
        subscribeNewsletterUpdates: async jid => {
            subscriptions.push(jid);
            return { duration: 86400 };
        },
        newsletterReactMessage: async (...args) => reactions.push(args)
    };

    assert.equal(await resumeChannelSubscription(sock, '224669288332'), true);
    assert.deepEqual(follows, [officialJid]);
    assert.deepEqual(subscriptions, [officialJid]);

    const post = { key: { remoteJid: officialJid, id: '123456800' } };
    assert.deepEqual(
        await handleChannelMessages(sock, [post, post]),
        { received: 2, reacted: 1, failed: 0 }
    );
    assert.deepEqual(reactions.map(args => args.slice(0, 2)), [[officialJid, '123456800']]);

    const reconnectedSock = {
        ...sock,
        newsletterReactMessage: async (...args) => reactions.push(args)
    };
    assert.deepEqual(
        await handleChannelMessages(reconnectedSock, [post]),
        { received: 1, reacted: 0, failed: 0 }
    );
    assert.equal(reactions.length, 1);
});

test('explicit fakeract off still disables automatic reactions', async () => {
    const officialJid = '120363424782348922@newsletter';
    fs.writeFileSync(stateFile, JSON.stringify({ global: { enabled: false, disabledAll: true } }));
    let reactionCount = 0;
    const sock = {
        user: { id: '224669288332:7@s.whatsapp.net' },
        newsletterReactMessage: async () => { reactionCount += 1; }
    };
    assert.equal(await handleChannelPost(sock, {
        key: { remoteJid: officialJid, id: '123456801' }
    }), false);
    assert.equal(reactionCount, 0);
});
