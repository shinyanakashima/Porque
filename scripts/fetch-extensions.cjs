// DuckDB-WASM の parquet / json 拡張を public/duckdb-ext に取得する。
// 実行時に extensions.duckdb.org へアクセスできない環境（社内ネットワーク等）でも動かすため。
const fs = require('fs');
const path = require('path');
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');

const EXTENSIONS = ['parquet', 'json'];
const PLATFORMS = ['wasm_eh', 'wasm_mvp'];

async function duckdbVersion() {
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));
  const db = await duckdb.createDuckDB({
    mvp: { mainModule: `${dist}/duckdb-mvp.wasm`, mainWorker: `${dist}/duckdb-node-mvp.worker.cjs` },
    eh: { mainModule: `${dist}/duckdb-eh.wasm`, mainWorker: `${dist}/duckdb-node-eh.worker.cjs` },
  }, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  return db.connect().query('SELECT library_version AS v FROM pragma_version()').toArray()[0].toJSON().v;
}

(async () => {
  const ver = await duckdbVersion();
  const root = path.join(__dirname, '..', 'public', 'duckdb-ext', ver);
  for (const pf of PLATFORMS) {
    fs.mkdirSync(path.join(root, pf), { recursive: true });
    for (const ext of EXTENSIONS) {
      const url = `https://extensions.duckdb.org/${ver}/${pf}/${ext}.duckdb_extension.wasm`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(root, pf, `${ext}.duckdb_extension.wasm`), buf);
      console.log(`${ver}/${pf}/${ext}: ${(buf.length / 1048576).toFixed(1)} MB`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
