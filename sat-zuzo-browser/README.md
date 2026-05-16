# SAT図像ブラウザ（叩き台）

東京大学 [SAT大正蔵図像DB](https://dzkimgs.l.u-tokyo.ac.jp/SATi/images.php) の非公式フロントエンド。本家は IIIF 準拠だが UI に難があるため、IIIF API 経由でメタデータを引いて使い勝手の良い検索/閲覧画面を被せる「叩き台」プロジェクト。

> **これは非公式の研究/開発用プロトタイプです。** 本家サイトを置き換えるものではありません。

## 構成

```
sat-zuzo-browser/
├── server.py            Flask: 静的配信 + /api/search, /api/items/<id>, /api/facets
├── scripts/
│   ├── fetch_manifests.py   IIIF Manifest 取得 → SQLite 投入
│   └── sample_manifest.json 動作確認用ダミーデータ
├── db/
│   └── schema.sql       images / annotations / tags
├── data/
│   └── sat.db           取得結果（gitignore 対象）
└── web/
    ├── index.html       ファセット + サムネイルグリッド
    ├── style.css        CSS変数で和風配色
    └── app.js           バニラ JS、OpenSeadragon でビューワ
```

## セットアップ

```bash
cd sat-zuzo-browser
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# サンプルデータを投入して動作確認
python scripts/fetch_manifests.py --seed

# サーバ起動
python server.py
# → http://localhost:5000
```

`fetch_manifests.py --volume 1` で巻1の実マニフェスト取得を呼び出すが、現状の `discover_manifests` は本家エンドポイント調査が未完で NotImplementedError を返す。実取得を有効化する際は `User-Agent` に連絡先メールアドレスを設定し、`REQUEST_INTERVAL_SEC` を守ること。

## 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| バックエンド | Python 3.11 + Flask 3 | 最小コードで API & 静的配信 |
| データ | SQLite | 単一ファイル、PR で diff も読みやすい |
| フロント | バニラ HTML/CSS/JS | フレームワーク学習コスト無しで Claude Code が反復しやすい |
| 画像ビューワ | OpenSeadragon (CDN) | IIIF Image API 標準対応 |
| フォント | Shippori Mincho + Noto Sans JP | 和風意匠と可読性の両立 |

## ロードマップ

- **v0.1（現在）**: 巻1のみサムネイル一覧 + OpenSeadragon 閲覧
- **v0.2**: ファセット拡充（姿形/持物/印相/座法/装身具）、全12巻
- **v0.3**: 類似画像検索（pHash / CLIP 埋め込み）
- **v0.4**: Claude による尊像アノテーションオーバーレイ（IIIF Annotation 準拠）

## ライセンス

- **自作コード（server.py, scripts/, web/, db/schema.sql 等）**: [MIT](https://opensource.org/licenses/MIT)
- **画像データ**: 本家 SAT大正蔵図像DB の表示に従い [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja) 継承（実画像はサーバ側にキャッシュ・再配布せず、IIIF URL 経由で参照のみ）

クレジット表示の例:
> 画像出典: SAT大正蔵図像DB（東京大学）<https://dzkimgs.l.u-tokyo.ac.jp/SATi/images.php> / CC BY-SA 4.0

## 運用上の注意

- IIIF サーバへのレート制限（並列1・200ms 間隔）を守る。
- `User-Agent` には必ず連絡先を入れる（現状 `REPLACE_ME@example.com` を書き換える）。
- 取得した画像本体を再配布しない。検索インデックス（メタデータ）のみを保持。
- 本リポジトリは非公式である旨を、UI からも見える位置に明記する。

## 開発メモ

- `data/sat.db` は `.gitignore` 済み。チームで共有する場合は `--seed` で再現可能。
- スキーマ変更時は `data/sat.db` を削除して `--seed` し直すのが手早い（マイグレーションは v0.2 以降）。
- 本家の DOM 構造が変わると `discover_manifests` が壊れる。最初の実装では `curl` で実 HTML を保存してテストフィクスチャ化することを推奨。
