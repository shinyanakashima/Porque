// 仮想スクロール付きテーブル。表示範囲の行だけを DuckDB から取得する。
const RH = 27;          // 行の高さ(px) 26 + 罫線1
const BLOCK = 200;      // 1回に取得する行数
const MAX_H = 15_000_000; // ブラウザの要素高さ上限対策

const NUM = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL)/i;

export function createGrid({ head, body, spacer, rowsEl, onSort, onRange }) {
  let cols = [], widths = [], total = 0, fetchFn = null, sort = null;
  let cache = new Map(), pending = new Set(), token = 0;
  let idxW = 60;

  function defaultWidth(c) {
    const w = Math.max(c.name.length * 8 + 24, NUM.test(c.type) ? 90 : 120);
    return Math.min(w, /^(STRUCT|MAP|.*\[\])/.test(c.type) ? 320 : 260);
  }

  function setData(d) {
    const sameCols = d.cols.length === cols.length && d.cols.every((c, i) => c.name === cols[i].name);
    const keep = sameCols ? widths : null;
    cols = d.cols; total = d.total; fetchFn = d.fetch; sort = d.sort;
    widths = keep || cols.map(defaultWidth);
    idxW = Math.max(50, String(total).length * 8 + 20);
    cache = new Map(); pending = new Set(); token++;
    renderHead();
    spacer.style.height = Math.min(total * RH, MAX_H) + 'px';
    spacer.style.width = rowWidth() + 'px';
    body.scrollTop = 0;
    render();
  }

  const rowWidth = () => idxW + widths.reduce((a, b) => a + b, 0);

  function renderHead() {
    head.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'hrow';
    row.style.width = rowWidth() + 20 + 'px';
    const idx = document.createElement('div');
    idx.className = 'hcell';
    idx.style.width = idxW + 'px';
    idx.innerHTML = '<span class="hn">#</span><span class="ht">&nbsp;</span>';
    row.appendChild(idx);
    cols.forEach((c, i) => {
      const h = document.createElement('div');
      h.className = 'hcell';
      h.style.width = widths[i] + 'px';
      const arrow = sort && sort.col === c.name ? (sort.desc ? ' ▼' : ' ▲') : '';
      h.innerHTML = `<span class="hn"></span><span class="ht"></span><span class="rs"></span>`;
      h.querySelector('.hn').textContent = c.name + arrow;
      h.querySelector('.ht').textContent = c.type;
      h.title = `${c.name}\n${c.type}\nクリックで並べ替え`;
      h.onclick = (e) => { if (!e.target.classList.contains('rs')) onSort(c.name); };
      h.querySelector('.rs').onmousedown = (e) => startResize(e, i);
      row.appendChild(h);
    });
    head.appendChild(row);
    head.scrollLeft = body.scrollLeft;
  }

  function startResize(e, i) {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = widths[i];
    const move = (ev) => {
      widths[i] = Math.max(40, w0 + ev.clientX - x0);
      renderHead(); render();
      spacer.style.width = rowWidth() + 'px';
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function firstRow() {
    const visible = Math.ceil(body.clientHeight / RH);
    if (total * RH <= MAX_H) return { first: Math.floor(body.scrollTop / RH), top: Math.floor(body.scrollTop / RH) * RH, visible };
    const maxScroll = Math.max(1, MAX_H - body.clientHeight);
    const first = Math.round((body.scrollTop / maxScroll) * Math.max(0, total - visible));
    return { first, top: body.scrollTop, visible };
  }

  function getRow(i) {
    const b = Math.floor(i / BLOCK);
    const blk = cache.get(b);
    if (blk) return blk[i - b * BLOCK];
    if (!pending.has(b) && fetchFn) {
      pending.add(b);
      const my = token;
      fetchFn(b * BLOCK, BLOCK).then((data) => {
        if (my !== token) return;
        cache.set(b, data);
        pending.delete(b);
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        render();
      }).catch(() => pending.delete(b));
    }
    return null;
  }

  function render() {
    const { first, top, visible } = firstRow();
    const last = Math.min(total, first + visible + 2);
    rowsEl.style.transform = `translateY(${top}px)`;
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const r = getRow(i);
      const el = document.createElement('div');
      el.className = 'row';
      el.style.width = rowWidth() + 'px';
      let html = `<div class="cell idx" style="width:${idxW}px">${i + 1}</div>`;
      for (let j = 0; j < cols.length; j++) {
        const v = r ? r[j] : '';
        const isNull = r && v == null;
        const cls = 'cell' + (NUM.test(cols[j].type) ? ' num' : '') + (isNull ? ' null' : '');
        html += `<div class="${cls}" style="width:${widths[j]}px">${isNull ? 'null' : esc(v)}</div>`;
      }
      el.innerHTML = html;
      frag.appendChild(el);
    }
    rowsEl.replaceChildren(frag);
    onRange && total && onRange(first, first + visible, total);
  }

  body.addEventListener('scroll', () => { head.scrollLeft = body.scrollLeft; render(); });
  window.addEventListener('resize', () => render());

  // セルの内容をクリックで全文表示（長い STRUCT など）
  rowsEl.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.cell');
    if (c && !c.classList.contains('idx')) alert(c.textContent);
  });

  function jump(i) {
    i = Math.max(0, Math.min(total - 1, i));
    if (total * RH <= MAX_H) body.scrollTop = i * RH;
    else body.scrollTop = (i / Math.max(1, total - 1)) * (MAX_H - body.clientHeight);
  }

  return { setData, jump, jumpFrac: (p) => jump(Math.round(p * (total - 1))) };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
