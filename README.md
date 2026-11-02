# Parquet Viewer

ブラウザだけで Parquet / GeoParquet を開いて確認するための社内ツール。
ファイルは DuckDB-WASM でブラウザ内処理し、サーバーへは送信しない。

## 機能

- テーブル表示：仮想スクロール（数百万行でも表示範囲だけ取得）、列の表示切替、列幅変更、ヘッダクリックで並べ替え、行ジャンプ
- メタ情報：行数・列数・行グループ数・圧縮方式・ファイルサイズ・GeoParquet の geo メタデータ
- 検索：全列の部分一致（大文字小文字区別なし）
- SQL：`data1`, `data2` … のテーブル名で任意の SQL。SELECT 結果はテーブル・グラフ・地図・エクスポートに反映
- プロファイル：列ごとの欠損率・ユニーク数・最小/最大・平均・中央値・標準偏差
- グラフ：数値列はヒストグラム、文字列列は出現頻度の上位
- 地図：WKB ジオメトリ列（GeoParquet / Overture 等）を地理院タイル上に描画、クリックで属性表示
- エクスポート：CSV / JSON / Parquet / GeoJSON（件数制限なし。Parquet は geo メタデータを引き継ぐ）
- 複数ファイルをタブで同時に開ける。URL 指定での読み込みにも対応（CORS と Range リクエストが必要）

## 開発

```bash
npm ci
npm run fetch-ext   # parquet / json 拡張を public/duckdb-ext に取得（任意）
npm run dev
```

`fetch-ext` を実行しない場合、拡張は実行時に extensions.duckdb.org から読み込まれる。

## デプロイ（GitHub Pages）

1. リポジトリの Settings → Pages → Source を「GitHub Actions」にする
2. main に push すると `.github/workflows/deploy.yml` がビルドして公開する

ビルド時に DuckDB の拡張を同梱するため、公開後は extensions.duckdb.org への通信なしで動作する。
背景地図のみ国土地理院のタイルサーバーへアクセスする。

## 制約

- ジオメトリは WKB（BLOB）のみ対応。GeoArrow エンコーディングや DuckDB GEOMETRY 型は未対応
- 地図は経緯度（EPSG:4326 / CRS84）を前提とする。平面直角座標系などは事前に変換が必要
- 地図表示は最大 10 万件まで（選択式）
- 扱えるファイルサイズはブラウザのメモリに依存する（数 GB 程度までが目安）
