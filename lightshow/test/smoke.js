/* 서버 통합 테스트: 관리자 1 + 관객 3명(서로 다른 좌석/건너뛰기) */
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const { io } = require('socket.io-client');
const PORT = 3999, URL = 'http://localhost:' + PORT;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-'));
const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, ADMIN_PASSWORD: 'pw', DATA_DIR: dir }), stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const J = (m, u, b, t) => fetch(URL + u, { method: m, headers: { 'content-type': 'application/json', 'x-token': t || '' }, body: b ? JSON.stringify(b) : undefined }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const first = (s, ev) => new Promise((r) => s.once(ev, r));

(async () => {
  await sleep(800);
  try {
    ok((await J('POST', '/api/login', { password: 'bad' })).s === 401, '잘못된 비밀번호 거부');
    ok((await J('GET', '/api/layouts')).s === 401, '토큰 없이 배치 목록 거부');
    const { j: { token } } = await J('POST', '/api/login', { password: 'pw' });
    ok(!!token, '로그인 토큰 발급');
    const act = (await J('GET', '/api/active')).j;
    ok(act.layout.rows === 20 && act.layout.rowSeats[0] === 13, '기본 배치 13x20');

    const admin = io(URL, { auth: { token } }); const ini = await first(admin, 'init');
    const mk = () => { const s = io(URL); s.msgs = []; s.on('c', (m) => s.msgs.push(m)); return s; };
    const a = mk(), b = mk(), c = mk();
    await Promise.all([first(a, 'init'), first(b, 'init'), first(c, 'init')]);
    const lid = ini.lid;
    const seat = (s, m) => new Promise((r) => s.emit('seat', Object.assign({ lid }, m), r));
    ok((await seat(a, { r: 0, i: 0 })).ok, '좌석 등록 1줄 1번');
    ok((await seat(b, { r: 19, i: 12 })).ok, '좌석 등록 20줄 13번');
    ok((await seat(c, { skip: true })).ok, '건너뛰기 등록');
    ok(!(await seat(a, { r: 25, i: 0 })).ok, '범위 밖 좌석 거부');
    ok(!(await new Promise((r) => a.emit('seat', { lid: 'x.1', r: 0, i: 0 }, r))).ok, '다른 배치 ID 좌석 거부');
    const pres = await new Promise((r) => { admin.on('pres', (p) => { if (p.seated === 2 && p.skip === 1) r(p); }); });
    ok(pres.n === 3 && pres.occ[0] === '1' && pres.occ[20 * 13 - 1] === '1', '운영자 접속 현황(3명, 칸 점유)');

    const t0 = Date.now();
    const ack = (cmd) => new Promise((r) => admin.emit('cmd', Object.assign({ lid }, cmd), r));
    ok((await new Promise((r) => a.emit('cmd', { lid, k: 'off' }, r))).ok === false, '관객이 명령 송출 시 거부');
    ok((await ack({ k: 'full', c: '#ff0000' })).ok, '전체 점등 송출');
    await sleep(150);
    ok([a, b, c].every((s) => s.msgs.length === 1 && s.msgs[0].k === 'full' && s.msgs[0].at > t0 && s.msgs[0].lid === lid), '모두 예약 시각(at) 포함 수신');
    ok((await ack({ k: 'bl', hz: 99 })).ok, '깜빡임 명령');
    await sleep(100);
    ok(a.msgs[1].k === 'bl' && a.msgs[1].hz === 3, '깜빡임 초당 3회로 강제 제한');
    ok((await ack({ k: 'scroll', w: 2, h: 20, pal: ['#000000', '#fff000'], px: '1'.repeat(40), ms: 10 })).ok, '흐르는 글씨 송출');
    await sleep(100);
    ok(a.msgs[2].ms === 170, '글씨 속도 하한 170ms로 제한');
    ok(!(await ack({ k: 'pat', w: 5, h: 5, pal: ['#000000'], px: '0'.repeat(25) })).ok, '배치와 크기가 다른 패턴 거부');
    ok((await new Promise((r) => admin.emit('cmd', { lid: 'wrong.1', k: 'off' }, r))).ok === false, 'lid 불일치 명령 거부');
    const pat = { k: 'pat', w: 13, h: 20, pal: ['#000000', '#00ff00'], px: '1'.repeat(260) };
    ok((await ack(pat)).ok, '260칸 패턴 송출');
    await sleep(100);
    ok(a.msgs.at(-1).k === 'pat', '패턴 수신');
    // 늦게 접속한 폰은 현재 상태를 받는다
    const d = io(URL); const dini = await first(d, 'init');
    ok(dini.state.scene.k === 'pat' && dini.state.bl && dini.state.bl.hz === 3, '신규 접속자에게 현재 연출 상태 전달');
    // 시계 동기화
    const ts = await new Promise((r) => d.emit('t', r));
    ok(Math.abs(ts - Date.now()) < 200, '시계 동기화 응답');

    // 배치 편집/활성 변경
    const L2 = { name: '교육관', rows: 5, defaultSeats: 8, rowSeats: [6, 6, 8, 8, 8], rowAlign: ['center', 'center', 'left', 'left', 'left'], blocked: ['2:3'] };
    const put = await J('PUT', '/api/layouts/new', L2, token);
    ok(put.s === 200 && put.j.layout.id, '새 배치 저장');
    const newId = put.j.layout.id;
    const changed = first(a, 'layout');
    ok((await J('POST', '/api/layouts/' + newId + '/activate', null, token)).s === 200, '배치 활성화');
    const lm = await changed;
    ok(lm.lid !== lid && lm.layout.rows === 5, '활성 배치 변경이 관객에게 통지됨');
    ok((await new Promise((r) => a.emit('seat', { lid, r: 0, i: 0 }, r))).ok === false, '이전 배치 ID 좌석 거부');
    ok((await J('DELETE', '/api/layouts/' + newId, null, token)).s === 400, '활성 배치 삭제 거부');
    const exp = await J('GET', '/api/export', null, token);
    ok(exp.j.layouts.length === 2, '내보내기 2개 배치');
    const imp = await J('POST', '/api/import', exp.j, token);
    ok(imp.j.imported === 2 && (await J('GET', '/api/layouts', null, token)).j.layouts.length === 4, '가져오기(ID 충돌 시 새 ID)');
    // 패턴 저장
    const pp = await J('PUT', '/api/patterns/' + newId + '/' + encodeURIComponent('테스트'), { w: 2, h: 2, pal: ['#000000', '#ff0000'], px: '0110' }, token);
    ok(pp.s === 200 && (await J('GET', '/api/patterns', null, token)).j[newId]['테스트'].px === '0110', '패턴 저장/조회');
    ok(fs.existsSync(path.join(dir, 'layouts.json')) && fs.existsSync(path.join(dir, 'patterns.json')), 'JSON 파일 저장');
    [admin, a, b, c, d].forEach((s) => s.close());
  } catch (e) { console.error(e); fails++; }
  srv.kill();
  console.log(fails ? `\n${fails}개 실패` : '\n모두 통과');
  process.exit(fails ? 1 : 0);
})();
