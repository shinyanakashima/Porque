import { rows, ident } from './db.js';
import { viewSQL, isBlob } from './main.js';

const esc = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const short = (s, n = 40) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) + '…' : s; };
const num = (v, d = 2) => v == null || v === '' ? '' : isFinite(+v) ? (+v).toLocaleString('ja-JP', { maximumFractionDigits: d }) : esc(short(v));

function mm(v, type) {
  if (isBlob(type)) return '<td class="hint">-</td>';
  if (v != null && v !== '' && isFinite(+v)) return `<td class="n">${num(v)}</td>`;
  return `<td class="mono" title="${esc(v)}">${esc(short(v, 28))}</td>`;
}

export async function renderProfile(el, s) {
  el.innerHTML = '<p class="hint">計算中…</p>';
  const sql = viewSQL(s);
  let res;
  try {
    res = await rows(`SELECT column_name, column_type, CAST(min AS VARCHAR) AS min, CAST(max AS VARCHAR) AS max, approx_unique::BIGINT AS uniq, CAST(avg AS VARCHAR) AS avg, CAST(std AS VARCHAR) AS std, CAST(q50 AS VARCHAR) AS q50, count::BIGINT AS cnt, null_percentage::DOUBLE AS nullp FROM (SUMMARIZE ${sql})`);
  } catch {
    // BLOB を含むと失敗する場合があるので、除外して再計算
    const cols = (s.sql ? s.sqlCols : s.cols.filter((c) => c.visible)).filter((c) => !isBlob(c.type));
    const sub = `SELECT ${cols.map((c) => ident(c.name)).join(', ')} FROM (${sql})`;
    res = await rows(`SELECT column_name, column_type, CAST(min AS VARCHAR) AS min, CAST(max AS VARCHAR) AS max, approx_unique::BIGINT AS uniq, CAST(avg AS VARCHAR) AS avg, CAST(std AS VARCHAR) AS std, CAST(q50 AS VARCHAR) AS q50, count::BIGINT AS cnt, null_percentage::DOUBLE AS nullp FROM (SUMMARIZE ${sub})`);
  }
  const total = res.length ? Number(res[0].cnt) : 0;
  const warn = res.filter((r) => r.nullp >= 50 || (Number(r.uniq) <= 1 && total > 1));

  el.innerHTML = `
    <div class="ptitle"><h2>列プロファイル</h2><span class="hint">${total.toLocaleString('ja-JP')} 行が対象${s.search || s.sql ? '（絞り込み後）' : ''}。ユニーク数は近似値です。</span></div>
    ${warn.length ? `<p class="hint">要確認: ${warn.map((r) => `<b>${esc(r.column_name)}</b>`).join('、')}（欠損50%以上 または 値が1種類のみ）</p>` : ''}
    <table class="ptable">
      <thead><tr><th>列</th><th>型</th><th>欠損率</th><th>ユニーク数</th><th>最小</th><th>最大</th><th>平均</th><th>中央値</th><th>標準偏差</th></tr></thead>
      <tbody>${res.map((r) => `
        <tr>
          <td class="mono">${esc(r.column_name)}</td>
          <td class="mono" title="${esc(r.column_type)}">${esc(short(r.column_type, 24))}</td>
          <td class="n"><span class="bar"><i style="width:${Math.min(100, r.nullp)}%"></i></span>${(+r.nullp).toFixed(1)}%</td>
          <td class="n">${Math.min(Number(r.uniq), Number(r.cnt) - Math.round(Number(r.cnt) * r.nullp / 100)).toLocaleString('ja-JP')}</td>
          ${mm(r.min, r.column_type)}
          ${mm(r.max, r.column_type)}
          <td class="n">${num(r.avg)}</td>
          <td class="n">${num(r.q50)}</td>
          <td class="n">${num(r.std)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}
