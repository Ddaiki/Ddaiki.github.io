// SAT大正蔵図像DB の偵察スクリプト (フェーズA)
// 目的: スクレイピング/全件取得の前に、データ取得経路を特定する
//
// 調査項目:
//  1. SATトップHTMLからMirador初期化部分/manifest URL/AJAXエンドポイントを抽出
//  2. IIIF Collection URLパターンの推定と試行
//  3. manifest 1件を取得して構造 (label, metadata, sequences/canvases) を要約
//  4. CORS / レスポンスヘッダ確認
//
// 出力: ./recon/{index.html, report.md, manifest-sample.json, headers.txt}
// 依存: なし (Node.js 18+ の標準 fetch のみ)
// 実行: node sat-zuzo-browser/scripts/recon/sat-recon.mjs
//
// レート制限: リクエスト間 500ms、User-Agent に連絡先を明示

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const OUT_DIR = resolve(REPO_ROOT, "recon");

// 実運用時は実アドレスに置換。本家への過剰負荷を避けるため明示する
const USER_AGENT = "sat-zuzo-browser-recon/0.1 (research; contact: REPLACE_ME@example.com)";
const REQUEST_INTERVAL_MS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const SAT_TOP = "https://dzkimgs.l.u-tokyo.ac.jp/SATi/images.php";

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithMeta(url, { method = "GET" } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method,
      headers: { "User-Agent": USER_AGENT, "Accept": "*/*" },
      signal: ctrl.signal,
      redirect: "follow",
    });
    const ct = resp.headers.get("content-type") || "";
    const cl = Number(resp.headers.get("content-length") || 0);
    if (cl > MAX_BYTES) {
      return { status: resp.status, headers: resp.headers, body: null, error: `too large: ${cl} bytes` };
    }
    const body = method === "HEAD" ? null : await resp.text();
    return { status: resp.status, headers: resp.headers, body, contentType: ct };
  } catch (e) {
    return { status: 0, error: String(e), headers: new Headers(), body: null };
  } finally {
    clearTimeout(t);
  }
}

function uniq(arr) { return Array.from(new Set(arr)); }

function extractCandidates(html) {
  // manifest を含む URL（jsonの中も拾えるよう quoting 緩め）
  const reUrl = /https?:\/\/[^\s"'<>)]+/g;
  const all = uniq(html.match(reUrl) || []);

  const buckets = {
    manifest: all.filter((u) => /manifest(\.json)?(\b|[?#])/i.test(u)),
    iiif: all.filter((u) => /\/iiif\//i.test(u)),
    collection: all.filter((u) => /collection(\.json)?(\b|[?#])/i.test(u)),
    infoJson: all.filter((u) => /info\.json/i.test(u)),
    php: all.filter((u) => /\.php(\b|[?#])/i.test(u) && u.includes("dzkimgs.l.u-tokyo.ac.jp")),
    json: all.filter((u) => /\.json(\b|[?#])/i.test(u)),
  };

  // インライン JSON (<script type="application/json">) の本文を抽出
  const reScriptJson = /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const inlineJson = [];
  let m;
  while ((m = reScriptJson.exec(html)) !== null) {
    inlineJson.push(m[1].trim().slice(0, 2000));
  }

  // Mirador / OpenSeadragon 初期化関数呼び出しの周辺
  const reMirador = /(?:Mirador\s*\(|loadManifest\s*\(|tileSources\s*:|manifestUri\s*:|"manifestUri"|window\.Mirador)/gi;
  const miradorHits = [];
  while ((m = reMirador.exec(html)) !== null) {
    const start = Math.max(0, m.index - 100);
    const end = Math.min(html.length, m.index + 400);
    miradorHits.push(html.slice(start, end));
  }

  return { all, buckets, inlineJson, miradorHits };
}

function summarizeManifest(json) {
  const out = {};
  out.context = json["@context"];
  out.type = json.type || json["@type"];
  out.label = json.label || null;
  out.id = json.id || json["@id"] || null;
  out.attribution = json.attribution || json.requiredStatement || null;
  out.license = json.license || json.rights || null;
  out.metadataKeys = Array.isArray(json.metadata)
    ? json.metadata.map((m) => (m.label && typeof m.label === "object" ? Object.values(m.label).flat().join("/") : m.label))
    : null;
  out.metadataSample = Array.isArray(json.metadata) ? json.metadata.slice(0, 6) : null;
  // v3: items, v2: sequences[0].canvases
  if (Array.isArray(json.items)) {
    out.canvasCount = json.items.length;
    out.firstCanvas = json.items[0] ? {
      id: json.items[0].id,
      label: json.items[0].label,
      width: json.items[0].width,
      height: json.items[0].height,
    } : null;
  } else if (Array.isArray(json.sequences) && json.sequences[0]?.canvases) {
    out.canvasCount = json.sequences[0].canvases.length;
    const c = json.sequences[0].canvases[0];
    out.firstCanvas = c ? { id: c["@id"], label: c.label, width: c.width, height: c.height } : null;
  }
  return out;
}

function headersToText(headers) {
  const lines = [];
  for (const [k, v] of headers.entries()) lines.push(`${k}: ${v}`);
  return lines.join("\n");
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const report = [];
  report.push(`# SAT大正蔵図像DB 偵察レポート (フェーズA)`);
  report.push(`生成: ${new Date().toISOString()}`);
  report.push(`User-Agent: ${USER_AGENT}`);
  report.push("");

  // 1) トップHTML取得
  report.push(`## 1. SATトップ取得`);
  report.push(`URL: ${SAT_TOP}`);
  const top = await fetchWithMeta(SAT_TOP);
  report.push(`Status: ${top.status}  Content-Type: ${top.contentType || "-"}`);
  if (top.body) {
    await writeFile(resolve(OUT_DIR, "index.html"), top.body);
    report.push(`保存: recon/index.html (${top.body.length} bytes)`);
  } else {
    report.push(`エラー: ${top.error || "本文取得失敗"}`);
  }
  await writeFile(resolve(OUT_DIR, "headers-top.txt"), headersToText(top.headers));

  if (!top.body) {
    report.push("");
    report.push(`> 本文取得不可のため、以降の解析を中止。`);
    await writeFile(resolve(OUT_DIR, "report.md"), report.join("\n"));
    console.error("[recon] SATトップ取得失敗。recon/headers-top.txt を確認してください。");
    process.exit(1);
  }

  // 2) URL/インラインJSON抽出
  await sleep(REQUEST_INTERVAL_MS);
  const { buckets, inlineJson, miradorHits } = extractCandidates(top.body);

  report.push("");
  report.push(`## 2. HTML中の候補URL`);
  for (const [k, list] of Object.entries(buckets)) {
    report.push(`### ${k} (${list.length}件)`);
    if (list.length === 0) {
      report.push("- (なし)");
    } else {
      for (const u of list.slice(0, 30)) report.push(`- ${u}`);
      if (list.length > 30) report.push(`- … 他 ${list.length - 30} 件`);
    }
  }

  report.push("");
  report.push(`## 3. <script type=\"application/json\"> インライン (${inlineJson.length}件、各先頭2000字)`);
  inlineJson.slice(0, 5).forEach((s, i) => {
    report.push("");
    report.push(`### inline ${i + 1}`);
    report.push("```json");
    report.push(s);
    report.push("```");
  });

  report.push("");
  report.push(`## 4. Mirador / tileSources 周辺 (${miradorHits.length}件、各400字)`);
  miradorHits.slice(0, 5).forEach((s, i) => {
    report.push("");
    report.push(`### hit ${i + 1}`);
    report.push("```");
    report.push(s);
    report.push("```");
  });

  // 5) manifest 候補があれば1件取得
  const manifestUrl = buckets.manifest[0] || buckets.iiif.find((u) => /manifest/i.test(u)) || null;
  report.push("");
  report.push(`## 5. manifest 1件取得`);
  if (!manifestUrl) {
    report.push("- HTMLから manifest URL が抽出できず、取得をスキップ。");
    report.push("  → 次のステップ: ブラウザDevToolsのNetworkタブで `manifest` を絞り込み、実URLを手動で発見してください。");
  } else {
    report.push(`URL: ${manifestUrl}`);
    await sleep(REQUEST_INTERVAL_MS);
    const mf = await fetchWithMeta(manifestUrl);
    report.push(`Status: ${mf.status}  Content-Type: ${mf.contentType || "-"}`);
    await writeFile(resolve(OUT_DIR, "headers-manifest.txt"), headersToText(mf.headers));
    if (mf.body) {
      await writeFile(resolve(OUT_DIR, "manifest-sample.json"), mf.body);
      try {
        const json = JSON.parse(mf.body);
        const summary = summarizeManifest(json);
        report.push("```json");
        report.push(JSON.stringify(summary, null, 2));
        report.push("```");
      } catch (e) {
        report.push(`- JSONパース失敗: ${e}`);
      }
    } else {
      report.push(`- 本文取得失敗: ${mf.error}`);
    }
  }

  // 6) IIIF Collection 推定試行 (もしなければ)
  report.push("");
  report.push(`## 6. IIIF Collection 推定 URL の試行`);
  const guesses = [
    "https://dzkimgs.l.u-tokyo.ac.jp/iiif/collection.json",
    "https://dzkimgs.l.u-tokyo.ac.jp/iiif/zuzou/collection.json",
    "https://dzkimgs.l.u-tokyo.ac.jp/iiif/zuzou_v/collection.json",
    "https://dzkimgs.l.u-tokyo.ac.jp/SATi/iiif/collection.json",
  ];
  for (const g of guesses) {
    await sleep(REQUEST_INTERVAL_MS);
    const r = await fetchWithMeta(g, { method: "HEAD" });
    report.push(`- ${r.status}  ${g}`);
  }

  // 仕上げ
  report.push("");
  report.push(`## 7. 次アクションのチェックリスト`);
  report.push(`- [ ] recon/index.html を grep して manifest 候補を確認 (例: \`grep -E "manifest|iiif" recon/index.html\`)`);
  report.push(`- [ ] recon/manifest-sample.json があれば metadata に「持物/臂数/面相」相当があるか確認`);
  report.push(`- [ ] DevTools Network タブで XHR/Fetch をキャプチャ (PHPセッションが必要かを判定)`);
  report.push(`- [ ] CORS ヘッダ (Access-Control-Allow-Origin) を recon/headers-*.txt で確認`);
  report.push(`- [ ] 出力一式をコミットしてプッシュ → PRで共有`);

  await writeFile(resolve(OUT_DIR, "report.md"), report.join("\n"));
  console.log(`[recon] 完了。出力: ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("[recon] 失敗:", e);
  process.exit(1);
});
