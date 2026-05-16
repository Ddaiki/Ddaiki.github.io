"""SAT 図像ブラウザ叩き台のミニ Flask サーバ。

エンドポイント:
- GET /                          web/index.html を返す
- GET /<static>                  web/ 配下を静的配信
- GET /api/search                クエリパラメータで images を検索
- GET /api/items/<id>            画像の詳細とアノテーション一覧
- GET /api/facets                ファセット候補（現状は tags テーブルから）

注意: 本番化時は debug=False に固定、CORS の origin を絞ること。
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "sat.db"
WEB_DIR = ROOT / "web"

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": "*"}})


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in row.keys()}


@app.route("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename: str):
    target = (WEB_DIR / filename).resolve()
    if not str(target).startswith(str(WEB_DIR.resolve())):
        abort(404)
    if not target.is_file():
        abort(404)
    return send_from_directory(WEB_DIR, filename)


@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    tags = [t for t in (request.args.get("tags") or "").split(",") if t]
    limit = min(int(request.args.get("limit", 60)), 200)
    offset = max(int(request.args.get("offset", 0)), 0)

    where = []
    params: list = []
    if q:
        where.append("(title LIKE ? OR deity_category LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])
    if category:
        where.append("deity_category = ?")
        params.append(category)

    sql = "SELECT id, volume, page, iiif_manifest_url, iiif_image_url, title, deity_category FROM images"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY volume, page LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    count_sql = "SELECT COUNT(*) AS n FROM images"
    if where:
        count_sql += " WHERE " + " AND ".join(where)

    with get_conn() as conn:
        total = conn.execute(count_sql, params[:-2] if where else []).fetchone()["n"]
        rows = [row_to_dict(r) for r in conn.execute(sql, params).fetchall()]

    return jsonify({
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": rows,
        "filters": {"q": q, "category": category, "tags": tags},
    })


@app.route("/api/items/<int:item_id>")
def api_item(item_id: int):
    with get_conn() as conn:
        image = conn.execute(
            "SELECT * FROM images WHERE id = ?", (item_id,)
        ).fetchone()
        if image is None:
            abort(404)
        annotations = [
            row_to_dict(r)
            for r in conn.execute(
                "SELECT * FROM annotations WHERE image_id = ? ORDER BY id", (item_id,)
            ).fetchall()
        ]

    item = row_to_dict(image)
    for ann in annotations:
        if ann.get("tags_json"):
            try:
                ann["tags"] = json.loads(ann["tags_json"])
            except json.JSONDecodeError:
                ann["tags"] = []
    item["annotations"] = annotations
    return jsonify(item)


@app.route("/api/facets")
def api_facets():
    with get_conn() as conn:
        tag_rows = conn.execute(
            "SELECT category, value FROM tags ORDER BY category, value"
        ).fetchall()
        category_rows = conn.execute(
            "SELECT deity_category AS value, COUNT(*) AS n FROM images "
            "WHERE deity_category IS NOT NULL GROUP BY deity_category ORDER BY n DESC"
        ).fetchall()

    facets: dict[str, list] = {}
    for r in tag_rows:
        facets.setdefault(r["category"], []).append(r["value"])

    return jsonify({
        "tags": facets,
        "deity_categories": [row_to_dict(r) for r in category_rows],
    })


if __name__ == "__main__":
    if not DB_PATH.exists():
        print(f"[warn] DB が見つかりません: {DB_PATH}")
        print("       python scripts/fetch_manifests.py --seed を先に実行してください。")
    app.run(host="127.0.0.1", port=5000, debug=True)
