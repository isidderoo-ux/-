'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const zonesById = new Map(config.zones.map((z) => [z.id, z]));

const TYPES = {
  cold: { label: '추워요', emoji: '🥶', action: '온도를 올리거나 바람을 약하게 해주세요' },
  hot: { label: '더워요', emoji: '🥵', action: '온도를 내리거나 바람을 세게 해주세요' },
};

const COOLDOWN_MS = (config.cooldownSeconds ?? 120) * 1000;
const MAX_NOTE_LENGTH = 100;
const RECENT_LIMIT = 50;

// zoneId:type -> 마지막 알림 시각 (같은 구역에서 같은 요청이 연달아 오는 것 방지)
const lastSent = new Map();
const recent = [];

function formatTime(date) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: config.timezone || 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function buildMessage(zone, type, note, date) {
  const t = TYPES[type];
  const lines = [
    `${t.emoji} [${zone.name}] ${t.label}`,
    `→ ${t.action}`,
    `시간: ${formatTime(date)}`,
  ];
  if (note) lines.push(`메모: ${note}`);
  return lines.join('\n');
}

async function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function sendSlack(webhookUrl, text) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack ${res.status}: ${await res.text()}`);
}

// 구역에 담당자가 따로 지정돼 있으면 그쪽으로, 없으면 기본 채널로 보낸다.
async function notify(zone, text) {
  const jobs = [];
  const telegramChatId = zone.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (process.env.TELEGRAM_BOT_TOKEN && telegramChatId) {
    jobs.push(sendTelegram(telegramChatId, text));
  }
  const slackWebhookUrl = zone.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (slackWebhookUrl) {
    jobs.push(sendSlack(slackWebhookUrl, text));
  }

  if (jobs.length === 0) {
    console.log(`[알림 채널 미설정 - 콘솔 출력]\n${text}\n`);
    return;
  }

  const results = await Promise.allSettled(jobs);
  const failures = results.filter((r) => r.status === 'rejected');
  failures.forEach((f) => console.error('알림 전송 실패:', f.reason.message));
  if (failures.length === jobs.length) throw new Error('모든 알림 전송 실패');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 4096) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handleRequest(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, message: '잘못된 요청입니다.' });
  }

  const zone = zonesById.get(body.zoneId);
  if (!zone) return sendJson(res, 400, { ok: false, message: '위치를 선택해 주세요.' });
  if (!TYPES[body.type]) return sendJson(res, 400, { ok: false, message: '추워요/더워요를 선택해 주세요.' });

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '';
  const key = `${zone.id}:${body.type}`;
  const now = Date.now();
  const elapsed = now - (lastSent.get(key) || 0);
  if (elapsed < COOLDOWN_MS) {
    const retryAfter = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
    return sendJson(res, 429, {
      ok: false,
      retryAfter,
      message: `${zone.name}의 같은 요청이 방금 접수됐어요. 담당자가 확인 중입니다. (${retryAfter}초 후 다시 가능)`,
    });
  }

  const date = new Date(now);
  try {
    await notify(zone, buildMessage(zone, body.type, note, date));
  } catch {
    return sendJson(res, 502, { ok: false, message: '담당자에게 전송하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }

  lastSent.set(key, now);
  recent.unshift({ zone: zone.name, type: TYPES[body.type].label, note, time: date.toISOString() });
  recent.length = Math.min(recent.length, RECENT_LIMIT);

  sendJson(res, 200, { ok: true, message: `${zone.name} "${TYPES[body.type].label}" 요청을 담당자에게 전달했어요.` });
}

const indexHtml = path.join(__dirname, 'public', 'index.html');

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexHtml).pipe(res);
  }
  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      title: config.title,
      zones: config.zones.map(({ id, name, group }) => ({ id, name, group })),
    });
  }
  if (req.method === 'GET' && pathname === '/api/recent') {
    return sendJson(res, 200, recent);
  }
  if (req.method === 'POST' && pathname === '/api/request') {
    return handleRequest(req, res);
  }
  sendJson(res, 404, { ok: false, message: 'Not found' });
});

server.listen(PORT, () => {
  const channels = [
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID && '텔레그램',
    process.env.SLACK_WEBHOOK_URL && '슬랙',
  ].filter(Boolean);
  console.log(`에어컨 요청 봇 실행 중: http://localhost:${PORT}`);
  console.log(`알림 채널: ${channels.length ? channels.join(', ') : '없음 (콘솔에만 출력)'}`);
});
