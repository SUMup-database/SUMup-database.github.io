// "Sources" report view and "Search" view.
import { PolarMap, theme } from './polarmap.js';
import { search } from './search.js';
import {
  D, TYPES, TYPE_LABEL, ZONES, ZONE_LABEL, ZONE_SHORT, loadLoc, esc, fmtInt, fmtYears, num,
  typeDots, histSvg, barsHtml, openLightbox,
} from './ui.js';

const UNIT = { density: 'kg m⁻³', smb: 'm w.e. yr⁻¹', temperature: '°C' };
const VAL_LABEL = { density: 'Density', smb: 'SMB', temperature: 'Temperature' };

// =============================================================================
// report
// =============================================================================
function mapsOf(s) {
  return ZONES.filter((z) => s.zones.includes(z));
}

function typeSection(s, t) {
  const v = s.types[t];
  const info = D.manifest.types[t];
  const facts = [
    ['Measurements', fmtInt(v.total)],
    ['Sites / profiles', fmtInt(v.sites)],
    ['Period', fmtYears(v.y0, v.y1)],
    ['Regions', ZONES.filter((z) => v.n[z] > 0).map((z) => `${ZONE_LABEL[z]} (${fmtInt(v.n[z])})`).join(', ') || '–'],
    ['Latitude', v.lat ? `${num(v.lat[0], 2)}° to ${num(v.lat[1], 2)}°` : '–'],
    ['Elevation', v.elev ? `${fmtInt(v.elev[0])} to ${fmtInt(v.elev[1])} m` : '–'],
    [`${VAL_LABEL[t]} (min / median / max)`, v.val ? `${num(v.val[0])} / ${num(v.val[1])} / ${num(v.val[2])} ${UNIT[t]}` : '–'],
  ];
  if (t !== 'smb' && v.depthMax != null) facts.push([t === 'density' ? 'Deepest sample' : 'Deepest sensor', `${num(v.depthMax, 1)} m`]);
  facts.push(['Release', `SUMup ${D.manifest.release[t]}`]);

  const entries = Object.entries(v.methods || {})
    .map(([k, n]) => ({ k, n, label: D.methodLabel[t][k] ?? 'not specified' }))
    .sort((a, b) => b.n - a.n);
  const top = entries.slice(0, 8);
  const rest = entries.slice(8).reduce((a, b) => a + b.n, 0);
  if (rest) top.push({ label: `${entries.length - 8} other methods`, n: rest });
  const names = (v.names || []).map((n) => `<span class="name">${esc(n)}</span>`).join('');
  const more = v.namesTotal > (v.names || []).length ? `<span class="muted small"> … and ${fmtInt(v.namesTotal - v.names.length)} more</span>` : '';

  return `<section class="card type-card" data-t="${t}">
    <h3><span class="dot t-${t}"></span>${TYPE_LABEL[t]} <span class="muted small">${UNIT[t]}</span></h3>
    <div class="two">
      <dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>
      <div>
        <h4>Measurements per year</h4>
        ${histSvg(v.hist, t)}
      </div>
    </div>
    <h4>Methods</h4>
    ${barsHtml(top, { color: `var(--c-${t})` })}
    <h4>Sites / profiles <span class="muted small">(${fmtInt(v.namesTotal)})</span></h4>
    <div class="names">${names || '<span class="muted small">none listed</span>'}${more}</div>
  </section>`;
}

function folderSection(s, f, allFigs) {
  const siblings = (D.folderIndex.get(f.type + '/' + f.name) || []).filter((i) => i !== s.i);
  const links = [];
  if (f.url) {
    links.push(`<a href="${f.url}" target="_blank" rel="noopener">dataset folder on GitHub ↗</a>`);
    if (f.process) links.push(`<a href="${f.url}/process.py" target="_blank" rel="noopener">process.py ↗</a>`);
  }
  const figs = f.figs.map((fig) => {
    const idx = allFigs.length;
    allFigs.push({ src: fig.src, caption: `${s.short} — ${f.name} / ${fig.name}` });
    return `<button class="thumb" data-fig="${idx}" title="${esc(fig.name)}"><img loading="lazy" src="${fig.src}" alt="${esc(fig.name)}"><span>${esc(fig.name)}</span></button>`;
  }).join('');
  return `<div class="folder">
    <div class="folder-h"><code>${esc(f.name)}</code> <span class="tchip t-${f.type}">${TYPE_LABEL[f.type]}</span>
      <span class="muted small">${links.join(' · ')}</span></div>
    ${figs ? `<div class="gallery">${figs}</div>` : '<p class="muted small">No plots were generated for this dataset folder.</p>'}
    ${siblings.length ? `<p class="muted small">This folder also feeds ${siblings.length} other source${siblings.length > 1 ? 's' : ''}: ${siblings.slice(0, 8).map((i) => `<a href="#/source/${encodeURIComponent(D.sources[i].id)}">${esc(D.sources[i].short)}</a>`).join(', ')}${siblings.length > 8 ? ', …' : ''}</p>` : ''}
    <details><summary>Raw files (${f.nfiles})</summary><ul class="files">${f.files.map((n) => `<li>${esc(n)}</li>`).join('')}${f.nfiles > f.files.length ? '<li>…</li>' : ''}</ul></details>
    ${f.bibtex ? `<details><summary>BibTeX</summary><pre class="bib">${esc(f.bibtex)}</pre></details>` : ''}
  </div>`;
}

let minis = [];
export function renderReport(el, s) {
  minis.forEach((m) => m.destroy());
  minis = [];
  const doi = s.doi ? `<a href="https://doi.org/${encodeURI(s.doi)}" target="_blank" rel="noopener">doi:${esc(s.doi)} ↗</a>` : '';
  const tList = Object.keys(s.types).sort((a, b) => TYPES.indexOf(a) - TYPES.indexOf(b));
  const zones = mapsOf(s);
  const allFigs = [];
  const folders = s.folders.map((f) => folderSection(s, f, allFigs)).join('');

  el.innerHTML = `
  <header class="rep-h">
    <div class="crumbs small muted"><a href="#/sources">Sources</a> › ${esc(s.bibtex || s.id)}</div>
    <h2>${esc(s.short)}</h2>
    <div class="chips">${typeDots(s)} ${s.zones.map((z) => `<span class="zchip">${ZONE_LABEL[z]}</span>`).join('')}
      ${s.compilation ? `<span class="zchip" title="This source is itself reported in a compilation">compiled in ${esc(s.compilation)}</span>` : ''}</div>
    <p class="refline">${esc(s.ref) || '<span class="muted">No full reference text available.</span>'}</p>
    <p class="small">${doi} ${doi ? '·' : ''} <a href="#/map?src=${encodeURIComponent(s.id)}">Show on the map →</a></p>
  </header>

  <div class="tiles">
    <div class="tile"><span class="k">Measurements</span><span class="v">${fmtInt(s.total)}</span></div>
    <div class="tile"><span class="k">Sites / profiles</span><span class="v">${fmtInt(s.sites)}</span></div>
    <div class="tile"><span class="k">Period</span><span class="v">${fmtYears(s.y0, s.y1)}</span></div>
    <div class="tile"><span class="k">Variables</span><span class="v">${tList.length}</span></div>
  </div>

  <section class="card">
    <h3>Where</h3>
    <div class="minis">${zones.map((z) => `<figure class="mini" data-zone="${z}"><div class="mini-box"><canvas></canvas></div>
      <figcaption>${ZONE_LABEL[z]} · <a href="#/map?src=${encodeURIComponent(s.id)}&zone=${z}">open on map</a></figcaption></figure>`).join('')}</div>
    <p class="legend small muted">${tList.map((t) => `<span class="dot t-${t}"></span>${TYPE_LABEL[t]}`).join(' &nbsp; ')} — agglomerated locations</p>
  </section>

  ${tList.map((t) => typeSection(s, t)).join('')}

  <section class="card">
    <h3>Plots &amp; processing</h3>
    ${folders || `<p class="muted">This source has no per-dataset folder in the compilation repository. It was inherited from the
      2023 release (or an earlier compilation), so no processing script or diagnostic plot is available.</p>`}
  </section>`;

  el.querySelectorAll('[data-fig]').forEach((b) => (b.onclick = () => openLightbox(allFigs, +b.dataset.fig)));

  // mini maps
  el.querySelectorAll('.mini').forEach((fig) => {
    const z = fig.dataset.zone;
    const canvas = fig.querySelector('canvas');
    const pts = [];
    const map = new PolarMap(canvas, {
      zone: z,
      basemap: D.basemap,
      interactive: false,
      drawPoints(ctx, m) {
        for (const p of pts) {
          ctx.fillStyle = theme['c_' + p.t];
          const half = p.t === 'smb' ? 1.6 : 3.4;
          for (let i = 0; i < p.x.length; i++) {
            const [px, py] = m.toScreen(p.x[i], p.y[i]);
            if (p.t === 'smb') ctx.fillRect(px - half, py - half, half * 2, half * 2);
            else {
              ctx.beginPath(); ctx.arc(px, py, half, 0, 6.2832); ctx.fill();
              ctx.lineWidth = 0.8; ctx.strokeStyle = theme.edge; ctx.stroke();
            }
          }
        }
      },
    });
    minis.push(map);
    fig.querySelector('.mini-box').onclick = (e) => { if (e.target.closest('a')) return; location.hash = `#/map?src=${encodeURIComponent(s.id)}&zone=${z}`; };
    (async () => {
      let b = null;
      for (const t of tList) {
        const L = await loadLoc(t, z);
        const xs = [], ys = [];
        for (let i = 0; i < L.N; i++) if (L.src[i] === s.i) { xs.push(L.x[i]); ys.push(L.y[i]); }
        if (!xs.length) continue;
        pts.push({ t, x: xs, y: ys });
        for (let i = 0; i < xs.length; i++) {
          if (!b) b = [xs[i], ys[i], xs[i], ys[i]];
          else { b[0] = Math.min(b[0], xs[i]); b[1] = Math.min(b[1], ys[i]); b[2] = Math.max(b[2], xs[i]); b[3] = Math.max(b[3], ys[i]); }
        }
      }
      if (!b) { fig.hidden = true; return; }
      const minw = 600e3; // keep some regional context around very local sources
      if (b[2] - b[0] < minw) { const c = (b[0] + b[2]) / 2; b[0] = c - minw / 2; b[2] = c + minw / 2; }
      if (b[3] - b[1] < minw) { const c = (b[1] + b[3]) / 2; b[1] = c - minw / 2; b[3] = c + minw / 2; }
      // very wide extents: keep whole region visible
      map.fit(b, 0.12);
    })();
  });
}

// =============================================================================
// Sources view (list + report)
// =============================================================================
export function createSourcesView(root) {
  root.innerHTML = `
  <aside class="src-list">
    <div class="src-list-h">
      <input type="search" id="sl-q" placeholder="Filter sources…" aria-label="Filter sources" autocomplete="off">
      <div class="chk-row" id="sl-types">
        ${TYPES.map((t) => `<label class="chk"><input type="checkbox" value="${t}" checked><span class="dot t-${t}"></span>${TYPE_LABEL[t].replace('Surface mass balance', 'SMB')}</label>`).join('')}
      </div>
      <div class="muted small" id="sl-count"></div>
    </div>
    <ul id="sl-ul"></ul>
  </aside>
  <article class="report" id="report"></article>`;
  const $ = (s) => root.querySelector(s);
  let current = null;

  function list() {
    const types = [...root.querySelectorAll('#sl-types input:checked')].map((i) => i.value);
    const res = search({ q: $('#sl-q').value, types, sort: $('#sl-q').value ? 'relevance' : 'name' });
    $('#sl-count').textContent = `${fmtInt(res.length)} source${res.length === 1 ? '' : 's'}`;
    $('#sl-ul').innerHTML = res.map((s) => `<li><a href="#/source/${encodeURIComponent(s.id)}" data-id="${esc(s.id)}" class="${s.id === current ? 'on' : ''}">
      <span class="sl-t">${esc(s.short)}</span><span class="sl-m">${typeDots(s)} ${s.nfigs ? `<span class="muted small" title="plots available">▦ ${s.nfigs}</span>` : ''}</span></a></li>`).join('');
  }
  $('#sl-q').oninput = list;
  root.querySelectorAll('#sl-types input').forEach((i) => (i.onchange = list));
  list();

  function intro() {
    const withPlots = D.sources.filter((s) => s.nfigs).length;
    $('#report').innerHTML = `<div class="empty-state"><h2>Source reports</h2>
      <p>Pick a source on the left to see its reference, coverage, methods, summary statistics, locations
      and the diagnostic plots produced by the compilation scripts.</p>
      <p class="muted">${fmtInt(D.sources.length)} sources in total · ${fmtInt(withPlots)} with plots · use <a href="#/search">Search</a> for author, year, DOI, site name or method filters.</p></div>`;
  }

  return {
    show(id) {
      current = id || null;
      if (!id) { intro(); list(); return; }
      const s = D.byId.get(id);
      if (!s) { $('#report').innerHTML = `<div class="empty-state"><h2>Unknown source</h2><p>No source “${esc(id)}”.</p></div>`; return; }
      renderReport($('#report'), s);
      $('#report').scrollTop = 0;
      root.querySelectorAll('#sl-ul a').forEach((a) => a.classList.toggle('on', a.dataset.id === id));
      root.querySelector('#sl-ul a.on')?.scrollIntoView({ block: 'nearest' });
    },
  };
}

// =============================================================================
// Search view
// =============================================================================
export function createSearchView(root) {
  const groupOpts = TYPES.map((t) => `<optgroup label="${TYPE_LABEL[t]}">${D.manifest.types[t].groups.map((g) => `<option value="${t}:${g.id}">${esc(g.label)}</option>`).join('')}</optgroup>`).join('');
  root.innerHTML = `
  <div class="search-wrap">
    <h2>Search sources</h2>
    <p class="muted">Search author, year, title, DOI, BibTeX key, dataset folder or site / core names.</p>
    <div class="search-bar"><input type="search" id="q" placeholder="e.g. Harper 2023, GISP2, PROMICE, 10.1594, snow pit …" autocomplete="off" autofocus></div>
    <div class="filters">
      <fieldset><legend>Variable</legend>
        ${TYPES.map((t) => `<label class="chk"><input type="checkbox" name="t" value="${t}" checked><span class="dot t-${t}"></span>${TYPE_LABEL[t]}</label>`).join('')}
      </fieldset>
      <label>Region <select id="zone"><option value="">Both</option>${ZONES.map((z) => `<option value="${z}">${ZONE_LABEL[z]}</option>`).join('')}</select></label>
      <label>Method <select id="group"><option value="">Any</option>${groupOpts}</select></label>
      <label>Period <span class="yrs"><input type="number" id="from" placeholder="from" min="1700" max="2100"> – <input type="number" id="to" placeholder="to" min="1700" max="2100"></span></label>
      <label class="chk"><input type="checkbox" id="plots"> with plots</label>
      <label>Sort <select id="sort"><option value="relevance">Relevance</option><option value="name">Name</option><option value="year">Most recent</option><option value="size">Most measurements</option></select></label>
    </div>
    <div class="muted small" id="rcount" role="status"></div>
    <div id="results"></div>
    <div class="more-wrap"><button id="more" class="btn" hidden>Show more</button></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  let shown = 40;
  let res = [];

  const state = () => ({
    q: $('#q').value.trim(),
    types: [...root.querySelectorAll('[name=t]:checked')].map((i) => i.value),
    zone: $('#zone').value,
    group: $('#group').value,
    from: +$('#from').value || 0,
    to: +$('#to').value || 0,
    plots: $('#plots').checked,
    sort: $('#sort').value,
  });

  function hl(text, q) {
    const toks = q.split(/\s+/).filter((x) => x.length > 1).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const e = esc(text);
    if (!toks.length) return e;
    return e.replace(new RegExp('(' + toks.join('|') + ')', 'ig'), '<mark>$1</mark>');
  }

  function render() {
    const f = state();
    res = search(f);
    $('#rcount').textContent = `${fmtInt(res.length)} of ${fmtInt(D.sources.filter((s) => !s.empty).length)} sources`;
    const page = res.slice(0, shown);
    $('#results').innerHTML = page.length ? `<table class="rtable"><thead><tr>
        <th>Source</th><th>Variables</th><th>Region</th><th>Period</th><th class="r">Measurements</th><th class="r">Plots</th></tr></thead><tbody>
      ${page.map((s) => `<tr data-id="${esc(s.id)}" tabindex="0">
        <td><a href="#/source/${encodeURIComponent(s.id)}"><b>${hl(s.short, f.q)}</b></a>
          ${s.compilation ? `<span class="zchip">in ${esc(s.compilation)}</span>` : ''}
          <div class="muted small clamp">${hl(s.ref.slice(0, 220), f.q)}</div>
          ${s._hit ? `<div class="small">site: <mark>${esc(s._hit)}</mark></div>` : ''}
          ${s.folders.length ? `<div class="small muted">folder: ${s.folders.slice(0, 3).map((x) => `<code>${esc(x.name)}</code>`).join(' ')}</div>` : ''}</td>
        <td>${typeDots(s)}</td>
        <td>${s.zones.map((z) => ZONE_SHORT[z]).join(' · ')}</td>
        <td class="nw">${fmtYears(s.y0, s.y1)}</td>
        <td class="r">${fmtInt(s.total)}</td>
        <td class="r">${s.nfigs || '–'}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty-state">No source matches these filters.</p>';
    $('#more').hidden = res.length <= shown;
    $('#more').textContent = `Show more (${fmtInt(res.length - shown)} left)`;
    root.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = '#/source/' + encodeURIComponent(tr.dataset.id); };
      tr.onkeydown = (e) => { if (e.key === 'Enter') location.hash = '#/source/' + encodeURIComponent(tr.dataset.id); };
    });
    // keep the filters in the URL so that searches can be shared
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q);
    if (f.types.length < TYPES.length) p.set('t', f.types.join(','));
    if (f.zone) p.set('z', f.zone);
    if (f.group) p.set('m', f.group);
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
    if (f.plots) p.set('plots', 1);
    if (f.sort !== 'relevance') p.set('sort', f.sort);
    history.replaceState(null, '', '#/search' + (p.toString() ? '?' + p : ''));
  }
  let timer;
  const kick = () => { shown = 40; clearTimeout(timer); timer = setTimeout(render, 120); };
  root.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', kick));
  root.querySelectorAll('select,[type=checkbox]').forEach((i) => i.addEventListener('change', kick));
  $('#more').onclick = () => { shown += 60; render(); };

  return {
    show(params) {
      if (params) {
        $('#q').value = params.q || '';
        root.querySelectorAll('[name=t]').forEach((i) => (i.checked = !params.t || params.t.split(',').includes(i.value)));
        $('#zone').value = params.z || '';
        $('#group').value = params.m || '';
        $('#from').value = params.from || '';
        $('#to').value = params.to || '';
        $('#plots').checked = !!params.plots;
        $('#sort').value = params.sort || 'relevance';
      }
      render();
    },
    focus() { $('#q').focus(); },
  };
}
