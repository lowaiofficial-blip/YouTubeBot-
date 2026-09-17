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

// AI Mesaj Üretici
async function generateBotMessage(systemPrompt, userRolePrompt) {
  const systemContent = `${systemPrompt} 
ASLA UYULMASI GEREKEN SERT KURALLAR:
1. KESİNLİKLE EMOJİ KULLANMA.
2. KESİNLİKLE NOKTALAMA İŞARETİ KULLANMA.
3. ERKEK HİTABI KULLANMA ("dayı", "kanka", "lan", "agalar" gibi kelimeler YASAK).
4. Yayıncıya bir şey seçtirmeye çalışma ("sen seç", "fark etmez" kelimeleri YASAK).
5. Asla özel oyun veya karakter adı verme.
6. En fazla 3-4 kelime yaz. Çok kısa tut.
7. Sadece oyun akışına uyacak bağımsız genel tepkiler ver (Örn: "of fena gitti", "yavaş ol biraz", "yaparsın sen", "fena patladık", "devam et durma").`;

  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userRolePrompt }
    ],
    model: 'openai/gpt-oss-120b',
    temperature: 0.85, // Çeşitlilik artsın diye sıcaklığı biraz yükselttik
    max_tokens: 15,
  });

  return completion.choices[0]?.message?.content || 'of fena gitti';
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
        ? 'Yayın başlamadı diye ufoflayan 3 kelimelik kız diliyle kısa mesaj yaz'
        : 'Yayın başlamadı diye heyecanla darlayan 3 kelimelik çılgınca mesaj yaz';

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
  console.log('Botlar kız jargonu ve ayrıştırılmış kişiliklerle başlatıldı...');

  // BOT 1: Normal Genç Kız İzleyici
  const bot1System = 'Sen YouTube canlı yayın sohbetinde takılan, rahat konuşan genç bir kız izleyicisin. Erkek ağzı kullanmazsın.';
  const bot1User = 'Yayın canlı akıyor, yaşanan aksiyona kız diliyle genel 3 kelimelik tepki ver';

  setInterval(() => {
    runBotTask(bot1YT, bot1System, bot1User, 'Bot 1 - GirlViewer', true);
  }, 60000);

  // BOT 2: Colette Personası (Çılgın & Takıntılı Kız)
  const bot2System = 'Sen yayıncıyı aşırı seven, takıntılı, coşkulu ve biraz çılgın bir kız izleyicisin (Colette tarzı). Erkek ağzı kullanmazsın.';
  const bot2User = 'Yayın canlı akıyor, hayranlıkla karışık çılgınca 3 kelimelik genel tepki ver';

  setInterval(() => {
    runBotTask(bot2YT, bot2System, bot2User, 'Bot 2 - Colette', false);
  }, 90000);
}

app.get('/', (req, res) => res.send('Girl persona bots running!'));
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startBots();
});
