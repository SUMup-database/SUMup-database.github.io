// Polar stereographic projections (WGS84), Snyder 1987 -- matches
//   greenland  -> EPSG:3413 (NSIDC Sea Ice Polar Stereographic North, lon0 -45, lat_ts 70N)
//   antarctica -> EPSG:3031 (Antarctic Polar Stereographic, lon0 0, lat_ts 71S)
const A = 6378137;
const E2 = 0.00669437999014133;
const E = Math.sqrt(E2);
const R = Math.PI / 180;

const DEF = {
  greenland: { north: true, lon0: -45, latTs: 70 },
  antarctica: { north: false, lon0: 0, latTs: 71 },
};

const tfun = (phi) => {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
};

export function makeProj(zone) {
  const d = DEF[zone];
  const ph = d.latTs * R;
  const mc = Math.cos(ph) / Math.sqrt(1 - E2 * Math.sin(ph) ** 2);
  const tc = tfun(ph);
  const lon0 = d.lon0 * R;
  const north = d.north;
  const e4 = E2 * E2, e6 = e4 * E2, e8 = e4 * e4;
  return {
    zone,
    forward(lat, lon) {
      const phi = (north ? lat : -lat) * R;
      const rho = (A * mc * tfun(phi)) / tc;
      const dl = lon * R - lon0;
      return [rho * Math.sin(dl), north ? -rho * Math.cos(dl) : rho * Math.cos(dl)];
    },
    inverse(x, y) {
      const rho = Math.hypot(x, y);
      const t = (rho * tc) / (A * mc);
      const chi = Math.PI / 2 - 2 * Math.atan(t);
      const phi =
        chi +
        (E2 / 2 + (5 * e4) / 24 + e6 / 12 + (13 * e8) / 360) * Math.sin(2 * chi) +
        ((7 * e4) / 48 + (29 * e6) / 240 + (811 * e8) / 11520) * Math.sin(4 * chi) +
        ((7 * e6) / 120 + (81 * e8) / 1120) * Math.sin(6 * chi) +
        ((4279 * e8) / 161280) * Math.sin(8 * chi);
      let lon = (lon0 + (north ? Math.atan2(x, -y) : Math.atan2(x, y))) / R;
      lon = ((lon + 540) % 360) - 180;
      return [north ? phi / R : -phi / R, lon];
    },
  };
}
