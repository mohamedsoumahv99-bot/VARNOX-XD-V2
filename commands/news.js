const axios = require('axios');

module.exports = async function (sock, chatId) {
    try {
        let articles;
        if (process.env.NEWS_API_KEY) {
            const response = await axios.get('https://newsapi.org/v2/top-headlines', {
                params: { country: process.env.NEWS_COUNTRY || 'us', apiKey: process.env.NEWS_API_KEY },
                timeout: 10000
            });
            articles = response.data.articles;
        } else {
            const response = await axios.get(
                'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=5',
                { timeout: 10000 }
            );
            articles = (response.data.hits || []).map(item => ({
                title: item.title,
                description: item.url || 'Open the Hacker News discussion',
            }));
        }
        articles = articles.filter(article => article.title).slice(0, 5);
        let newsMessage = '📰 *Latest News*:\n\n';
        articles.forEach((article, index) => {
            newsMessage += `${index + 1}. *${article.title}*\n${article.description}\n\n`;
        });
        await sock.sendMessage(chatId, { text: newsMessage });
    } catch (error) {
        console.error('Error fetching news:', error);
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch news right now.' });
    }
};
