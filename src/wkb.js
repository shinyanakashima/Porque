// WKB / EWKB / ISO WKB(Z,M,ZM) → GeoJSON geometry
export function wkbToGeoJSON(bytes) {
  if (!bytes || bytes.length < 5) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;

  function geom() {
    const le = view.getUint8(o) === 1; o += 1;
    let t = view.getUint32(o, le); o += 4;
    let hasZ = false, hasM = false;
    // EWKB flags
    if (t & 0x80000000) hasZ = true;
    if (t & 0x40000000) hasM = true;
    if (t & 0x20000000) o += 4; // SRID
    t &= 0x0fffffff;
    // ISO
    if (t >= 3000) { hasZ = true; hasM = true; t -= 3000; }
    else if (t >= 2000) { hasM = true; t -= 2000; }
    else if (t >= 1000) { hasZ = true; t -= 1000; }
    const dim = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

    const pt = () => {
      const x = view.getFloat64(o, le), y = view.getFloat64(o + 8, le);
      o += 8 * dim;
      return [x, y];
    };
    const u32 = () => { const v = view.getUint32(o, le); o += 4; return v; };
    const pts = () => { const n = u32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = pt(); return a; };
    const rings = () => { const n = u32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = pts(); return a; };
    const subs = () => { const n = u32(); const a = new Array(n); for (let i = 0; i < n; i++) a[i] = geom(); return a; };

    switch (t) {
      case 1: { const p = pt(); return Number.isNaN(p[0]) ? null : { type: 'Point', coordinates: p }; }
      case 2: return { type: 'LineString', coordinates: pts() };
      case 3: return { type: 'Polygon', coordinates: rings() };
      case 4: return { type: 'MultiPoint', coordinates: subs().filter(Boolean).map((g) => g.coordinates) };
      case 5: return { type: 'MultiLineString', coordinates: subs().map((g) => g.coordinates) };
      case 6: return { type: 'MultiPolygon', coordinates: subs().map((g) => g.coordinates) };
      case 7: return { type: 'GeometryCollection', geometries: subs().filter(Boolean) };
      default: throw new Error('未対応のWKB型: ' + t);
    }
  }
  try { return geom(); } catch { return null; }
}

export function extendBounds(b, g) {
  if (!g) return;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
      if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
    } else c.forEach(walk);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => extendBounds(b, x));
  else walk(g.coordinates);
}
