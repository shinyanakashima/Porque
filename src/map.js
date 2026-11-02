import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { q, ident } from './db.js';
import { viewSQL, isBlob, findGeomCols } from './main.js';
import { wkbToGeoJSON, extendBounds } from './wkb.js';

const $ = (id) => document.getElementById(id);
const COLOR = '#d0592b';
const TILES = {
  pale: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  std: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  photo: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
};
const ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>';

maplibregl.setWorkerUrl(workerUrl);

let map, ready;

function ensureMap() {
  if (map) return ready;
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: { base: { type: 'raster', tiles: [TILES.pale], tileSize: 256, maxzoom: 18, attribution: ATTR } },
      layers: [{ id: 'base', type: 'raster', source: 'base' }],
    },
    center: [143.2, 42.92], // 帯広
    zoom: 9,
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left');
  ready = new Promise((res) => map.on('load', () => {
    map.addSource('data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'fill', type: 'fill', source: 'data', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.35 } });
    map.addLayer({ id: 'line', type: 'line', source: 'data', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': COLOR, 'line-width': 1.2 } });
    map.addLayer({ id: 'point', type: 'circle', source: 'data', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': COLOR, 'circle-radius': 4, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    for (const l of ['fill', 'line', 'point']) {
      map.on('click', l, (e) => {
        const p = e.features[0].properties;
        const html = '<table class="popup-table">' + Object.entries(p).map(([k, v]) =>
          `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + '</table>';
        new maplibregl.Popup({ maxWidth: '360px' }).setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
      map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
    }
    res();
  }));
  $('baseMap').onchange = () => map.getSource('base').setTiles([TILES[$('baseMap').value]]);
  return ready;
}

export function mapResize() { if (map) setTimeout(() => map.resize(), 0); }

export function fillGeomCols(s) {
  const sel = $('geomCol');
  const prev = sel.value;
  const cols = findGeomCols(s);
  sel.innerHTML = cols.map((c) => `<option>${esc(c)}</option>`).join('') || '<option value="">（なし）</option>';
  if (cols.includes(prev)) sel.value = prev;
}

export async function renderMap(s) {
  await ensureMap();
  const gcol = $('geomCol').value;
  if (!gcol) {
    map.getSource('data').setData({ type: 'FeatureCollection', features: [] });
    $('mapInfo').textContent = 'ジオメトリ列（WKB の BLOB 列）が見つかりません';
    return '地図: ジオメトリ列なし';
  }
  const limit = +$('geomLimit').value;
  const all = s.sql ? s.sqlCols : s.cols;
  const props = all.filter((c) => !isBlob(c.type)).slice(0, 30);
  const sql = viewSQL(s, { all: true });
  const t = await q(`SELECT ${ident(gcol)} AS __g${props.map((c) => `, CAST(${ident(c.name)} AS VARCHAR) AS ${ident(c.name)}`).join('')}
                     FROM (${sql}) WHERE ${ident(gcol)} IS NOT NULL LIMIT ${limit}`);
  const [{ n }] = (await q(`SELECT count(*)::BIGINT AS n FROM (${sql}) WHERE ${ident(gcol)} IS NOT NULL`)).toArray().map((r) => r.toJSON());
  const total = Number(n);

  const g = t.getChild('__g');
  const pv = props.map((c) => t.getChild(c.name));
  const features = [];
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  let bad = 0;
  for (let i = 0; i < t.numRows; i++) {
    const geom = wkbToGeoJSON(g.get(i));
    if (!geom) { bad++; continue; }
    extendBounds(b, geom);
    const p = {};
    props.forEach((c, j) => { const v = pv[j].get(i); if (v != null) p[c.name] = v; });
    features.push({ type: 'Feature', geometry: geom, properties: p });
  }
  map.getSource('data').setData({ type: 'FeatureCollection', features });

  const lonlat = b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90;
  if (features.length && lonlat) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 17, duration: 0 });

  const crs = s.meta.geo?.columns?.[gcol]?.crs;
  const crsName = crs == null ? 'OGC:CRS84（既定）' : (crs.id ? `${crs.id.authority}:${crs.id.code}` : crs.name || '指定あり');
  let msg = `${features.length.toLocaleString('ja-JP')} / ${total.toLocaleString('ja-JP')} 件を表示`;
  if (total > limit) msg += '（上限で打ち切り）';
  if (bad) msg += `・解析不可 ${bad} 件`;
  if (!lonlat && features.length) msg += '・座標が経緯度ではありません（' + crsName + '）。EPSG:4326 に変換してください';
  $('mapInfo').textContent = msg;
  return `地図: ${msg}`;
}

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
