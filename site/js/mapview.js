// Interactive map view: agglomerated measurement locations in polar stereographic projection,
// switchable by variable / method group / individual method, period and source.
import { PolarMap, theme } from './polarmap.js';
import {
  D, TYPES, TYPE_LABEL, ZONES, ZONE_LABEL, loadLoc, esc, fmtInt, fmtCount, fmtYears,
} from './ui.js';

const DRAW_ORDER = ['smb', 'density', 'temperature']; // dense layers first, sparse on top
const MIN_YEAR = 1900;
const MAX_YEAR = new Date().getFullYear();

export function createMapView(root) {
  const S = {
    zone: 'greenland',
    colorBy: 'variable',
    typeOn: { density: true, smb: true, temperature: true },
    vis: {},
    yearLo: MIN_YEAR,
    yearHi: MAX_YEAR,
    undated: true,
    size: 1,
    alpha: 0.9,
    src: -1,
    loc: {},
    sel: null,
  };
  for (const t of TYPES) S.vis[t] = new Uint8Array(D.manifest.types[t].methods.length).fill(1);

  root.innerHTML = `
  <aside class="side" aria-label="Map controls">
    <div class="side-sec">
      <div class="seg" role="group" aria-label="Region">
        ${ZONES.map((z) => `<button data-zone="${z}" class="${z === S.zone ? 'on' : ''}">${ZONE_LABEL[z]}</button>`).join('')}
      </div>
      <div id="src-chip"></div>
    </div>
    <div class="side-sec">
      <h3>Measurements &amp; methods</h3>
      <div id="layers"></div>
    </div>
    <div class="side-sec">
      <h3>Colour by</h3>
      <div class="seg" role="group" aria-label="Colour by">
        <button data-color="variable" class="on">Variable</button><button data-color="method">Method group</button>
      </div>
    </div>
    <div class="side-sec">
      <h3>Period <span class="muted small" id="yr-label"></span></h3>
      <label class="rng"><span>From</span><input type="range" id="yr-lo" min="${MIN_YEAR}" max="${MAX_YEAR}" value="${MIN_YEAR}"></label>
      <label class="rng"><span>To</span><input type="range" id="yr-hi" min="${MIN_YEAR}" max="${MAX_YEAR}" value="${MAX_YEAR}"></label>
      <label class="chk"><input type="checkbox" id="undated" checked> include undated measurements</label>
    </div>
    <div class="side-sec">
      <h3>Display</h3>
      <label class="rng"><span>Marker size</span><input type="range" id="size" min="0.5" max="3" step="0.1" value="1"></label>
      <label class="rng"><span>Opacity</span><input type="range" id="alpha" min="0.2" max="1" step="0.05" value="0.9"></label>
      <label class="chk"><input type="checkbox" id="show-ice" checked> ice sheet &amp; land</label>
      <label class="chk"><input type="checkbox" id="show-grid" checked> graticule</label>
    </div>
    <p class="muted small note">Each marker is an <b>agglomerated location</b>: all measurements of one source and method
      that fall in the same grid cell (250 m for density and temperature, 500 m for SMB). Click the map for details.</p>
  </aside>
  <div class="stage">
    <canvas aria-label="Map of SUMup measurement locations"></canvas>
    <div class="map-btns">
      <button id="zin" title="Zoom in" aria-label="Zoom in">+</button>
      <button id="zout" title="Zoom out" aria-label="Zoom out">−</button>
      <button id="zfit" title="Reset view" aria-label="Reset view">⤢</button>
    </div>
    <div class="map-status"><span id="status"></span><span id="coords" class="muted"></span></div>
    <div class="map-loading" id="loading">Loading locations…</div>
    <div class="tip" id="tip" hidden></div>
    <div class="selpanel" id="selpanel" hidden></div>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const canvas = $('canvas');
  const tip = $('#tip');
  const selpanel = $('#selpanel');

  // ---------------------------------------------------------------- layers UI
  const cards = {};
  const layersEl = $('#layers');
  for (const t of TYPES) {
    const info = D.manifest.types[t];
    const card = document.createElement('section');
    card.className = 'layer';
    card.dataset.type = t;
    card.innerHTML = `
      <header>
        <label class="lt"><input type="checkbox" class="type-toggle" checked>
          <span class="dot t-${t}"></span><b>${TYPE_LABEL[t]}</b></label>
        <span class="n muted small"></span>
      </header>
      <ul class="groups"></ul>`;
    const ul = card.querySelector('.groups');
    const rec = { el: card, n: card.querySelector('.n'), groups: {} };
    for (const g of info.groups) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="grow">
          <label><input type="checkbox" class="gcb" checked><span class="sw"></span><span class="gl">${esc(g.label)}</span></label>
          <span class="n muted small"></span>
          <button class="more" aria-label="Show individual methods" title="Individual methods" aria-expanded="false">▸</button>
        </div>
        <ul class="methods" hidden></ul>`;
      const mul = li.querySelector('.methods');
      const grec = { el: li, cb: li.querySelector('.gcb'), sw: li.querySelector('.sw'), n: li.querySelector('.n'), methods: [] };
      info.methods.forEach((m, r) => {
        if (m.group !== g.id) return;
        const mli = document.createElement('li');
        mli.innerHTML = `<label><input type="checkbox" checked><span class="ml">${esc(m.label)}</span></label><span class="n muted small"></span>`;
        mul.appendChild(mli);
        grec.methods.push({ r, li: mli, cb: mli.querySelector('input'), n: mli.querySelector('.n') });
      });
      li.querySelector('.more').onclick = (e) => {
        const open = mul.hidden;
        mul.hidden = !open;
        e.currentTarget.textContent = open ? '▾' : '▸';
        e.currentTarget.setAttribute('aria-expanded', open);
      };
      grec.cb.onchange = () => {
        for (const m of grec.methods) {
          S.vis[t][m.r] = grec.cb.checked ? 1 : 0;
          m.cb.checked = grec.cb.checked;
        }
        grec.cb.indeterminate = false;
        map.draw();
      };
      for (const m of grec.methods) {
        m.cb.onchange = () => {
          S.vis[t][m.r] = m.cb.checked ? 1 : 0;
          const on = grec.methods.filter((k) => k.cb.checked).length;
          grec.cb.checked = on > 0;
          grec.cb.indeterminate = on > 0 && on < grec.methods.length;
          map.draw();
        };
      }
      rec.groups[g.id] = grec;
      ul.appendChild(li);
    }
    card.querySelector('.type-toggle').onchange = (e) => {
      S.typeOn[t] = e.target.checked;
      card.classList.toggle('off', !e.target.checked);
      map.draw();
    };
    cards[t] = rec;
    layersEl.appendChild(card);
  }

  function refreshLayerUI() {
    for (const t of TYPES) {
      const info = D.manifest.types[t];
      const rec = cards[t];
      let tot = 0;
      for (const g of info.groups) {
        const gr = rec.groups[g.id];
        let gn = 0;
        for (const m of gr.methods) {
          const n = info.methods[m.r]['n_' + S.zone] || 0;
          m.n.textContent = fmtCount(n);
          m.li.hidden = n === 0;
          gn += n;
        }
        gr.n.textContent = fmtCount(gn);
        gr.el.hidden = gn === 0;
        tot += gn;
        const col = S.colorBy === 'variable' ? theme['c_' + t] : g.color;
        gr.sw.style.background = col;
        gr.sw.className = 'sw s-' + t;
      }
      rec.n.textContent = tot ? fmtCount(tot) + ' meas.' : 'none here';
      rec.el.classList.toggle('empty', tot === 0);
    }
  }

  // ---------------------------------------------------------------- map
  const colorFor = (t, r) => {
    if (S.colorBy === 'variable') return theme['c_' + t];
    const info = D.manifest.types[t];
    return info.groupById[info.methods[r].group].color;
  };

  let statusTxt = '';
  // One stamp per screen pixel and (type, method): when zoomed out, many cells fall on the same pixel
  // and drawing each of them is the main cost, so a pixel is painted only once per method.
  let stamps = new Uint32Array(0), stampId = 0;
  function drawPoints(ctx, map) {
    if (stamps.length !== map.w * map.h) { stamps = new Uint32Array(map.w * map.h); stampId = 0; }
    const z = S.zone;
    const lo = S.yearLo > MIN_YEAR ? S.yearLo : -1;
    const hi = S.yearHi < MAX_YEAR ? S.yearHi : 1e9;
    const und = S.undated, sf = S.src;
    const inv = 1 / map.s, hw = map.w / 2, hh = map.h / 2, cx = map.cx, cy = map.cy, W = map.w, H = map.h;
    let cells = 0, nmeas = 0;
    ctx.globalAlpha = S.alpha;
    for (const t of DRAW_ORDER) {
      if (!S.typeOn[t]) continue;
      const L = S.loc[t]?.[z];
      if (!L) continue;
      const vis = S.vis[t];
      const isSq = t === 'smb';
      const sz = (isSq ? 2.4 : 5.2) * S.size;
      const half = sz / 2;
      for (let r = 0; r < L.ranges.length; r++) {
        if (!vis[r]) continue;
        const a = L.ranges[r][0], b = L.ranges[r][1];
        if (a === b) continue;
        ctx.fillStyle = colorFor(t, r);
        if (!isSq) ctx.beginPath();
        stampId++;
        for (let i = a; i < b; i++) {
          if (sf >= 0 && L.src[i] !== sf) continue;
          const y0 = L.y0[i], y1 = L.y1[i];
          if (y0 | y1) {
            const ya = y0 || y1, yb = y1 || y0;
            if (yb < lo || ya > hi) continue;
          } else if (!und) continue;
          cells++;
          nmeas += L.n[i];
          const px = (L.x[i] - cx) * inv + hw;
          const py = hh - (L.y[i] - cy) * inv;
          if (px < -sz || py < -sz || px > W + sz || py > H + sz) continue;
          if (px >= 0 && py >= 0 && px < W && py < H) {
            const k = (py | 0) * W + (px | 0);
            if (stamps[k] === stampId) continue;
            stamps[k] = stampId;
          }
          if (isSq) ctx.fillRect(px - half, py - half, sz, sz);
          else if (t === 'density') {
            ctx.moveTo(px + half, py);
            ctx.arc(px, py, half, 0, 6.2832);
          } else { // temperature: diamond
            const d = half * 1.25;
            ctx.moveTo(px, py - d); ctx.lineTo(px + d, py); ctx.lineTo(px, py + d); ctx.lineTo(px - d, py); ctx.closePath();
          }
        }
        if (!isSq) {
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = theme.edge;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    if (S.sel) {
      const [px, py] = map.toScreen(S.sel[0], S.sel[1]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.gridtext;
      ctx.beginPath(); ctx.arc(px, py, 11, 0, 6.2832); ctx.stroke();
    }
    const txt = `${fmtInt(cells)} locations · ${fmtCount(nmeas)} measurements shown`;
    if (txt !== statusTxt) {
      statusTxt = txt;
      $('#status').textContent = txt;
    }
  }

  const map = new PolarMap(canvas, {
    zone: S.zone,
    basemap: D.basemap,
    interactive: true,
    drawPoints,
    onMove(lat, lon, px, py) {
      $('#coords').textContent = `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'}  ${Math.abs(lon).toFixed(2)}°${lon < 0 ? 'W' : 'E'}`;
      hover(px, py);
    },
    onLeave() { tip.hidden = true; },
    onClick(px, py) { select(px, py); },
  });

  // ---------------------------------------------------------------- picking
  function query(px, py, rad) {
    const z = S.zone;
    const lo = S.yearLo > MIN_YEAR ? S.yearLo : -1;
    const hi = S.yearHi < MAX_YEAR ? S.yearHi : 1e9;
    const [mx, my] = map.toMap(px, py);
    const rr = rad * map.s;
    const r2 = rr * rr;
    const groups = new Map();
    for (const t of TYPES) {
      if (!S.typeOn[t]) continue;
      const L = S.loc[t]?.[z];
      if (!L) continue;
      for (let r = 0; r < L.ranges.length; r++) {
        if (!S.vis[t][r]) continue;
        for (let i = L.ranges[r][0]; i < L.ranges[r][1]; i++) {
          const dx = L.x[i] - mx, dy = L.y[i] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (S.src >= 0 && L.src[i] !== S.src) continue;
          const y0 = L.y0[i], y1 = L.y1[i];
          if (y0 | y1) {
            if ((y1 || y0) < lo || (y0 || y1) > hi) continue;
          } else if (!S.undated) continue;
          const key = t + '|' + L.src[i] + '|' + r;
          let g = groups.get(key);
          if (!g) groups.set(key, (g = { t, r, src: L.src[i], n: 0, cells: 0, y0: 0, y1: 0, d2: d2, x: L.x[i], y: L.y[i] }));
          g.n += L.n[i];
          g.cells++;
          if (y0 && (!g.y0 || y0 < g.y0)) g.y0 = y0;
          if (y1 && y1 > g.y1) g.y1 = y1;
          if (d2 < g.d2) { g.d2 = d2; g.x = L.x[i]; g.y = L.y[i]; }
        }
      }
    }
    return [...groups.values()].sort((a, b) => a.d2 - b.d2);
  }

  const methodLabel = (g) => D.manifest.types[g.t].methods[g.r].label;
  const groupLabel = (g) => {
    const info = D.manifest.types[g.t];
    return info.groupById[info.methods[g.r].group].label;
  };

  function hover(px, py) {
    const hits = query(px, py, 7);
    if (!hits.length) { tip.hidden = true; return; }
    const g = hits[0], s = D.sources[g.src];
    tip.innerHTML = `<b>${esc(s.short)}</b><br><span class="muted">${TYPE_LABEL[g.t]} · ${esc(groupLabel(g))}</span><br>
      ${fmtYears(g.y0 || null, g.y1 || null)} · ${fmtInt(g.n)} measurements${hits.length > 1 ? `<br><span class="muted">+ ${hits.length - 1} more here · click for list</span>` : ''}`;
    tip.hidden = false;
    const W = canvas.clientWidth;
    tip.style.left = Math.min(px + 14, W - 280) + 'px';
    tip.style.top = Math.max(8, py - 10) + 'px';
  }

  function select(px, py) {
    const hits = query(px, py, 9);
    if (!hits.length) {
      S.sel = null;
      selpanel.hidden = true;
      map.draw();
      return;
    }
    S.sel = [hits[0].x, hits[0].y];
    const [lat, lon] = map.proj.inverse(hits[0].x, hits[0].y);
    const rows = hits.slice(0, 40).map((g) => {
      const s = D.sources[g.src];
      return `<li>
        <span class="tchip t-${g.t}">${TYPE_LABEL[g.t]}</span>
        <a href="#/source/${encodeURIComponent(s.id)}">${esc(s.short)}</a>
        <div class="muted small">${esc(methodLabel(g))} · ${fmtYears(g.y0 || null, g.y1 || null)} · ${fmtInt(g.n)} measurements${g.cells > 1 ? ` in ${g.cells} cells` : ''}</div>
        <div class="small"><a href="#/map?src=${encodeURIComponent(s.id)}" data-iso="${esc(s.id)}">show only this source</a></div>
      </li>`;
    }).join('');
    selpanel.innerHTML = `<button class="x" aria-label="Close">×</button>
      <h4>${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(3)}°${lon < 0 ? 'W' : 'E'}</h4>
      <ul>${rows}</ul>${hits.length > 40 ? `<p class="muted small">+ ${hits.length - 40} more entries</p>` : ''}`;
    selpanel.hidden = false;
    selpanel.querySelector('.x').onclick = () => { S.sel = null; selpanel.hidden = true; map.draw(); };
    selpanel.querySelectorAll('[data-iso]').forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); setSource(a.dataset.iso, true); };
    });
    map.draw();
  }

  // ---------------------------------------------------------------- zones / loading
  async function ensureLoaded(zone) {
    const need = TYPES.filter((t) => !S.loc[t]?.[zone]);
    if (!need.length) return;
    $('#loading').hidden = false;
    await Promise.all(need.map(async (t) => {
      (S.loc[t] ||= {})[zone] = await loadLoc(t, zone);
    }));
    $('#loading').hidden = true;
  }

  async function setZone(zone, fit = true) {
    S.zone = zone;
    root.querySelectorAll('[data-zone]').forEach((b) => b.classList.toggle('on', b.dataset.zone === zone));
    S.sel = null;
    selpanel.hidden = true;
    await ensureLoaded(zone);
    refreshLayerUI();
    map.setZone(zone, fit);
  }

  function filterBounds() {
    const z = S.zone;
    let b = null;
    for (const t of TYPES) {
      const L = S.loc[t]?.[z];
      if (!L) continue;
      for (let i = 0; i < L.N; i++) {
        if (L.src[i] !== S.src) continue;
        if (!b) b = [L.x[i], L.y[i], L.x[i], L.y[i]];
        else {
          if (L.x[i] < b[0]) b[0] = L.x[i];
          if (L.y[i] < b[1]) b[1] = L.y[i];
          if (L.x[i] > b[2]) b[2] = L.x[i];
          if (L.y[i] > b[3]) b[3] = L.y[i];
        }
      }
    }
    if (!b) return null;
    const minw = 60e3;
    if (b[2] - b[0] < minw) { const c = (b[0] + b[2]) / 2; b[0] = c - minw / 2; b[2] = c + minw / 2; }
    if (b[3] - b[1] < minw) { const c = (b[1] + b[3]) / 2; b[1] = c - minw / 2; b[3] = c + minw / 2; }
    return b;
  }

  async function setSource(id, fit = true) {
    const chip = $('#src-chip');
    if (!id) {
      S.src = -1;
      chip.innerHTML = '';
      map.draw();
      return;
    }
    const s = D.byId.get(id);
    if (!s) return;
    S.src = s.i;
    // pick region where this source has most data
    const best = ZONES.map((z) => [z, Object.values(s.types).reduce((a, v) => a + (v.n[z] || 0), 0)]).sort((a, b) => b[1] - a[1])[0][0];
    if (best !== S.zone) await setZone(best, false);
    else await ensureLoaded(S.zone);
    chip.innerHTML = `<div class="chip-src">Showing only <b>${esc(s.short)}</b>
      <a href="#/source/${encodeURIComponent(s.id)}" class="small">report</a>
      <button aria-label="Clear source filter" title="Show all sources">×</button></div>`;
    chip.querySelector('button').onclick = () => { history.replaceState(null, '', '#/map'); setSource(null); };
    refreshLayerUI();
    const b = filterBounds();
    if (b && fit) map.fit(b, 0.12);
    else map.draw();
  }

  // ---------------------------------------------------------------- wiring
  root.querySelectorAll('[data-zone]').forEach((b) => (b.onclick = () => setZone(b.dataset.zone)));
  root.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => {
    S.colorBy = b.dataset.color;
    root.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('on', x === b));
    refreshLayerUI();
    map.draw();
  }));
  const yrLabel = () => {
    const lo = S.yearLo > MIN_YEAR ? S.yearLo : `≤${MIN_YEAR}`;
    const hi = S.yearHi < MAX_YEAR ? S.yearHi : 'now';
    $('#yr-label').textContent = `${lo} – ${hi}`;
  };
  yrLabel();
  $('#yr-lo').oninput = (e) => {
    S.yearLo = +e.target.value;
    if (S.yearLo > S.yearHi) { S.yearHi = S.yearLo; $('#yr-hi').value = S.yearHi; }
    yrLabel(); map.draw();
  };
  $('#yr-hi').oninput = (e) => {
    S.yearHi = +e.target.value;
    if (S.yearHi < S.yearLo) { S.yearLo = S.yearHi; $('#yr-lo').value = S.yearLo; }
    yrLabel(); map.draw();
  };
  $('#undated').onchange = (e) => { S.undated = e.target.checked; map.draw(); };
  $('#size').oninput = (e) => { S.size = +e.target.value; map.draw(); };
  $('#alpha').oninput = (e) => { S.alpha = +e.target.value; map.draw(); };
  $('#show-ice').onchange = (e) => { map.showIce = e.target.checked; map.draw(); };
  $('#show-grid').onchange = (e) => { map.showGrid = e.target.checked; map.draw(); };
  $('#zin').onclick = () => map.zoomAt(map.w / 2, map.h / 2, 1.6);
  $('#zout').onclick = () => map.zoomAt(map.w / 2, map.h / 2, 1 / 1.6);
  $('#zfit').onclick = () => (S.src >= 0 && filterBounds() ? map.fit(filterBounds(), 0.12) : map.reset());

  let ready = setZone('greenland');

  return {
    /** called by the router every time the map tab is shown */
    async show(params) {
      await ready;
      map.resize();
      if (params.src !== undefined && params.src !== (D.sources[S.src]?.id ?? '')) await setSource(params.src);
      else if (params.zone && ZONES.includes(params.zone) && params.zone !== S.zone) await setZone(params.zone);
      map.draw();
    },
    refresh() { refreshLayerUI(); map.draw(); },
  };
}
