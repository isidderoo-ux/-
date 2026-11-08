/* 운영자 페이지 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TOKEN_KEY = 'ls_token';
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var sock = null;

  var activeL = null, activeLid = null, G = null;   // 현재 활성 배치(송출 대상)
  var layouts = [], activeId = '';
  var pres = null;

  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'content-type': 'application/json', 'x-token': token }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) {
        if (r.status === 401 && url !== '/api/login') { logout(); throw new Error('로그인이 필요합니다'); }
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; });
      });
  }

  /* ---------- 로그인 ---------- */
  function logout() { token = ''; localStorage.removeItem(TOKEN_KEY); if (sock) sock.close(); location.reload(); }
  $('#loginform').onsubmit = function (e) {
    e.preventDefault();
    api('POST', '/api/login', { password: $('#pw').value }).then(function (j) {
      token = j.token; localStorage.setItem(TOKEN_KEY, token); boot();
    }).catch(function (err) { $('#loginerr').textContent = err.message; });
  };
  $('#logout').onclick = logout;

  function boot() {
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    sock = io({ auth: { token: token } });
    sock.on('connect', function () { $('#st-conn').textContent = '🟢 연결됨'; });
    sock.on('disconnect', function () { $('#st-conn').textContent = '🔴 끊김(재연결 중)'; });
    sock.on('init', onLayoutMsg);
    sock.on('layout', onLayoutMsg);
    sock.on('pres', function (p) { pres = p; renderPres(); });
    sock.on('c', function (m) { if (m.k === 'br') { $('#br').value = Math.round(m.v * 100); $('#br-v').textContent = Math.round(m.v * 100) + '%'; } });
    loadLayouts();
  }

  function onLayoutMsg(p) {
    var changed = !activeLid || activeLid !== p.lid;
    activeL = LS.sanitize(p.layout, p.layout.id); activeL.rev = p.layout.rev;
    activeLid = p.lid; G = LS.grid(activeL);
    $('#st-layout').textContent = activeL.name;
    $('#st-total').textContent = G.total;
    if (p.state && p.state.br) { $('#br').value = Math.round(p.state.br * 100); $('#br-v').textContent = Math.round(p.state.br * 100) + '%'; }
    if (changed) { pres = null; resetPaint(); loadPatterns(); if (p.state) syncBlinkUI(p.state.bl); }
    activeId = activeL.id;
    renderPres(); renderLayoutList();
  }
  function syncBlinkUI(bl) {
    blinkOn = !!bl;
    if (bl) { $('#bl-hz').value = bl.hz; $('#bl-v').textContent = bl.hz; }
    $('#blink').textContent = blinkOn ? '깜빡임 ON' : '깜빡임 OFF';
    $('#blink').classList.toggle('on', blinkOn);
  }

  function send(cmd) {
    if (!sock || !sock.connected) return toast('서버와 연결되지 않았습니다');
    cmd.lid = activeLid;
    sock.emit('cmd', cmd, function (r) {
      if (!r || !r.ok) toast('송출 실패: ' + ((r && r.err) || '알 수 없음') + (r && r.err === 'lid' ? ' (배치가 바뀌었습니다. 새로고침)' : ''));
    });
  }

  /* ---------- 접속 현황 ---------- */
  function renderPres() {
    if (!activeL) return;
    var p = pres && pres.lid === activeLid ? pres : { n: 0, seated: 0, skip: 0, occ: '' };
    $('#st-n').textContent = p.n; $('#st-seated').textContent = p.seated; $('#st-skip').textContent = p.skip;
    var host = $('#occ');
    var cell = Math.max(10, Math.min(24, Math.floor(Math.min((host.clientWidth || 360) - 40, 460) / (G.W + 1.5))));
    host.innerHTML = '';
    host.appendChild(LS.mapDOM(activeL, { cell: cell, occ: function (r, c) { return +(p.occ.charAt(r * G.W + c) || 0); } }));
  }

  /* ---------- 탭 ---------- */
  function tab(name) {
    $('#p-show').classList.toggle('hidden', name !== 'show');
    $('#p-layout').classList.toggle('hidden', name !== 'layout');
    $('#tab-show').classList.toggle('on', name === 'show');
    $('#tab-layout').classList.toggle('on', name === 'layout');
    if (name === 'show') { renderPres(); drawPaint(); }
  }
  $('#tab-show').onclick = function () { tab('show'); };
  $('#tab-layout').onclick = function () { tab('layout'); };

  /* ============================================================
     패턴 그리기
  ============================================================ */
  var PW = 0, PH = 0, cv = [], cur = '#ff3355', tool = 'paint', CELL = 24;
  var SW = ['#ffffff', '#ff3355', '#ff9500', '#ffe14d', '#34d27b', '#33c6ff', '#3d6bff', '#a855f7', '#ff7ac8'];
  var canvas = $('#paint'), ctx = canvas.getContext('2d');

  $('#swatches').innerHTML = SW.map(function (c) { return '<button class="sw" data-c="' + c + '" style="background:' + c + '"></button>'; }).join('');
  function setColor(c) {
    cur = c; tool = 'paint';
    $$('#swatches .sw').forEach(function (b) { b.classList.toggle('sel', b.getAttribute('data-c') === c); });
    $('#custom').value = c; setTool('paint');
  }
  function setTool(t) { tool = t; $('#tool-paint').classList.toggle('on', t === 'paint'); $('#tool-erase').classList.toggle('on', t === 'erase'); }
  $$('#swatches .sw').forEach(function (b) { b.onclick = function () { setColor(b.getAttribute('data-c')); }; });
  $('#custom').oninput = function () { setColor(this.value); };
  $('#tool-paint').onclick = function () { setTool('paint'); };
  $('#tool-erase').onclick = function () { setTool('erase'); };
  $('#fill').onclick = function () { cv = cv.map(function () { return cur; }); drawPaint(); };
  $('#clear').onclick = function () { cv = cv.map(function () { return '#000000'; }); drawPaint(); };

  function resetPaint() {
    var oldW = PW, oldH = PH, old = cv;
    PW = G.W; PH = G.H; cv = new Array(PW * PH).fill('#000000');
    if (oldW && old.length === oldW * oldH) { // 배치가 바뀌면 이전 그림을 중앙 기준으로 옮김
      var f = fit({ w: oldW, h: oldH, colors: old }, PW, PH);
      cv = f.colors;
    }
    drawPaint();
  }
  function drawPaint() {
    if (!PW) return;
    var host = canvas.parentNode.clientWidth || 360;
    CELL = Math.max(10, Math.min(30, Math.floor((host - 8) / PW), Math.floor(560 / PH)));
    canvas.width = PW * CELL; canvas.height = PH * CELL;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (var r = 0; r < PH; r++) for (var c = 0; c < PW; c++) {
      var col = cv[r * PW + c];
      if (col !== '#000000') { ctx.fillStyle = col; ctx.fillRect(c * CELL, r * CELL, CELL, CELL); }
      if (!G.g[r][c]) { // 좌석 없는 칸(통로 등): 가는 X 표시
        ctx.strokeStyle = '#3a3a4a'; ctx.beginPath();
        ctx.moveTo(c * CELL + 4, r * CELL + 4); ctx.lineTo((c + 1) * CELL - 4, (r + 1) * CELL - 4);
        ctx.moveTo((c + 1) * CELL - 4, r * CELL + 4); ctx.lineTo(c * CELL + 4, (r + 1) * CELL - 4); ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var x = 0; x <= PW; x++) { ctx.moveTo(x * CELL + .5, 0); ctx.lineTo(x * CELL + .5, canvas.height); }
    for (var y = 0; y <= PH; y++) { ctx.moveTo(0, y * CELL + .5); ctx.lineTo(canvas.width, y * CELL + .5); }
    ctx.stroke();
    $('#pat-size').textContent = '(' + PW + '칸 × ' + PH + '줄)';
  }
  var painting = false;
  function paintAt(e) {
    var rc = canvas.getBoundingClientRect();
    var c = Math.floor((e.clientX - rc.left) * (canvas.width / rc.width) / CELL);
    var r = Math.floor((e.clientY - rc.top) * (canvas.height / rc.height) / CELL);
    if (c < 0 || r < 0 || c >= PW || r >= PH) return;
    var v = tool === 'erase' ? '#000000' : cur;
    if (cv[r * PW + c] !== v) { cv[r * PW + c] = v; drawPaint(); }
  }
  canvas.addEventListener('pointerdown', function (e) { painting = true; canvas.setPointerCapture(e.pointerId); paintAt(e); });
  canvas.addEventListener('pointermove', function (e) { if (painting) paintAt(e); });
  canvas.addEventListener('pointerup', function () { painting = false; });
  window.addEventListener('resize', function () { drawPaint(); renderPres(); });

  /* 크기가 다른 패턴을 중앙 기준으로 맞춤 */
  function fit(src, W, H) {
    var ox = Math.floor((W - src.w) / 2), oy = Math.floor((H - src.h) / 2);
    var out = new Array(W * H).fill('#000000'), lost = 0;
    for (var y = 0; y < src.h; y++) for (var x = 0; x < src.w; x++) {
      var col = src.colors[y * src.w + x], dx = x + ox, dy = y + oy;
      if (dx >= 0 && dx < W && dy >= 0 && dy < H) out[dy * W + dx] = col;
      else if (col !== '#000000') lost++;
    }
    return { colors: out, lost: lost, ox: ox, oy: oy };
  }

  /* 기본 패턴: 배치 크기에 맞춰 자동 크기·중앙 정렬 */
  function builtin(name, W, H, color) {
    var out = new Array(W * H).fill('#000000'), r, c;
    if (name === 'full') return out.map(function () { return color; });
    if (name === 'cross') {
      var Hc = H >= 8 ? H - 2 : H, y0 = Math.floor((H - Hc) / 2);
      var t = Math.max(1, Math.round(W / 6)); if ((W - t) % 2) t++; if (t > W) t = W;
      var Lh = Math.min(W, Math.max(t, Math.round(Hc * 0.55))); if ((W - Lh) % 2) Lh = Math.max(t, Lh - 1);
      var th = Math.max(1, Math.round(Hc / 9));
      var hy = y0 + Math.round(Hc * 0.28);
      for (r = y0; r < y0 + Hc; r++) for (c = (W - t) / 2; c < (W + t) / 2; c++) out[r * W + c] = color;
      for (r = hy; r < hy + th && r < H; r++) for (c = (W - Lh) / 2; c < (W + Lh) / 2; c++) out[r * W + c] = color;
      return out;
    }
    if (name === 'heart') {
      var S = Math.min(W, H) / 2.6;
      for (r = 0; r < H; r++) for (c = 0; c < W; c++) {
        var u = (c + 0.5 - W / 2) / S, v = (H / 2 - (r + 0.5)) / S + 0.1;
        var a = u * u + v * v - 1;
        if (a * a * a - u * u * v * v * v <= 0) out[r * W + c] = color;
      }
      return out;
    }
    return out;
  }
  $$('[data-b]').forEach(function (b) {
    b.onclick = function () {
      var n = b.getAttribute('data-b');
      if (n === 'full') { cv = builtin('full', PW, PH, cur); drawPaint(); send({ k: 'full', c: cur }); return; }
      cv = builtin(n, PW, PH, cur); drawPaint(); sendPaint();
    };
  });
  function sendPaint() { var e = LS.encodePx(cv); send({ k: 'pat', w: PW, h: PH, pal: e.pal, px: e.px }); }
  $('#send-pat').onclick = sendPaint;

  /* ---------- 사용자 패턴 저장/불러오기 ---------- */
  var allPatterns = {};
  function loadPatterns() { api('GET', '/api/patterns').then(function (p) { allPatterns = p; renderSaved(); }).catch(function () {}); }
  function layoutName(id) { var l = layouts.filter(function (x) { return x.id === id; })[0]; return l ? l.name : id; }
  function renderSaved() {
    var host = $('#saved'); host.innerHTML = '';
    if (!activeL) return;
    var ids = Object.keys(allPatterns).sort(function (a, b) { return (b === activeL.id) - (a === activeL.id); });
    ids.forEach(function (id) {
      var names = Object.keys(allPatterns[id] || {});
      if (!names.length) return;
      var h = document.createElement('div'); h.className = 'stat'; h.style.marginTop = '8px';
      h.textContent = (id === activeL.id ? '▶ 이 배치' : '다른 배치') + ' · ' + layoutName(id);
      host.appendChild(h);
      names.forEach(function (n) {
        var p = allPatterns[id][n], chip = document.createElement('span'); chip.className = 'chip';
        var b = document.createElement('button'); b.style.color = '#fff'; b.textContent = n + ' (' + p.w + '×' + p.h + ')';
        b.onclick = function () { loadSaved(p); };
        var x = document.createElement('button'); x.textContent = '✕';
        x.onclick = function () {
          if (!confirm('"' + n + '" 패턴을 삭제할까요?')) return;
          api('DELETE', '/api/patterns/' + encodeURIComponent(id) + '/' + encodeURIComponent(n)).then(loadPatterns);
        };
        chip.appendChild(b); chip.appendChild(x); host.appendChild(chip);
      });
    });
  }
  $('#save-pat').onclick = function () {
    var name = $('#pname').value.trim();
    if (!name) return toast('패턴 이름을 입력하세요');
    var e = LS.encodePx(cv);
    api('PUT', '/api/patterns/' + encodeURIComponent(activeL.id) + '/' + encodeURIComponent(name), { w: PW, h: PH, pal: e.pal, px: e.px })
      .then(function () { toast('저장했습니다'); loadPatterns(); }).catch(function (e2) { toast(e2.message); });
  };
  var pendingFit = null;
  function loadSaved(p) {
    var src = { w: p.w, h: p.h, colors: LS.decodePx(p.pal, p.px) };
    if (p.w === PW && p.h === PH) { cv = src.colors; drawPaint(); return; }
    var f = fit(src, PW, PH);
    pendingFit = f;
    // 미리보기: 원본 전체를 그리고, 현재 배치에 들어오는 영역을 표시(잘리는 부분은 어둡게)
    var k = Math.max(3, Math.min(14, Math.floor(420 / Math.max(p.w, PW)), Math.floor(420 / Math.max(p.h, PH))));
    var cvs = $('#fit-cv'), x = cvs.getContext('2d');
    cvs.width = Math.max(p.w, PW) * k; cvs.height = Math.max(p.h, PH) * k;
    x.fillStyle = '#111'; x.fillRect(0, 0, cvs.width, cvs.height);
    var offX = Math.floor((cvs.width / k - p.w) / 2), offY = Math.floor((cvs.height / k - p.h) / 2); // 원본 위치
    var winX = offX + (-f.ox), winY = offY + (-f.oy); // 현재 배치 창(원본 좌표계 기준)
    var wx = offX - f.ox, wy = offY - f.oy;
    for (var yy = 0; yy < p.h; yy++) for (var xx = 0; xx < p.w; xx++) {
      var col = src.colors[yy * p.w + xx];
      if (col === '#000000') continue;
      var inside = xx + f.ox >= 0 && xx + f.ox < PW && yy + f.oy >= 0 && yy + f.oy < PH;
      x.globalAlpha = inside ? 1 : 0.28; x.fillStyle = inside ? col : '#ff4444';
      x.fillRect((offX + xx) * k, (offY + yy) * k, k, k);
    }
    x.globalAlpha = 1; x.strokeStyle = '#ffd54a'; x.lineWidth = 2;
    x.strokeRect(wx * k + 1, wy * k + 1, PW * k - 2, PH * k - 2);
    $('#fit-info').textContent = '원본 ' + p.w + '×' + p.h + ' → 현재 ' + PW + '×' + PH + ' (노란 테두리 = 현재 배치 범위). ' +
      (f.lost ? '빨간 부분 ' + f.lost + '칸이 잘립니다.' : '잘리는 부분 없음 (남는 곳은 빈칸).');
    $('#dlg-fit').showModal();
  }
  $('#fit-ok').onclick = function () { if (pendingFit) { cv = pendingFit.colors; drawPaint(); } $('#dlg-fit').close(); };
  $('#fit-cancel').onclick = function () { $('#dlg-fit').close(); };

  /* ============================================================
     효과 버튼
  ============================================================ */
  var blinkOn = false;
  $('#all-on').onclick = function () { send({ k: 'full', c: cur }); };
  $('#all-off').onclick = function () { send({ k: 'off' }); syncBlinkUI(null); };
  $('#br').oninput = function () { $('#br-v').textContent = this.value + '%'; };
  $('#br').onchange = function () { send({ k: 'br', v: this.value / 100 }); };
  function sendBlink() { send({ k: 'bl', hz: blinkOn ? +$('#bl-hz').value : 0 }); }
  $('#blink').onclick = function () { blinkOn = !blinkOn; syncBlinkUI(blinkOn ? { hz: +$('#bl-hz').value } : null); sendBlink(); };
  $('#bl-hz').oninput = function () { $('#bl-v').textContent = this.value; };
  $('#bl-hz').onchange = function () { if (blinkOn) sendBlink(); };
  $('#wave-ms').oninput = function () { $('#wave-v-ms').textContent = this.value + 'ms'; };
  $('#wave-v').onclick = function () { send({ k: 'wave', d: 'v', c: cur, bg: '#000000', ms: +$('#wave-ms').value, bw: 3 }); };
  $('#wave-h').onclick = function () { send({ k: 'wave', d: 'h', c: cur, bg: '#000000', ms: +$('#wave-ms').value, bw: 3 }); };

  /* ---------- 흐르는 글씨 (한글 지원: 브라우저 폰트를 현재 배치 높이로 픽셀화) ---------- */
  function renderText(text, H, fg, bg) {
    var ss = 4, fs = Math.max(6, (H >= 10 ? H - 2 : H)) * ss;
    var m = document.createElement('canvas').getContext('2d');
    var font = 'bold ' + fs + 'px "Malgun Gothic","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR","NanumGothic",sans-serif';
    m.font = font;
    var wpx = Math.ceil(m.measureText(text).width) + ss * 2;
    var cw = Math.ceil(wpx / ss) * ss, c = document.createElement('canvas');
    c.width = cw; c.height = H * ss;
    var x = c.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.font = font; x.textBaseline = 'middle'; x.textAlign = 'left';
    x.fillText(text, ss, c.height / 2 + fs * 0.05);
    var img = x.getImageData(0, 0, c.width, c.height).data, w = cw / ss, bits = '';
    for (var r = 0; r < H; r++) for (var col = 0; col < w; col++) {
      var sum = 0;
      for (var yy = 0; yy < ss; yy++) for (var xx = 0; xx < ss; xx++) sum += img[((r * ss + yy) * c.width + col * ss + xx) * 4];
      bits += sum / (ss * ss * 255) > 0.4 ? '1' : '0';
    }
    return { w: w, h: H, pal: [bg, fg], px: bits };
  }
  function previewText() {
    var t = $('#txt').value.trim(), cvp = $('#txtprev');
    if (!t || !G) { cvp.width = 1; cvp.height = 1; return null; }
    var p = renderText(t.slice(0, 40), G.H, $('#txt-c').value, $('#txt-bg').value), k = 5;
    cvp.width = p.w * k; cvp.height = p.h * k;
    var x = cvp.getContext('2d');
    for (var i = 0; i < p.px.length; i++) {
      x.fillStyle = p.px[i] === '1' ? p.pal[1] : p.pal[0];
      x.fillRect((i % p.w) * k, Math.floor(i / p.w) * k, k - 1, k - 1);
    }
    return p;
  }
  ['#txt', '#txt-c', '#txt-bg'].forEach(function (s) { $(s).oninput = previewText; });
  $('#txt-ms').oninput = function () { $('#txt-v').textContent = this.value + 'ms'; };
  $('#send-txt').onclick = function () {
    var p = previewText();
    if (!p) return toast('문구를 입력하세요');
    if (p.w > 3000) return toast('문구가 너무 깁니다');
    // 글씨 pal[0]=배경색, pal[1]=글자색. 서버는 pal 최대 62색까지 허용
    send({ k: 'scroll', w: p.w, h: p.h, pal: p.pal, px: p.px, ms: +$('#txt-ms').value });
  };

  /* ============================================================
     좌석 배치 편집기
  ============================================================ */
  var E = null, dirty = false;
  function loadLayouts() {
    return api('GET', '/api/layouts').then(function (j) {
      layouts = j.layouts; activeId = j.active; renderLayoutList(); renderSaved();
      if (!E && layouts.length) openEditor(layouts.filter(function (l) { return l.id === activeId; })[0] || layouts[0]);
    });
  }
  function summary(l) {
    var g = LS.grid(l); return l.rows + '줄 × 최대 ' + g.W + '칸 · 좌석 ' + g.total + '석';
  }
  function renderLayoutList() {
    var host = $('#laylist'); if (!host) return; host.innerHTML = '';
    layouts.forEach(function (l) {
      var d = document.createElement('div'); d.className = 'lay' + (E && E.id === l.id ? ' cur' : '');
      d.innerHTML = '<div style="flex:1;min-width:150px"><b></b> ' + (l.id === activeId ? '<span class="tag">활성</span>' : '') + '<br><span class="stat"></span></div>';
      d.querySelector('b').textContent = l.name; d.querySelector('.stat').textContent = summary(l);
      var mk = function (txt, cls, fn) { var b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = txt; b.onclick = fn; d.appendChild(b); };
      if (l.id !== activeId) mk('활성화', 'pri', function () { activate(l); });
      mk('편집', '', function () { if (!dirty || confirm('저장하지 않은 변경이 사라집니다. 계속할까요?')) openEditor(l); });
      mk('복제', '', function () { var c = JSON.parse(JSON.stringify(l)); c.id = ''; c.name = (l.name + ' 복사').slice(0, 30); openEditor(c, true); });
      mk('내보내기', '', function () { download('/api/export?id=' + encodeURIComponent(l.id), 'lightshow-' + l.id + '.json'); });
      if (l.id !== activeId) mk('삭제', 'red', function () {
        if (confirm('"' + l.name + '" 배치와 저장된 패턴을 삭제할까요?')) api('DELETE', '/api/layouts/' + l.id).then(function () { if (E && E.id === l.id) E = null; return loadLayouts(); }).catch(function (e) { toast(e.message); });
      });
      host.appendChild(d);
    });
  }
  function activate(l) {
    var n = pres ? pres.n : 0;
    if (!confirm('"' + l.name + '" 배치를 활성화합니다.\n접속 중인 관객 ' + n + '명에게 좌석 재선택 안내가 표시됩니다. 계속할까요?')) return;
    api('POST', '/api/layouts/' + l.id + '/activate').then(function () { toast('활성화했습니다'); return loadLayouts(); }).catch(function (e) { toast(e.message); });
  }
  function download(url, name) {
    fetch(url, { headers: { 'x-token': token } }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }
  $('#lay-export').onclick = function () { download('/api/export', 'lightshow-layouts.json'); };
  $('#lay-import').onchange = function () {
    var f = this.files[0], inp = this; if (!f) return;
    f.text().then(function (t) { return api('POST', '/api/import', JSON.parse(t)); })
      .then(function (j) { toast(j.imported + '개 배치를 가져왔습니다'); return loadLayouts(); })
      .catch(function (e) { toast('가져오기 실패: ' + e.message); }).then(function () { inp.value = ''; });
  };
  $('#lay-new').onclick = function () {
    if (dirty && !confirm('저장하지 않은 변경이 사라집니다. 계속할까요?')) return;
    openEditor(LS.sanitize({ id: '', name: '새 배치', rows: 20, defaultSeats: 13 }, ''), true);
  };

  function openEditor(l, isNew) {
    E = LS.sanitize(l, l.id); E.id = l.id || ''; E.rev = l.rev || 1; E._new = !!isNew || !l.id;
    dirty = !!isNew; renderLayoutList(); renderEditor();
  }
  function mark() { dirty = true; $('#ed-title').textContent = '편집기 — ' + (E.name || '') + ' ● 저장 안 됨'; }

  function renderEditor() {
    var body = $('#ed-body');
    $('#ed-title').textContent = '편집기 — ' + E.name + (dirty ? ' ● 저장 안 됨' : '');
    body.innerHTML =
      '<div class="row"><label>이름 <input type="text" id="e-name" maxlength="30" style="width:170px"></label>' +
      '<label>전체 줄 수 <input type="number" id="e-rows" min="1" max="' + LS.MAX_ROWS + '"></label>' +
      '<label>기본 좌석 수 <input type="number" id="e-def" min="1" max="' + LS.MAX_SEATS + '"></label>' +
      '<button class="btn" id="e-applydef">모든 줄에 기본 좌석 수 적용</button></div>' +
      '<div class="row" style="background:#1f1f2b;padding:8px;border-radius:8px"><b class="stat">줄 범위 설정</b>' +
      '<input type="number" id="r-a" min="1" value="1"> ~ <input type="number" id="r-b" min="1" value="1">줄 → 좌석 ' +
      '<input type="number" id="r-n" min="1" max="' + LS.MAX_SEATS + '" value="11">석 ' +
      '<select id="r-al"><option value="">정렬 유지</option><option value="left">왼쪽 정렬</option><option value="center">가운데 정렬</option><option value="right">오른쪽 정렬</option></select>' +
      '<button class="btn" id="r-go">적용</button></div>' +
      '<div class="stat">칸을 클릭하면 통로/빈칸(좌석 없음)으로 바뀝니다. 점선 칸은 이 줄의 좌석 범위 밖입니다.</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-top:8px"><div id="e-grid" class="edgrid" style="overflow:auto;max-width:100%"></div><div id="e-table" style="max-height:520px;overflow:auto"></div></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn pri" id="e-save">💾 저장</button>' +
      '<button class="btn" id="e-saveact">저장 후 활성화</button><span class="stat" id="e-sum"></span></div>';
    $('#e-name').value = E.name; $('#e-rows').value = E.rows; $('#e-def').value = E.defaultSeats;
    $('#e-name').oninput = function () { E.name = this.value; mark(); };
    $('#e-def').onchange = function () { E.defaultSeats = LS.clampI(this.value, 1, LS.MAX_SEATS, 13); this.value = E.defaultSeats; mark(); };
    $('#e-rows').onchange = function () {
      var n = LS.clampI(this.value, 1, LS.MAX_ROWS, E.rows); this.value = n;
      while (E.rowSeats.length < n) { E.rowSeats.push(E.defaultSeats); E.rowAlign.push('center'); }
      E.rowSeats.length = n; E.rowAlign.length = n; E.rows = n;
      E.blocked = E.blocked.filter(function (s) { return +s.split(':')[0] < n; });
      mark(); drawGrid();
    };
    $('#e-applydef').onclick = function () {
      for (var r = 0; r < E.rows; r++) E.rowSeats[r] = E.defaultSeats;
      E.blocked = E.blocked.filter(function (s) { return +s.split(':')[1] < E.defaultSeats; }); mark(); drawGrid();
    };
    $('#r-go').onclick = function () {
      var a = LS.clampI($('#r-a').value, 1, E.rows, 1), b = LS.clampI($('#r-b').value, 1, E.rows, a);
      if (b < a) { var t = a; a = b; b = t; }
      var n = LS.clampI($('#r-n').value, 1, LS.MAX_SEATS, E.defaultSeats), al = $('#r-al').value;
      for (var r = a - 1; r < b; r++) { E.rowSeats[r] = n; if (al) E.rowAlign[r] = al; }
      E.blocked = E.blocked.filter(function (s) { var p = s.split(':'); return +p[1] < E.rowSeats[+p[0]]; });
      mark(); drawGrid();
    };
    $('#e-save').onclick = function () { saveLayout(false); };
    $('#e-saveact').onclick = function () { saveLayout(true); };
    drawGrid();
  }

  function drawGrid() {
    var L = LS.sanitize(E, E.id), W = LS.cols(L), host = $('#e-grid'), cell = Math.max(14, Math.min(26, Math.floor(420 / (W + 1))));
    L.blocked = E.blocked.filter(function (s) { var p = s.split(':'); return +p[0] < L.rows && +p[1] < L.rowSeats[+p[0]]; });
    var g = LS.grid(L);
    host.innerHTML = '';
    var m = LS.mapDOM(L, { cell: cell });
    // 좌석 범위 밖/통로 구분 및 클릭 처리
    var cells = m.querySelectorAll('.c');
    for (var r = 0; r < L.rows; r++) for (var c = 0; c < W; c++) {
      var el = cells[r * W + c], st = LS.rowStart(L, r, W), i = c - st;
      if (i < 0 || i >= L.rowSeats[r]) { el.className = 'c out'; continue; }
      el.setAttribute('data-r', r); el.setAttribute('data-i', i);
      if (E.blocked.indexOf(r + ':' + i) >= 0) el.className = 'c blk';
      else { var sc = g.g[r][c]; el.textContent = sc ? sc.num : ''; el.style.fontSize = Math.max(7, cell * 0.5) + 'px'; el.style.color = '#9a9ab0'; el.style.textAlign = 'center'; el.style.lineHeight = cell + 'px'; }
    }
    m.addEventListener('click', function (e) {
      var t = e.target, rr = t.getAttribute && t.getAttribute('data-r'); if (rr == null) return;
      var key = rr + ':' + t.getAttribute('data-i'), ix = E.blocked.indexOf(key);
      if (ix >= 0) E.blocked.splice(ix, 1); else E.blocked.push(key);
      mark(); drawGrid();
    });
    host.appendChild(m);
    // 줄별 표
    var h = '<table class="rt"><tr><th>줄</th><th>좌석</th><th>정렬</th></tr>';
    for (var q = 0; q < E.rows; q++) {
      h += '<tr><td>' + (q + 1) + '</td><td><input type="number" min="1" max="' + LS.MAX_SEATS + '" data-q="' + q + '" class="t-n" value="' + E.rowSeats[q] + '" style="width:56px"></td>' +
        '<td><select data-q="' + q + '" class="t-a">' + LS.ALIGNS.map(function (a) { return '<option value="' + a + '"' + (E.rowAlign[q] === a ? ' selected' : '') + '>' + { left: '왼쪽', center: '가운데', right: '오른쪽' }[a] + '</option>'; }).join('') + '</select></td></tr>';
    }
    $('#e-table').innerHTML = h + '</table>';
    $$('.t-n').forEach(function (inp) {
      inp.onchange = function () {
        var q = +this.getAttribute('data-q'); E.rowSeats[q] = LS.clampI(this.value, 1, LS.MAX_SEATS, E.defaultSeats);
        E.blocked = E.blocked.filter(function (s) { var p = s.split(':'); return +p[0] !== q || +p[1] < E.rowSeats[q]; }); mark(); drawGrid();
      };
    });
    $$('.t-a').forEach(function (sel) { sel.onchange = function () { E.rowAlign[+this.getAttribute('data-q')] = this.value; mark(); drawGrid(); }; });
    $('#e-sum').textContent = '총 ' + g.total + '석 (최대 ' + W + '칸 × ' + L.rows + '줄)';
  }

  function saveLayout(thenActivate) {
    var body = LS.sanitize(E, E.id); body.id = E.id;
    var isActive = E.id && E.id === activeId, old = layouts.filter(function (l) { return l.id === E.id; })[0];
    if (isActive && old && JSON.stringify([old.rows, old.rowSeats, old.rowAlign, old.blocked.slice().sort()]) !== JSON.stringify([body.rows, body.rowSeats, body.rowAlign, body.blocked.slice().sort()]) &&
      !confirm('지금 활성 중인 배치를 수정합니다.\n접속 중인 관객 ' + (pres ? pres.n : 0) + '명이 자리를 다시 선택해야 합니다. 저장할까요?')) return;
    api('PUT', '/api/layouts/' + (E.id || 'new'), body).then(function (j) {
      dirty = false; E = LS.sanitize(j.layout, j.layout.id); E.id = j.layout.id; E.rev = j.layout.rev;
      toast('저장했습니다');
      return loadLayouts().then(function () { renderEditor(); if (thenActivate && E.id !== activeId) activate(j.layout); });
    }).catch(function (e) { toast('저장 실패: ' + e.message); });
  }

  /* ---------- 관객 접속 QR ---------- */
  function drawQr() {
    var u = $('#qr-url').value.trim();
    $('#qr-note').textContent = /localhost|127\.0\.0\.1/.test(u) ? '⚠ localhost 주소는 폰에서 열리지 않습니다. "내부 IP로"를 누르거나 NAS 주소를 입력하세요.' : (u.indexOf('https:') === 0 ? '' : 'http 주소는 폰에서 플래시/화면 유지가 동작하지 않을 수 있습니다(HTTPS 권장).');
    fetch('/api/qr?url=' + encodeURIComponent(u), { headers: { 'x-token': token } }).then(function (r) { return r.text(); }).then(function (svg) { $('#qr-img').innerHTML = svg; $('#qr-img svg').style.cssText = 'width:100%;height:100%'; });
  }
  $('#qr-btn').onclick = function () { $('#qr-url').value = location.origin + '/'; $('#dlg-qr').showModal(); drawQr(); };
  $('#qr-url').oninput = drawQr;
  $('#qr-close').onclick = function () { $('#dlg-qr').close(); };
  $('#qr-ip').onclick = function () {
    api('GET', '/api/info').then(function (i) { if (i.ips[0]) { $('#qr-url').value = (i.https ? 'https' : 'http') + '://' + i.ips[0] + ':' + i.port + '/'; drawQr(); } else toast('내부 IP를 찾지 못했습니다'); });
  };

  /* ---------- 시작 ---------- */
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  if (token) api('GET', '/api/layouts').then(function () { boot(); }).catch(function () { $('#login').classList.remove('hidden'); });
  else $('#login').classList.remove('hidden');
  // 로그인 폼은 토큰 확인 전까지 보이지 않도록
  if (token) $('#login').classList.add('hidden');
  $('#bl-hz').dispatchEvent(new Event('input'));
  setColor(cur);
})();
