// Landing page: release summary, coverage through time, methods and repository figures.
import { D, TYPES, TYPE_LABEL, ZONES, ZONE_LABEL, esc, fmtInt, fmtCount, fmtYears, histSvg, barsHtml, openLightbox } from './ui.js';

const UNIT = { density: 'kg m⁻³', smb: 'm w.e. yr⁻¹', temperature: '°C' };

export function createOverview(root) {
  const stats = {};
  for (const t of TYPES) {
    const st = { total: 0, sources: 0, sites: 0, y0: null, y1: null, zones: { greenland: 0, antarctica: 0 }, hist: new Map() };
    for (const s of D.sources) {
      const v = s.types[t];
      if (!v || !v.total) continue;
      st.sources++;
      st.total += v.total;
      st.sites += v.sites;
      for (const z of ZONES) st.zones[z] += v.n[z] || 0;
      if (v.y0) st.y0 = st.y0 == null ? v.y0 : Math.min(st.y0, v.y0);
      if (v.y1) st.y1 = st.y1 == null ? v.y1 : Math.max(st.y1, v.y1);
      for (const [y, n] of v.hist || []) st.hist.set(y, (st.hist.get(y) || 0) + n);
    }
    st.histArr = [...st.hist.entries()].sort((a, b) => a[0] - b[0]);
    stats[t] = st;
  }
  const figs = D.manifest.overview || [];
  const figGroup = (f) => {
    const n = f.name.toLowerCase();
    return n.startsWith('density') ? 'density' : n.startsWith('temperature') ? 'temperature' : 'smb';
  };

  root.innerHTML = `
  <div class="ov">
    <section class="hero">
      <h1>Explore the SUMup database</h1>
      <p class="lead">Surface mass balance, subsurface temperature and density measurements from the Greenland and Antarctic ice sheets,
        compiled by the SUMup working group. Browse every measurement location on a polar map, read a report for each of the
        ${fmtInt(D.sources.filter((s) => !s.empty).length)} contributing sources, or search them by author, site or method.</p>
      <div class="cta">
        <a class="btn primary" href="#/map">Open the map</a>
        <a class="btn" href="#/sources">Browse sources</a>
        <a class="btn" href="#/search">Search</a>
        <a class="btn" href="#/release">Release notes</a>
      </div>
    </section>

    <section class="stat-grid">
      ${TYPES.map((t) => {
        const st = stats[t];
        return `<a class="stat t-${t}" href="#/map">
          <span class="stat-h"><span class="dot t-${t}"></span>${TYPE_LABEL[t]}</span>
          <span class="big">${fmtCount(st.total)}</span>
          <span class="small muted">measurements · SUMup ${D.manifest.release[t]}</span>
          <span class="sub">${fmtInt(st.sources)} sources · ${fmtInt(st.sites)} sites<br>
            ${fmtYears(st.y0, st.y1)} · ${ZONES.map((z) => `${ZONE_LABEL[z]} ${fmtCount(st.zones[z])}`).join(' / ')}</span>
        </a>`;
      }).join('')}
    </section>

    <section class="card">
      <h2>Measurements per year</h2>
      <div class="three">
        ${TYPES.map((t) => `<div><h4><span class="dot t-${t}"></span>${TYPE_LABEL[t]}</h4>${histSvg(stats[t].histArr, t, { w: 380, h: 100 })}</div>`).join('')}
      </div>
    </section>

    <section class="card">
      <h2>Methods</h2>
      <p class="muted small">Raw method strings in SUMup are free text; they are grouped here into broader method families (see <code>METHOD_GROUPS</code> in <code>build_site_data.py</code>).
        The map lets you switch each family, or each individual method, on and off.</p>
      <div class="three">
        ${TYPES.map((t) => `<div><h4><span class="dot t-${t}"></span>${TYPE_LABEL[t]}</h4>
          ${barsHtml(D.manifest.types[t].groups.map((g) => ({ label: g.label, n: g.n, color: g.id === 'other' ? 'var(--muted)' : `var(--c-${t})` })), {})}</div>`).join('')}
      </div>
    </section>

    ${figs.length ? `<section class="card">
      <h2>Release figures from the compilation repository</h2>
      <div class="seg" id="fig-tabs">${TYPES.map((t, i) => `<button data-t="${t}" class="${i ? '' : 'on'}">${TYPE_LABEL[t]}</button>`).join('')}</div>
      <div class="gallery big" id="fig-gal"></div>
    </section>` : ''}

    <section class="card cite">
      <h2>Cite</h2>
      <p class="small">Vandecrux, B., Amory, C., Ahlstrøm, A.P., et al.: <i>The SUMup collaborative database: Surface mass balance, subsurface temperature and density
        measurements from the Greenland and Antarctic ice sheets (2025 release)</i>, Arctic Data Center,
        <a href="https://www.doi.org/10.18739/A2M61BR5M" target="_blank" rel="noopener">doi:10.18739/A2M61BR5M</a>, 2025.
        Please also cite the individual sources you use — each source report lists its reference.</p>
      <p class="small muted">Data shown: density ${D.manifest.release.density}, temperature ${D.manifest.release.temperature}, SMB ${D.manifest.release.smb}
        (latest release found in the compilation repository).
        ${D.manifest.repo.url ? `Compilation scripts: <a href="${D.manifest.repo.url}" target="_blank" rel="noopener">${D.manifest.repo.url.replace('https://', '')}</a>.` : ''}</p>
    </section>
  </div>`;

  const gal = root.querySelector('#fig-gal');
  if (gal) {
    const draw = (t) => {
      const items = figs.filter((f) => figGroup(f) === t);
      gal.innerHTML = items.map((f, i) => `<button class="thumb" data-i="${i}"><img loading="lazy" src="${f.src}" alt="${esc(f.name)}"><span>${esc(f.name)}</span></button>`).join('')
        || '<p class="muted">No figures.</p>';
      gal.querySelectorAll('.thumb').forEach((b) => (b.onclick = () => openLightbox(items.map((f) => ({ src: f.src, caption: f.name })), +b.dataset.i)));
    };
    draw('density');
    root.querySelectorAll('#fig-tabs button').forEach((b) => (b.onclick = () => {
      root.querySelectorAll('#fig-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      draw(b.dataset.t);
    }));
  }
}
