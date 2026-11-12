#!/usr/bin/env python
"""
Compare two SUMup releases and write site/data/release_notes.json (used by the "Release notes" page).

For every variable (density, SMB, temperature) the rows of the previous and of the new release are compared
by content: the release tables renumber their reference/name/method keys, so each row is hashed after the keys
have been replaced by the text they stand for (name, method); numeric columns are rounded to 4 decimals.

A source is one bibtex key (as in build_site_data.py), but keys get renamed, split or merged between releases.
Sources of the two releases are therefore grouped into one *dataset* when they have the same key, or when one
shares at least half of its rows with the other. Each dataset is then compared as a whole:

  unchanged : identical rows in both releases
  updated   : present in both releases, rows added and/or removed
  new       : only in the new release
  removed   : only in the previous release

Usage:
    python build_release_notes.py [--compilation PATH] [--out site] [--new 2026] [--old 2025]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from build_site_data import DEFAULT_COMPILATION, HERE, TYPES, ZONES, Release, slug

warnings.filterwarnings("ignore")

KEY_COLS = ("name_key", "reference_key", "method_key")
# numeric data columns are rounded before comparison (the files carry float32 noise such as 17.074562907 vs 17.074562072)
NUMERIC = {"latitude", "longitude", "elevation", "depth", "start_depth", "stop_depth", "midpoint", "density",
           "duration", "temperature", "smb", "error", "start_year", "end_year"}
DECIMALS = 4
CHUNK = 400_000


def log(*a):
    print(*a, flush=True)


def find_year(comp: Path, stem: str, year: int) -> Release:
    best = None
    for p in (comp / "SUMup files").iterdir():
        if re.fullmatch(rf"SUMup_{year}_{stem}_csv(\.zip)?", p.name, re.I):
            if best is None or p.is_dir():
                best = p
    if best is None:
        raise SystemExit(f"release {year} of '{stem}' not found")
    return Release(best)


def source_id(bib, short) -> str:
    bib = str(bib).strip() if pd.notna(bib) else ""
    short = str(short).strip() if pd.notna(short) else ""
    return slug(bib) if bib else "ref_" + slug(short)


def read_release(rel: Release, stem: str):
    """-> (short {sid: label}, bibtex {sid: key}, (src, h, count) of the data columns, same incl. names/methods, rows per zone)"""
    refs = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{stem}_references\.tsv"), sep="\t")
    methods = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{stem}_methods\.tsv"), sep="\t")
    names = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{stem}_names\.tsv"), sep="\t")
    refs["sid"] = [source_id(b, s) for b, s in zip(refs.bibtex_key, refs.reference_short)]
    key2sid = dict(zip(refs.reference_key.astype(int), refs.sid))
    short = {}
    bibtex = {}
    for r in refs.itertuples():
        short.setdefault(r.sid, str(r.reference_short).strip() if pd.notna(r.reference_short) else r.sid)
        bibtex.setdefault(r.sid, str(r.bibtex_key).strip() if pd.notna(r.bibtex_key) else "")
    mname = dict(zip(methods.method_key.astype(int), methods.method.fillna("").astype(str)))
    nname = dict(zip(names.name_key.astype(int), names.name.fillna("").astype(str)))

    frames, rows = [], {}
    for z in ZONES:
        n = 0
        for ch in pd.read_csv(rel.open(rf"sumup_\d{{4}}_{stem}_{z}\.csv"), dtype=str, chunksize=CHUNK,
                              keep_default_na=False):
            n += len(ch)
            data = [c for c in ch.columns if c not in KEY_COLS]
            sub = ch[data].copy()
            for c in data:
                if c in NUMERIC:
                    sub[c] = pd.to_numeric(sub[c], errors="coerce").round(DECIMALS)
            sub["__name"] = pd.to_numeric(ch["name_key"], errors="coerce").map(nname).fillna("")
            sub["__method"] = pd.to_numeric(ch["method_key"], errors="coerce").map(mname).fillna("")
            hd = pd.util.hash_pandas_object(sub[data], index=False).values      # values, positions, dates
            hf = pd.util.hash_pandas_object(sub, index=False).values            # ... + site name and method
            src = pd.to_numeric(ch["reference_key"], errors="coerce").map(key2sid)
            frames.append(pd.DataFrame({"src": src.values, "h": hd, "hf": hf}))
        rows[z] = n
        log(f"    {z}: {n:,} rows")
    allh = pd.concat(frames, ignore_index=True).dropna(subset=["src"])
    hashes = allh.groupby(["src", "h"]).size().rename("c").reset_index()
    full = allh.rename(columns={"h": "_", "hf": "h"}).groupby(["src", "h"]).size().rename("c").reset_index()
    return short, bibtex, hashes, full, rows


class UnionFind:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


LINK_FRACTION = 0.5   # sources are the same dataset if they share this fraction of the rows of either one


def compare(ho: pd.DataFrame, hn: pd.DataFrame, short_o: dict, short_n: dict):
    """ho/hn: (src, h, c) of old/new release -> (dataset id per old src, per new src, per-dataset stats)"""
    tot_o = ho.groupby("src").c.sum()
    tot_n = hn.groupby("src").c.sum()
    uf = UnionFind()
    for s in tot_o.index:
        uf.find(("o", s))
    for s in tot_n.index:
        uf.find(("n", s))
    for s in set(tot_o.index) & set(tot_n.index):
        uf.union(("o", s), ("n", s))                      # same key
    m = ho.merge(hn, on="h", suffixes=("_o", "_n"))
    m["ov"] = np.minimum(m.c_o, m.c_n)
    ov = m.groupby(["src_o", "src_n"]).ov.sum().reset_index()
    ov = ov[(ov.ov >= LINK_FRACTION * ov.src_o.map(tot_o)) | (ov.ov >= LINK_FRACTION * ov.src_n.map(tot_n))]
    for r in ov.itertuples():
        uf.union(("o", r.src_o), ("n", r.src_n))          # same rows under another key
    # second pass: datasets that only exist on one side but are evidently the same reference whose values were
    # reprocessed (same reference label, or the new key extends the old one: Lewis2019 -> Lewis2019_Lewis2021_insitu)
    sides = {}
    for k in list(uf.p):
        sides.setdefault(uf.find(k), set()).add(k[0])
    old_only = [k for k in uf.p if k[0] == "o" and sides[uf.find(k)] == {"o"}]
    new_only = [k for k in uf.p if k[0] == "n" and sides[uf.find(k)] == {"n"}]
    for o in old_only:
        for n in new_only:
            if (short_o.get(o[1]) and short_o.get(o[1]) == short_n.get(n[1])
                    or n[1].startswith(o[1] + "_") or o[1].startswith(n[1] + "_")):
                uf.union(o, n)
    root = {k: uf.find(k) for k in list(uf.p)}
    ids = {r: i for i, r in enumerate(sorted(set(root.values()), key=str))}
    do = {s: ids[root[("o", s)]] for s in tot_o.index}
    dn = {s: ids[root[("n", s)]] for s in tot_n.index}

    return do, dn, dataset_diff(ho, hn, do, dn)


def dataset_diff(ho, hn, do, dn):
    """per dataset: rows in old / new release and rows only in the new (added) / only in the old (removed)"""
    a = ho.assign(ds=ho.src.map(do)).groupby(["ds", "h"]).c.sum().rename("co")
    b = hn.assign(ds=hn.src.map(dn)).groupby(["ds", "h"]).c.sum().rename("cn")
    j = pd.concat([a, b], axis=1).fillna(0).reset_index()
    j["added"] = (j.cn - j.co).clip(lower=0)
    j["removed"] = (j.co - j.cn).clip(lower=0)
    return j.groupby("ds")[["co", "cn", "added", "removed"]].sum().astype(np.int64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--compilation", type=Path, default=DEFAULT_COMPILATION)
    ap.add_argument("--out", type=Path, default=HERE / "site")
    ap.add_argument("--new", type=int, default=2026)
    ap.add_argument("--old", type=int, default=2025)
    args = ap.parse_args()
    comp = args.compilation.resolve()

    result = {"new": args.new, "old": args.old, "types": {}}

    for typ, cfg in TYPES.items():
        stem = cfg["stem"]
        log(f"[{typ}]")
        log(f"  {args.old}")
        s_old, b_old, h_old, f_old, rows_old = read_release(find_year(comp, stem, args.old), stem)
        log(f"  {args.new}")
        s_new, b_new, h_new, f_new, rows_new = read_release(find_year(comp, stem, args.new), stem)

        do, dn, st = compare(h_old, h_new, s_old, s_new)
        stf = dataset_diff(f_old, f_new, do, dn)           # same, but names / methods count as content too
        members = {}
        for sid, d in do.items():
            members.setdefault(d, {"old": [], "new": []})["old"].append(sid)
        for sid, d in dn.items():
            members.setdefault(d, {"old": [], "new": []})["new"].append(sid)
        counts = {"unchanged": 0, "updated": 0, "new": 0, "removed": 0}
        items = []
        for d, mem in members.items():
            r = st.loc[d]
            if not mem["old"]:
                status = "new"
            elif not mem["new"]:
                status = "removed"
            else:
                status = "unchanged" if r.added == 0 and r.removed == 0 else "updated"
            counts[status] += 1
            keys = sorted(mem["new"] or mem["old"], key=lambda k: -len(k))
            shorts = []
            for k in mem["new"] or mem["old"]:
                sh = (s_new.get(k) if mem["new"] else s_old.get(k)) or k
                if sh not in shorts:
                    shorts.append(sh)
            labels = status == "unchanged" and bool(stf.loc[d].added or stf.loc[d].removed)
            items.append({"status": status, "labels": labels, "short": sorted(shorts)[0], "nShort": len(shorts),
                          "keys": sorted(mem["new"] or mem["old"]),
                          "oldKeys": sorted(k for k in mem["old"] if k not in mem["new"]) if mem["new"] else [],
                          "old": int(r.co), "new": int(r.cn), "added": int(r.added), "removed": int(r.removed)})
        items.sort(key=lambda x: x["short"].lower())
        result["types"].setdefault(typ, {})["items"] = items
        result["types"][typ].update({"label": cfg["label"], "rowsOld": rows_old, "rowsNew": rows_new, "counts": counts})
        log("  ->", counts)

    out = args.out.resolve() / "data" / "release_notes.json"
    out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log("wrote", out, f"({out.stat().st_size / 1e3:.0f} kB)")


if __name__ == "__main__":
    sys.exit(main())
