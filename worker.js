// =====================================================================
//  에어컨 요청 텔레그램 봇 (Cloudflare Workers)
//  설치 방법은 README.md 를 참고하세요.
//  봇 토큰은 코드에 적지 않고 Workers 설정의 비밀 변수 BOT_TOKEN 에 넣습니다.
// =====================================================================

// ----- 1. 기본 설정 (여기만 바꾸면 됩니다) -----------------------------

// 알림을 받을 담당자(또는 담당자 단톡방)의 채팅 ID. 봇에게 /id 를 보내면 알려줍니다.
const MANAGER_CHAT_ID = '-5453679069';

// 첫 요청 후 이 시간(분) 안에 들어온 같은 구역·같은 요청은 담당자 메시지 하나에 건수로 합칩니다.
// 시간이 지나 또 요청이 오면 새 알림이 갑니다.
const MERGE_MINUTES = 10;

// [처리 완료]를 이 시간(시간) 안에 누르지 않으면 "처리됐어요" 알림 대상 기록을 지웁니다.
const NOTIFY_HOURS = 12;

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
// 개인정보: 이름·아이디는 저장하지 않고 담당자에게도 보내지 않습니다.
// "처리됐어요" 알림을 보내기 위해 요청한 사람의 채팅 번호만 저장하며,
// [처리 완료]를 누르면 알림을 보낸 즉시 지우고, 누르지 않아도 NOTIFY_HOURS 가 지나면 지워집니다.

const ALL_ZONES = GRID_ZONES.concat(EXTRA_ZONES);

const TYPES = {
  cold: { label: '추워요', emoji: '🥶', action: '온도를 올리거나 바람을 약하게 해주세요', still: '계속 추우시면' },
  hot: { label: '더워요', emoji: '🥵', action: '온도를 내리거나 바람을 세게 해주세요', still: '계속 더우시면' },
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
  const text = (msg.text || '').trim();
  if (/^\/id\b/.test(text)) {
    return tg(env, 'sendMessage', { chat_id: msg.chat.id, text: '이 채팅의 ID: ' + msg.chat.id });
  }
  // 담당자 단톡방 등 그룹에서는 메뉴를 띄우지 않는다.
  if (msg.chat.type !== 'private') return;

  // 아래쪽 고정 키보드의 구역 버튼을 누르면 구역 이름이 메시지로 온다.
  const zoneIndex = ALL_ZONES.indexOf(text);
  if (zoneIndex >= 0) {
    return tg(env, 'sendMessage', {
      chat_id: msg.chat.id, text: '📍 ' + text + '\n어떠세요?', reply_markup: typeKeyboard(zoneIndex),
    });
  }
  await tg(env, 'sendMessage', { chat_id: msg.chat.id, text: zoneMenuText(), reply_markup: zoneKeyboard() });
}

async function handleButton(query, env) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const parts = String(query.data).split('|');
  const answer = (extra) => tg(env, 'answerCallbackQuery', { callback_query_id: query.id, ...extra });
  const edit = (text, keyboard) =>
    tg(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard });

  // 'menu', 'zone' 은 고정 키보드 도입 전에 보낸 메시지의 버튼이다.
  if (parts[0] === 'menu') {
    return Promise.all([
      answer(),
      edit(zoneMenuText()),
      tg(env, 'sendMessage', { chat_id: chatId, text: zoneMenuText(), reply_markup: zoneKeyboard() }),
    ]);
  }

  const zone = ALL_ZONES[Number(parts[1])];
  if (!zone) return answer();

  if (parts[0] === 'zone') {
    return Promise.all([answer(), edit('📍 ' + zone + '\n어떠세요?', typeKeyboard(parts[1]))]);
  }

  const type = TYPES[parts[2]];
  if (!type) return answer();
  const kv = env.COOLDOWN;
  const requestKey = `request:${parts[1]}:${parts[2]}`; // 지금 건수를 모으는 중인 알림
  const now = Date.now();
  const put = (key, value, seconds) => kv && kv
    .put(key, JSON.stringify(value), { expirationTtl: Math.max(60, Math.ceil(seconds)) })
    .catch((err) => console.error('KV 저장 실패: ' + err));

  // 담당자가 알림의 [처리 완료]를 누르면 요청한 사람들에게 알리고, 저장해 둔 채팅 번호를 지운다.
  if (parts[0] === 'done') {
    const alertKey = `alert:${chatId}:${messageId}`;
    const [alert, active] = kv ? await Promise.all([kv.get(alertKey, 'json'), kv.get(requestKey, 'json')]) : [];
    const requesters = alert ? alert.requesters : [];
    await Promise.all([
      answer({ text: '처리 완료로 표시했어요.' }),
      edit(`${query.message.text}\n\n✅ 처리 완료 · ${formatTime(now)}`
        + (requesters.length ? ` · 요청자 ${requesters.length}명에게 알림` : '')),
      ...requesters.map((id) => tg(env, 'sendMessage', {
        chat_id: id, text: `✅ ${zone} "${type.label}" 요청을 담당자가 처리했어요.\n${type.still} 다시 요청해 주세요.`,
      })),
      alert && kv.delete(alertKey),
      // 다음 요청부터 새 알림이 가게 한다. 이 메시지보다 나중에 온 알림이면 그대로 둔다.
      active && active.messageId === messageId && String(active.chatId) === String(chatId) && kv.delete(requestKey),
    ]);
    return;
  }
  if (parts[0] !== 'type') return answer();

  const managerChatId = ZONE_MANAGERS[zone] || MANAGER_CHAT_ID;
  const doneButton = { inline_keyboard: [[button('✅ 처리 완료', `done|${parts[1]}|${parts[2]}`)]] };
  const windowMs = MERGE_MINUTES * 60 * 1000;
  const active = kv ? await kv.get(requestKey, 'json') : null;

  // 이미 알림이 간 요청이면 새 알림 대신 그 메시지의 건수를 올린다.
  if (active && now - active.first < windowMs) {
    const alertKey = `alert:${active.chatId}:${active.messageId}`;
    const alert = (await kv.get(alertKey, 'json')) || { count: 1, first: active.first, last: active.first, requesters: [] };
    if (alert.requesters.includes(chatId)) {
      return Promise.all([
        answer(),
        edit(`✅ 이미 요청하셨어요. 담당자가 확인 중입니다.\n(${zone} "${type.label}" 현재 ${alert.count}건)`),
      ]);
    }
    const next = { ...alert, count: alert.count + 1, last: now, requesters: alert.requesters.concat(chatId) };
    const [updated] = await Promise.all([
      tg(env, 'editMessageText', {
        chat_id: active.chatId, message_id: active.messageId, text: managerMessage(zone, type, next),
        reply_markup: doneButton,
      }),
      answer(),
      edit(`✅ 이미 ${zone} "${type.label}" 요청이 접수돼 있어요.\n추가 요청으로 반영했어요. (현재 ${next.count}건)\n처리되면 알려드릴게요.`),
    ]);
    if (updated.ok) return put(alertKey, next, NOTIFY_HOURS * 3600);
    // 담당자 메시지가 지워졌으면 아래에서 새 알림으로 보낸다.
  }

  // 전송이 성공한다고 보고 완료 화면까지 함께 보낸 뒤, 실패했을 때만 화면을 고친다.
  const alert = { count: 1, first: now, last: now, requesters: [chatId] };
  const [sent] = await Promise.all([
    tg(env, 'sendMessage', {
      chat_id: managerChatId, text: managerMessage(zone, type, alert), reply_markup: doneButton,
    }),
    answer(),
    edit(`✅ ${zone} "${type.label}" 요청을 담당자에게 전달했어요.\n처리되면 알려드릴게요.`),
  ]);
  if (!sent.ok) {
    return edit('⚠️ 담당자에게 전송하지 못했어요. 다시 눌러주세요.', typeKeyboard(parts[1]));
  }
  const sentId = sent.result.message_id;
  await Promise.all([
    put(requestKey, { chatId: managerChatId, messageId: sentId, first: now }, windowMs / 1000),
    put(`alert:${managerChatId}:${sentId}`, alert, NOTIFY_HOURS * 3600),
  ]);
}

function managerMessage(zone, type, record) {
  const title = `${type.emoji} [${zone}] ${type.label}` + (record.count > 1 ? `  · 요청 ${record.count}건` : '');
  const time = record.count > 1
    ? `처음 ${formatTime(record.first)} · 마지막 ${formatTime(record.last)}`
    : '시간: ' + formatTime(record.first);
  return [title, '→ ' + type.action, time].join('\n');
}

function formatTime(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

function zoneMenuText() {
  return '📍 아래 버튼에서 지금 계신 곳을 눌러주세요.';
}

// 채팅창 아래쪽(글자 키보드 자리)에 항상 떠 있는 구역 버튼
function zoneKeyboard() {
  const rows = [];
  for (let i = 0; i < GRID_ZONES.length; i += 3) rows.push(GRID_ZONES.slice(i, i + 3));
  for (let i = 0; i < EXTRA_ZONES.length; i += 3) rows.push(EXTRA_ZONES.slice(i, i + 3));
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    is_persistent: true,
    resize_keyboard: true,
    input_field_placeholder: '위치를 눌러주세요',
  };
}

function typeKeyboard(zoneIndex) {
  return {
    inline_keyboard: [[button('🥶 추워요', `type|${zoneIndex}|cold`), button('🥵 더워요', `type|${zoneIndex}|hot`)]],
  };
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
  await Promise.all([
    tg(env, 'setMyCommands', { commands: [{ command: 'start', description: '에어컨 요청하기' }] }),
    // 봇을 처음 열었을 때 [시작] 버튼 위에 보이는 안내문
    tg(env, 'setMyDescription', {
      description: '📍 위치를 고르고 🥶 추워요 / 🥵 더워요를 누르면 담당자에게 바로 알려드려요.\n\n아래 [시작]을 눌러주세요.',
    }),
    tg(env, 'setMyShortDescription', { short_description: '에어컨 추워요/더워요 요청 봇' }),
  ]);
  const info = await tg(env, 'getWebhookInfo', {});

  const lines = [
    result.ok ? '✅ 텔레그램과 연결됐어요.' : '❌ 연결 실패: ' + result.description,
    env.COOLDOWN ? '✅ 요청 건수 저장소(COOLDOWN) 연결됨' : '⚠️ 요청 건수 저장소(COOLDOWN)가 연결되지 않았어요. (요청마다 새 알림이 갑니다)',
    !/^-?\d+$/.test(MANAGER_CHAT_ID) ? '⚠️ MANAGER_CHAT_ID 를 아직 입력하지 않았어요.' : '✅ 담당자 채팅 ID 입력됨',
    '',
    '연결 주소: ' + (info.result && info.result.url),
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
