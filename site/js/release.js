// Release notes: what changed between the previous and the new SUMup release, per variable and dataset.
// Data: data/release_notes.json, written by build_release_notes.py.
import { D, TYPES, TYPE_LABEL, esc, fmtInt, fmtCount, norm } from './ui.js';

const STATUS = [
  { id: 'updated', label: 'Updated', hint: 'In both releases, but values, positions or dates differ' },
  { id: 'unchanged', label: 'Unchanged', hint: 'Identical data in both releases' },
  { id: 'new', label: 'New', hint: 'Only in the new release' },
  { id: 'removed', label: 'Removed', hint: 'Only in the previous release' },
];
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtInt(Math.abs(n));

export function createReleaseView(root) {
  root.innerHTML = '<div class="rel"><p class="muted">Loading release notes…</p></div>';
  let R = null;
  let items = [];
  const S = { status: 'updated', types: new Set(TYPES), q: '', sort: 'size' };

  fetch('data/release_notes.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`data/release_notes.json: ${r.status}`);
      return r.json();
    })
    .then((j) => { R = j; build(); })
    .catch((e) => {
      root.innerHTML = `<div class="rel"><div class="empty-state"><h2>Release notes not available</h2>
        <p>${esc(e.message)}</p><p class="small">Generate them with <code>python build_release_notes.py</code>.</p></div></div>`;
    });

  function build() {
    for (const t of TYPES) {
      for (const it of R.types[t].items) {
        const site = it.status === 'removed' ? null : it.keys.find((k) => D.byId.has(k));
        items.push({
          ...it, type: t, site,
          size: it.status === 'updated' ? it.added + it.removed : Math.max(it.old, it.new),
          _q: norm([it.short, ...it.keys, ...it.oldKeys].join(' ')),
        });
      }
    }
    const { old: Y0, new: Y1 } = R;
    const tot = (t, k) => sum(R.types[t][k]);
    const all = (k) => TYPES.reduce((a, t) => a + tot(t, k), 0);
    const cnt = (st) => TYPES.reduce((a, t) => a + R.types[t].counts[st], 0);

    root.innerHTML = `
    <div class="rel">
      <section class="hero">
        <h1>SUMup ${Y1} release notes</h1>
        <p class="lead">What changed since the ${Y0} release. Each dataset (a reference and its measurements) was compared with its ${Y0} version,
          variable by variable: <b>${fmtInt(cnt('unchanged'))}</b> are unchanged, <b>${fmtInt(cnt('updated'))}</b> were updated,
          <b>${fmtInt(cnt('new'))}</b> are new and <b>${fmtInt(cnt('removed'))}</b> are no longer included.
          In total the release holds ${fmtCount(all('rowsNew'))} measurements (${Y0}: ${fmtCount(all('rowsOld'))}).</p>
      </section>

      <section class="stat-grid">
        ${TYPES.map((t) => {
          const o = tot(t, 'rowsOld'), n = tot(t, 'rowsNew'), c = R.types[t].counts;
          return `<div class="stat t-${t}">
            <span class="stat-h"><span class="dot t-${t}"></span>${TYPE_LABEL[t]}</span>
            <span class="big">${fmtCount(n)}</span>
            <span class="small muted">measurements in ${Y1} · ${Y0}: ${fmtCount(o)} (${signed(n - o)})</span>
            <span class="sub">${STATUS.map((s) => `<b>${fmtInt(c[s.id])}</b> ${s.label.toLowerCase()}`).join(' · ')}</span>
          </div>`;
        }).join('')}
      </section>

      <section class="card">
        <h2>Datasets</h2>
        <div class="seg" id="rel-status" role="tablist" aria-label="Status"></div>
        <div class="filters">
          <input id="rel-q" type="search" placeholder="Filter by author, year or key…" aria-label="Filter datasets" style="min-width:260px">
          <fieldset><legend class="muted">Variable</legend>
            ${TYPES.map((t) => `<label><input type="checkbox" data-t="${t}" checked><span class="tchip t-${t}">${TYPE_LABEL[t]}</span></label>`).join('')}
          </fieldset>
          <fieldset><legend class="muted">Sort</legend>
            <div class="seg" id="rel-sort"><button data-s="size" class="on">Largest first</button><button data-s="name">A–Z</button></div>
          </fieldset>
          <button class="btn" id="rel-csv" style="margin-left:auto">Download CSV</button>
        </div>
        <p class="muted small" id="rel-hint"></p>
        <div id="rel-list"></div>
      </section>

      <details class="card rel-method">
        <summary><b>How the releases were compared</b></summary>
        <ul class="small">
          <li>Both releases are read as published (the CSV tables), keys are replaced by the site names and methods they stand for, and every row is
            reduced to a fingerprint of its values, position and date. Numeric values are rounded to 4 decimals, which removes floating-point noise.</li>
          <li>A dataset is one reference (bibtex key). Keys are renamed, split or merged between releases, so references that share at least half of their
            rows, or that carry the same reference label or an extended key, are treated as the same dataset.</li>
          <li><b>Updated</b>: rows were added and/or removed (the table shows how many). <b>Unchanged</b>: identical rows; those marked
            <i>names / methods relabelled</i> only had site names or method wording edited. A dataset shown as updated may be a correction, a reprocessing
            (for instance a unit fix), or new measurements — the comparison cannot tell which; see the source report and the compilation repository for details.</li>
          <li>Counts are table rows of the release files (both ice sheets). Re-create this page with <code>python build_release_notes.py</code>.</li>
        </ul>
      </details>
    </div>`;

    const $ = (s) => root.querySelector(s);
    $('#rel-q').oninput = (e) => { S.q = e.target.value; draw(); };
    root.querySelectorAll('[data-t]').forEach((cb) => (cb.onchange = () => {
      cb.checked ? S.types.add(cb.dataset.t) : S.types.delete(cb.dataset.t);
      draw();
    }));
    root.querySelectorAll('#rel-sort button').forEach((b) => (b.onclick = () => {
      S.sort = b.dataset.s;
      root.querySelectorAll('#rel-sort button').forEach((x) => x.classList.toggle('on', x === b));
      draw();
    }));
    $('#rel-csv').onclick = downloadCsv;
    draw();
  }

  const visible = (status) => {
    const tokens = norm(S.q).split(/\s+/).filter(Boolean);
    return items.filter((it) => (!status || it.status === status) && S.types.has(it.type)
      && tokens.every((tk) => it._q.includes(tk)));
  };

  function draw() {
    const $ = (s) => root.querySelector(s);
    const counts = Object.fromEntries(STATUS.map((s) => [s.id, 0]));
    for (const it of visible()) counts[it.status]++;
    $('#rel-status').innerHTML = STATUS.map((s) => `<button role="tab" data-st="${s.id}" class="${s.id === S.status ? 'on' : ''}" aria-selected="${s.id === S.status}">${s.label} <span class="rel-n">${fmtInt(counts[s.id])}</span></button>`).join('');
    $('#rel-status').querySelectorAll('button').forEach((b) => (b.onclick = () => { S.status = b.dataset.st; draw(); }));
    $('#rel-hint').textContent = STATUS.find((s) => s.id === S.status).hint + '.';

    const byName = (a, b) => a.short.trim().localeCompare(b.short.trim(), 'en', { sensitivity: 'base', numeric: true }) || a.type.localeCompare(b.type);
    const rows = visible(S.status).sort(S.sort === 'size' ? (a, b) => b.size - a.size || byName(a, b) : byName);
    if (!rows.length) {
      $('#rel-list').innerHTML = '<p class="muted">No dataset matches.</p>';
      return;
    }
    const upd = S.status === 'updated';
    $('#rel-list').innerHTML = `<table class="rtable rel-table">
      <thead><tr><th>Dataset</th><th>Variable</th><th class="r">${R.old} rows</th><th class="r">${R.new} rows</th>
        <th class="r">${upd ? 'Rows added / removed' : 'Change'}</th><th>Key</th></tr></thead>
      <tbody>${rows.map(rowHtml).join('')}</tbody></table>`;
  }

  function rowHtml(it) {
    const name = it.site
      ? `<a href="#/source/${encodeURIComponent(it.site)}">${esc(it.short)}</a>` : esc(it.short);
    const extra = [];
    if (it.nShort > 1) extra.push(`+ ${it.nShort - 1} related reference${it.nShort > 2 ? 's' : ''}`);
    if (it.oldKeys.length) extra.push(`was ${esc(it.oldKeys.slice(0, 2).join(', '))}${it.oldKeys.length > 2 ? '…' : ''}`);
    let change = '<span class="muted">–</span>';
    if (it.status === 'updated') {
      const pct = (100 * (it.added + it.removed)) / Math.max(1, it.old + it.new);
      change = `<span class="nw">+${fmtInt(it.added)} / −${fmtInt(it.removed)}</span><br><span class="small muted">${pct < 1 ? '< 1' : Math.round(pct)} % of rows differ</span>`;
    } else if (it.status === 'new') change = `<span class="nw">+${fmtInt(it.new)}</span>`;
    else if (it.status === 'removed') change = `<span class="nw">−${fmtInt(it.old)}</span>`;
    else if (it.labels) change = '<span class="small muted">names / methods relabelled</span>';
    const key = it.keys[0] + (it.keys.length > 1 ? ` +${it.keys.length - 1}` : '');
    return `<tr>
      <td>${name}${extra.length ? `<div class="small muted">${extra.join(' · ')}</div>` : ''}</td>
      <td class="nw"><span class="tchip t-${it.type}">${TYPE_LABEL[it.type]}</span></td>
      <td class="r">${it.old ? fmtInt(it.old) : '–'}</td><td class="r">${it.new ? fmtInt(it.new) : '–'}</td>
      <td class="r">${change}</td>
      <td class="small muted"><span class="clamp" title="${esc(it.keys.join(', '))}">${esc(key)}</span></td></tr>`;
  }

  function downloadCsv() {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['variable', 'status', 'reference', 'keys', 'previous_keys', `rows_${R.old}`, `rows_${R.new}`, 'rows_added', 'rows_removed', 'labels_relabelled'];
    const lines = [head.join(',')];
    for (const it of visible().sort((a, b) => a.type.localeCompare(b.type) || a.status.localeCompare(b.status) || a.short.localeCompare(b.short))) {
      lines.push([it.type, it.status, it.short, it.keys.join(' '), it.oldKeys.join(' '), it.old, it.new, it.added, it.removed, it.labels ? 1 : 0].map(q).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `SUMup_${R.new}_vs_${R.old}_dataset_changes.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { show() { root.scrollTop = 0; } };
}
