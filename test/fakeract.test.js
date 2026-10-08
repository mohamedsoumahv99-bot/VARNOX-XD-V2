'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'varnox-fakeract-')), 'state.json');
process.env.FAKERACT_STATE_FILE = stateFile;
const { parseChannelLink } = require('../commands/fakeract');
const { handleChannelPost } = require('../commands/fakeract');

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
