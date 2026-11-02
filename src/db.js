import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

let db, conn;

export async function initDB() {
  const bundle = await duckdb.selectBundle({
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  });
  const worker = new Worker(bundle.mainWorker);
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
  await useLocalExtensions(bundle.mainModule === ehWasm ? 'wasm_eh' : 'wasm_mvp');
  return db;
}

// parquet / json 拡張は DuckDB-WASM 本体に含まれず、初回利用時に読み込まれる。
// ビルド時に public/duckdb-ext へ同梱していればそちらを使い、無ければ公式リポジトリ（extensions.duckdb.org）を使う。
async function useLocalExtensions(platform) {
  try {
    const t = await conn.query('SELECT library_version AS v FROM pragma_version()');
    const ver = t.toArray()[0].toJSON().v;
    const repo = new URL('./duckdb-ext', location.href).href.replace(/\/$/, '');
    const res = await fetch(`${repo}/${ver}/${platform}/parquet.duckdb_extension.wasm`, { method: 'HEAD' });
    if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) return;
    await conn.query(`SET custom_extension_repository = '${repo}'`);
    await conn.query(`SET autoinstall_extension_repository = '${repo}'`);
  } catch { /* 公式リポジトリにフォールバック */ }
}

export const q = (sql) => conn.query(sql);

export async function rows(sql) {
  const t = await conn.query(sql);
  return t.toArray().map((r) => r.toJSON());
}

export const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
export const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

export async function registerFile(file) {
  const name = uniqueName(file.name);
  await db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
  return name;
}

export async function registerUrl(url) {
  const name = uniqueName(url.split('/').pop().split('?')[0] || 'remote.parquet');
  await db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
  return name;
}

const used = new Set();
function uniqueName(n) {
  let base = n, i = 1;
  while (used.has(n)) n = `${i++}_${base}`;
  used.add(n);
  return n;
}

export async function dropFile(name) {
  try { await db.dropFile(name); } catch { /* ignore */ }
  used.delete(name);
}

export async function copyOut(sql, fmt, extra = '') {
  const out = `export_${Date.now()}.${fmt}`;
  const opt = fmt === 'csv' ? "(FORMAT CSV, HEADER)" : fmt === 'json' ? "(FORMAT JSON, ARRAY true)" : `(FORMAT PARQUET, COMPRESSION ZSTD${extra})`;
  await db.registerEmptyFileBuffer(out);
  await conn.query(`COPY (${sql}) TO ${lit(out)} ${opt}`);
  const buf = await db.copyFileToBuffer(out);
  await db.dropFile(out);
  return buf;
}
