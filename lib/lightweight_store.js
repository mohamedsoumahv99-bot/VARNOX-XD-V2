/**
 * lightweight_store.js  v2 — store par instance (multi-user)
 *
 * Au lieu d'un singleton partagé, on exporte une factory createStore().
 * Chaque instance bot possède son propre store : pas de mélange de
 * messages/contacts entre utilisateurs différents.
 */
'use strict';

const fs = require('fs');

// Config : nombre max de messages gardés par conversation
let MAX_MESSAGES = 20;
try {
  const settings = require('../settings.js');
  if (settings.maxStoreMessages && typeof settings.maxStoreMessages === 'number') {
    MAX_MESSAGES = settings.maxStoreMessages;
  }
} catch {}

/**
 * Crée un nouveau store indépendant.
 * Appelé une fois par instance bot dans attachBotHandlers.
 */
function createStore() {
  const store = {
    messages : {},
    contacts : {},
    chats    : {},

    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        messages.forEach(msg => {
          if (!msg.key?.remoteJid) return;
          const jid = msg.key.remoteJid;
          this.messages[jid] = this.messages[jid] || [];
          this.messages[jid].push(msg);
          if (this.messages[jid].length > MAX_MESSAGES)
            this.messages[jid] = this.messages[jid].slice(-MAX_MESSAGES);
        });
      });

      ev.on('contacts.update', (contacts) => {
        contacts.forEach(contact => {
          if (contact.id) {
            this.contacts[contact.id] = {
              id   : contact.id,
              name : contact.notify || contact.name || '',
            };
          }
        });
      });

      ev.on('chats.set', (chats) => {
        this.chats = {};
        chats.forEach(chat => {
          this.chats[chat.id] = { id: chat.id, subject: chat.subject || '' };
        });
      });
    },

    async loadMessage(jid, id) {
      return this.messages[jid]?.find(m => m.key.id === id) || null;
    },

    getStats() {
      let totalMessages = 0;
      Object.values(this.messages).forEach(arr => {
        if (Array.isArray(arr)) totalMessages += arr.length;
      });
      return {
        messages          : totalMessages,
        contacts          : Object.keys(this.contacts).length,
        chats             : Object.keys(this.chats).length,
        maxMessagesPerChat: MAX_MESSAGES,
      };
    },
  };

  return store;
}

module.exports = createStore;
