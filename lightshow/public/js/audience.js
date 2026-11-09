/* 관객 페이지 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var KEY = 'lightshow.seat.v1', FKEY = 'lightshow.flash';

  var L = null, lid = null, G = null;           // 현재 활성 배치
  var seat = null;                              // {r,i} | {skip:true} | null  (확정된 내 자리)
  var pick = { r: null, i: null };              // 선택 진행 중
  var sock = null;
  var offset = 0;                               // 서버시간 - 내 시계
  var st = { scene: { k: 'off' }, bl: null, br: 0.7 };
  var queue = [];
  var inShow = false;

  function save(o) { try { if (o) localStorage.setItem(KEY, JSON.stringify(o)); else localStorage.removeItem(KEY); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function serverNow() { return Date.now() + offset; }

  function screen(id) {
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i].id === id);
    inShow = id === 's-show';
  }
  function notice(msg) {
    var n = $('#notice');
    if (msg) { n.textContent = msg; n.classList.remove('hidden'); } else n.classList.add('hidden');
  }

  /* ---------- 내장 브라우저 안내 ---------- */
  var ua = navigator.userAgent;
  var isInApp = /KAKAOTALK|NAVER\(inapp|DaumApps|FBAN|FBAV|Instagram|Line\//i.test(ua);
  var isAndroid = /Android/i.test(ua), isKakao = /KAKAOTALK/i.test(ua);
  function setupInApp() {
    $('#inapp-url').textContent = location.href;
    $('#openext').onclick = function () {
      var url = location.href;
      if (isKakao) location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url);
      else if (isAndroid) location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=' + location.protocol.replace(':', '') + ';package=com.android.chrome;end';
      else copyUrl();
    };
    $('#copyurl').onclick = copyUrl;
    $('#ignore-inapp').onclick = function () { screen('s-home'); start(); };
  }
  function copyUrl() {
    var url = location.href;
    var done = function () { $('#copyurl').textContent = '복사됨! 사파리/크롬에 붙여넣으세요'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
    function fallback() {
      var t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(t);
    }
  }

  /* ---------- 서버 시간 보정 ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function syncClock(n) {
    var best = null, i = 0;
    function one() {
      return new Promise(function (res) {
        var t0 = Date.now();
        var to = setTimeout(res, 2000);
        sock.emit('t', function (ts) {
          clearTimeout(to);
          var t1 = Date.now(), rtt = t1 - t0;
          if (!best || rtt < best.rtt) best = { rtt: rtt, off: ts - (t0 + t1) / 2 };
          res();
        });
      });
    }
    return (async function () {
      for (i = 0; i < n; i++) { await one(); await sleep(60); }
      if (best) offset = offset && Math.abs(offset - best.off) < 30 ? (offset + best.off) / 2 : best.off;
    })();
  }

  /* ---------- 화면 켜짐 유지 / 플래시 ---------- */
  var wake = null;
  function acquireWake() {
    if (!('wakeLock' in navigator) || wake) return;
    navigator.wakeLock.request('screen').then(function (w) {
      wake = w; w.addEventListener('release', function () { wake = null; });
    }).catch(function () {});
  }
  var torch = { track: null, on: false, ok: false, busy: false };
  function initTorch() {
    if (torch.track || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (stream) {
      var tr = stream.getVideoTracks()[0];
      var caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
      if (caps && caps.torch) { torch.track = tr; torch.ok = true; }
      else stream.getTracks().forEach(function (t) { t.stop(); }); // 미지원: 조용히 화면만 사용
    }).catch(function () {});
  }
  function setTorch(on) {
    if (!torch.ok || torch.on === on) return;
    torch.on = on;
    torch.track.applyConstraints({ advanced: [{ torch: on }] }).catch(function () { torch.ok = false; });
  }

  /* ---------- 연출 렌더링 ---------- */
  function apply(m) { LS.applyCmd(st, m); }
  function myCell() {
    if (!seat || seat.skip || !L) return null;
    return { r: seat.r, c: LS.rowStart(L, seat.r, G.W) + seat.i };
  }
  function colorAt(now) { return LS.colorAt(st, myCell(), G.W, G.H, now); }

  /* 안전장치: 어떤 명령이 와도 이 폰은 켜짐 전환이 초당 3회를 넘지 못함 */
  var onTimes = [], lastLit = false, shown = undefined;
  function present(col) {
    var lit = !!col;
    if (lit && !lastLit) {
      var now = performance.now();
      onTimes = onTimes.filter(function (t) { return now - t < 1000; });
      if (onTimes.length >= 3) { col = null; lit = false; } else onTimes.push(now);
    }
    lastLit = lit;
    if (col !== shown) {
      shown = col;
      $('#stage').style.background = col || '#000';
      $('#wait').style.display = col || st.scene.k !== 'off' ? 'none' : 'block';
    }
    setTorch(lit);
    $('#dim').style.opacity = String(1 - st.br);
  }
  function frame() {
    requestAnimationFrame(frame);
    if (!inShow || !G) return;
    var now = serverNow();
    while (queue.length && queue[0].at <= now) apply(queue.shift());
    present(colorAt(now));
  }

  /* ---------- 좌석 선택 UI ---------- */
  function cellSize(box, maxH) {
    var w = Math.min(window.innerWidth - 60, 420);
    return Math.max(7, Math.min(26, Math.floor(Math.min(w / (G.W + 1.5), maxH / G.H))));
  }
  function drawMap(host, hlRow, me) {
    var h = Math.max(150, window.innerHeight * 0.3);
    host.innerHTML = '';
    host.appendChild(LS.mapDOM(L, { cell: cellSize(host, h), hlRow: hlRow, me: me }));
  }
  function showRows() {
    pick = { r: seat && !seat.skip ? seat.r : null, i: seat && !seat.skip ? seat.i : null };
    drawMap($('#map-row'), pick.r, seat && !seat.skip ? seat : null);
    var b = $('#rowbtns'); b.innerHTML = '';
    for (var r = 0; r < G.H; r++) {
      (function (r) {
        var btn = document.createElement('button');
        btn.textContent = r + 1;
        if (pick.r === r) btn.className = 'sel';
        btn.onclick = function () { pick.r = r; pick.i = null; showSeats(); };
        b.appendChild(btn);
      })(r);
    }
    screen('s-row');
  }
  function showSeats() {
    var r = pick.r;
    $('#seat-title').textContent = (r + 1) + '줄 · 몇 번째 자리?';
    var b = $('#seatbtns'); b.innerHTML = '';
    $('#ok').classList.add('hidden');
    var cur = seat && !seat.skip && seat.r === r ? seat.i : null;
    drawMap($('#map-seat'), r, cur != null ? { r: r, i: cur } : null);
    for (var c = 0; c < G.W; c++) {
      var s = G.g[r][c];
      if (!s) continue;
      (function (s) {
        var btn = document.createElement('button');
        btn.textContent = s.num;
        btn.onclick = function () {
          pick.i = s.i;
          drawMap($('#map-seat'), r, { r: r, i: s.i });
          var all = b.children; for (var k = 0; k < all.length; k++) all[k].className = '';
          btn.className = 'sel';
          var ok = $('#ok'); ok.textContent = (r + 1) + '줄 ' + s.num + '번 — 맞아요 ✔'; ok.classList.remove('hidden');
          ok.scrollIntoView({ block: 'nearest' });
        };
        b.appendChild(btn);
      })(s);
    }
    screen('s-seat');
  }

  function registerSeat(cb) {
    if (!seat || !sock || !sock.connected) return cb && cb(true);
    var m = seat.skip ? { lid: lid, skip: true } : { lid: lid, r: seat.r, i: seat.i };
    sock.emit('seat', m, function (res) { if (cb) cb(res && res.ok); });
  }
  function confirmSeat(s) {
    seat = s;
    save(Object.assign({ lid: lid }, s));
    registerSeat();
    enterShow();
  }
  function seatLabel() {
    if (!seat) return '';
    if (seat.skip) return '전체 점등만 참여';
    var cell = G.g[seat.r][LS.rowStart(L, seat.r, G.W) + seat.i];
    return (seat.r + 1) + '줄 ' + (cell ? cell.num : '?') + '번';
  }
  function enterShow() {
    $('#seatlab').textContent = seatLabel();
    screen('s-show');
    acquireWake();
  }

  /* ---------- 배치 적용 ---------- */
  function setLayout(p, changed) {
    L = LS.sanitize(p.layout, p.layout.id); L.rev = p.layout.rev;
    lid = p.lid; G = LS.grid(L);
    if (p.state) { st = { scene: p.state.scene || { k: 'off' }, bl: p.state.bl, br: p.state.br }; queue = []; }
    var saved = load();
    if (saved && saved.lid === lid) {
      seat = saved.skip ? { skip: true } : { r: saved.r, i: saved.i };
      if (!saved.skip && (seat.r >= G.H || seat.i >= L.rowSeats[seat.r])) seat = null;
    } else {
      var had = !!saved;
      seat = null; save(null);
      if (had || changed) { notice('좌석 배치가 변경되었습니다. 자리를 다시 선택해 주세요.'); if (joined) showRows(); else screen('s-home'); return; }
    }
    if (seat) { registerSeat(function (ok) { if (!ok) { seat = null; save(null); notice('자리 정보를 다시 선택해 주세요.'); showRows(); } }); if (inShow) enterShow(); }
  }

  var joined = false, started = false;
  function start() {
    if (started) return; started = true;
    sock = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    var first = true;
    sock.on('connect', function () { $('#dot').classList.remove('off'); });
    sock.on('disconnect', function () { $('#dot').classList.add('off'); });
    sock.on('init', function (p) {
      var wasFirst = first; first = false;
      if (p.t) offset = p.t - Date.now();
      setLayout(p, false);
      syncClock(7);
      if (wasFirst && load() && load().lid === p.lid) { joined = true; enterShow(); }
    });
    sock.on('layout', function (p) {
      if (p.lid === lid) { if (p.layout) { L.name = p.layout.name; } return; }
      setLayout(p, true);
    });
    sock.on('c', function (m) {
      if (m.lid !== lid) return;
      if (m.at <= serverNow()) apply(m); else { queue.push(m); queue.sort(function (a, b) { return a.at - b.at; }); }
    });
    setInterval(function () { if (sock.connected) syncClock(3); }, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { acquireWake(); if (sock.connected) syncClock(3); }
    });
    document.addEventListener('pointerdown', function () { if (inShow) { acquireWake(); if (flashWanted()) initTorch(); } });
    requestAnimationFrame(frame);
  }
  function flashWanted() { try { return localStorage.getItem(FKEY) !== '0'; } catch (e) { return true; } }

  /* ---------- 버튼 ---------- */
  $('#join').onclick = function () {
    joined = true; notice(null);
    var f = $('#flashchk').checked;
    try { localStorage.setItem(FKEY, f ? '1' : '0'); } catch (e) {}
    acquireWake();
    if (f) initTorch();
    if (seat) enterShow(); else showRows();
  };
  $('#skip').onclick = function () { confirmSeat({ skip: true }); };
  $('#back').onclick = showRows;
  $('#ok').onclick = function () { if (pick.r != null && pick.i != null) confirmSeat({ r: pick.r, i: pick.i }); };
  $('#chg').onclick = function () { showRows(); };
  window.addEventListener('resize', function () {
    if ($('#s-row').classList.contains('active')) drawMap($('#map-row'), pick.r, seat && !seat.skip ? seat : null);
  });

  try { $('#flashchk').checked = flashWanted(); } catch (e) {}
  if (isInApp) { setupInApp(); screen('s-inapp'); } else { screen('s-home'); start(); }
})();
