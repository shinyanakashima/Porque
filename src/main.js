import { initDB, q, rows, ident, lit, registerFile, registerUrl, dropFile, copyOut } from './db.js';
import { createGrid } from './grid.js';
import { renderProfile } from './profile.js';
import { renderChart, fillChartCols } from './chart.js';
import { renderMap, fillGeomCols, mapResize } from './map.js';
import { wkbToGeoJSON } from './wkb.js';

const $ = (id) => document.getElementById(id);
const fmtN = (n) => Number(n).toLocaleString('ja-JP');
const fmtBytes = (b) => b == null ? '-' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';

export const state = { sources: [], cur: null, mode: 'table', seq: 0 };
const cur = () => state.cur;

export const isBlob = (t) => /^BLOB|^GEOMETRY|^WKB/i.test(t);
export const isNum = (t) => /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL)/i.test(t);

function status(msg, err = false) {
  const el = $('statusText');
  el.textContent = msg;
  el.classList.toggle('err', err);
}

// ---------- SQL builders ----------
function baseFrom(s) { return s.sql ? `(${s.sql}) AS _q` : ident(s.id); }
function shownCols(s) { return s.sql ? s.sqlCols : s.cols.filter((c) => c.visible); }
function allCols(s) { return s.sql ? s.sqlCols : s.cols; }

function whereClause(s, cols) {
  if (!s.search) return '';
  const pat = lit('%' + s.search + '%');
  const conds = cols.filter((c) => !isBlob(c.type)).map((c) => `CAST(${ident(c.name)} AS VARCHAR) ILIKE ${pat}`);
  return conds.length ? ' WHERE ' + conds.join(' OR ') : ' WHERE false';
}

export function viewSQL(s, { all = false } = {}) {
  const cols = all ? allCols(s) : shownCols(s);
  const sel = cols.length ? cols.map((c) => ident(c.name)).join(', ') : '1 AS "(列なし)"';
  const order = s.sort ? ` ORDER BY ${ident(s.sort.col)} ${s.sort.desc ? 'DESC' : 'ASC'} NULLS LAST` : '';
  return `SELECT ${sel} FROM ${baseFrom(s)}${whereClause(s, allCols(s))}${order}`;
}

// ---------- sources ----------
async function openFile(file) {
  status(`${file.name} を読み込み中…`);
  const fname = await registerFile(file);
  await addSource(fname, file.name, file.size);
}

async function openUrl() {
  const url = prompt('Parquet ファイルの URL（CORS と Range リクエストに対応している必要があります）');
  if (!url) return;
  status('URL を読み込み中…');
  try {
    const fname = await registerUrl(url.trim());
    await addSource(fname, url.trim(), null);
  } catch (e) { status('読み込みに失敗: ' + e.message, true); }
}

async function addSource(fname, label, size, from = null) {
  const id = 'data' + (++state.seq);
  try {
    await q(`CREATE VIEW ${ident(id)} AS SELECT * FROM ${from || `read_parquet(${lit(fname)})`}`);
    const desc = await rows(`DESCRIBE ${ident(id)}`);
    const cols = desc.map((d) => ({ name: d.column_name, type: d.column_type, visible: true }));
    const [cnt] = await rows(`SELECT count(*)::BIGINT AS n FROM ${ident(id)}`);
    let rg = '-', comp = '-';
    try {
      const [m] = await rows(`SELECT count(DISTINCT row_group_id)::INT AS rg, string_agg(DISTINCT compression, ', ') AS comp FROM parquet_metadata(${lit(fname)})`);
      rg = m.rg; comp = m.comp;
    } catch { /* ignore */ }
    let geo = null, geoRaw = null;
    try {
      const kv = await rows(`SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata(${lit(fname)})`);
      const g = kv.find((r) => r.k === 'geo');
      if (g) { geoRaw = g.v; geo = JSON.parse(g.v); }
    } catch { /* ignore */ }
    const s = {
      id, fname, label, size, cols, sqlCols: [], sql: null, search: '', sort: null,
      meta: { rows: Number(cnt.n), rowGroups: rg, compression: comp, geo, geoRaw },
    };
    state.sources.push(s);
    if (!$('sqlBox').value.trim()) $('sqlBox').value = `SELECT * FROM ${id} LIMIT 1000`;
    select(s);
  } catch (e) {
    state.seq--;
    await dropFile(fname);
    status('Parquet として読めませんでした: ' + e.message, true);
  }
}

async function closeSource(s) {
  await q(`DROP VIEW IF EXISTS ${ident(s.id)}`);
  await dropFile(s.fname);
  state.sources = state.sources.filter((x) => x !== s);
  select(state.sources[state.sources.length - 1] || null);
}

function select(s) {
  state.cur = s;
  $('searchBox').value = s ? s.search : '';
  renderTabs();
  renderSidebar();
  refresh();
}

// ---------- UI rendering ----------
function renderTabs() {
  const el = $('tabList');
  el.innerHTML = '';
  for (const s of state.sources) {
    const t = document.createElement('div');
    t.className = 'tab' + (s === cur() ? ' on' : '');
    t.title = s.label;
    t.innerHTML = `<span>${s.id}</span><span class="fname"></span><span class="x" title="閉じる">×</span>`;
    t.querySelector('.fname').textContent = s.label.split('/').pop();
    t.onclick = (e) => { if (e.target.classList.contains('x')) closeSource(s); else select(s); };
    el.appendChild(t);
  }
}

function renderSidebar() {
  const s = cur();
  const list = $('colList');
  list.innerHTML = '';
  $('colCount').textContent = s ? s.cols.length : 0;
  if (!s) { $('meta').innerHTML = ''; return; }
  const f = $('colFilter').value.toLowerCase();
  s.cols.forEach((c) => {
    if (f && !c.name.toLowerCase().includes(f)) return;
    const li = document.createElement('li');
    li.innerHTML = `<input type="checkbox"><span class="cname"></span><span class="ctype"></span>`;
    li.querySelector('input').checked = c.visible;
    li.querySelector('.cname').textContent = c.name;
    li.querySelector('.ctype').textContent = c.type;
    li.title = `${c.name}\n${c.type}`;
    li.querySelector('input').onchange = (e) => { c.visible = e.target.checked; renderMeta(); refresh(); };
    list.appendChild(li);
  });
  renderMeta();
}

function renderMeta() {
  const s = cur();
  if (!s) return;
  const m = s.meta;
  const geoCol = m.geo ? (m.geo.primary_column || Object.keys(m.geo.columns || {})[0]) : null;
  const items = [
    ['行数', fmtN(m.rows)],
    ['列数', s.cols.length],
    ['表示中の列', `${s.cols.filter((c) => c.visible).length}/${s.cols.length}`],
    ['行グループ', m.rowGroups],
    ['圧縮', m.compression || '-'],
    ['ファイルサイズ', fmtBytes(s.size)],
  ];
  if (geoCol) items.push(['GeoParquet', `${geoCol}（${m.geo.version || '-'}）`]);
  $('meta').innerHTML = items.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');
}

// ---------- grid ----------
const grid = createGrid({
  head: $('gridHead'), body: $('gridBody'), spacer: $('gridSpacer'), rowsEl: $('gridRows'),
  onSort: (col) => {
    const s = cur();
    if (!s) return;
    if (!s.sort || s.sort.col !== col) s.sort = { col, desc: false };
    else if (!s.sort.desc) s.sort.desc = true;
    else s.sort = null;
    refresh();
  },
  onRange: (first, last, total) => status(`${fmtN(first + 1)}–${fmtN(Math.min(last, total))} 行目 / ${fmtN(total)} 行 × ${shownCols(cur()).length} 列${cur().sql ? '（SQL適用中）' : ''}${cur().search ? '（検索中）' : ''}`),
});

let gen = 0;
export async function refresh() {
  const s = cur();
  const my = ++gen;
  $('drop').hidden = !!s;
  for (const v of ['tableView', 'profileView', 'chartView', 'mapView']) $(v).hidden = true;
  $('sqlPane').hidden = state.mode !== 'sql';
  if (!s) { status(state.sources.length ? '' : 'ファイルを開いてください'); return; }

  const mode = state.mode;
  try {
    if (mode === 'table' || mode === 'sql') {
      $('tableView').hidden = false;
      const sql = viewSQL(s);
      const cols = shownCols(s);
      const [c] = await rows(`SELECT count(*)::BIGINT AS n FROM (${sql})`);
      if (my !== gen) return;
      grid.setData({
        cols, total: Number(c.n), sort: s.sort,
        fetch: async (off, lim) => {
          const sel = cols.map((col) => isBlob(col.type)
            ? `CASE WHEN ${ident(col.name)} IS NULL THEN NULL ELSE '<' || octet_length(${ident(col.name)}::BLOB) || ' bytes>' END`
            : `CAST(${ident(col.name)} AS VARCHAR)`).join(', ');
          const t = await q(`SELECT ${sel || 'NULL'} FROM (${sql}) LIMIT ${lim} OFFSET ${off}`);
          const n = t.numRows, out = new Array(n);
          const vecs = cols.map((_, i) => t.getChildAt(i));
          for (let r = 0; r < n; r++) out[r] = vecs.map((v) => v.get(r));
          return out;
        },
      });
    } else if (mode === 'profile') {
      $('profileView').hidden = false;
      status('プロファイル計算中…');
      await renderProfile($('profileView'), s);
      if (my === gen) status(`プロファイル: ${shownCols(s).length} 列`);
    } else if (mode === 'chart') {
      $('chartView').hidden = false;
      fillChartCols(s);
      await renderChart(s);
      if (my === gen) status('グラフ');
    } else if (mode === 'map') {
      $('mapView').hidden = false;
      fillGeomCols(s);
      mapResize();
      status('地図を描画中…');
      const info = await renderMap(s);
      if (my === gen) status(info);
    }
  } catch (e) {
    if (my === gen) status('エラー: ' + e.message, true);
  }
}

// ---------- export ----------
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function doExport() {
  const s = cur();
  if (!s) return;
  const fmt = $('exportFmt').value;
  const base = s.label.split('/').pop().replace(/\.(geo)?parquet$|\.pq$/i, '') + (s.sql || s.search ? '_filtered' : '');
  status('エクスポート中…');
  try {
    if (fmt === 'geojson') {
      const gcol = $('geomCol').value || findGeomCols(s)[0];
      if (!gcol) throw new Error('ジオメトリ列が見つかりません');
      const sql = viewSQL(s, { all: true });
      const props = allCols(s).filter((c) => !isBlob(c.type));
      const t = await q(`SELECT ${ident(gcol)} AS __g${props.map((c) => `, CAST(${ident(c.name)} AS VARCHAR) AS ${ident(c.name)}`).join('')} FROM (${sql})`);
      const g = t.getChild('__g'), pv = props.map((c) => t.getChild(c.name));
      const parts = [];
      for (let i = 0; i < t.numRows; i++) {
        const p = {};
        props.forEach((c, j) => { p[c.name] = pv[j].get(i); });
        parts.push(JSON.stringify({ type: 'Feature', geometry: wkbToGeoJSON(g.get(i)), properties: p }));
      }
      download('{"type":"FeatureCollection","features":[\n' + parts.join(',\n') + '\n]}', base + '.geojson', 'application/geo+json');
      status(`GeoJSON を出力しました（${fmtN(parts.length)} 件）`);
      return;
    }
    const sql = viewSQL(s);
    let extra = '';
    if (fmt === 'parquet' && s.meta.geoRaw && !s.sql) extra = `, KV_METADATA {geo: ${lit(s.meta.geoRaw)}}`;
    const buf = await copyOut(sql, fmt, extra);
    download(buf, `${base}.${fmt}`, fmt === 'csv' ? 'text/csv' : fmt === 'json' ? 'application/json' : 'application/octet-stream');
    status(`${fmt.toUpperCase()} を出力しました（${fmtBytes(buf.byteLength)}）`);
  } catch (e) { status('エクスポート失敗: ' + e.message, true); }
}

export function findGeomCols(s) {
  const cols = allCols(s).filter((c) => isBlob(c.type)).map((c) => c.name);
  const prim = s.meta.geo && (s.meta.geo.primary_column || Object.keys(s.meta.geo.columns || {})[0]);
  const pref = ['geometry', 'geom', 'wkb_geometry', 'the_geom'];
  return cols.sort((a, b) => (b === prim) - (a === prim) || (pref.includes(b)) - (pref.includes(a)));
}

// ---------- SQL ----------
async function runSql() {
  const s = cur();
  const text = $('sqlBox').value.trim().replace(/;\s*$/, '');
  if (!text) return;
  status('実行中…');
  try {
    let desc = null;
    try { desc = await rows(`DESCRIBE ${text}`); } catch { /* not a query */ }
    if (!desc) {
      await q(text);
      status('実行しました');
      return;
    }
    if (!s) { status('先にファイルを開いてください', true); return; }
    s.sql = text;
    s.sqlCols = desc.map((d) => ({ name: d.column_name, type: d.column_type, visible: true }));
    s.sort = null;
    await refresh();
  } catch (e) { status('SQLエラー: ' + e.message, true); }
}

function resetSql() {
  const s = cur();
  if (!s) return;
  s.sql = null; s.sqlCols = []; s.sort = null;
  refresh();
}

// ---------- events ----------
function bind() {
  $('addSource').onclick = () => $('fileInput').click();
  $('drop').onclick = () => $('fileInput').click();
  $('addUrl').onclick = openUrl;
  $('fileInput').onchange = async (e) => { for (const f of e.target.files) await openFile(f); e.target.value = ''; };

  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    for (const f of e.dataTransfer.files) await openFile(f);
  });

  $('modeSeg').onclick = (e) => {
    const m = e.target.dataset.mode;
    if (!m) return;
    state.mode = m;
    [...$('modeSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    refresh();
  };
  $('searchForm').onsubmit = (e) => { e.preventDefault(); if (cur()) { cur().search = $('searchBox').value.trim(); refresh(); } };
  $('searchBox').addEventListener('search', () => { if (cur() && !$('searchBox').value) { cur().search = ''; refresh(); } });
  $('colFilter').oninput = renderSidebar;
  $('colAll').onclick = (e) => { e.preventDefault(); cur()?.cols.forEach((c) => (c.visible = true)); renderSidebar(); refresh(); };
  $('colNone').onclick = (e) => { e.preventDefault(); cur()?.cols.forEach((c) => (c.visible = false)); renderSidebar(); refresh(); };
  $('exportBtn').onclick = doExport;
  $('runSql').onclick = runSql;
  $('resetSql').onclick = resetSql;
  $('sqlBox').onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSql(); } };
  $('jumpForm').onsubmit = (e) => { e.preventDefault(); const n = parseInt($('jumpRow').value, 10); if (n > 0) grid.jump(n - 1); };
  document.querySelector('.jumps').onclick = (e) => { e.preventDefault(); const p = e.target.dataset.p; if (p) grid.jumpFrac(+p); };
  $('chartCol').onchange = () => renderChart(cur());
  $('chartN').onchange = () => renderChart(cur());
  $('geomCol').onchange = () => refresh();
  $('geomLimit').onchange = () => refresh();
}

bind();
initDB()
  .then(() => status('ファイルを開いてください'))
  .catch((e) => status('DuckDB の起動に失敗: ' + e.message, true));
