import express from 'express';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

// Groq AI İstemcisi
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// OAuth2 İstemcileri
function createYouTubeClient(clientId, clientSecret, refreshToken) {
  const auth = new google.auth.OAuth2(clientId, clientSecret, 'https://developers.google.com/oauthplayground');
  auth.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: 'v3', auth });
}

const bot1YT = createYouTubeClient(
  process.env.BOT1_CLIENT_ID,
  process.env.BOT1_CLIENT_SECRET,
  process.env.BOT1_REFRESH_TOKEN
);

const bot2YT = createYouTubeClient(
  process.env.BOT2_CLIENT_ID,
  process.env.BOT2_CLIENT_SECRET,
  process.env.BOT2_REFRESH_TOKEN
);

// Live Chat ID Alıcı
async function getLiveChatId(youtubeClient) {
  const response = await youtubeClient.videos.list({
    part: 'liveStreamingDetails',
    id: process.env.LIVE_STREAM_ID
  });
  
  const details = response.data.items?.[0]?.liveStreamingDetails;
  if (!details || !details.activeLiveChatId) {
    throw new Error('Canlı yayın chat ID bulunamadı. Yayının açık olduğundan emin ol!');
  }
  return details.activeLiveChatId;
}

// AI Mesaj Üretici
async function generateBotMessage(personaPrompt) {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `${personaPrompt} Kesinlikle noktalama işareti kullanma. Bol emoji kullan. Kısa ve doğal bir YouTube yayın sohbeti mesajı yaz.`
      }
    ],
    model: 'llama3-8b-8192',
  });

  return completion.choices[0]?.message?.content || 'sa emoji 🔥🔥';
}

// Chate Mesaj Gönderici
async function sendChatMessage(youtubeClient, liveChatId, messageText) {
  await youtubeClient.liveChatMessages.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        liveChatId: liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: {
          messageText: messageText
        }
      }
    }
  });
}

// Bot Çalıştırıcı Döngü
async function startBots() {
  try {
    console.log('Canlı yayın bilgisi alınıyor...');
    const liveChatId = await getLiveChatId(bot1YT);
    console.log(`Chat ID Bağlandı: ${liveChatId}`);

    // Bot 1 Persona Döngüsü (Örn: Her 45 saniyede bir)
    setInterval(async () => {
      try {
        const msg = await generateBotMessage('Sen heyecanlı ve yayını izleyen sıradan bir izleyicisin.');
        await sendChatMessage(bot1YT, liveChatId, msg);
        console.log(`[Bot 1 - Viewer]: ${msg}`);
      } catch (err) {
        console.error('Bot 1 Hata:', err.message);
      }
    }, 45000);

    // Bot 2 Persona Döngüsü (Örn: Her 60 saniyede bir)
    setInterval(async () => {
      try {
        const msg = await generateBotMessage('Sen Colette karakterisin, heyecanlı, takıntılı ve enerjik şekilde konuşursun.');
        await sendChatMessage(bot2YT, liveChatId, msg);
        console.log(`[Bot 2 - Colette]: ${msg}`);
      } catch (err) {
        console.error('Bot 2 Hata:', err.message);
      }
    }, 60000);

  } catch (err) {
    console.error('Botlar başlatılamadı:', err.message);
  }
}

// Render Web Service Ayakta Tutma
app.get('/', (req, res) => res.send('Bots are live and running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
