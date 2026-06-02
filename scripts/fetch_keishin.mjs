// CIIC「経営事項審査 結果公表システム」から経審結果（完成工事高・自己資本額・総合評定値P点）を
// 許可番号で1件ずつ照会し keishin.json を更新。年次 cron 想定。
//
// ※最難関: 結果がPDF・最新分のみ・年1更新。サイトは開発サンドボックスから到達不可。
//   方針はベストエフォート: PDF解析できれば履歴に追記、できなければ「確認リンク＋last_checked」だけ更新し、
//   ダッシュボードの「経審確認」リンクから手動確認できるようにする。既存seedは壊さない。
//   PDF解析は pdf-parse があれば使用（無ければスキップ）。設定上書き: CIIC_SEARCH_URL / LIMIT
import path from 'node:path';
import { fetchText, stripTags, toInt, sleep, readJSON, writeJSON, loadCompanies, today } from './lib/scrape.mjs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const SEARCH_URL = process.env.CIIC_SEARCH_URL || 'http://www7.ciic.or.jp/';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const WAIT_MS = 5000;

async function loadPdfParser() {
  // pdf-parse は index.js のデバッグ処理を避けるため内部モジュールを直接読み込む
  try { return (await import('pdf-parse/lib/pdf-parse.js')).default; }
  catch { console.warn('pdf-parse 未導入: PDF抽出をスキップ（確認リンクのみ更新）'); return null; }
}

function extractFromText(text) {
  const grabNum = (label) => {
    const m = text.match(new RegExp(label + '[^0-9０-９△▲-]{0,8}([△▲-]?[0-9０-９,，]+)'));
    return m ? toInt(m[1]) : null;
  };
  const rec = {
    kijunbi: (text.match(/審査基準日[^0-9]{0,3}([0-9０-９年月日./-]+)/) || [])[1] || null,
    revenue_k: grabNum('完成工事高') ?? grabNum('売上高'),
    equity_k: grabNum('自己資本'),
    p_score: grabNum('総合評定値') ?? grabNum('総合評点') ?? grabNum('P点'),
  };
  return (rec.revenue_k != null || rec.equity_k != null || rec.p_score != null) ? rec : null;
}

async function tryFetchPdfRecord(company, pdfParse) {
  // 1) 許可番号で照会ページ取得 → 2) PDFリンク抽出 → 3) PDF取得・解析（pdf-parseがあれば）
  const html = await fetchText(`${SEARCH_URL}?kyokaNo=${encodeURIComponent(company.license_no)}`, { timeoutMs: 25000 });
  // PDFテキストが直接照会できない構成のため、まずHTMLテキストからの抽出を試す
  let rec = extractFromText(stripTags(html));
  if (rec) { rec.source = 'ciic-html'; return rec; }
  if (!pdfParse) return null;
  const pdfHref = (html.match(/href="([^"]+\.pdf[^"]*)"/i) || [])[1];
  if (!pdfHref) return null;
  const pdfUrl = new URL(pdfHref, SEARCH_URL).href;
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const data = await pdfParse(buf);
  rec = extractFromText(data.text.replace(/\s+/g, ' '));
  if (rec) { rec.source = 'ciic-pdf'; rec.pdf_url = pdfUrl; }
  return rec;
}

async function main() {
  const pdfParse = await loadPdfParser();
  const companies = loadCompanies(DATA_DIR).filter((c) => c.license_no);
  const keishin = readJSON(`${DATA_DIR}/keishin.json`, {});
  const date = today();
  let added = 0, linked = 0, failed = 0, n = 0;

  for (const c of companies) {
    if (n++ >= LIMIT) break;
    const confirmUrl = `${SEARCH_URL}`; // 検索フォーム。許可番号 ${c.license_no} で照会
    try {
      const rec = await tryFetchPdfRecord(c, pdfParse);
      const arr = keishin[c.license_no] || (keishin[c.license_no] = []);
      if (rec) {
        const dup = arr.some((r) => r.kijunbi && r.kijunbi === rec.kijunbi && r.source && r.source.startsWith('ciic'));
        if (!dup) { arr.push({ ...rec, fetched: date }); added++; console.log(`add ${c.name}: ${JSON.stringify(rec)}`); }
      } else {
        linked++;
      }
      // 確認リンク/最終確認をメタとして保持（配列とは別キー）
      keishin[`_meta:${c.license_no}`] = { name: c.name, confirm_url: confirmUrl, last_checked: date };
    } catch (e) {
      failed++;
      console.warn(`fail ${c.name}: ${e.message}`);
      keishin[`_meta:${c.license_no}`] = { name: c.name, confirm_url: confirmUrl, last_checked: date, error: e.message };
    }
    await sleep(WAIT_MS);
  }

  writeJSON(`${DATA_DIR}/keishin.json`, keishin);
  console.log(`\nkeishin: added=${added} link-only=${linked} failed=${failed}`);
  if (added === 0) console.error('NOTE: 自動抽出0件。経審はPDF/最新分のみで難度が高いため、ダッシュボードの「経審確認」から手動確認を推奨。');
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
