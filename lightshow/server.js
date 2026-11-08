'use strict';
/* 교회 행사용 스마트폰 조명 연출 서버 (Node.js + Express + Socket.IO, DB 없이 JSON 파일 저장) */
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const C = require('./public/js/common.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'church1234';
const LEAD_MS = parseInt(process.env.LEAD_MS, 10) || 600; // 명령을 "서버시간 + LEAD_MS" 시점에 실행하도록 예약
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TOKEN_TTL = 12 * 3600 * 1000;
const MAX_HZ = 3; // 안전 규칙: 깜빡임 초당 3회 이하

if (!process.env.ADMIN_PASSWORD) console.warn('[경고] ADMIN_PASSWORD 환경변수가 없어 기본 비밀번호(church1234)를 사용합니다. 반드시 변경하세요.');

/* ---------- 저장소 ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const F_LAYOUTS = path.join(DATA_DIR, 'layouts.json');
const F_PATTERNS = path.join(DATA_DIR, 'patterns.json');

function readJson(f, fb) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fb; }
}
function writeJson(f, obj) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
function newId() { return 'l' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'); }

let db = readJson(F_LAYOUTS, null);
if (!db || !Array.isArray(db.layouts) || !db.layouts.length) {
  db = { active: 'main', layouts: [C.sanitize({ id: 'main', name: '본당', rows: 20, defaultSeats: 13 })] };
  writeJson(F_LAYOUTS, db);
}
db.layouts = db.layouts.map((l) => C.sanitize(l, newId()));
if (!db.layouts.some((l) => l.id === db.active)) db.active = db.layouts[0].id;
let patterns = readJson(F_PATTERNS, {}); // { 배치id: { 이름: {w,h,pal,px} } }
const saveLayouts = () => writeJson(F_LAYOUTS, db);
const savePatterns = () => writeJson(F_PATTERNS, patterns);

const getLayout = (id) => db.layouts.find((l) => l.id === id);
const activeLayout = () => getLayout(db.active);
const geomKey = (l) => JSON.stringify([l.rows, l.rowSeats, l.rowAlign, l.blocked.slice().sort()]);

/* ---------- 연출 상태(새로 접속한 폰에 즉시 전달) ---------- */
let state = { scene: { k: 'off' }, bl: null, br: 0.7 };
function resetState() { state = { scene: { k: 'off' }, bl: null, br: state.br }; }

/* ---------- 인증 ---------- */
const tokens = new Map();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const failures = new Map();
function validToken(t) {
  if (!t) return false;
  const e = tokens.get(t);
  if (!e) return false;
  if (e < Date.now()) { tokens.delete(t); return false; }
  return true;
}
setInterval(() => { const n = Date.now(); tokens.forEach((e, t) => { if (e < n) tokens.delete(t); }); }, 600000).unref();

/* ---------- HTTP ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: 0 }));

const auth = (req, res, next) => (validToken(req.get('x-token')) ? next() : res.status(401).json({ error: 'auth' }));
const publicPayload = () => { const L = activeLayout(); return { lid: C.lid(L), layout: L }; };

app.get('/api/active', (req, res) => res.json(publicPayload()));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - f.t > 60000) { f.n = 0; f.t = Date.now(); }
  if (f.n >= 5) return res.status(429).json({ error: '잠시 후 다시 시도하세요' });
  const ok = crypto.timingSafeEqual(sha(req.body && req.body.password), sha(ADMIN_PASSWORD));
  if (!ok) { f.n++; failures.set(ip, f); return res.status(401).json({ error: '비밀번호가 틀렸습니다' }); }
  failures.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, Date.now() + TOKEN_TTL);
  res.json({ token });
});

app.get('/api/layouts', auth, (req, res) => res.json({ active: db.active, layouts: db.layouts }));

app.put('/api/layouts/:id', auth, (req, res) => {
  const id = req.params.id === 'new' ? newId() : req.params.id;
  const old = getLayout(id);
  const L = C.sanitize(Object.assign({}, req.body, { id }), id);
  L.id = id;
  let changedActive = false;
  if (old) {
    L.rev = old.rev;
    if (geomKey(old) !== geomKey(L)) { L.rev = old.rev + 1; changedActive = id === db.active; }
    db.layouts[db.layouts.indexOf(old)] = L;
  } else db.layouts.push(L);
  saveLayouts();
  if (changedActive) broadcastLayout();
  else if (id === db.active) io.emit('layout', Object.assign(publicPayload(), { state, keep: true }));
  res.json({ layout: L, active: db.active });
});

app.post('/api/layouts/:id/activate', auth, (req, res) => {
  if (!getLayout(req.params.id)) return res.status(404).json({ error: 'not found' });
  if (db.active !== req.params.id) { db.active = req.params.id; saveLayouts(); broadcastLayout(); }
  res.json({ active: db.active });
});

app.delete('/api/layouts/:id', auth, (req, res) => {
  if (req.params.id === db.active) return res.status(400).json({ error: '활성 배치는 삭제할 수 없습니다' });
  if (db.layouts.length <= 1) return res.status(400).json({ error: '마지막 배치는 삭제할 수 없습니다' });
  db.layouts = db.layouts.filter((l) => l.id !== req.params.id);
  delete patterns[req.params.id];
  saveLayouts(); savePatterns();
  res.json({ ok: true });
});

app.get('/api/export', auth, (req, res) => {
  const ids = req.query.id ? [String(req.query.id)] : db.layouts.map((l) => l.id);
  const out = { format: 'church-lightshow', version: 1, layouts: [], patterns: {} };
  ids.forEach((id) => { const l = getLayout(id); if (l) { out.layouts.push(l); if (patterns[id]) out.patterns[id] = patterns[id]; } });
  res.set('Content-Disposition', 'attachment; filename="lightshow-layouts.json"');
  res.json(out);
});

app.post('/api/import', auth, (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.layouts) ? b.layouts : (Array.isArray(b) ? b : (b.rows ? [b] : []));
  if (!list.length) return res.status(400).json({ error: '배치 데이터가 없습니다' });
  let n = 0;
  list.slice(0, 50).forEach((raw) => {
    const L = C.sanitize(raw, newId());
    const oldId = L.id;
    if (!L.id || getLayout(L.id)) { L.id = newId(); if (getLayout(oldId)) L.name = (L.name + ' (가져옴)').slice(0, 30); }
    L.rev = 1;
    db.layouts.push(L); n++;
    const pp = b.patterns && b.patterns[oldId];
    if (pp && typeof pp === 'object') {
      patterns[L.id] = {};
      Object.keys(pp).slice(0, 100).forEach((name) => { const p = cleanPattern(pp[name]); if (p) patterns[L.id][String(name).slice(0, 30)] = p; });
    }
  });
  saveLayouts(); savePatterns();
  res.json({ imported: n });
});

function cleanPattern(p) {
  if (!p || typeof p !== 'object') return null;
  const w = C.clampI(p.w, 1, 3000, 0), h = C.clampI(p.h, 1, C.MAX_ROWS, 0);
  if (!w || !h || typeof p.px !== 'string' || p.px.length !== w * h || !Array.isArray(p.pal)) return null;
  const pal = p.pal.slice(0, 62);
  if (!pal.every((c) => C.HEX.test(c))) return null;
  for (let i = 0; i < p.px.length; i++) if (C.palIndex(p.px[i]) < 0 || C.palIndex(p.px[i]) >= pal.length) return null;
  return { w, h, pal, px: p.px };
}

app.get('/api/patterns', auth, (req, res) => res.json(patterns));
app.put('/api/patterns/:lid/:name', auth, (req, res) => {
  if (!getLayout(req.params.lid)) return res.status(404).json({ error: 'not found' });
  const p = cleanPattern(req.body);
  const name = String(req.params.name).trim().slice(0, 30);
  if (!p || !name) return res.status(400).json({ error: '잘못된 패턴' });
  (patterns[req.params.lid] = patterns[req.params.lid] || {})[name] = p;
  savePatterns();
  res.json({ ok: true });
});
app.delete('/api/patterns/:lid/:name', auth, (req, res) => {
  if (patterns[req.params.lid]) delete patterns[req.params.lid][req.params.name];
  savePatterns();
  res.json({ ok: true });
});

const server = process.env.SSL_CERT && process.env.SSL_KEY
  ? https.createServer({ cert: fs.readFileSync(process.env.SSL_CERT), key: fs.readFileSync(process.env.SSL_KEY) }, app)
  : http.createServer(app);

/* ---------- Socket.IO ---------- */
const io = new Server(server, {
  perMessageDeflate: { threshold: 1024 },
  maxHttpBufferSize: 2e6,
  pingInterval: 10000,
  pingTimeout: 15000,
});
const seats = new Map(); // socket.id -> {r,i,c} | {skip:true}
const aud = new Set();
let presDirty = true;

io.use((socket, next) => {
  socket.data.admin = validToken(socket.handshake.auth && socket.handshake.auth.token);
  next();
});

const initPayload = () => Object.assign(publicPayload(), { state, t: Date.now() });

function broadcastLayout() {
  resetState();
  seats.clear();
  presDirty = true;
  io.emit('layout', Object.assign(publicPayload(), { state }));
}

io.on('connection', (socket) => {
  if (socket.data.admin) socket.join('admin'); else aud.add(socket.id);
  presDirty = true;
  socket.emit('init', initPayload());

  socket.on('t', (ack) => { if (typeof ack === 'function') ack(Date.now()); });

  let lastSeat = 0;
  socket.on('seat', (m, ack) => {
    const reply = (v) => { if (typeof ack === 'function') ack(v); };
    if (socket.data.admin || !m || typeof m !== 'object') return reply({ ok: false });
    const now = Date.now();
    if (now - lastSeat < 150) return reply({ ok: false, err: 'rate' });
    lastSeat = now;
    const L = activeLayout();
    if (m.lid !== C.lid(L)) return reply({ ok: false, err: 'lid' });
    if (m.clear) { seats.delete(socket.id); presDirty = true; return reply({ ok: true }); }
    if (m.skip) { seats.set(socket.id, { skip: true }); presDirty = true; return reply({ ok: true }); }
    const G = C.grid(L), r = m.r | 0, i = m.i | 0;
    if (r < 0 || r >= G.H || i < 0 || i >= L.rowSeats[r]) return reply({ ok: false, err: 'seat' });
    const c = C.rowStart(L, r, G.W) + i;
    if (!G.g[r][c]) return reply({ ok: false, err: 'seat' });
    seats.set(socket.id, { r, i, c });
    presDirty = true;
    reply({ ok: true });
  });

  socket.on('cmd', (m, ack) => {
    const reply = (v) => { if (typeof ack === 'function') ack(v); };
    if (!socket.data.admin) return reply({ ok: false, err: 'auth' });
    reply(handleCmd(m));
  });

  socket.on('disconnect', () => { aud.delete(socket.id); seats.delete(socket.id); presDirty = true; });
});

const hex = (c, d) => (typeof c === 'string' && C.HEX.test(c) ? c.toLowerCase() : d);
const num = (v, a, b, d) => { v = +v; return isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };

function handleCmd(m) {
  if (!m || typeof m !== 'object') return { ok: false };
  const L = activeLayout();
  if (m.lid !== C.lid(L)) return { ok: false, err: 'lid' };
  const W = C.cols(L), H = L.rows;
  const at = Date.now() + LEAD_MS;
  let out = null;
  switch (m.k) {
    case 'off': out = { k: 'off' }; state.scene = out; state.bl = null; break;
    case 'full': out = { k: 'full', c: hex(m.c, '#ffffff') }; state.scene = out; break;
    case 'pat': {
      const p = cleanPattern(m);
      if (!p || p.w !== W || p.h !== H) return { ok: false, err: 'size' };
      out = { k: 'pat', w: W, h: H, pal: p.pal, px: p.px }; state.scene = out; break;
    }
    case 'scroll': {
      const p = cleanPattern(m);
      if (!p || p.h !== H) return { ok: false, err: 'size' };
      out = { k: 'scroll', w: p.w, h: H, pal: p.pal, px: p.px, ms: num(m.ms, 170, 1000, 250) }; state.scene = out; break;
    }
    case 'wave':
      out = { k: 'wave', d: m.d === 'h' ? 'h' : 'v', c: hex(m.c, '#ffffff'), bg: hex(m.bg, '#000000'), ms: num(m.ms, 100, 1000, 250) | 0, bw: num(m.bw, 1, 6, 3) | 0 };
      state.scene = out; break;
    case 'bl': {
      const hz = num(m.hz, 0, MAX_HZ, 0);
      out = { k: 'bl', hz: hz < 0.2 ? 0 : Math.round(hz * 10) / 10 };
      state.bl = out.hz ? { hz: out.hz, at } : null; break;
    }
    case 'br': out = { k: 'br', v: Math.round(num(m.v, 0.1, 1, 0.7) * 100) / 100 }; state.br = out.v; break;
    default: return { ok: false, err: 'k' };
  }
  out.lid = C.lid(L);
  out.at = at;
  if (out.k === 'bl' && state.bl) state.bl.at = at;
  io.emit('c', out);
  return { ok: true, at };
}

/* 관리자에게 접속 현황을 1초마다(변경 시에만) 전송 */
setInterval(() => {
  if (!presDirty) return;
  presDirty = false;
  const L = activeLayout(), G = C.grid(L);
  const arr = new Array(G.W * G.H).fill(0);
  let seated = 0, skip = 0;
  seats.forEach((s) => {
    if (s.skip) skip++;
    else { seated++; const k = s.r * G.W + s.c; if (arr[k] < 9) arr[k]++; }
  });
  io.to('admin').emit('pres', { lid: C.lid(L), n: aud.size, seated, skip, occ: arr.join('') });
}, 1000).unref();

server.listen(PORT, () => {
  const proto = process.env.SSL_CERT ? 'https' : 'http';
  console.log(`조명 연출 서버 시작: ${proto}://localhost:${PORT}  (관객: /  운영자: /admin.html)`);
});
