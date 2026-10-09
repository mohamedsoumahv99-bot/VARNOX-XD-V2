'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const isOwnerOrSudo = require('../lib/isOwner');

test('only the fixed primary number is recognized as the owner', async () => {
    assert.equal(await isOwnerOrSudo.isPrimaryOwner('224669288332@s.whatsapp.net'), true);
    assert.equal(await isOwnerOrSudo.isPrimaryOwner('+224 669 288 332'), true);
    assert.equal(await isOwnerOrSudo.isPrimaryOwner('224610835573@s.whatsapp.net'), false);
});

test('resolves the primary owner from a WhatsApp LID in a group', async () => {
    const sock = {
        groupMetadata: async () => ({
            participants: [{
                id: '123456789@lid',
                phoneNumber: '224669288332@s.whatsapp.net'
            }]
        })
    };
    assert.equal(
        await isOwnerOrSudo.isPrimaryOwner('123456789@lid', sock, 'test-group@g.us'),
        true
    );
});
