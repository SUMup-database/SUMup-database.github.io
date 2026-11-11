// Source search: plain in-memory text index over the ~800 sources (no server, no database).
import { D, TYPES, norm } from './ui.js';

export function buildIndex() {
  for (const s of D.sources) {
    const folders = s.folders.map((f) => f.name).join(' ');
    s._short = norm(`${s.short} ${s.bibtex} ${s.id}`);
    s._folder = norm(folders);
    s._ref = norm(`${s.ref} ${s.doi || ''} ${s.compilation || ''}`);
    s._names = norm(
      Object.values(s.types).flatMap((t) => t.names || []).join('\n')
    );
    s._types = Object.keys(s.types).join(' ');
    // method groups used: "type:group"
    s._groups = new Set();
    for (const [t, v] of Object.entries(s.types)) {
      for (const k of Object.keys(v.methods || {})) s._groups.add(`${t}:${D.groupOf[t]?.[k] ?? 'other'}`);
    }
  }
}

/**
 * @param {{q?:string,types?:string[],zone?:string,group?:string,plots?:boolean,from?:number,to?:number,sort?:string}} f
 * @returns {object[]} sources (with ._score and ._hit)
 */
export function search(f = {}) {
  const tokens = norm(f.q || '').split(/\s+/).filter(Boolean);
  const out = [];
  for (const s of D.sources) {
    if (s.empty) continue;
    if (f.types && f.types.length && f.types.length < TYPES.length && !f.types.some((t) => s.types[t])) continue;
    if (f.zone && !s.zones.includes(f.zone)) continue;
    if (f.group && !s._groups.has(f.group)) continue;
    if (f.plots && !s.nfigs) continue;
    if (f.from && (s.y1 == null || s.y1 < f.from)) continue;
    if (f.to && (s.y0 == null || s.y0 > f.to)) continue;
    let score = 0;
    s._hit = null;
    let ok = true;
    for (const tk of tokens) {
      if (s._short.includes(tk)) score += s._short.startsWith(tk) ? 14 : 10;
      else if (s._folder.includes(tk)) score += 6;
      else if (s._ref.includes(tk)) score += 3;
      else if (s._names.includes(tk)) {
        score += 1;
        if (!s._hit) {
          const nm = Object.values(s.types).flatMap((t) => t.names || []).find((n) => norm(n).includes(tk));
          if (nm) s._hit = nm;
        }
      } else { ok = false; break; }
    }
    if (!ok) continue;
    s._score = score;
    out.push(s);
  }
  const sort = f.sort || (tokens.length ? 'relevance' : 'name');
  const byName = (a, b) => a.short.trim().localeCompare(b.short.trim(), 'en', { sensitivity: 'base', numeric: true });
  const sorters = {
    relevance: (a, b) => b._score - a._score || byName(a, b),
    name: byName,
    year: (a, b) => (b.y1 ?? 0) - (a.y1 ?? 0) || byName(a, b),
    size: (a, b) => b.total - a.total || byName(a, b),
  };
  out.sort(sorters[sort] || byName);
  return out;
}
