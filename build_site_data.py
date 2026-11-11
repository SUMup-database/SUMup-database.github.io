#!/usr/bin/env python
"""
Build the static data files used by the SUMup explorer website (site/).

Everything is derived from files that already exist in the compilation repo:

  * the released CSV tables  (SUMup files/SUMup_<year>_<type>_csv[.zip])
        -> agglomerated map locations (binary), per-source statistics
  * data/<type> data/<dataset>/   (process.py, reference.bib, figures/)
        -> links between a source and its plots / code / bibtex
  * doc/figures, figures/         -> release-level overview plots
  * doc/GIS/*.shp                 -> ice-sheet outlines for the basemap

No database: the output is a few JSON files + small binary column files.

Usage:
    python build_site_data.py [--compilation PATH] [--out site] [--no-figures]

Python >= 3.9 with pandas, numpy, pyproj, shapely, pyshp and Pillow.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import struct
import sys
import warnings
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

HERE = Path(__file__).resolve().parent
DEFAULT_COMPILATION = HERE.parent / "SUMup-compilation-scripts"

# Link target for "view on GitHub" buttons (set REPO_URL = "" to disable)
REPO_URL = "https://github.com/SUMup-database/SUMup-compilation-scripts"
REPO_BRANCH = "main"

# ---------------------------------------------------------------------------
# what we read
# ---------------------------------------------------------------------------
ZONES = ("greenland", "antarctica")
CRS = {"greenland": 3413, "antarctica": 3031}

TYPES = {
    # key: label, folder in data/, file stem in the release, value column, unit
    "density": dict(label="Density", folder="density data", stem="density",
                    value="density", unit="kg m⁻³", cell=250),
    "smb": dict(label="Surface mass balance", folder="SMB data", stem="smb",
                value="smb", unit="m w.e. yr⁻¹", cell=500),
    "temperature": dict(label="Temperature", folder="temperature data",
                        stem="temperature", value="temperature", unit="°C",
                        cell=250),
}

# ---------------------------------------------------------------------------
# method grouping: raw SUMup method strings are very heterogeneous (>130
# distinct strings).  The first matching rule wins; edit freely.
# ---------------------------------------------------------------------------
METHOD_GROUPS = {
    "density": [
        ("ct", "X-ray CT", r"tomograph|\bCT\b|icect"),
        ("logging", "Logging / geophysical", r"gamma|dielectric|\bDEP\b|decomp|televiewer|neutron|madge"),
        ("cutter", "Density cutter", r"cutter|cylindrical|\bcc\b|liner|custom trace metal"),
        ("pyc", "Pycnometer / weighing", r"pycnometer|weigh"),
        ("core", "Firn / ice core section", r"core"),
        ("pit", "Snow pit", r"snow ?pit"),
    ],
    "smb": [
        ("radar", "Radar", r"radar|isochron"),
        ("stake", "Stakes / height ranging", r"stake|height ranging|ablation hose|snowfox"),
        ("core", "Ice / firn core", r"core"),
        ("pit", "Snow pit", r"\bpits?\b"),
    ],
    "temperature": [
        ("fibre", "Fibre optic (DTS)", r"fib(er|re)|\bDTS\b"),
        ("rtd", "Resistance (thermohm, RTD, Pt100)",
         r"thermohm|pt ?100|platinum|resistance temp|resistance thermometer|wheatstone|wheastone|\bRTD\b"),
        ("thermistor", "Thermistor / thermistor string",
         r"thermistor|thermarray|semiconductor|\bUUB\b|TMP102|DS18B20|digital|T107|probe"),
        ("tc", "Thermocouple", r"thermocouple"),
        ("liquid", "Liquid / metal thermometer", r"mercury|bimetal|metal thermometer|thermometer"),
    ],
}
OTHER = ("other", "Other / unspecified")

# colour slots (categorical, fixed order, from the dataviz reference palette)
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]


def classify(typ: str, method: str | float) -> tuple[str, str]:
    if not isinstance(method, str) or not method.strip():
        return OTHER
    for gid, label, rx in METHOD_GROUPS[typ]:
        if re.search(rx, method, re.I):
            return gid, label
    return OTHER


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def log(*a):
    print(*a, flush=True)


def slug(s: str) -> str:
    s = re.sub(r"[^\w\-.]+", "_", s.strip(), flags=re.U)
    return s.strip("_")[:80] or "x"


def find_release(comp: Path, stem: str):
    """newest 'SUMup_<year>_<stem>_csv' (folder or zip) -> (year, opener)"""
    best = None
    for p in (comp / "SUMup files").iterdir():
        m = re.fullmatch(rf"SUMup_(\d{{4}})_{stem}_csv(\.zip)?", p.name, re.I)
        if m:
            year = int(m.group(1))
            if best is None or year > best[0] or (year == best[0] and p.is_dir()):
                best = (year, p)
    if best is None:
        raise SystemExit(f"No release found for {stem}")
    return best


class Release:
    """uniform access to files inside a release folder or zip"""

    def __init__(self, path: Path):
        self.path = path
        self.zip = zipfile.ZipFile(path) if path.suffix == ".zip" else None
        self.names = (
            {Path(n).name.lower(): n for n in self.zip.namelist()} if self.zip
            else {p.name.lower(): p for p in path.iterdir()}
        )

    def open(self, pattern: str):
        for low, real in self.names.items():
            if re.fullmatch(pattern.lower(), low):
                return self.zip.open(real) if self.zip else open(real, "rb")
        raise FileNotFoundError(pattern)


DOI_RX = re.compile(r"(10\.\d{4,9}/[^\s,;<>\"')\]]+)", re.I)


def extract_doi(text: str) -> str | None:
    m = DOI_RX.search(text or "")
    return m.group(1).rstrip(".") if m else None


def parse_bib(txt: str) -> dict:
    """very small bibtex reader (only what we need: key, title, year, doi, author)"""
    out = {}
    for m in re.finditer(r"@\w+\s*\{\s*([^,\s]+)\s*,(.*?)(?=\n@|\Z)", txt, re.S):
        key, body = m.group(1), m.group(2)
        f = {}
        for fm in re.finditer(r"(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\"[^\"]*\"|[^,\n]+)", body):
            v = fm.group(2).strip().strip(",").strip()
            if v[:1] in "{\"" and v[-1:] in "}\"":
                v = v[1:-1]
            f[fm.group(1).lower()] = re.sub(r"\s+", " ", v.replace("{", "").replace("}", "")).strip()
        out[key] = f
    return out


# ---------------------------------------------------------------------------
# 1. load release tables
# ---------------------------------------------------------------------------
def load_type(comp: Path, typ: str):
    cfg = TYPES[typ]
    year, path = find_release(comp, cfg["stem"])
    rel = Release(path)
    log(f"[{typ}] release {year}: {path.name}")
    refs = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{cfg['stem']}_references\.tsv"), sep="\t")
    methods = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{cfg['stem']}_methods\.tsv"), sep="\t")
    names = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{cfg['stem']}_names\.tsv"), sep="\t")
    tabs = {}
    for z in ZONES:
        df = pd.read_csv(rel.open(rf"sumup_\d{{4}}_{cfg['stem']}_{z}\.csv"))
        df = df.dropna(subset=["latitude", "longitude"])
        tabs[z] = df
        log(f"    {z}: {len(df):,} rows")
    return year, refs, methods, names, tabs


def year_series(typ: str, df: pd.DataFrame):
    """(year_min, year_max) per row; 0 = unknown"""
    if typ == "smb":
        a = pd.to_numeric(df.get("start_year"), errors="coerce")
        b = pd.to_numeric(df.get("end_year"), errors="coerce")
        a = a.fillna(b)
        b = b.fillna(a)
    else:
        a = pd.to_numeric(df["timestamp"].astype(str).str[:4], errors="coerce")
        b = a
    a = a.where((a > 1700) & (a < 2100), 0).fillna(0).astype(np.int32)
    b = b.where((b > 1700) & (b < 2100), 0).fillna(0).astype(np.int32)
    return a, b


# ---------------------------------------------------------------------------
# 2. match dataset folders to sources
# ---------------------------------------------------------------------------
def scan_folders(comp: Path):
    """per type: list of folder dicts with text used for matching"""
    out = {}
    for typ, cfg in TYPES.items():
        base = comp / "data" / cfg["folder"]
        lst = []
        for d in sorted(p for p in base.iterdir() if p.is_dir()):
            if d.name in ("to add", "__pycache__"):
                continue
            txt = ""
            for fn in ("process.py", "reference.bib"):
                p = d / fn
                if p.exists():
                    txt += p.read_text(encoding="utf-8", errors="ignore") + "\n"
            bib = parse_bib((d / "reference.bib").read_text(encoding="utf-8", errors="ignore")) \
                if (d / "reference.bib").exists() else {}
            figs = sorted(p for p in (d / "figures").glob("*") if p.suffix.lower() in (".png", ".jpg", ".jpeg")) \
                if (d / "figures").is_dir() else []
            others = sorted(p.name for p in d.iterdir()
                            if p.name not in ("__pycache__", "figures", "data_formatted.csv", "reference.bib", "process.py")
                            and not p.name.startswith("."))
            lst.append(dict(type=typ, name=d.name, path=d, text=txt, bib=bib, figs=figs,
                            has_process=(d / "process.py").exists(),
                            has_formatted=(d / "data_formatted.csv").exists(),
                            files=others[:40], nfiles=len(others)))
        out[typ] = lst
    return out


def folder_matches(folder: dict, ref_short: str, bibkeys: list[str]) -> bool:
    txt = folder["text"]
    for k in bibkeys:
        if len(k) >= 4 and re.search(r"""(?<=["'{\s])""" + re.escape(k) + r"""(?=["',\s}])""", txt):
            return True
    return bool(ref_short) and len(ref_short) > 6 and (
        f"'{ref_short}'" in txt or f'"{ref_short}"' in txt)


# ---------------------------------------------------------------------------
# 3. basemap
# ---------------------------------------------------------------------------
def build_basemap(comp: Path):
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import shape, Polygon, MultiPolygon
    from shapely.ops import transform

    gis = comp / "doc" / "GIS"

    def rings(geom, tol):
        geom = geom.simplify(tol, preserve_topology=True)
        polys = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
        out = []
        for p in polys:
            if p.is_empty or not isinstance(p, Polygon):
                continue
            for r in [p.exterior, *p.interiors]:
                c = np.asarray(r.coords)
                out.append(np.round(c).astype(int).ravel().tolist())
        return out

    res = {}
    # Greenland (already EPSG:3413)
    g = {}
    for name in ("land", "ice"):
        r = shapefile.Reader(str(gis / f"greenland_{name}_3413"))
        rr = []
        for s in r.shapes():
            rr += rings(shape(s.__geo_interface__), 400)
        g[name] = rr
    res["greenland"] = g
    # Antarctica (lon/lat -> 3031)
    r = shapefile.Reader(str(gis / "Medium_resolution_vector_polygons_of_the_Antarctic_coastline"))
    tr = Transformer.from_crs(4326, 3031, always_xy=True)
    fields = [f[0] for f in r.fields[1:]]
    surf_i = fields.index("surface") if "surface" in fields else None
    grounded, floating = [], []
    for sr in r.shapeRecords():
        geom = shape(sr.shape.__geo_interface__)
        if geom.is_empty:
            continue
        geom = transform(lambda x, y, z=None: tr.transform(np.clip(x, -180, 180), np.clip(y, -90, -60)), geom)
        surf = str(sr.record[surf_i]).lower() if surf_i is not None else "land"
        (grounded if surf in ("land", "grounded ice", "rock", "rumple") else floating).extend(rings(geom, 800))
    res["antarctica"] = {"land": grounded, "ice": floating}
    return res


# ---------------------------------------------------------------------------
# 4. figures
# ---------------------------------------------------------------------------
def copy_figure(src: Path, dst: Path, maxw=1100):
    from PIL import Image
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return
    try:
        im = Image.open(src)
        if im.width > maxw:
            im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        if im.mode in ("RGBA", "LA", "P"):
            im.save(dst, optimize=True)
        else:
            im.convert("RGB").save(dst, optimize=True)
    except Exception as e:  # corrupt / unusual file: copy as is
        log("   ! figure copy fallback", src.name, e)
        shutil.copy2(src, dst)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--compilation", type=Path, default=DEFAULT_COMPILATION)
    ap.add_argument("--out", type=Path, default=HERE / "site")
    ap.add_argument("--no-figures", action="store_true", help="skip copying/resizing PNGs")
    args = ap.parse_args()
    comp, out = args.compilation.resolve(), args.out.resolve()
    (out / "data").mkdir(parents=True, exist_ok=True)

    overrides_p = HERE / "folder_overrides.json"
    overrides = json.loads(overrides_p.read_text("utf-8")) if overrides_p.exists() else {}

    folders = scan_folders(comp)
    log("folders:", {k: len(v) for k, v in folders.items()})

    sources: dict[str, dict] = {}        # id -> source
    src_list: list[dict] = []            # ordered
    manifest = {"types": {}, "release": {}, "repo": {"url": REPO_URL, "branch": REPO_BRANCH}}
    bins_total = 0

    def get_source(refrow) -> dict:
        bib = str(refrow.bibtex_key).strip() if pd.notna(refrow.bibtex_key) else ""
        short = str(refrow.reference_short).strip() if pd.notna(refrow.reference_short) else ""
        sid = slug(bib) if bib else "ref_" + slug(short)
        if sid not in sources:
            full = str(refrow.reference).strip() if pd.notna(refrow.reference) else ""
            m = re.search(r"\s+as in\s+(.+)$", short)
            s = dict(id=sid, i=len(src_list), short=short, ref=full, bibtex=bib,
                     doi=extract_doi(full), compilation=m.group(1) if m else None,
                     types={}, folders=[])
            sources[sid] = s
            src_list.append(s)
        else:
            s = sources[sid]
            if not s["ref"] and pd.notna(refrow.reference):
                s["ref"] = str(refrow.reference).strip()
                s["doi"] = s["doi"] or extract_doi(s["ref"])
        return s

    for typ, cfg in TYPES.items():
        year, refs, methods, names, tabs = load_type(comp, typ)
        manifest["release"][typ] = year

        # ---- method table with groups -------------------------------------
        methods["method"] = methods["method"].where(methods["method"].notna(), None)
        mrows = []
        for r in methods.itertuples():
            gid, glabel = classify(typ, r.method)
            if r.method_key == -9999:
                gid, glabel = OTHER
            mrows.append(dict(key=int(r.method_key),
                              label=r.method if isinstance(r.method, str) and r.method.strip() else "not specified",
                              group=gid, glabel=glabel))
        mdf = pd.DataFrame(mrows)

        # ---- sources for this type ----------------------------------------
        refs["reference_key"] = refs["reference_key"].astype(int)
        refkey_to_src = {}
        for r in refs.itertuples():
            s = get_source(r)
            refkey_to_src[int(r.reference_key)] = s["i"]
            t = s["types"].setdefault(typ, dict(refKeys=[]))
            t["refKeys"].append(int(r.reference_key))
        # folder matching
        for f in folders[typ]:
            ok = overrides.get(typ, {}).get(f["name"])
            hits = set()
            for r in refs.itertuples():
                bk = str(r.bibtex_key).split() if pd.notna(r.bibtex_key) else []
                sh = str(r.reference_short).strip() if pd.notna(r.reference_short) else ""
                if ok is not None and sh in ok:
                    hits.add(refkey_to_src[int(r.reference_key)])
                elif ok is None and folder_matches(f, sh, bk):
                    hits.add(refkey_to_src[int(r.reference_key)])
            f["sources"] = sorted(hits)
            for si in hits:
                src_list[si]["folders"].append(f)

        # ---- process rows --------------------------------------------------
        from pyproj import Transformer
        name_map = dict(zip(names.name_key, names.name))
        mkey_to_row = {int(k): i for i, k in enumerate(mdf.key)}

        per_zone_bins = {}
        g_stats = {}     # (src, zone) -> accumulators
        all_frames = []
        for z in ZONES:
            df = tabs[z].copy()
            tr = Transformer.from_crs(4326, CRS[z], always_xy=True)
            x, y = tr.transform(df.longitude.values, df.latitude.values)
            df["x"], df["y"] = x, y
            df["src"] = df.reference_key.map(refkey_to_src)
            df = df.dropna(subset=["src"])
            df["src"] = df.src.astype(np.int32)
            df["mrow"] = df.method_key.map(mkey_to_row).fillna(0).astype(np.int32)
            ya, yb = year_series(typ, df)
            df["y0"], df["y1"] = ya.values, yb.values
            df["zone"] = z
            all_frames.append(df)

            # agglomerate on a metric grid
            cell = cfg["cell"]
            df["cx"] = np.round(df.x / cell).astype(np.int64)
            df["cy"] = np.round(df.y / cell).astype(np.int64)
            ya0 = df.y0.where(df.y0 > 0)
            yb1 = df.y1.where(df.y1 > 0)
            df["_y0"], df["_y1"] = ya0, yb1
            agg = (df.groupby(["mrow", "src", "cx", "cy"], sort=False)
                     .agg(x=("x", "mean"), y=("y", "mean"), n=("x", "size"),
                          y0=("_y0", "min"), y1=("_y1", "max"))
                     .reset_index())
            agg[["y0", "y1"]] = agg[["y0", "y1"]].fillna(0).astype(np.int32)
            per_zone_bins[z] = agg

        # method order: by decreasing total n so abundant methods draw first
        tot = pd.concat([b[["mrow", "n"]] for b in per_zone_bins.values()]).groupby("mrow").n.sum()
        order = [int(m) for m in tot.sort_values(ascending=False).index]
        rank = {m: i for i, m in enumerate(order)}
        # keep rows of methods that have no data out of the legend
        mdf_used = mdf.iloc[order].reset_index(drop=True)
        mdf_used["n"] = [int(tot[m]) for m in order]
        for z in ZONES:
            mdf_used[f"n_{z}"] = [int(per_zone_bins[z].loc[per_zone_bins[z].mrow == m, "n"].sum()) for m in order]

        # group list (ordered by total n) + colours
        gtot = mdf_used.groupby(["group", "glabel"]).n.sum().sort_values(ascending=False).reset_index()
        groups = []
        for i, r in enumerate(gtot.itertuples()):
            groups.append(dict(id=r.group, label=r.glabel, n=int(r.n),
                               color=SERIES[i % len(SERIES)] if r.group != "other" else "#8a8a85"))
        # "other" always last
        groups.sort(key=lambda g: (g["id"] == "other", -g["n"]))
        for i, g in enumerate([g for g in groups if g["id"] != "other"]):
            g["color"] = SERIES[i % len(SERIES)]

        # ---- write binary location files ----------------------------------
        files = {}
        for z in ZONES:
            b = per_zone_bins[z]
            b["rank"] = b.mrow.map(rank)
            b = b.sort_values(["rank", "src"]).reset_index(drop=True)
            N = len(b)
            ranges, start = [], 0
            for rk in range(len(order)):
                cnt = int((b["rank"] == rk).sum())
                ranges.append([start, start + cnt])
                start += cnt
            fn = f"loc_{typ}_{z}.bin"
            with open(out / "data" / fn, "wb") as fh:
                fh.write(struct.pack("<I", N))
                fh.write(b.x.values.astype("<f4").tobytes())
                fh.write(b.y.values.astype("<f4").tobytes())
                fh.write(b.n.values.astype("<u4").tobytes())
                fh.write(b.src.values.astype("<u2").tobytes())
                fh.write(b.y0.values.astype("<u2").tobytes())
                fh.write(b.y1.values.astype("<u2").tobytes())
                fh.write(b["rank"].values.astype("<u1").tobytes())
            files[z] = dict(file=fn, n=N, ranges=ranges)
            bins_total += N
            log(f"    wrote {fn}: {N:,} cells")

        manifest["types"][typ] = dict(label=cfg["label"], unit=cfg["unit"], cell=cfg["cell"],
                                      methods=mdf_used.to_dict("records"), groups=groups, zones=files)

        # ---- per-source statistics -----------------------------------------
        full = pd.concat(all_frames, ignore_index=True)
        vcol = cfg["value"]
        full["_v"] = pd.to_numeric(full[vcol], errors="coerce")
        dcol = {"density": "stop_depth", "temperature": "depth"}.get(typ)
        full["_d"] = pd.to_numeric(full[dcol], errors="coerce") if dcol else np.nan
        full["_e"] = pd.to_numeric(full["elevation"], errors="coerce")
        full["_yh"] = np.where(full.y0 > 0, np.where(full.y1 > 0, (full.y0 + full.y1) // 2, full.y0), 0)

        for sidx, g in full.groupby("src"):
            t = src_list[int(sidx)]["types"][typ]
            t.pop("bibShort", None)
            t["n"] = {z: int((g.zone == z).sum()) for z in ZONES}
            t["sites"] = int(g.name_key.nunique())
            ys = g.y0[g.y0 > 0]
            ye = g.y1[g.y1 > 0]
            t["y0"] = int(ys.min()) if len(ys) else None
            t["y1"] = int(ye.max()) if len(ye) else None
            t["lat"] = [round(float(g.latitude.min()), 3), round(float(g.latitude.max()), 3)]
            e = g._e.dropna()
            t["elev"] = [int(e.min()), int(e.max())] if len(e) else None
            v = g._v.dropna()
            t["val"] = [round(float(v.min()), 3), round(float(v.median()), 3), round(float(v.max()), 3)] if len(v) else None
            d = g._d.dropna()
            t["depthMax"] = round(float(d.max()), 2) if len(d) else None
            mc = g.method_key.value_counts()
            t["methods"] = {str(int(k)): int(c) for k, c in mc.items()}
            h = g._yh[g._yh > 0].value_counts().sort_index()
            t["hist"] = [[int(k), int(c)] for k, c in h.items()]
            nm = g.name_key.dropna().astype(int).unique()
            lab = sorted({str(name_map.get(k, k)).strip() for k in nm})
            t["names"] = lab[:60]
            t["namesTotal"] = len(lab)
        del full, all_frames

    # ---------------------------------------------------------------------
    # figures + folder resources
    # ---------------------------------------------------------------------
    fig_out = out / "figures"
    fig_n = 0
    for typ in TYPES:
        for f in folders[typ]:
            if not f["sources"]:
                continue
            f["web_figs"] = []
            for p in f["figs"]:
                rel = f"figures/{typ}/{slug(f['name'])}/{slug(p.stem)}.png"
                f["web_figs"].append(dict(src=rel, name=p.stem))
                if not args.no_figures:
                    copy_figure(p, out / rel)
                    fig_n += 1
    log(f"figures processed: {fig_n}")

    # release overview plots
    overview = []
    for p in sorted((comp / "doc" / "figures").glob("*.png")) + sorted((comp / "figures").glob("SMB_overview_*.png")):
        rel = f"figures/overview/{slug(p.stem)}.png"
        overview.append(dict(src=rel, name=p.stem.replace("_", " ")))
        if not args.no_figures:
            copy_figure(p, out / rel, maxw=1300)
    manifest["overview"] = overview

    # ---------------------------------------------------------------------
    # sources.json
    # ---------------------------------------------------------------------
    def folder_json(f):
        rel = f"data/{TYPES[f['type']]['folder']}/{f['name']}".replace(" ", "%20")
        bibtext = None
        bp = f["path"] / "reference.bib"
        if bp.exists():
            bibtext = bp.read_text(encoding="utf-8", errors="ignore").strip()[:3000]
        return dict(type=f["type"], name=f["name"], figs=f.get("web_figs", []),
                    process=f["has_process"], files=f["files"], nfiles=f["nfiles"],
                    bibtex=bibtext,
                    url=f"{REPO_URL}/tree/{REPO_BRANCH}/{rel}" if REPO_URL else None)

    out_sources = []
    for s in src_list:
        s = dict(s)
        s["folders"] = [folder_json(f) for f in s["folders"]]
        for typ, t in s["types"].items():
            t.setdefault("n", {z: 0 for z in ZONES})   # refs with no rows in the release
        out_sources.append(s)
    # drop sources without any data row
    keep = [s for s in out_sources if any(sum(t["n"].values()) > 0 for t in s["types"].values())]
    log(f"sources: {len(out_sources)} total, {len(keep)} with data rows")
    # NB: location bins use the index into src_list -> keep order & 'i'; just flag emptiness
    for s in out_sources:
        s["empty"] = s not in keep
    manifest["nSources"] = len(out_sources)

    (out / "data" / "sources.json").write_text(
        json.dumps(out_sources, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "data" / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    log("basemap ...")
    (out / "data" / "basemap.json").write_text(json.dumps(build_basemap(comp), separators=(",", ":")), encoding="utf-8")

    size = sum(p.stat().st_size for p in (out / "data").iterdir()) / 1e6
    log(f"done. data/ = {size:.1f} MB, {bins_total:,} map cells")


if __name__ == "__main__":
    main()
