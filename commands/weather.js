const axios = require('axios');

module.exports = async function (sock, chatId, message, city) {
    try {
        let weather;
        if (process.env.OPENWEATHER_API_KEY) {
            const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
                params: { q: city, appid: process.env.OPENWEATHER_API_KEY, units: 'metric' },
                timeout: 10000
            });
            weather = response.data;
        } else {
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
                timeout: 10000,
                headers: { 'user-agent': 'VARNOX-XD weather command' }
            });
            const current = response.data?.current_condition?.[0];
            if (!current) throw new Error('Weather provider returned no data');
            weather = {
                name: city,
                weather: [{ description: current.weatherDesc?.[0]?.value || 'unknown' }],
                main: { temp: current.temp_C }
            };
        }
        const weatherText = `Weather in ${weather.name}: ${weather.weather[0].description}. Temperature: ${weather.main.temp}°C.`;
        await sock.sendMessage(chatId, { text: weatherText }, { quoted: message }   );
    } catch (error) {
        console.error('Error fetching weather:', error);
        await sock.sendMessage(chatId, { text: 'Sorry, I could not fetch the weather right now.' }, { quoted: message } );
    }
};
