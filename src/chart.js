import { rows, ident } from './db.js';
import { viewSQL, isBlob, isNum } from './main.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? 'null').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const COLOR = '#2d7f6b';

function colsOf(s) {
  return (s.sql ? s.sqlCols : s.cols).filter((c) => !isBlob(c.type) && !/^(STRUCT|MAP)|\[\]$/.test(c.type));
}

export function fillChartCols(s) {
  const sel = $('chartCol');
  const cols = colsOf(s);
  const prev = sel.value;
  sel.innerHTML = cols.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}（${isNum(c.type) ? '数値' : 'カテゴリ'}）</option>`).join('');
  if (cols.some((c) => c.name === prev)) sel.value = prev;
  else { const n = cols.find((c) => isNum(c.type)); if (n) sel.value = n.name; }
}

export async function renderChart(s) {
  const area = $('chartArea');
  const name = $('chartCol').value;
  const col = colsOf(s).find((c) => c.name === name);
  if (!col) { area.innerHTML = '<p class="hint">グラフにできる列がありません</p>'; return; }
  const sql = viewSQL(s, { all: true });
  const c = ident(col.name);
  const n = +$('chartN').value;
  area.innerHTML = '<p class="hint">集計中…</p>';

  let data, title;
  if (isNum(col.type)) {
    const [st] = await rows(`SELECT min(${c})::DOUBLE AS lo, max(${c})::DOUBLE AS hi, count(${c})::BIGINT AS n FROM (${sql})`);
    if (st.lo == null) { area.innerHTML = '<p class="hint">値がありません</p>'; return; }
    const bins = Math.max(5, n);
    const w = (st.hi - st.lo) / bins || 1;
    const r = await rows(`SELECT LEAST(floor((${c}::DOUBLE - ${st.lo}) / ${w}), ${bins - 1})::INT AS b, count(*)::BIGINT AS n FROM (${sql}) WHERE ${c} IS NOT NULL GROUP BY 1 ORDER BY 1`);
    const m = new Map(r.map((x) => [x.b, Number(x.n)]));
    data = Array.from({ length: bins }, (_, i) => ({ label: fmt(st.lo + i * w) + ' – ' + fmt(st.lo + (i + 1) * w), n: m.get(i) || 0 }));
    title = `${col.name} のヒストグラム（${bins} 区間、null 除く ${Number(st.n).toLocaleString('ja-JP')} 件）`;
  } else {
    const r = await rows(`SELECT CAST(${c} AS VARCHAR) AS v, count(*)::BIGINT AS n FROM (${sql}) GROUP BY 1 ORDER BY 2 DESC LIMIT ${n}`);
    data = r.map((x) => ({ label: x.v, n: Number(x.n) }));
    title = `${col.name} の出現頻度 上位 ${n}`;
  }
  area.innerHTML = `<p><b>${esc(title)}</b></p>` + bars(data);
}

function fmt(v) {
  const a = Math.abs(v);
  return a !== 0 && (a < 0.01 || a >= 1e7) ? v.toExponential(2) : (+v.toFixed(2)).toLocaleString('ja-JP');
}

function bars(data) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const lw = 200, bw = 520, h = 22, W = lw + bw + 90;
  const rowsSvg = data.map((d, i) => {
    const y = i * h;
    const w = Math.max(d.n ? 1 : 0, (d.n / max) * bw);
    const label = String(d.label ?? 'null');
    return `<g transform="translate(0,${y})">
      <text x="${lw - 8}" y="15" text-anchor="end">${esc(label.length > 28 ? label.slice(0, 28) + '…' : label)}<title>${esc(label)}</title></text>
      <rect x="${lw}" y="3" width="${w}" height="${h - 6}" fill="${COLOR}" rx="2"></rect>
      <text x="${lw + w + 6}" y="15" fill="#555">${d.n.toLocaleString('ja-JP')}</text>
    </g>`;
  }).join('');
  return `<svg width="${W}" height="${data.length * h + 4}" viewBox="0 0 ${W} ${data.length * h + 4}">${rowsSvg}</svg>`;
}
