// Shared helpers: data access, formatting, tiny SVG charts, lightbox.

export const TYPES = ['density', 'smb', 'temperature'];
export const TYPE_LABEL = { density: 'Density', smb: 'Surface mass balance', temperature: 'Temperature' };
export const TYPE_SHORT = { density: 'Density', smb: 'SMB', temperature: 'Temperature' };
export const ZONES = ['greenland', 'antarctica'];
export const ZONE_LABEL = { greenland: 'Greenland', antarctica: 'Antarctica' };
export const ZONE_SHORT = { greenland: 'GrIS', antarctica: 'AIS' };

// ---- data store ----------------------------------------------------------
export const D = {
  manifest: null,
  sources: [],
  basemap: null,
  byId: new Map(),
  groupOf: {}, // type -> method_key -> group id
  methodLabel: {}, // type -> method_key -> label
  folderIndex: new Map(), // "type/name" -> [source idx]
  _loc: {},
};

export async function loadData() {
  const j = (u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`${u}: ${r.status}`);
    return r.json();
  });
  const [manifest, sources, basemap] = await Promise.all([
    j('data/manifest.json'), j('data/sources.json'), j('data/basemap.json'),
  ]);
  D.manifest = manifest;
  D.sources = sources;
  D.basemap = basemap;
  for (const s of sources) {
    D.byId.set(s.id, s);
    s.total = 0;
    s.sites = 0;
    s.y0 = null;
    s.y1 = null;
    for (const [t, v] of Object.entries(s.types)) {
      const n = (v.n.greenland || 0) + (v.n.antarctica || 0);
      v.total = n;
      s.total += n;
      s.sites += v.sites || 0;
      if (v.y0) s.y0 = s.y0 == null ? v.y0 : Math.min(s.y0, v.y0);
      if (v.y1) s.y1 = s.y1 == null ? v.y1 : Math.max(s.y1, v.y1);
    }
    s.zones = ZONES.filter((z) => Object.values(s.types).some((v) => (v.n[z] || 0) > 0));
    s.nfigs = s.folders.reduce((a, f) => a + f.figs.length, 0);
    for (const f of s.folders) {
      const k = f.type + '/' + f.name;
      if (!D.folderIndex.has(k)) D.folderIndex.set(k, []);
      D.folderIndex.get(k).push(s.i);
    }
  }
  for (const [t, info] of Object.entries(manifest.types)) {
    D.groupOf[t] = {};
    D.methodLabel[t] = {};
    for (const m of info.methods) {
      D.groupOf[t][m.key] = m.group;
      D.methodLabel[t][m.key] = m.label;
    }
    info.groupById = Object.fromEntries(info.groups.map((g) => [g.id, g]));
  }
}

/** binary location table for (type, zone) */
export function loadLoc(type, zone) {
  const k = type + '/' + zone;
  if (D._loc[k]) return D._loc[k];
  const info = D.manifest.types[type].zones[zone];
  D._loc[k] = fetch('data/' + info.file)
    .then((r) => r.arrayBuffer())
    .then((buf) => {
      const N = new DataView(buf).getUint32(0, true);
      let o = 4;
      const take = (C, n) => {
        const a = new C(buf, o, N);
        o += n * N;
        return a;
      };
      return {
        N,
        ranges: info.ranges,
        x: take(Float32Array, 4),
        y: take(Float32Array, 4),
        n: take(Uint32Array, 4),
        src: take(Uint16Array, 2),
        y0: take(Uint16Array, 2),
        y1: take(Uint16Array, 2),
        // method row of each cell (derived from the contiguous ranges)
        m: (() => {
          const m = new Uint8Array(buf, o, N);
          return m;
        })(),
      };
    });
  return D._loc[k];
}

// ---- formatting ------------------------------------------------------------
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtInt = (n) => Number(n).toLocaleString('en-US');
export function fmtCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' M';
  if (n >= 1e4) return Math.round(n / 1e3) + ' k';
  return fmtInt(n);
}
export const fmtYears = (a, b) => (a == null ? 'undated' : a === b || b == null ? `${a}` : `${a}–${b}`);
export const num = (v, d = 2) => (v == null ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const typeColor = (t) => getComputedStyle(document.documentElement).getPropertyValue('--c-' + t).trim();

export function typeDots(s) {
  return Object.keys(s.types)
    .sort((a, b) => TYPES.indexOf(a) - TYPES.indexOf(b))
    .map((t) => `<span class="tchip t-${t}" title="${TYPE_LABEL[t]}">${TYPE_SHORT[t]}</span>`)
    .join('');
}

// ---- tiny SVG charts ---------------------------------------------------------
/** year histogram; hist = [[year,count],...] */
export function histSvg(hist, type, { w = 420, h = 90 } = {}) {
  if (!hist || !hist.length) return '<p class="muted small">No dated measurements.</p>';
  const ys = hist.map((d) => d[0]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y1 - y0 + 1;
  // bin to <= 60 bars
  const step = Math.max(1, Math.ceil(span / 60));
  const bins = new Map();
  for (const [y, n] of hist) {
    const b = y0 + Math.floor((y - y0) / step) * step;
    bins.set(b, (bins.get(b) || 0) + n);
  }
  const maxN = Math.max(...bins.values());
  const padL = 4, padR = 4, padT = 6, padB = 18;
  const iw = w - padL - padR, ih = h - padT - padB;
  const nb = Math.ceil(span / step);
  const bw = iw / nb;
  let bars = '';
  for (const [b, n] of bins) {
    const x = padL + ((b - y0) / step) * bw;
    const bh = Math.max(1.5, (n / maxN) * ih); // linear: counts are an extensive quantity
    const lab = step > 1 ? `${b}–${b + step - 1}` : b;
    bars += `<rect x="${(x + 0.5).toFixed(1)}" y="${(padT + ih - bh).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" class="bar t-${type}"><title>${lab}: ${fmtInt(n)} measurements</title></rect>`;
  }
  return `<svg class="hist" viewBox="0 0 ${w} ${h}" role="img" aria-label="Measurements per year, ${y0} to ${y1}">
    <line x1="${padL}" x2="${w - padR}" y1="${padT + ih + 0.5}" y2="${padT + ih + 0.5}" class="axis"/>
    ${bars}
    <text x="${padL}" y="${h - 4}" class="axt">${y0}</text>
    <text x="${w - padR}" y="${h - 4}" text-anchor="end" class="axt">${y1}</text>
    <text x="${w / 2}" y="${h - 4}" text-anchor="middle" class="axt">max ${fmtInt(maxN)} / ${step > 1 ? step + ' yr' : 'yr'}</text>
  </svg>`;
}

/** horizontal bars: rows = [{label, n, color?, sub?}] */
export function barsHtml(rows, { color = 'var(--accent)' } = {}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return `<ul class="bars">${rows
    .map(
      (r) => `<li><span class="bl" title="${esc(r.title || r.label)}">${esc(r.label)}</span>
      <span class="bt"><span class="bf" style="width:${Math.max(0.5, (r.n / max) * 100).toFixed(1)}%;background:${r.color || color}"></span></span>
      <span class="bn">${fmtInt(r.n)}</span></li>`
    )
    .join('')}</ul>`;
}

// ---- lightbox ----------------------------------------------------------------
let lb;
export function openLightbox(items, idx) {
  if (!lb) {
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<button class="lb-close" aria-label="Close">×</button><button class="lb-prev" aria-label="Previous">‹</button>
      <figure><img alt=""><figcaption></figcaption></figure><button class="lb-next" aria-label="Next">›</button>`;
    document.body.appendChild(lb);
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target.classList.contains('lb-close')) closeLb();
    });
    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') lb._step(-1);
      if (e.key === 'ArrowRight') lb._step(1);
    });
  }
  const show = () => {
    const it = items[idx];
    lb.querySelector('img').src = it.src;
    lb.querySelector('figcaption').textContent = it.caption || '';
    lb.querySelector('.lb-prev').style.visibility = lb.querySelector('.lb-next').style.visibility = items.length > 1 ? 'visible' : 'hidden';
  };
  lb._step = (d) => {
    idx = (idx + d + items.length) % items.length;
    show();
  };
  lb.querySelector('.lb-prev').onclick = () => lb._step(-1);
  lb.querySelector('.lb-next').onclick = () => lb._step(1);
  show();
  lb.classList.add('open');
}
function closeLb() {
  lb.classList.remove('open');
}
