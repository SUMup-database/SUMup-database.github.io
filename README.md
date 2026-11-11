# SUMup Explorer

A static website to explore the SUMup database (density, surface mass balance, firn temperature) using only
files that already exist in `SUMup-compilation-scripts`. No database, no server-side code.

| Section | What it does |
|---|---|
| **Overview** | Release summary, measurements per year, method families, and the release-level figures from the compilation repo (`doc/figures`, `figures/`). |
| **Map** | Polar stereographic map (EPSG:3413 Greenland / EPSG:3031 Antarctica) of agglomerated measurement locations. Toggle each variable, each method family, or each individual method; filter by period or by a single source; colour by variable or method; hover/click for sources, methods, years. |
| **Sources** | Report per source: reference + DOI, location mini-maps, per-variable statistics, methods, timeline, site names, and the plots (`figures/*.png`) of the matching dataset folder, with links to `process.py` / the folder on GitHub. |
| **Search** | Text search over author, year, title, DOI, BibTeX key, dataset folder and site names, with filters (variable, region, method family, period, "has plots"). Search state is kept in the URL. |

## Build and run

```bash
python build_site_data.py          # reads ../SUMup-compilation-scripts, writes site/data and site/figures (~1.5 min)
python -m http.server 8000 -d site # then open http://localhost:8000
```

`build_site_data.py` needs Python 3.9+ with `pandas numpy pyproj shapely pyshp Pillow`.
Options: `--compilation PATH`, `--out DIR`, `--no-figures` (skip copying/resizing the PNGs).
`site/` is plain static files and can be published as is (e.g. GitHub Pages). Re-run the build after each new release.

## What is derived, and how

* **Releases**: the newest `SUMup files/SUMup_<year>_<type>_csv` folder (or `.zip`) is used for each variable
  (currently density 2026, temperature 2026, SMB 2025).
* **Map cells** (`data/loc_<type>_<zone>.bin`): rows are projected and binned on a metric grid
  (250 m for density/temperature, 500 m for SMB) per *(method, source)*, keeping count and first/last year. ~200 k cells, ~4 MB.
* **Sources** (`data/sources.json`): one source = one `bibtex_key` of the release reference tables, merged across
  variables. Per source: statistics computed from the release CSVs.
* **Method families**: raw method strings are grouped with the regex rules in `METHOD_GROUPS` (top of `build_site_data.py`).
* **Source → dataset folder**: a folder (`data/<type> data/<name>/`) is linked to a source when its `process.py` /
  `reference.bib` quotes the source's bibtex key or `reference_short`. Plots come from that folder's `figures/`
  (resized to ≤1100 px). To correct a link, add `folder_overrides.json`:
  `{"density": {"Folder name": ["Reference short 1", "Reference short 2"]}}`.
  Sources inherited from the 2023 baseline have no folder, hence no plots or script.
* **Basemap**: simplified outlines from `doc/GIS` shapefiles.

## Notes

* Edit `REPO_URL` / `REPO_BRANCH` at the top of `build_site_data.py` for the "on GitHub" links (default branch: `main`).
* Not committed anywhere: the script only reads the compilation repo and writes inside this folder.
