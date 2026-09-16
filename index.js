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

async function getLiveChatId(youtubeClient) {
  const response = await youtubeClient.videos.list({
    part: 'liveStreamingDetails',
    id: process.env.LIVE_STREAM_ID
  });
  
  const details = response.data.items?.[0]?.liveStreamingDetails;
  if (!details || !details.activeLiveChatId) {
    throw new Error('Sohbet ID alınamadı.');
  }
  return details.activeLiveChatId;
}

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

// Tam Ayarlanmış Sistem Prompt'u
async function generateBotMessage(systemPrompt, userRolePrompt, chatContext = '') {
  const systemContent = `${systemPrompt} 
KESİN KURALLAR:
1. Kesinlikle noktalama işareti kullanma (nokta, virgül, ünlem YASAK).
2. Bol bol emoji kullan.
3. Asla başkasını veya diğer botları @ ile etiketleme!
4. Başka izleyicilere teşekkür edip yayıncı gibi davranma, sen sadece sohbeti izleyen birisin.
5. Sohbet geçmişindeki mesajların kelimelerini aynen tekrarlama.`;

  const userContent = chatContext 
    ? `Sohbetteki son mesajlar şunlar:\n${chatContext}\n\n${userRolePrompt}` 
    : userRolePrompt;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ],
    model: 'openai/gpt-oss-20b',
  });

  return completion.choices[0]?.message?.content || 'yayın ne zaman başlıyor 🔥';
}

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

async function runBotTask(botClient, systemPrompt, userRolePrompt, botName) {
  try {
    const liveChatId = await getLiveChatId(botClient);
    const recentMsgs = await getRecentChatMessages(botClient, liveChatId);
    const msg = await generateBotMessage(systemPrompt, userRolePrompt, recentMsgs);
    await sendChatMessage(botClient, liveChatId, msg);
    console.log(`[${botName}]: ${msg}`);
  } catch (err) {
    console.error(`[${botName} Hata]:`, err.message);
  }
}

function startBots() {
  console.log('Bot servisleri başlatıldı...');

  // Bot 1 - Heyecanlı İzleyici Personası (Her 60sn)
  const bot1System = 'Sen YouTube yayınlarında takılan heyecanlı bir izleyicisin Cezalı çark yayınlarını çok seversin Sakın yayıncı gibi davranma sen sadece bir izleyicisin';
  const bot1User = 'Yayın ve çark cezaları hakkında heyecanlı kısa bir sohbet mesajı yaz Genel izleyici gibi davran';

  setInterval(() => {
    runBotTask(bot1YT, bot1System, bot1User, 'Bot 1 - Viewer');
  }, 60000);

  // Bot 2 - Colette Personası (Her 90sn)
  const bot2System = 'Sen Brawl Stars oyunundaki Colette karakterisin Çılgın takıntılı enerjik ve koleksiyon meraklısısın Defterinden imza toplamaktan ve Brawl Stars oyunundan bahsetmeyi çok seversin';
  const bot2User = 'Colette gibi davranarak imzalardan defterinden veya oyundan bahsettiğin hareketli bir mesaj yaz';

  setInterval(() => {
    runBotTask(bot2YT, bot2System, bot2User, 'Bot 2 - Colette');
  }, 90000);
}

app.get('/', (req, res) => res.send('Bots are live and running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
