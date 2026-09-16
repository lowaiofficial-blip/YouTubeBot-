import express from 'express';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

let bot1PreStreamSent = false;
let bot2PreStreamSent = false;

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

async function checkStreamStatus(youtubeClient) {
  const response = await youtubeClient.videos.list({
    part: 'snippet,liveStreamingDetails',
    id: process.env.LIVE_STREAM_ID
  });
  
  const item = response.data.items?.[0];
  if (!item) throw new Error('Yayın bulunamadı');

  return {
    isLive: item.snippet.liveBroadcastContent === 'live',
    liveChatId: item.liveStreamingDetails?.activeLiveChatId
  };
}

// AI Mesaj Üretici (Yayıncı Soru Sorsa Bile Pot Kırmayan Evrensel Replikler)
async function generateBotMessage(systemPrompt, userRolePrompt) {
  const systemContent = `${systemPrompt} 
ASLA UYULMASI GEREKEN SERT KURALLAR:
1. KESİNLİKLE EMOJİ KULLANMA.
2. KESİNLİKLE NOKTALAMA İŞARETİ KULLANMA.
3. Asla özel oyun adı veya karakter adı verme.
4. En fazla 3-5 kelime yaz. Çok kısa tut.
5. Yayıncı soru sorsa bile sırıtmayacak, kararı yayıncıya bırakan veya genel tepki veren sokak ağzıyla argo yaz (Örn: "sen bilirsin dayı", "kendi kafana göre takıl", "fark etmez devam et", "o neydi lan öyle", "yaparsın sen").`;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userRolePrompt }
    ],
    model: 'gpt-oss-120b',
    temperature: 0.7,
    max_tokens: 15,
  });

  return completion.choices[0]?.message?.content || 'sen bilirsin dayı';
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

async function runBotTask(botClient, systemPrompt, userRolePrompt, botName, isBot1) {
  try {
    const status = await checkStreamStatus(botClient);
    if (!status.liveChatId) return;

    // YAYIN HENÜZ BAŞLAMADIYSA
    if (!status.isLive) {
      if (isBot1 && bot1PreStreamSent) return;
      if (!isBot1 && bot2PreStreamSent) return;

      const prePrompt = isBot1 
        ? 'Yayın daha başlamadı çok var diye uflayan 3 kelimelik kısa mesaj yaz'
        : 'Yayın başlamadı darlayan 3 kelimelik kısa mesaj yaz';

      const msg = await generateBotMessage(systemPrompt, prePrompt);
      await sendChatMessage(botClient, status.liveChatId, msg);
      
      if (isBot1) bot1PreStreamSent = true;
      else bot2PreStreamSent = true;

      console.log(`[${botName} (YAYIN ÖNCESİ TEK MESAJ)]: ${msg}`);
      return;
    }

    // YAYIN CANLI BAŞLADIYSA
    const msg = await generateBotMessage(systemPrompt, userRolePrompt);
    await sendChatMessage(botClient, status.liveChatId, msg);
    console.log(`[${botName} CANLI YAYINDA]: ${msg}`);

  } catch (err) {
    console.error(`[${botName} Hata]:`, err.message);
  }
}

function startBots() {
  console.log('Botlar tek başlarına chati idare edecek şekilde başlatıldı...');

  const bot1System = 'Sen YouTube canlı yayın sohbetinde takılan argolu konuşan sabırsız bir Türk gencisin';
  const bot1User = 'Yayın canlı başladı, kararı yayıncıya bırakan veya genel tepki veren argolu kısa bir şey yaz';

  setInterval(() => {
    runBotTask(bot1YT, bot1System, bot1User, 'Bot 1 - Viewer', true);
  }, 60000);

  const bot2System = 'Sen canlı yayını izleyen kafası biraz kırık bir izleyicisin';
  const bot2User = 'Yayın canlı başladı, kararı yayıncıya bırakan çılgın kısa bir şey yaz';

  setInterval(() => {
    runBotTask(bot2YT, bot2System, bot2User, 'Bot 2 - Colette', false);
  }, 90000);
}

app.get('/', (req, res) => res.send('Solo stream bots ready!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
