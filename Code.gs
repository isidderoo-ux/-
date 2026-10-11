// =====================================================================
//  에어컨 요청 텔레그램 봇 (구글 Apps Script)
//  설치 방법은 README.md 를 참고하세요.
// =====================================================================

// ----- 1. 기본 설정 (여기만 바꾸면 됩니다) -----------------------------

// @BotFather 에게 받은 봇 토큰
const BOT_TOKEN = '여기에_봇_토큰을_붙여넣으세요';

// 알림을 받을 담당자(또는 담당자 단톡방)의 채팅 ID. 봇에게 /id 를 보내면 알려줍니다.
const MANAGER_CHAT_ID = '여기에_담당자_채팅_ID를_붙여넣으세요';

// 배포 후 받은 웹 앱 URL (https://script.google.com/macros/s/.../exec)
const WEB_APP_URL = '여기에_웹앱_URL을_붙여넣으세요';

// 같은 구역에서 같은 요청을 다시 알리기까지 기다리는 시간(초)
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

const ALL_ZONES = GRID_ZONES.concat(EXTRA_ZONES);

const TYPES = {
  cold: { label: '추워요', emoji: '🥶', action: '온도를 올리거나 바람을 약하게 해주세요' },
  hot: { label: '더워요', emoji: '🥵', action: '온도를 내리거나 바람을 세게 해주세요' },
};

/** 텔레그램이 메시지/버튼 이벤트를 보내면 실행됩니다. */
function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    // 텔레그램은 응답을 못 받았다고 판단하면 같은 이벤트를 다시 보내므로 한 번만 처리한다.
    if (!claimOnce('update:' + update.update_id, 21600)) return ok();

    if (update.callback_query) handleButton(update.callback_query);
    else if (update.message) handleMessage(update.message);
  } catch (err) {
    console.error(err);
  }
  return ok();
}

function handleMessage(msg) {
  const text = msg.text || '';
  if (/^\/id\b/.test(text)) {
    return tg('sendMessage', { chat_id: msg.chat.id, text: '이 채팅의 ID: ' + msg.chat.id });
  }
  // 담당자 단톡방 등 그룹에서는 메뉴를 띄우지 않는다.
  if (msg.chat.type !== 'private') return;

  tg('sendMessage', { chat_id: msg.chat.id, text: zoneMenuText(), reply_markup: zoneMenuKeyboard() });
}

function handleButton(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const parts = String(query.data).split('|');

  if (parts[0] === 'menu') {
    editMessage(chatId, messageId, zoneMenuText(), zoneMenuKeyboard());
    return tg('answerCallbackQuery', { callback_query_id: query.id });
  }

  const zone = ALL_ZONES[Number(parts[1])];
  if (!zone) return tg('answerCallbackQuery', { callback_query_id: query.id });

  if (parts[0] === 'zone') {
    editMessage(chatId, messageId, '📍 ' + zone + '\n어떠세요?', {
      inline_keyboard: [
        [button('🥶 추워요', 'type|' + parts[1] + '|cold'), button('🥵 더워요', 'type|' + parts[1] + '|hot')],
        [button('↩ 위치 다시 선택', 'menu')],
      ],
    });
    return tg('answerCallbackQuery', { callback_query_id: query.id });
  }

  const type = TYPES[parts[2]];
  if (parts[0] !== 'type' || !type) return tg('answerCallbackQuery', { callback_query_id: query.id });

  const cooldownKey = 'cooldown:' + parts[1] + ':' + parts[2];
  if (!claimOnce(cooldownKey, COOLDOWN_SECONDS)) {
    return tg('answerCallbackQuery', {
      callback_query_id: query.id,
      text: zone + '의 같은 요청이 방금 접수됐어요. 담당자가 확인 중입니다.',
      show_alert: true,
    });
  }

  const sent = tg('sendMessage', { chat_id: ZONE_MANAGERS[zone] || MANAGER_CHAT_ID, text: managerMessage(zone, type) });
  if (!sent.ok) {
    CacheService.getScriptCache().remove(cooldownKey);
    return tg('answerCallbackQuery', {
      callback_query_id: query.id,
      text: '담당자에게 전송하지 못했어요. 잠시 후 다시 눌러주세요.',
      show_alert: true,
    });
  }

  editMessage(chatId, messageId, '✅ ' + zone + ' "' + type.label + '" 요청을 담당자에게 전달했어요.', {
    inline_keyboard: [[button('다시 요청하기', 'menu')]],
  });
  tg('answerCallbackQuery', { callback_query_id: query.id, text: '전달했어요!' });
}

function managerMessage(zone, type) {
  return [
    type.emoji + ' [' + zone + '] ' + type.label,
    '→ ' + type.action,
    '시간: ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'MM/dd HH:mm'),
  ].join('\n');
}

function zoneMenuText() {
  return '📍 지금 계신 곳을 눌러주세요.';
}

function zoneMenuKeyboard() {
  const buttons = ALL_ZONES.map(function (name, i) { return button(name, 'zone|' + i); });
  const rows = [];
  for (let i = 0; i < GRID_ZONES.length; i += 3) rows.push(buttons.slice(i, i + 3));
  for (let i = GRID_ZONES.length; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
  return { inline_keyboard: rows };
}

function button(text, data) {
  return { text: text, callback_data: data };
}

function editMessage(chatId, messageId, text, keyboard) {
  tg('editMessageText', { chat_id: chatId, message_id: messageId, text: text, reply_markup: keyboard });
}

/** key 를 처음 보면 true, seconds 안에 이미 본 key 면 false. */
function claimOnce(key, seconds) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return false;
    cache.put(key, '1', seconds);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function tg(method, body) {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const result = JSON.parse(res.getContentText());
  if (!result.ok) console.error(method + ' 실패: ' + res.getContentText());
  return result;
}

function ok() {
  return ContentService.createTextOutput('ok');
}

// ----- 3. 설치할 때 한 번만 실행하는 함수 --------------------------------

/** 배포 후 WEB_APP_URL 을 채우고 이 함수를 한 번 실행하세요. */
function setWebhook() {
  console.log(tg('setWebhook', {
    url: WEB_APP_URL,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  }));
  tg('setMyCommands', { commands: [{ command: 'start', description: '에어컨 요청하기' }] });
}

/** 봇이 반응하지 않을 때 실행해서 상태를 확인하세요. */
function checkWebhook() {
  console.log(tg('getWebhookInfo', {}));
}
