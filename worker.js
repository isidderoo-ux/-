// =====================================================================
//  에어컨 요청 텔레그램 봇 (Cloudflare Workers)
//  설치 방법은 README.md 를 참고하세요.
//  봇 토큰은 코드에 적지 않고 Workers 설정의 비밀 변수 BOT_TOKEN 에 넣습니다.
// =====================================================================

// ----- 1. 기본 설정 (여기만 바꾸면 됩니다) -----------------------------

// 알림을 받을 담당자(또는 담당자 단톡방)의 채팅 ID. 봇에게 /id 를 보내면 알려줍니다.
const MANAGER_CHAT_ID = '-5453679069';

// 같은 구역에서 같은 요청을 다시 알리기까지 기다리는 시간(초, 60 이상)
const COOLDOWN_SECONDS = 120;

// 3×3 큰 구역 (위에서부터 3개씩 한 줄)
const GRID_ZONES = [
  '1구역', '2구역', '3구역',
  '4구역', '5구역', '6구역',
  '7구역', '8구역', '9구역',
];

// 추가 장소
const EXTRA_ZONES = ['의자석', '로비', '단상'];

// (선택) 특정 장소만 다른 담당자에게 보내려면 적어주세요. 예: { '로비': '123456789' }
const ZONE_MANAGERS = {};

// ----- 2. 아래는 수정하지 않아도 됩니다 ---------------------------------
//
// 개인정보: 텔레그램이 보내는 이름·아이디는 처리 중에만 메모리에 있고 저장하거나 전달하지 않습니다.
// 저장하는 것은 2분짜리 중복 방지 기록("cooldown:4:cold")뿐입니다.

const ALL_ZONES = GRID_ZONES.concat(EXTRA_ZONES);

const TYPES = {
  cold: { label: '추워요', emoji: '🥶', action: '온도를 올리거나 바람을 약하게 해주세요' },
  hot: { label: '더워요', emoji: '🥵', action: '온도를 내리거나 바람을 세게 해주세요' },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/setup') return setup(url, env);
    if (request.method !== 'POST') return new Response('에어컨 요청 봇 작동 중');

    // 텔레그램이 보낸 요청인지 확인한다 (setWebhook 때 등록한 비밀값).
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await webhookSecret(env)) {
      return new Response('forbidden', { status: 403 });
    }

    const update = await request.json();
    // 텔레그램에는 바로 응답하고, 실제 처리는 응답 뒤에 이어서 한다.
    ctx.waitUntil(handleUpdate(update, env).catch((err) => console.error(err)));
    return new Response('ok');
  },
};

async function handleUpdate(update, env) {
  if (update.callback_query) return handleButton(update.callback_query, env);
  if (update.message) return handleMessage(update.message, env);
}

async function handleMessage(msg, env) {
  const text = msg.text || '';
  if (/^\/id\b/.test(text)) {
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: '이 채팅의 ID: ' + msg.chat.id });
  }
  // 담당자 단톡방 등 그룹에서는 메뉴를 띄우지 않는다.
  if (msg.chat.type !== 'private') return;

  await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: zoneMenuText(), reply_markup: zoneMenuKeyboard() });
}

async function handleButton(query, env) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const parts = String(query.data).split('|');
  const answer = (extra) => tg(env, 'answerCallbackQuery', { callback_query_id: query.id, ...extra });
  const edit = (text, keyboard) =>
    tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard });

  if (parts[0] === 'menu') {
    return Promise.all([answer(), edit(zoneMenuText(), zoneMenuKeyboard())]);
  }

  const zone = ALL_ZONES[Number(parts[1])];
  if (!zone) return answer();

  if (parts[0] === 'zone') {
    return Promise.all([answer(), edit('📍 ' + zone + '\n어떠세요?', {
      inline_keyboard: [
        [button('🥶 추워요', `type|${parts[1]}|cold`), button('🥵 더워요', `type|${parts[1]}|hot`)],
        [button('↩ 위치 다시 선택', 'menu')],
      ],
    })]);
  }

  const type = TYPES[parts[2]];
  if (parts[0] !== 'type' || !type) return answer();

  const cooldownKey = `cooldown:${parts[1]}:${parts[2]}`;
  if (env.COOLDOWN && await env.COOLDOWN.get(cooldownKey)) {
    return answer({ text: zone + '의 같은 요청이 방금 접수됐어요. 담당자가 확인 중입니다.', show_alert: true });
  }

  // 전송이 성공한다고 보고 완료 화면까지 함께 보낸 뒤, 실패했을 때만 화면을 고친다.
  const [sent] = await Promise.all([
    tg(env, 'sendMessage', { chat_id: ZONE_MANAGERS[zone] || MANAGER_CHAT_ID, text: managerMessage(zone, type) }),
    answer(),
    edit(`✅ ${zone} "${type.label}" 요청을 담당자에게 전달했어요.`, {
      inline_keyboard: [[button('다시 요청하기', 'menu')]],
    }),
  ]);
  if (!sent.ok) {
    return edit('⚠️ 담당자에게 전송하지 못했어요. 잠시 후 다시 시도해 주세요.', {
      inline_keyboard: [[button('다시 요청하기', 'menu')]],
    });
  }
  if (env.COOLDOWN) {
    await env.COOLDOWN.put(cooldownKey, '1', { expirationTtl: Math.max(60, COOLDOWN_SECONDS) });
  }
}

function managerMessage(zone, type) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const time = `${p.month}/${p.day} ${p.hour}:${p.minute}`;
  return [`${type.emoji} [${zone}] ${type.label}`, '→ ' + type.action, '시간: ' + time].join('\n');
}

function zoneMenuText() {
  return '📍 지금 계신 곳을 눌러주세요.';
}

function zoneMenuKeyboard() {
  const buttons = ALL_ZONES.map((name, i) => button(name, 'zone|' + i));
  const rows = [];
  for (let i = 0; i < GRID_ZONES.length; i += 3) rows.push(buttons.slice(i, i + 3));
  for (let i = GRID_ZONES.length; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return { inline_keyboard: rows };
}

function button(text, data) {
  return { text, callback_data: data };
}

async function tg(env, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!result.ok) console.error(`${method} 실패: ${JSON.stringify(result)}`);
  return result;
}

// 봇 토큰에서 만든 값이라 따로 설정할 필요가 없다.
async function webhookSecret(env) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('webhook:' + env.BOT_TOKEN));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// 브라우저에서 https://<워커주소>/setup 을 한 번 열면 텔레그램과 연결된다.
async function setup(url, env) {
  if (!env.BOT_TOKEN) return new Response('BOT_TOKEN 비밀 변수가 설정되지 않았어요.', { status: 500 });

  const result = await tg(env, 'setWebhook', {
    url: url.origin + '/',
    secret_token: await webhookSecret(env),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: '에어컨 요청하기' }] });
  const info = await tg(env, 'getWebhookInfo', {});

  const lines = [
    result.ok ? '✅ 텔레그램과 연결됐어요.' : '❌ 연결 실패: ' + result.description,
    env.COOLDOWN ? '✅ 중복 방지 저장소(COOLDOWN) 연결됨' : '⚠️ 중복 방지 저장소(COOLDOWN)가 연결되지 않았어요.',
    !/^-?\d+$/.test(MANAGER_CHAT_ID) ? '⚠️ MANAGER_CHAT_ID 를 아직 입력하지 않았어요.' : '✅ 담당자 채팅 ID 입력됨',
    '',
    '연결 주소: ' + (info.result && info.result.url),
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
