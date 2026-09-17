import express from 'express';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import 'dotenv/config';

const app = express();
const port = process.env.PORT || 3000;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Yayın öncesi kontrolü
let bot1PreStreamSent = false;
let bot2PreStreamSent = false;

// Mesaj hafızası (Tekrarları engellemek için)
let bot1History = [];
let bot2History = [];

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

async function getRecentChatHistory(youtubeClient, liveChatId) {
  try {
    const response = await youtubeClient.liveChatMessages.list({
      liveChatId: liveChatId,
      part: 'snippet',
      maxResults: 5
    });
    return response.data.items.map(i => i.snippet.displayMessage).join(' | ');
  } catch (err) {
    return '';
  }
}

async function generateBotMessage(systemPrompt, userRolePrompt, historyArray, chatContext = '') {
  const previousMessages = historyArray.slice(-5).join(', ');

  const systemContent = `${systemPrompt} 
ASLA UYULMASI GEREKEN KURALLAR:
1. KESİNLİKLE EMOJİ KULLANMA.
2. KESİNLİKLE NOKTALAMA İŞARETİ KULLANMA.
3. ERKEK HİTABI KULLANMA ("dayı", "kanka", "lan", "agalar" YASAK).
4. Sadece kız jargonuyla konuş.
5. DAHA ÖNCE YAZDIĞIN ŞU MESAJLARI VE BENZERLERİNİ ASLA TEKRARLAMA: [${previousMessages}].
6. Chatteki son durum: "${chatContext}".
7. En fazla 3-5 kelime yaz. Kısa ve öz tut.`;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userRolePrompt }
    ],
    model: 'openai/gpt-oss-120b',
    temperature: 0.85,
    max_tokens: 15,
  });

  const generated = completion.choices[0]?.message?.content || 'of fena gitti';
  
  historyArray.push(generated);
  if (historyArray.length > 10) historyArray.shift();

  return generated;
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

    if (!status.isLive) {
      if (isBot1 && bot1PreStreamSent) return;
      if (!isBot1 && bot2PreStreamSent) return;

      const preStreamMessagesBot1 = ["off yayın açılsa da izlesek", "başlamadı mı daha ya", "bekliyoruz bakalım"];
      const preStreamMessagesBot2 = ["yayın gelsin artıkk", "heyecandan öleceğim açın", "beklemekten çıldırdım"];

      const selectedList = isBot1 ? preStreamMessagesBot1 : preStreamMessagesBot2;
      const msg = selectedList[Math.floor(Math.random() * selectedList.length)];

      await sendChatMessage(botClient, status.liveChatId, msg);
      
      if (isBot1) bot1PreStreamSent = true;
      else bot2PreStreamSent = true;

      console.log(`[${botName} (YAYIN ÖNCESİ)]: ${msg}`);
      return;
    }

    const chatContext = await getRecentChatHistory(botClient, status.liveChatId);
    const historyArray = isBot1 ? bot1History : bot2History;

    const msg = await generateBotMessage(systemPrompt, userRolePrompt, historyArray, chatContext);
    await sendChatMessage(botClient, status.liveChatId, msg);
    console.log(`[${botName} CANLI YAYINDA]: ${msg}`);

  } catch (err) {
    console.error(`[${botName} Hata]:`, err.message);
  }
}

function startBots() {
  console.log('Botlar hafıza koruması ve kız jargonu ile başlatıldı...');

  const bot1System = 'Sen YouTube canlı yayın sohbetinde takılan rahat ve doğal genç bir kız izleyicisin.';
  const bot1User = 'Chatte yazılanlara ve ortama uyacak şekilde kız diliyle 3-4 kelimelik kısa tepki ver';

  setInterval(() => {
    runBotTask(bot1YT, bot1System, bot1User, 'Bot 1 - Ece', true);
  }, 60000);

  const bot2System = 'Sen yayıncıyı aşırı seven, heyecanlı ve takıntılı bir kız izleyicisin.';
  const bot2User = 'Ortama ve chatte konuşulanlara bakarak coşkulu ve çılgınca 3-4 kelimelik kısa tepki ver';

  setInterval(() => {
    runBotTask(bot2YT, bot2System, bot2User, 'Bot 2 - Colette', false);
  }, 90000);
}

app.get('/', (req, res) => res.send('Memory-protected Girl Bots Ready!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
