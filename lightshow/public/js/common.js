/* 서버·클라이언트 공용: 좌석 배치 계산, 패턴 인코딩, 미니 배치도 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ROWS = 60, MAX_SEATS = 40;
  var ALIGNS = ['left', 'center', 'right'];
  var B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function clampI(v, a, b, d) {
    v = parseInt(v, 10);
    if (!isFinite(v)) return d;
    return Math.min(b, Math.max(a, v));
  }

  /* 배치 JSON 정리(검증). 서버 저장·가져오기·편집기에서 공통 사용 */
  function sanitize(inp, fallbackId) {
    var o = inp && typeof inp === 'object' ? inp : {};
    var rows = clampI(o.rows, 1, MAX_ROWS, 20);
    var def = clampI(o.defaultSeats, 1, MAX_SEATS, 13);
    var rowSeats = [], rowAlign = [];
    for (var r = 0; r < rows; r++) {
      rowSeats.push(clampI(o.rowSeats && o.rowSeats[r], 1, MAX_SEATS, def));
      var a = o.rowAlign && o.rowAlign[r];
      rowAlign.push(ALIGNS.indexOf(a) >= 0 ? a : 'center');
    }
    var seen = {}, blocked = [];
    (Array.isArray(o.blocked) ? o.blocked : []).forEach(function (s) {
      if (typeof s !== 'string' || !/^\d+:\d+$/.test(s) || seen[s]) return;
      var p = s.split(':');
      var rr = +p[0], ii = +p[1];
      if (rr < rows && ii < rowSeats[rr]) { seen[s] = 1; blocked.push(s); }
    });
    var id = String(o.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || fallbackId || '';
    var name = String(o.name == null ? '' : o.name).trim().slice(0, 30) || '이름 없는 배치';
    return { id: id, name: name, rev: clampI(o.rev, 1, 1e9, 1), rows: rows, defaultSeats: def, rowSeats: rowSeats, rowAlign: rowAlign, blocked: blocked };
  }

  function cols(L) {
    var m = 1;
    for (var i = 0; i < L.rowSeats.length; i++) if (L.rowSeats[i] > m) m = L.rowSeats[i];
    return m;
  }
  function rowStart(L, r, W) {
    var n = L.rowSeats[r], a = L.rowAlign[r];
    return a === 'left' ? 0 : a === 'right' ? W - n : Math.floor((W - n) / 2);
  }
  /* 격자 계산: g[r][c] = null(좌석 없음) | {i: 줄 안 슬롯 번호, num: 표시되는 좌석 번호} */
  function grid(L) {
    var W = cols(L), H = L.rows, bl = {}, total = 0, g = [];
    L.blocked.forEach(function (s) { bl[s] = 1; });
    for (var r = 0; r < H; r++) {
      var row = new Array(W), s = rowStart(L, r, W), num = 0;
      for (var c = 0; c < W; c++) row[c] = null;
      for (var i = 0; i < L.rowSeats[r]; i++) {
        if (!bl[r + ':' + i]) { num++; total++; row[s + i] = { i: i, num: num }; }
      }
      g.push(row);
    }
    return { W: W, H: H, g: g, total: total };
  }
  function lid(L) { return L.id + '.' + L.rev; }

  /* 패턴: 색 배열(hex) <-> 팔레트 + 문자열 */
  function hexRgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function encodePx(colors) {
    var pal = ['#000000'], map = { '#000000': 0 }, px = '';
    var i, extra = [];
    for (i = 0; i < colors.length; i++) {
      var c = String(colors[i] || '#000000').toLowerCase();
      if (!HEX.test(c)) c = '#000000';
      if (map[c] === undefined) {
        if (pal.length < B62.length) { map[c] = pal.length; pal.push(c); }
        else extra.push(c);
      }
    }
    for (i = 0; i < colors.length; i++) {
      var k = String(colors[i] || '#000000').toLowerCase();
      if (!HEX.test(k)) k = '#000000';
      if (map[k] === undefined) { // 팔레트 초과 시 가장 가까운 색으로
        var a = hexRgb(k), best = 0, bd = 1e9;
        for (var j = 0; j < pal.length; j++) {
          var b = hexRgb(pal[j]), d = (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2]);
          if (d < bd) { bd = d; best = j; }
        }
        map[k] = best;
      }
      px += B62.charAt(map[k]);
    }
    return { pal: pal, px: px };
  }
  function decodePx(pal, px) {
    var out = new Array(px.length);
    for (var i = 0; i < px.length; i++) out[i] = pal[B62.indexOf(px.charAt(i))] || '#000000';
    return out;
  }
  function palIndex(ch) { return B62.indexOf(ch); }

  /* 작은 배치도(DOM).
     opts: cell(px), hlRow(줄 강조), me{r,i}, occ(r,c)->수, onClick(r,i), tint(r,c)->색 */
  function mapDOM(L, opts) {
    opts = opts || {};
    var G = grid(L), W = G.W, H = G.H, cell = opts.cell || 18;
    var el = document.createElement('div');
    el.className = 'lsmap';
    el.style.gridTemplateColumns = 'auto repeat(' + W + ',' + cell + 'px)';
    el.style.setProperty('--cell', cell + 'px');
    for (var r = 0; r < H; r++) {
      var lab = document.createElement('div');
      lab.className = 'rl' + (opts.hlRow === r ? ' hl' : '');
      lab.textContent = r + 1;
      lab.style.fontSize = Math.max(8, Math.min(13, cell * 0.62)) + 'px';
      el.appendChild(lab);
      for (var c = 0; c < W; c++) {
        var d = document.createElement('div'), s = G.g[r][c];
        var cls = 'c';
        if (!s) cls += ' none';
        else {
          cls += ' seat';
          if (opts.hlRow === r) cls += ' rowhl';
          if (opts.me && opts.me.r === r && opts.me.i === s.i) cls += ' me';
          if (opts.occ) {
            var n = opts.occ(r, c);
            if (n > 0) cls += n > 1 ? ' on dup' : ' on';
          }
          if (opts.onClick) { d.setAttribute('data-r', r); d.setAttribute('data-i', s.i); }
        }
        d.className = cls;
        if (s && opts.tint) { var t = opts.tint(r, c); if (t) d.style.background = t; }
        el.appendChild(d);
      }
    }
    if (opts.onClick) {
      el.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-r') != null) opts.onClick(+t.getAttribute('data-r'), +t.getAttribute('data-i'));
      });
    }
    return el;
  }

  /* 연출 상태 계산 (관객 폰·운영자 미리보기/LIVE 모니터 공용) */
  function applyCmd(st, m) {
    switch (m.k) {
      case 'bl': st.bl = m.hz ? { hz: m.hz, at: m.at } : null; break;
      case 'br': st.br = m.v; break;
      case 'off': st.scene = m; st.bl = null; break;
      default: st.scene = m;
    }
  }
  /* cell = {r,c} 또는 null(좌석 없는 건너뛰기 참여자: 전체 점등만 반응) */
  function colorAt(st, cell, W, H, now) {
    var s = st.scene, col = null;
    if (s.k === 'full') col = s.c;
    else if (cell) {
      if (s.k === 'pat') {
        if (s.w === W && s.h === H) col = s.pal[palIndex(s.px.charAt(cell.r * W + cell.c))] || null;
      } else if (s.k === 'scroll') {
        if (s.d === 'v') {
          var oy = Math.floor((now - s.at) / s.ms) % (s.h + H);
          if (oy < 0) oy = 0;
          var y = oy - H + cell.r;
          if (y >= 0 && y < s.h && s.w === W) col = s.pal[palIndex(s.px.charAt(y * s.w + cell.c))] || null;
          else col = s.pal[0] || null;
        } else {
          var o = Math.floor((now - s.at) / s.ms) % (s.w + W);
          if (o < 0) o = 0;
          var x = o - W + cell.c;
          if (x >= 0 && x < s.w && s.h === H) col = s.pal[palIndex(s.px.charAt(cell.r * s.w + x))] || null;
          else col = s.pal[0] || null;
        }
      } else if (s.k === 'wave') {
        var p = s.d === 'v' ? cell.r : cell.c, n = s.d === 'v' ? H : W;
        var head = Math.floor((now - s.at) / s.ms) % (n + s.bw);
        if (head < 0) head = 0;
        col = p <= head && head - p < s.bw ? s.c : s.bg;
      }
    }
    if (col && st.bl) {
      var ph = Math.floor((now - st.bl.at) * Math.min(3, st.bl.hz) * 2 / 1000);
      if (ph % 2 !== 0) col = null;
    }
    if (col === '#000000') col = null;
    return col;
  }

  return {
    MAX_ROWS: MAX_ROWS, MAX_SEATS: MAX_SEATS, ALIGNS: ALIGNS, B62: B62, HEX: HEX,
    sanitize: sanitize, cols: cols, rowStart: rowStart, grid: grid, lid: lid,
    encodePx: encodePx, decodePx: decodePx, palIndex: palIndex, applyCmd: applyCmd, colorAt: colorAt, mapDOM: mapDOM, clampI: clampI
  };
});
