const { igdl } = require("ruhend-scraper");
const { commandInput, isHttpUrl } = require('../lib/downloadUtils');

// Store processed message IDs to prevent duplicates
const processedMessages = new Set();

// Function to extract unique media URLs with simple deduplication
function extractUniqueMedia(mediaData) {
    const uniqueMedia = [];
    const seenUrls = new Set();
    
    for (const media of mediaData) {
        if (!media.url) continue;
        
        // Only check for exact URL duplicates
        if (!seenUrls.has(media.url)) {
            seenUrls.add(media.url);
            uniqueMedia.push(media);
        }
    }
    
    return uniqueMedia;
}

// Function to validate media URL
function isValidMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Accept any URL that looks like media
    return url.includes('cdninstagram.com') || 
           url.includes('instagram') || 
           url.includes('http');
}

async function instagramCommand(sock, chatId, message) {
    try {
        // Check if message has already been processed
        const messageId = message.key?.id;
        if (messageId && processedMessages.has(messageId)) {
            return;
        }
        
        // Add message ID to processed set
        if (messageId) processedMessages.add(messageId);
        
        // Clean up old message IDs after 5 minutes
        setTimeout(() => {
            if (messageId) processedMessages.delete(messageId);
        }, 5 * 60 * 1000);

        const url = commandInput(message);
        
        if (!url) {
            return await sock.sendMessage(chatId, { 
                text: "Please provide an Instagram link for the video."
            });
        }

        // Check for various Instagram URL formats
        const instagramPatterns = [
            /https?:\/\/(?:www\.)?instagram\.com\//,
            /https?:\/\/(?:www\.)?instagr\.am\//,
            /https?:\/\/(?:www\.)?instagram\.com\/p\//,
            /https?:\/\/(?:www\.)?instagram\.com\/reel\//,
            /https?:\/\/(?:www\.)?instagram\.com\/tv\//
        ];

        const isValidUrl = isHttpUrl(url) && instagramPatterns.some(pattern => pattern.test(url));
        
        if (!isValidUrl) {
            return await sock.sendMessage(chatId, { 
                text: "That is not a valid Instagram link. Please provide a valid Instagram post, reel, or video link."
            });
        }

        await sock.sendMessage(chatId, {
            react: { text: '🔄', key: message.key }
        });

        // Pass only the URL to the scraper; passing ".instagram <url>" makes
        // some scraper versions reject an otherwise valid post.
        const downloadData = await igdl(url);
        
        if (!downloadData || !downloadData.data || downloadData.data.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: "❌ No media found at the provided link. The post might be private or the link is invalid."
            });
        }

        const mediaData = downloadData.data;
        
        // Simple deduplication - just remove exact URL duplicates
        const uniqueMedia = extractUniqueMedia(mediaData);
        
        // Limit to maximum 20 unique media items
        const mediaToDownload = uniqueMedia.slice(0, 20);
        
        if (mediaToDownload.length === 0) {
            return await sock.sendMessage(chatId, { 
                text: "❌ No valid media found to download. This might be a private post or the scraper failed."
            });
        }

        // Download all media silently without status messages
        for (let i = 0; i < mediaToDownload.length; i++) {
            try {
                const media = mediaToDownload[i];
                const mediaUrl = media.url;

                // Check if URL ends with common video extensions
                const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(mediaUrl) || 
                              media.type === 'video' || 
                              url.includes('/reel/') ||
                              url.includes('/tv/');

                if (isVideo) {
                    await sock.sendMessage(chatId, {
                        video: { url: mediaUrl },
                        mimetype: "video/mp4",
                        caption: "𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2"
                    }, { quoted: message });
                } else {
                    await sock.sendMessage(chatId, {
                        image: { url: mediaUrl },
                        caption: "𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 𝗩𝗔𝗥𝗡𝗢𝗫 𝗫𝗗 𝗩2"
                    }, { quoted: message });
                }
                
                // Add small delay between downloads to prevent rate limiting
                if (i < mediaToDownload.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (mediaError) {
                console.error(`Error downloading media ${i + 1}:`, mediaError);
                // Continue with next media if one fails
            }
        }

    } catch (error) {
        console.error('Error in Instagram command:', error);
        await sock.sendMessage(chatId, { 
            text: "❌ Une erreur est survenue lors de processing the Instagram request. Veuillez réessayer."
        });
    }
}

module.exports = instagramCommand;
