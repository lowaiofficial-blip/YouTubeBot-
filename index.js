import express from 'express';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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

// Canlı Yayın veya Bekleme Ekranı Sohbet ID Alıcı
async function getLiveChatId(youtubeClient) {
  const response = await youtubeClient.videos.list({
    part: 'liveStreamingDetails',
    id: process.env.LIVE_STREAM_ID
  });
  
  const details = response.data.items?.[0]?.liveStreamingDetails;
  if (!details || !details.activeLiveChatId) {
    throw new Error('Sohbet ID alınamadı. Sohbet henüz aktif değil.');
  }
  return details.activeLiveChatId;
}

// Sohbetteki Son Mesajları Okuma
async function getRecentChatMessages(youtubeClient, liveChatId) {
  try {
    const res = await youtubeClient.liveChatMessages.list({
      liveChatId: liveChatId,
      part: 'snippet,authorDetails',
      maxResults: 5
    });
    const messages = res.data.items.map(item => `${item.authorDetails.displayName}: ${item.snippet.displayMessage}`);
    return messages.join('\n');
  } catch (err) {
    return '';
  }
}

// AI Mesaj Üretici (openai/gpt-oss-20b Modeli)
async function generateBotMessage(personaPrompt, chatContext = '') {
  const systemContent = `${personaPrompt} Kesinlikle noktalama işareti kullanma. Bol emoji kullan. Kısa ve doğal bir YouTube yayın sohbeti mesajı yaz.`;
  const userContent = chatContext ? `Sohbetteki son mesajlar şunlar:\n${chatContext}\nBu mesajlara uygun bir cevap yaz:` : 'Sohbete yeni bir mesaj yaz:';

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ],
    model: 'openai/gpt-oss-20b',
  });

  return completion.choices[0]?.message?.content || 'sa emoji 🔥';
}

// Sohbete Mesaj Gönderici
async function sendChatMessage(youtubeClient, liveChatId, messageText) {
  await youtubeClient.liveChatMessages.insert({
    part: 'snippet',
    requestBody: {
      snippet: {
        liveChatId: liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: messageText }
      }
    }
  });
}

// Tekil Bot Çalıştırma İşlemi
async function runBotTask(botClient, persona, botName) {
  try {
    const liveChatId = await getLiveChatId(botClient);
    const recentMsgs = await getRecentChatMessages(botClient, liveChatId);
    const msg = await generateBotMessage(persona, recentMsgs);
    await sendChatMessage(botClient, liveChatId, msg);
    console.log(`[${botName}]: ${msg}`);
  } catch (err) {
    console.error(`[${botName} Hata]:`, err.message);
  }
}

// Döngü Başlatıcı
function startBots() {
  console.log('Bot servisleri başlatıldı. Sohbet taranıyor...');

  // Bot 1 (Her 45 saniyede bir dener ve yazar)
  setInterval(() => {
    runBotTask(bot1YT, 'Sen heyecanlı ve yayını izleyen sıradan bir izleyicisin.', 'Bot 1 - Viewer');
  }, 45000);

  // Bot 2 (Her 60 saniyede bir dener ve yazar)
  setInterval(() => {
    runBotTask(bot2YT, 'Sen Colette karakterisin, heyecanlı, takıntılı ve enerjik şekilde konuşursun.', 'Bot 2 - Colette');
  }, 60000);
}

app.get('/', (req, res) => res.send('Bots are live and running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
