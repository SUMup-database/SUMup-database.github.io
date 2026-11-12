// A small canvas map in polar stereographic coordinates (metres).
// No tiles / no external libraries: the basemap is drawn from simplified
// ice-sheet outlines shipped in data/basemap.json.
import { makeProj } from './proj.js';

export const EXTENT = {
  greenland: [-700e3, -3400e3, 900e3, -600e3],
  antarctica: [-2950e3, -2750e3, 2950e3, 2750e3],
};

const GRID = {
  greenland: { parallels: [60, 70, 80], meridians: 30, latMin: 55, labelLon: -105, merLabelLat: 58 },
  antarctica: { parallels: [-60, -70, -80], meridians: 30, latMin: -58, labelLon: 150, merLabelLat: -63 },
};

export const theme = {};
export function refreshTheme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (k) => cs.getPropertyValue(k).trim();
  for (const k of ['ocean', 'land', 'ice', 'shelf', 'grid', 'gridtext', 'coast', 'edge']) theme[k] = g('--map-' + k);
  for (const t of ['density', 'smb', 'temperature']) theme['c_' + t] = g('--c-' + t);
}

const cache = {};
function zoneAssets(zone, basemap) {
  if (cache[zone]) return cache[zone];
  const mk = (rings) => {
    const p = new Path2D();
    for (const r of rings) {
      p.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) p.lineTo(r[i], r[i + 1]);
      p.closePath();
    }
    return p;
  };
  const proj = makeProj(zone);
  const g = GRID[zone];
  const grid = new Path2D();
  const sgn = zone === 'greenland' ? 1 : -1;
  for (const lat of g.parallels) {
    for (let lon = -180; lon <= 180; lon += 2) {
      const [x, y] = proj.forward(lat, lon);
      lon === -180 ? grid.moveTo(x, y) : grid.lineTo(x, y);
    }
  }
  for (let lon = -180; lon < 180; lon += g.meridians) {
    for (let k = 0; k <= 40; k++) {
      const lat = g.latMin + ((sgn * 90 - g.latMin) * k) / 40;
      const [x, y] = proj.forward(lat, lon);
      k === 0 ? grid.moveTo(x, y) : grid.lineTo(x, y);
    }
  }
  const labels = [];
  for (const lat of g.parallels) {
    const [x, y] = proj.forward(lat, g.labelLon);
    labels.push({ x, y, text: `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}` });
  }
  for (let lon = -150; lon <= 180; lon += g.meridians) {
    const [x, y] = proj.forward(g.merLabelLat, lon);
    labels.push({ x, y, text: `${Math.abs(lon)}°${lon < 0 ? 'W' : lon > 0 && lon < 180 ? 'E' : ''}` });
  }
  cache[zone] = {
    proj,
    land: mk(basemap[zone].land),
    ice: mk(basemap[zone].ice),
    grid,
    labels,
  };
  return cache[zone];
}

export class PolarMap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} o {zone, basemap, interactive, drawPoints(ctx,map), onMove(lat,lon,px,py), onClick(px,py,ev), onView()}
   */
  constructor(canvas, o) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = o;
    this.basemap = o.basemap;
    this.showIce = true;
    this.showGrid = true;
    this.cx = 0;
    this.cy = 0;
    this.s = 5000; // metres per CSS pixel
    this.w = 300;
    this.h = 300;
    this.setZone(o.zone || 'greenland', false);
    this._raf = 0;
    // interactive maps render the full scene into an offscreen bitmap; while the user pans/zooms
    // that bitmap is just moved/scaled (cheap) and the scene is re-rendered once the gesture settles
    this._off = o.interactive ? document.createElement('canvas') : null;
    this._snap = null;
    this._fast = false;
    this._idle = 0;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement || canvas);
    if (o.interactive) this._bind();
    this.resize();
  }

  setZone(zone, fit = true) {
    this.zone = zone;
    this._snap = null;
    this.assets = zoneAssets(zone, this.basemap);
    this.proj = this.assets.proj;
    if (fit) this.fit(EXTENT[zone]);
  }

  resize() {
    const p = this.canvas.parentElement || this.canvas;
    const w = Math.max(50, Math.round(p.clientWidth));
    const h = Math.max(50, Math.round(p.clientHeight));
    if (w === this.w && h === this.h && this.dpr === (window.devicePixelRatio || 1) && this._sized) return;
    this._sized = true;
    this.w = w;
    this.h = h;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (this._off) {
      this._off.width = this.canvas.width;
      this._off.height = this.canvas.height;
      this._snap = null;
    }
    // first time the canvas has a real size (it may start inside a hidden view): fit the region
    if (!this._realFit && p.clientWidth > 100 && p.clientHeight > 100) {
      this._realFit = true;
      this.fit(this._pendingFit || EXTENT[this.zone]);
    }
    this.draw();
  }

  /** fit a bbox [xmin,ymin,xmax,ymax] (metres) */
  fit(b, pad = 0.05) {
    this._fitted = true;
    if (!this._realFit) this._pendingFit = b; // canvas not laid out yet: remember
    if (this.w <= 100 || this.h <= 100) { this.draw(); return; }
    const sx = (b[2] - b[0]) / (this.w * (1 - 2 * pad));
    const sy = (b[3] - b[1]) / (this.h * (1 - 2 * pad));
    this.s = Math.max(sx, sy, 8);
    this.cx = (b[0] + b[2]) / 2;
    this.cy = (b[1] + b[3]) / 2;
    this.draw();
    this.o.onView?.();
  }

  reset() {
    this.fit(EXTENT[this.zone]);
  }

  destroy() {
    this._ro.disconnect();
    clearTimeout(this._idle);
  }

  toScreen(x, y) {
    return [(x - this.cx) / this.s + this.w / 2, this.h / 2 - (y - this.cy) / this.s];
  }
  toMap(px, py) {
    return [this.cx + (px - this.w / 2) * this.s, this.cy - (py - this.h / 2) * this.s];
  }

  zoomAt(px, py, factor) {
    const [mx, my] = this.toMap(px, py);
    const ext = EXTENT[this.zone];
    const smax = Math.max(ext[2] - ext[0], ext[3] - ext[1]) / Math.min(this.w, this.h) * 1.6;
    this.s = Math.min(smax, Math.max(5, this.s / factor));
    this.cx = mx - (px - this.w / 2) * this.s;
    this.cy = my + (py - this.h / 2) * this.s;
    this._interact();
    this.o.onView?.();
  }

  /** full (sharp) redraw of the scene */
  draw() {
    clearTimeout(this._idle);
    this._fast = false;
    this._schedule();
  }

  /** view changed by a pan/zoom gesture: move the cached bitmap now, re-render when the gesture settles */
  _interact() {
    if (!this._off || !this._snap) { this.draw(); return; }
    this._fast = true;
    clearTimeout(this._idle);
    this._idle = setTimeout(() => this.draw(), 140);
    this._schedule();
  }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._draw();
    });
  }

  _draw() {
    const { ctx, w, h, dpr } = this;
    if (!this._off) {
      this._render(ctx);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this._fast && this._snap) {
      // cheap path: reuse the last rendered bitmap, shifted and scaled to the current view
      const sn = this._snap;
      const k = sn.s / this.s;
      const dx = (-(w / 2) * k + (sn.cx - this.cx) / this.s + w / 2) * dpr;
      const dy = (-(h / 2) * k + h / 2 - (sn.cy - this.cy) / this.s) * dpr;
      ctx.fillStyle = theme.ocean;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this._off, dx, dy, this._off.width * k, this._off.height * k);
    } else {
      const octx = this._off.getContext('2d');
      this._render(octx);
      this._snap = { cx: this.cx, cy: this.cy, s: this.s };
      ctx.drawImage(this._off, 0, 0);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._scaleBar();
  }

  _render(ctx) {
    const { w, h, dpr, s } = this;
    const A = this.assets;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.ocean;
    ctx.fillRect(0, 0, w, h);

    // basemap: draw metre-space paths through an affine transform
    ctx.save();
    ctx.setTransform(dpr / s, 0, 0, -dpr / s, dpr * (w / 2 - this.cx / s), dpr * (h / 2 + this.cy / s));
    const order = this.zone === 'greenland'
      ? [[A.land, theme.land], [A.ice, theme.ice]]
      : [[A.ice, theme.shelf], [A.land, theme.ice]];
    if (this.showIce) {
      for (const [p, col] of order) {
        ctx.fillStyle = col;
        ctx.fill(p, 'evenodd');
      }
    }
    ctx.lineWidth = 0.8 * s;
    ctx.strokeStyle = theme.coast;
    ctx.stroke(A.land);
    if (this.zone === 'antarctica') ctx.stroke(A.ice);
    if (this.showGrid) {
      ctx.lineWidth = 0.7 * s;
      ctx.strokeStyle = theme.grid;
      ctx.stroke(A.grid);
    }
    ctx.restore();

    if (this.showGrid && this.o.interactive !== false) {
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      for (const l of A.labels) {
        const [px, py] = this.toScreen(l.x, l.y);
        if (px < 10 || py < 10 || px > w - 10 || py > h - 10) continue;
        ctx.strokeStyle = theme.ocean;
        ctx.strokeText(l.text, px, py);
        ctx.fillStyle = theme.gridtext;
        ctx.fillText(l.text, px, py);
      }
    }

    this.o.drawPoints?.(ctx, this);
  }

  _scaleBar() {
    const { ctx, s, h } = this;
    const target = s * 110; // metres for ~110px
    const pow = Math.pow(10, Math.floor(Math.log10(target)));
    const m = [1, 2, 5, 10].map((k) => k * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const px = m / s;
    const x0 = 14, y0 = h - 16;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.ocean;
    ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 4); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = theme.gridtext;
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const label = m >= 1000 ? `${m / 1000} km` : `${m} m`;
    ctx.lineWidth = 3; ctx.strokeStyle = theme.ocean; ctx.strokeText(label, x0 + 2, y0 - 5);
    ctx.fillStyle = theme.gridtext; ctx.fillText(label, x0 + 2, y0 - 5);
    ctx.restore();
  }

  _bind() {
    const c = this.canvas;
    const ptrs = new Map();
    let drag = null, pinch = null, moved = 0;
    c.style.touchAction = 'none';
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, pos(e));
      moved = 0;
      if (ptrs.size === 1) drag = { p: pos(e), cx: this.cx, cy: this.cy };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
        drag = null;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d);
        pinch.d = d;
        moved = 99;
      } else if (drag && ptrs.size === 1) {
        const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (moved > 3) {
          this.cx = drag.cx - dx * this.s;
          this.cy = drag.cy + dy * this.s;
          this._interact();
          this.o.onView?.();
        }
      }
      if (!drag || moved <= 3) {
        const [mx, my] = this.toMap(p[0], p[1]);
        const [lat, lon] = this.proj.inverse(mx, my);
        this.o.onMove?.(lat, lon, p[0], p[1]);
      }
    });
    const up = (e) => {
      const was = ptrs.has(e.pointerId);
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (was && ptrs.size === 0 && moved <= 3 && drag) this.o.onClick?.(...pos(e), e);
      if (ptrs.size === 0) drag = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => this.o.onLeave?.());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [px, py] = pos(e);
      this.zoomAt(px, py, Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 33 : 1)));
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const [px, py] = pos(e);
      this.zoomAt(px, py, 2);
    });
  }
}
