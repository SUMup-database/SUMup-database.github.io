import { D, loadData } from './ui.js';
import { refreshTheme } from './polarmap.js';
import { buildIndex } from './search.js';
import { createOverview } from './overview.js';
import { createMapView } from './mapview.js';
import { createSourcesView, createSearchView } from './sources.js';
import { createReleaseView } from './release.js';

const views = {};
const els = {
  overview: document.getElementById('view-overview'),
  map: document.getElementById('view-map'),
  sources: document.getElementById('view-sources'),
  search: document.getElementById('view-search'),
  release: document.getElementById('view-release'),
};

// ---- theme ----------------------------------------------------------------
const root = document.documentElement;
try {
  const t = localStorage.getItem('sumup-theme');
  if (t) root.dataset.theme = t;
} catch { /* storage may be blocked */ }
const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
document.getElementById('theme').onclick = () => {
  root.dataset.theme = isDark() ? 'light' : 'dark';
  try { localStorage.setItem('sumup-theme', root.dataset.theme); } catch { /* ignore */ }
  themed();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themed);
function themed() {
  refreshTheme();
  views.map?.refresh();
  if (current === 'sources' && views.sources) route();
}

// ---- router -----------------------------------------------------------------
let current = null;
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'overview', arg: parts[1], params: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route() {
  const { name, arg, params } = parse();
  const alias = name === 'source' ? 'sources' : name;
  const v = els[alias] ? alias : 'overview';
  for (const [k, el] of Object.entries(els)) el.hidden = k !== v;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  current = v;
  if (v === 'map') await views.map.show(params);
  if (v === 'sources') views.sources.show(arg);
  if (v === 'search') { views.search.show(params); }
  if (v === 'release') views.release.show();
  if (v === 'overview') window.scrollTo(0, 0);
  document.title = 'SUMup Explorer' + (v === 'overview' ? '' : ' · ' + (v === 'release' ? 'Release notes' : v[0].toUpperCase() + v.slice(1)));
}

// ---- boot ---------------------------------------------------------------------
(async () => {
  const status = document.getElementById('boot');
  try {
    await loadData();
    refreshTheme();
    buildIndex();
    createOverview(els.overview);
    views.map = createMapView(els.map);
    views.sources = createSourcesView(els.sources);
    views.search = createSearchView(els.search);
    views.release = createReleaseView(els.release);
    status.remove();
    window.addEventListener('hashchange', route);
    await route();
  } catch (e) {
    console.error(e);
    status.innerHTML = `<b>Could not load the data.</b><br>${String(e.message || e)}<br>
      <span class="small">The site must be served over HTTP (e.g. <code>python -m http.server -d site</code>) and the
      <code>data/</code> folder must have been generated with <code>python build_site_data.py</code>.</span>`;
  }
  window.SUMUP = { D };
})();
