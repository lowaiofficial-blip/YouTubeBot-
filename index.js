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

// Canlı Yayın Chat ID Alıcı
async function getLiveChatId(youtubeClient) {
  const response = await youtubeClient.videos.list({
    part: 'liveStreamingDetails',
    id: process.env.LIVE_STREAM_ID
  });
  
  const details = response.data.items?.[0]?.liveStreamingDetails;
  if (!details || !details.activeLiveChatId) {
    throw new Error('Canlı yayın chat ID bulunamadı. Yayın henüz açık veya chat aktif değil!');
  }
  return details.activeLiveChatId;
}

// Canlı Chatteki Son Mesajları Okuma
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

// AI Mesaj Üretici (gpt-oss-20b Modeli)
async function generateBotMessage(personaPrompt, chatContext = '') {
  const systemContent = `${personaPrompt} Kesinlikle noktalama işareti kullanma. Bol emoji kullan. Kısa ve doğal bir YouTube yayın sohbeti mesajı yaz.`;
  const userContent = chatContext ? `Sohbetteki son mesajlar şunlar:\n${chatContext}\nBu mesajlara uygun bir cevap yaz:` : 'Sohbete yeni bir mesaj yaz:';

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ],
    model: 'gpt-oss-20b',
  });

  return completion.choices[0]?.message?.content || 'sa emoji 🔥';
}

// Canlı Chat'e Mesaj Gönderici
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

// Bot Çalıştırıcı
async function startBots() {
  try {
    console.log('Canlı yayın bilgisi alınıyor...');
    const liveChatId = await getLiveChatId(bot1YT);
    console.log(`Chat ID Bağlandı: ${liveChatId}`);

    // Bot 1 Canlı Chat Döngüsü (Her 45sn)
    setInterval(async () => {
      try {
        const recentMsgs = await getRecentChatMessages(bot1YT, liveChatId);
        const msg = await generateBotMessage('Sen heyecanlı ve yayını izleyen sıradan bir izleyicisin.', recentMsgs);
        await sendChatMessage(bot1YT, liveChatId, msg);
        console.log(`[Bot 1 - Viewer]: ${msg}`);
      } catch (err) {
        console.error('Bot 1 Hata:', err.message);
      }
    }, 45000);

    // Bot 2 Canlı Chat Döngüsü (Her 60sn)
    setInterval(async () => {
      try {
        const recentMsgs = await getRecentChatMessages(bot2YT, liveChatId);
        const msg = await generateBotMessage('Sen Colette karakterisin, heyecanlı, takıntılı ve enerjik şekilde konuşursun.', recentMsgs);
        await sendChatMessage(bot2YT, liveChatId, msg);
        console.log(`[Bot 2 - Colette]: ${msg}`);
      } catch (err) {
        console.error('Bot 2 Hata:', err.message);
      }
    }, 60000);

  } catch (err) {
    console.error('Yayın henüz açılmadığı için chat bulunamadı. Yayın açılınca otomatik bağlanacak:', err.message);
  }
}

app.get('/', (req, res) => res.send('Bots are live and running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
