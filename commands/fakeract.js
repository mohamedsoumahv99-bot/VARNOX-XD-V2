'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_DIR = path.resolve(process.env.SESSION_DIR || path.join(__dirname, '../sessions'));
const STATE_DIR = path.join(SESSION_DIR, 'channel-alerts');
const AUTOJOIN_STATE_DIR = path.join(SESSION_DIR, 'channel-autojoin');
const REACTION_STATE_DIR = path.join(SESSION_DIR, 'channel-reactions');
const CHANNEL_LINK = new RegExp('^(?:https?://)?(?:www[.]?)?whatsapp[.]com/channel/([^/?# ]+)(?:/([0-9]+))?(?:[/?#].*)?$', 'i');
const REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '👏', '🎉', '💯', '😍', '🤯', '🙏', '✨'];
const PRIMARY_CHANNEL_JID = '120363424782348922@newsletter';
if (process.env.PRIMARY_CHANNEL_JID && process.env.PRIMARY_CHANNEL_JID !== PRIMARY_CHANNEL_JID) {
   console.warn('[auto-join] ignoring PRIMARY_CHANNEL_JID override; official channel is ' + PRIMARY_CHANNEL_JID);
}
const pendingNotifications = new Set();
const pendingReactions = new Set();
const autoJoinTasks = new WeakMap();
const primaryUpdateTasks = new WeakMap();
const primaryUpdateTimers = new WeakMap();
const primaryUpdateGenerations = new WeakMap();

function parseChannelLink(value) {
   const match = String(value || '').trim().match(CHANNEL_LINK);
   if (!match) return null;
   return { inviteCode: match[1] };
}

function accountNumber(sock) {
   return String(sock?.user?.id || sock?.user?.jid || '')
   .split(':')[0]
   .split('@')[0]
   .replace(/[^0-9]/g, '');
}

function maskedAccount(sock) {
   const number = accountNumber(sock);
   if (!number) return 'unknown';
   return number.length > 4 ? number.slice(0, 2) + '***' + number.slice(-2) : '***';
}

function accountStatePath(sock, directory = STATE_DIR) {
   const number = accountNumber(sock);
   if (!number) return null;
   const key = crypto.createHash('sha256').update(number).digest('hex');
   return path.join(directory, key + '.json');
}

function readAccountState(sock, directory, label) {
   const file = accountStatePath(sock, directory);
   if (!file) return {};
   try {
   const value = JSON.parse(fs.readFileSync(file, 'utf8'));
   return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
   } catch (error) {
   if (error.code !== 'ENOENT') {
       console.warn('[' + label + '] state read failed for account=' + maskedAccount(sock) + ': ' + error.message);
   }
   return {};
   }
}

function writeAccountState(sock, directory, state) {
   const file = accountStatePath(sock, directory);
   if (!file) throw new Error('Compte WhatsApp connecté introuvable');
   fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
   const temp = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
   fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
   fs.renameSync(temp, file);
}

function readState(sock) {
   return readAccountState(sock, STATE_DIR, 'channel-alert');
}

function writeState(sock, state) {
   return writeAccountState(sock, STATE_DIR, state);
}

function ownerJid(sock) {
   const id = String(sock?.user?.id || sock?.user?.jid || '').split(':')[0];
   if (!id) return null;
   return id.includes('@') ? id : id.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
}

async function replyPrivately(sock, text) {
   const jid = ownerJid(sock);
   if (!jid) throw new Error('Chat privé du compte connecté introuvable');
   return sock.sendMessage(jid, { text });
}

async function requestLiveUpdates(sock, newsletterJid) {
   if (typeof sock.subscribeNewsletterUpdates !== 'function') {
   throw new Error('La réception des publications en direct n’est pas prise en charge par Baileys');
   }
   const result = await sock.subscribeNewsletterUpdates(newsletterJid);
   const durationSeconds = Number(result?.duration);
   if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
       throw new Error('WhatsApp n’a pas confirmé la souscription aux publications en direct');
   }
   const duration = result?.duration ? ' duration=' + result.duration : '';
   console.info('[channel-alert] live updates subscription returned account=' + maskedAccount(sock) +
   ' channel=' + newsletterJid + duration);
   return result;
}

async function ensurePrimaryChannelFollow(sock) {
   if (!sock || typeof sock !== 'object') throw new Error('Socket WhatsApp absent');
   const existingTask = autoJoinTasks.get(sock);
   if (existingTask) return existingTask;

   const task = Promise.resolve().then(async () => {
   if (!accountNumber(sock)) throw new Error('Compte WhatsApp connecté introuvable');
   const state = readAccountState(sock, AUTOJOIN_STATE_DIR, 'auto-join');
   if (state.channelJid === PRIMARY_CHANNEL_JID && state.requestAcceptedAt) {
       return { status: 'already-acknowledged', channelJid: PRIMARY_CHANNEL_JID };
   }
   if (typeof sock.newsletterFollow !== 'function') {
       throw new Error('newsletterFollow n’est pas disponible dans cette version de Baileys');
   }

   await sock.newsletterFollow(PRIMARY_CHANNEL_JID);
   writeAccountState(sock, AUTOJOIN_STATE_DIR, {
       channelJid: PRIMARY_CHANNEL_JID,
       requestAcceptedAt: Date.now(),
   });
   console.info('[auto-join] WhatsApp acknowledged follow request account=' +
       maskedAccount(sock) + ' channel=' + PRIMARY_CHANNEL_JID);
   return { status: 'acknowledged', channelJid: PRIMARY_CHANNEL_JID };
   });
   autoJoinTasks.set(sock, task);
   return task;
}

function schedulePrimaryUpdatesRenewal(sock, duration) {
   const previous = primaryUpdateTimers.get(sock);
   if (previous) clearTimeout(previous);

   const seconds = Number(duration);
   const delay = Number.isFinite(seconds) && seconds > 0
       ? Math.max(60_000, Math.floor(seconds * 1000 * 0.8))
       : 10 * 60_000;
   const timer = setTimeout(() => {
       primaryUpdateTimers.delete(sock);
       primaryUpdateTasks.delete(sock);
       restorePrimaryChannelUpdates(sock).catch(error => {
           console.warn('[auto-react] live-update renewal failed account=' +
               maskedAccount(sock) + ': ' + error.message);
       });
   }, delay);
   timer.unref?.();
   primaryUpdateTimers.set(sock, timer);
}

function restorePrimaryChannelUpdates(sock) {
   const existingTask = primaryUpdateTasks.get(sock);
   if (existingTask) return existingTask;

   const generation = primaryUpdateGenerations.get(sock) || 0;
   const task = requestLiveUpdates(sock, PRIMARY_CHANNEL_JID)
       .then(result => {
           if ((primaryUpdateGenerations.get(sock) || 0) !== generation) return result;
           schedulePrimaryUpdatesRenewal(sock, result.duration);
           return result;
       })
       .catch(error => {
           primaryUpdateTasks.delete(sock);
           throw error;
       });
   primaryUpdateTasks.set(sock, task);
   return task;
}

function stopPrimaryChannelUpdates(sock) {
   primaryUpdateGenerations.set(sock, (primaryUpdateGenerations.get(sock) || 0) + 1);
   const timer = primaryUpdateTimers.get(sock);
   if (timer) clearTimeout(timer);
   primaryUpdateTimers.delete(sock);
   primaryUpdateTasks.delete(sock);
}

async function restorePrimaryChannel(sock) {
   const follow = await ensurePrimaryChannelFollow(sock);
   const updates = await restorePrimaryChannelUpdates(sock);
   return { follow, updates };
}

async function restoreChannelAlerts(sock) {
   const state = readState(sock);
   if (!state.enabled || !state.channelJid) return false;
   state.liveUpdatesState = 'pending';
   writeState(sock, state);
   try {
   if (state.channelJid === PRIMARY_CHANNEL_JID) {
       await restorePrimaryChannelUpdates(sock);
   } else {
       await requestLiveUpdates(sock, state.channelJid);
   }
   state.liveUpdatesState = 'active';
   state.lastLiveUpdatesAt = Date.now();
   delete state.liveUpdatesError;
   writeState(sock, state);
   return true;
   } catch (error) {
   state.liveUpdatesState = 'pending';
   state.liveUpdatesError = error.message;
   writeState(sock, state);
   throw error;
   }
}

async function fakeReactCommand(sock, _chatId, _message, rawArgs = '') {
   const owner = ownerJid(sock);
   if (!owner) {
   await replyPrivately(sock, '❌ Compte WhatsApp connecté introuvable.');
   return;
   }

   const value = String(rawArgs || '').trim();
   const command = value.toLowerCase();
   const state = readState(sock);

   if (command === 'off') {
   state.enabled = false;
   state.liveUpdatesState = 'disabled';
   state.disabledAt = Date.now();
   writeState(sock, state);
   await replyPrivately(sock, '✅ Les notifications de chaîne sont désactivées pour ce compte.');
   return;
   }

   if (command === 'status') {
   const status = state.enabled
       ? '📡 Notifications actives pour ' + (state.channelJid || 'la chaîne configurée') +
           '. Réception en direct : ' + (state.liveUpdatesState === 'active' ? 'confirmée.' : 'en attente de confirmation.')
       : 'ℹ️ Aucune notification de chaîne active sur ce compte.';
   await replyPrivately(sock, status);
   return;
   }

   const target = parseChannelLink(value.trim().split(' ')[0]);
   if (!target) {
   await replyPrivately(
       sock,
       'Utilise .channelalert <lien de chaîne WhatsApp> pour activer le suivi sur ce compte.\n' +
       'Alias : .fakeract <lien>\n' +
       'Commandes : .channelalert status | .channelalert off'
   );
   return;
   }

   if (typeof sock.newsletterMetadata !== 'function') {
   await replyPrivately(sock, '❌ Cette version de Baileys ne permet pas de vérifier les chaînes WhatsApp.');
   return;
   }

   try {
   const metadata = await sock.newsletterMetadata('invite', target.inviteCode);
   const newsletterJid = metadata?.id || metadata?.jid;
   if (!newsletterJid || !newsletterJid.endsWith('@newsletter')) throw new Error('Chaîne introuvable ou JID invalide');
   if (typeof sock.newsletterFollow !== 'function') {
       throw new Error('Le suivi des chaînes n’est pas pris en charge par cette version de Baileys');
   }

   if (newsletterJid === PRIMARY_CHANNEL_JID) {
       await ensurePrimaryChannelFollow(sock);
   } else {
       await sock.newsletterFollow(newsletterJid);
   }
   const nextState = {
       enabled: true,
       inviteCode: target.inviteCode,
       channelJid: newsletterJid,
       sentPosts: [],
       configuredAt: Date.now(),
       liveUpdatesState: 'pending',
   };
   writeState(sock, nextState);

   try {
       if (newsletterJid === PRIMARY_CHANNEL_JID) {
           await restorePrimaryChannelUpdates(sock);
       } else {
           await requestLiveUpdates(sock, newsletterJid);
       }
       nextState.liveUpdatesState = 'active';
       nextState.lastLiveUpdatesAt = Date.now();
       writeState(sock, nextState);
       await replyPrivately(sock, '✅ Chaîne suivie et réception en direct confirmée pour ce compte. Chaque nouvelle publication suivie sera signalée en privé.');
   } catch (error) {
       nextState.liveUpdatesState = 'pending';
       nextState.liveUpdatesError = error.message;
       writeState(sock, nextState);
       console.error('[channel-alert] follow succeeded but live updates were not confirmed account=' + maskedAccount(sock) +
           ' channel=' + newsletterJid + ': ' + error.message);
       await replyPrivately(sock, '✅ Chaîne suivie. ⚠️ Baileys n’a pas confirmé la réception en direct; elle sera réessayée à la prochaine reconnexion. Consulte les journaux si le problème persiste.');
   }
   } catch (error) {
   console.error('[channel-alert] activation failed account=' + maskedAccount(sock) + ': ' + error.message);
   await replyPrivately(sock, '❌ Impossible d’activer le suivi de cette chaîne : ' + error.message);
   }
}

async function handleChannelPost(sock, message) {
   const remoteJid = message?.key?.remoteJid;
   if (!remoteJid?.endsWith('@newsletter')) return false;

   const config = readState(sock);
   if (!config.enabled || config.channelJid !== remoteJid) return false;

   const serverMessageId = String(
   message.key.serverMessageId ||
   message.key.serverId ||
   message.key.server_id ||
   message.message?.messageContextInfo?.serverMessageId ||
   message.message?.messageContextInfo?.serverId ||
   message.message?.newsletterMessage?.serverMessageId ||
   (/^[0-9]+$/.test(String(message.key.id || '')) ? message.key.id : '') ||
   ''
   );
   const postKey = serverMessageId || String(message.key.id || '');
   if (!postKey) {
   console.warn('[channel-alert] newsletter post skipped: no usable message id account=' + maskedAccount(sock) + ' channel=' + remoteJid);
   return false;
   }

   const accountKey = crypto.createHash('sha256').update(accountNumber(sock)).digest('hex');
   const eventKey = accountKey + ':' + remoteJid + ':' + postKey;
   const sentPosts = Array.isArray(config.sentPosts) ? config.sentPosts : [];
   if (pendingNotifications.has(eventKey) || sentPosts.includes(postKey)) return false;
   pendingNotifications.add(eventKey);
   try {
   config.sentPosts = [...sentPosts, postKey].slice(-100);
   writeState(sock, config);
   const postUrl = 'https://whatsapp.com/channel/' + config.inviteCode +
       (/^[0-9]+$/.test(serverMessageId) ? '/' + serverMessageId : '');
   try {
       await replyPrivately(sock, '📢 Nouvelle publication sur la chaîne suivie.\n\nOuvrir : ' + postUrl);
   } catch (error) {
       const current = readState(sock);
       current.sentPosts = (Array.isArray(current.sentPosts) ? current.sentPosts : []).filter(id => id !== postKey);
       writeState(sock, current);
       throw error;
   }
   console.info('[channel-alert] private post alert sent account=' + maskedAccount(sock) +
       ' channel=' + remoteJid + ' post=' + postKey);
   return true;
   } finally {
   pendingNotifications.delete(eventKey);
   }
}

async function reactToPrimaryChannelPost(sock, message) {
   const channelJid = message?.key?.remoteJid;
   if (channelJid !== PRIMARY_CHANNEL_JID) return false;

   // Baileys rc14 sets key.server_id from the newsletter stanza. Its legacy
   // newsletter-notification path puts the same message_id in key.id instead.
   const keyId = String(message?.key?.id || '');
   const serverMessageId = String(
       message?.key?.server_id || (/^[0-9]+$/.test(keyId) ? keyId : '')
   ).trim();
   if (!serverMessageId) {
       console.warn('[auto-react] newsletter post skipped: Baileys did not provide key.server_id account=' +
           maskedAccount(sock) + ' channel=' + channelJid);
       return false;
   }
   if (typeof sock.newsletterReactMessage !== 'function') {
       throw new Error('newsletterReactMessage n’est pas disponible dans cette version de Baileys');
   }

   const accountKey = crypto.createHash('sha256').update(accountNumber(sock)).digest('hex');
   const eventKey = accountKey + ':' + channelJid + ':' + serverMessageId;
   if (pendingReactions.has(eventKey)) return false;

   const state = readAccountState(sock, REACTION_STATE_DIR, 'auto-react');
   const attempts = Array.isArray(state.attempts) ? state.attempts : [];
   if (attempts.some(attempt => attempt?.serverMessageId === serverMessageId)) return false;

   pendingReactions.add(eventKey);
   try {
       const attempt = { serverMessageId, status: 'pending', attemptedAt: Date.now() };
       state.attempts = [...attempts, attempt];
       const nextEmoji = Number.isInteger(state.nextEmoji) ? state.nextEmoji : 0;
       const emoji = REACTIONS[nextEmoji % REACTIONS.length];
       state.nextEmoji = (nextEmoji + 1) % REACTIONS.length;
       writeAccountState(sock, REACTION_STATE_DIR, state);

       try {
           await sock.newsletterReactMessage(channelJid, serverMessageId, emoji);
       } catch (error) {
           const latest = readAccountState(sock, REACTION_STATE_DIR, 'auto-react');
           const latestAttempts = Array.isArray(latest.attempts) ? latest.attempts : [];
           const current = latestAttempts.find(item => item?.serverMessageId === serverMessageId);
           if (current) {
               current.status = 'failed';
               current.error = String(error?.message || error).slice(0, 200);
               try {
                   writeAccountState(sock, REACTION_STATE_DIR, latest);
               } catch (stateError) {
                   console.error('[auto-react] could not persist failed attempt account=' +
                       maskedAccount(sock) + ' post=' + serverMessageId + ': ' + stateError.message);
               }
           }
           throw error;
       }

       const latest = readAccountState(sock, REACTION_STATE_DIR, 'auto-react');
       const latestAttempts = Array.isArray(latest.attempts) ? latest.attempts : [];
       const current = latestAttempts.find(item => item?.serverMessageId === serverMessageId);
       if (current) {
           current.status = 'acknowledged';
           current.acknowledgedAt = Date.now();
           try {
               writeAccountState(sock, REACTION_STATE_DIR, latest);
           } catch (stateError) {
               console.error('[auto-react] WhatsApp acknowledged reaction but state write failed account=' +
                   maskedAccount(sock) + ' post=' + serverMessageId + ': ' + stateError.message);
           }
       }
       console.info('[auto-react] WhatsApp acknowledged reaction request account=' +
           maskedAccount(sock) + ' channel=' + channelJid + ' post=' + serverMessageId);
       return true;
   } finally {
       pendingReactions.delete(eventKey);
   }
}

async function handleChannelMessages(sock, messages, upsertType) {
   const posts = (Array.isArray(messages) ? messages : [])
   .filter(message => message?.key?.remoteJid?.endsWith('@newsletter'));
   let notified = 0;
   let reacted = 0;
   let failed = 0;

   for (const message of posts) {
   const channelJid = message.key.remoteJid;
   const messageId = String(message.key.serverMessageId || message.key.id || 'unknown');
   const state = readState(sock);
   if (channelJid === PRIMARY_CHANNEL_JID || (state.enabled && state.channelJid === channelJid)) {
       console.info('[channel-alert] newsletter post received account=' + maskedAccount(sock) +
           ' channel=' + channelJid + ' post=' + messageId + ' upsert=' + String(upsertType || 'unknown'));
   }
   try {
       if (await reactToPrimaryChannelPost(sock, message)) reacted += 1;
   } catch (error) {
       failed += 1;
       console.error('[auto-react] reaction failed account=' + maskedAccount(sock) +
           ' channel=' + channelJid + ' post=' + messageId + ': ' + error.message);
   }
   try {
       if (await handleChannelPost(sock, message)) notified += 1;
   } catch (error) {
       failed += 1;
       console.error('[channel-alert] post handling failed account=' + maskedAccount(sock) +
           ' channel=' + channelJid + ' post=' + messageId + ': ' + error.message);
   }
   }

   return { received: posts.length, notified, reacted, failed };
}

module.exports = fakeReactCommand;
module.exports.handleChannelPost = handleChannelPost;
module.exports.handleChannelMessages = handleChannelMessages;
module.exports.restoreChannelAlerts = restoreChannelAlerts;
module.exports.parseChannelLink = parseChannelLink;
module.exports.ensurePrimaryChannelFollow = ensurePrimaryChannelFollow;
module.exports.restorePrimaryChannel = restorePrimaryChannel;
module.exports.stopPrimaryChannelUpdates = stopPrimaryChannelUpdates;
