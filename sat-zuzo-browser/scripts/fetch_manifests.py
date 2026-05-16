"""SAT 大正蔵図像 DB の IIIF マニフェスト取得スクリプト。

実運用: 本家ページから IIIF Manifest URL を抽出し、巻ごとに取得して SQLite に格納。
本叩き台時点ではネットワーク取得は省略可能で、--seed でサンプル JSON を投入できる。

レート制限: 並列 1、リクエスト間 200ms 以上、User-Agent に連絡先を明示。
SAT 図像 DB は CC BY-SA を採用しているが、過剰アクセスは厳禁。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Iterable

import requests

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "sat.db"
SCHEMA_PATH = ROOT / "db" / "schema.sql"
SAMPLE_PATH = ROOT / "scripts" / "sample_manifest.json"

# 連絡先は実運用前に書き換えること
USER_AGENT = "sat-zuzo-browser-tatakidai/0.1 (research; contact: REPLACE_ME@example.com)"
REQUEST_INTERVAL_SEC = 0.25
REQUEST_TIMEOUT_SEC = 30

SAT_BASE = "https://dzkimgs.l.u-tokyo.ac.jp/SATi/images.php"


def ensure_schema(conn: sqlite3.Connection) -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema)
    conn.commit()


def upsert_image(conn: sqlite3.Connection, row: dict) -> None:
    conn.execute(
        """
        INSERT INTO images (volume, page, iiif_manifest_url, iiif_image_url, title, deity_category)
        VALUES (:volume, :page, :iiif_manifest_url, :iiif_image_url, :title, :deity_category)
        ON CONFLICT(volume, page) DO UPDATE SET
            iiif_manifest_url=excluded.iiif_manifest_url,
            iiif_image_url=excluded.iiif_image_url,
            title=excluded.title,
            deity_category=excluded.deity_category
        """,
        row,
    )


def load_sample(conn: sqlite3.Connection) -> int:
    payload = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    for item in items:
        upsert_image(conn, item)
    conn.commit()
    return len(items)


def fetch_url(url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SEC)
    resp.raise_for_status()
    return resp.text


def discover_manifests(volume: int) -> Iterable[dict]:
    """本家 HTML から Mirador 初期化スクリプトを探し、巻番号で絞った manifest URL を返す。

    実装メモ: SAT 側の DOM 構造は将来変わりうる。最初は curl で実 HTML を保存し、
    そこから iiif_manifest_url のパターン（例: /iiif/zz/{volume:02}/{page:02}/manifest.json）
    を抽出するのが安全。本関数は本番接続テストが取れていないため stub。
    """
    raise NotImplementedError(
        "本家エンドポイントの実調査が未完了。叩き台では --seed を使用してください。"
    )


def fetch_volume(conn: sqlite3.Connection, volume: int) -> int:
    count = 0
    for record in discover_manifests(volume):
        upsert_image(conn, record)
        count += 1
        time.sleep(REQUEST_INTERVAL_SEC)
    conn.commit()
    return count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seed",
        action="store_true",
        help="sample_manifest.json を DB に投入（ネットアクセスなし）",
    )
    parser.add_argument(
        "--volume",
        type=int,
        default=None,
        help="指定巻のマニフェストを実取得（要ネットアクセス、現状未対応）",
    )
    args = parser.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(conn)

        if args.seed:
            n = load_sample(conn)
            print(f"[seed] {n} 件をサンプルから投入: {DB_PATH}")
            return 0

        if args.volume is not None:
            try:
                n = fetch_volume(conn, args.volume)
                print(f"[fetch] 巻{args.volume}: {n} 件取得")
                return 0
            except NotImplementedError as e:
                print(f"[skip] {e}", file=sys.stderr)
                return 2

        parser.print_help()
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
