const axios = require('axios');
const { sleep } = require('../lib/myfunc');
const settings = require('../settings');

/**
 * Commande .pair — Génère un code de jumelage WhatsApp
 * Utilise l'API /code du panneau web VARNOX XD V2
 */
async function pairCommand(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: `📱 *VARNOX XD V2 — Pair Code*\n\nUtilisation: *.pair <numéro>*\nExemple: *.pair 224610835573*\n\nOu visite le panneau web:\n${settings.pairApiUrl}`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363424782348922@newsletter',
                        newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                        serverMessageId: -1
                    }
                }
            });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length > 5 && v.length < 20);

        if (numbers.length === 0) {
            return await sock.sendMessage(chatId, {
                text: '❌ Numéro invalide. Format: *.pair 224610835573*',
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363424782348922@newsletter',
                        newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                        serverMessageId: -1
                    }
                }
            });
        }

        for (const number of numbers) {
            // Vérifier que le numéro est sur WhatsApp
            const whatsappID = number + '@s.whatsapp.net';
            const result = await sock.onWhatsApp(whatsappID).catch(() => []);

            if (!result[0]?.exists) {
                await sock.sendMessage(chatId, {
                    text: `❌ Le numéro *${number}* n'est pas enregistré sur WhatsApp.`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363424782348922@newsletter',
                            newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                            serverMessageId: -1
                        }
                    }
                });
                continue;
            }

            await sock.sendMessage(chatId, {
                text: `⏳ Génération du code pour *${number}*...\nPatientez ~10 secondes.`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363424782348922@newsletter',
                        newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                        serverMessageId: -1
                    }
                }
            });

            try {
                // Appel à notre propre API Vercel (plus fiable qu'un service tiers)
                const apiUrl = `${settings.pairApiUrl}/code?number=${number}`;
                const response = await axios.get(apiUrl, { timeout: 35000 });

                if (response.data?.code && !response.data?.error) {
                    const code = response.data.code;
                    await sleep(2000);
                    await sock.sendMessage(chatId, {
                        text: `✅ *Code de jumelage WhatsApp*\n\n🔑 Code: *${code}*\n\n📱 Comment utiliser:\n1. Ouvre WhatsApp\n2. Paramètres → Appareils connectés\n3. Lier un appareil → Lier avec numéro de téléphone\n4. Entre le code ci-dessus\n\n⚠️ Le code expire en quelques minutes.`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363424782348922@newsletter',
                                newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                                serverMessageId: -1
                            }
                        }
                    });
                } else {
                    throw new Error(response.data?.message || 'Réponse invalide');
                }
            } catch (apiError) {
                console.error('[pair.js] Erreur API:', apiError.message);
                await sock.sendMessage(chatId, {
                    text: `❌ Impossible de générer le code: ${apiError.message}\n\nEssaie directement sur:\n${settings.pairApiUrl}`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363424782348922@newsletter',
                            newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                            serverMessageId: -1
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error('[pair.js] Erreur générale:', error);
        await sock.sendMessage(chatId, {
            text: "❌ Une erreur s'est produite. Réessayez ou visite: " + settings.pairApiUrl,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363424782348922@newsletter',
                    newsletterName: '𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2',
                    serverMessageId: -1
                }
            }
        });
    }
}

module.exports = pairCommand;
