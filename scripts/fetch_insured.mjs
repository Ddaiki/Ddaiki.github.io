// 年金機構「厚生年金保険・健康保険 適用事業所検索」から被保険者数を取得し insured.json を更新。
// 対象は companies.json の各社（法人番号で1件ずつ照会）。月次 cron で実行する想定。
//
// ※重要: 政府系サイトは開発サンドボックスから到達不可（egress 403）。本スクリプトの
//   エンドポイント/抽出ロジックは GitHub Actions の workflow_dispatch で初回実行し、
//   ログを見て確定すること。失敗した社はスキップし、既存データ（seed/履歴）は壊さない。
//
// 設定はここで上書き可能（初回検証で実URL/パラメータを微修正する）:
//   NENKIN_SEARCH_URL : 検索エンドポイント
//   LIMIT             : 先頭N社だけ処理（動作確認用）
import path from 'node:path';
import { fetchText, stripTags, toInt, sleep, readJSON, writeJSON, loadCompanies, today } from './lib/scrape.mjs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const SEARCH_URL = process.env.NENKIN_SEARCH_URL || 'https://www.nenkin.go.jp/do/search_section/';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const WAIT_MS = Number(process.env.WAIT_MS || 1500); // 礼儀正しく待機（控えめ）
const PROBE = !!process.env.PROBE; // 1社だけ取得し、返ってきたHTML先頭をログ出力（構造解明用）

// 法人番号で照会した結果HTMLから被保険者数を抽出（複数パターンに耐性）。
function extractInsured(html) {
  const text = stripTags(html);
  // 例: 「被保険者数 13人」「厚生年金保険被保険者数：13」など
  const patterns = [
    /(?:厚生年金保険)?被保険者数[^0-9０-９]{0,6}([0-9０-９,，]+)/,
    /被保険者数\D{0,4}([0-9０-９,，]+)\s*人/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) { const n = toInt(m[1]); if (n != null) return n; }
  }
  return null;
}

async function queryByCorpNumber(houjin) {
  // GET 検索（法人番号パラメータ）。実パラメータ名は初回検証で確定する。
  const url = `${SEARCH_URL}?houjinBangou=${encodeURIComponent(houjin)}`;
  return await fetchText(url, { timeoutMs: 25000 });
}

async function probe(companies) {
  const c = companies[0];
  console.log(`PROBE 年金機構 ${c.name} (法人番号 ${c.houjin_bangou})`);
  console.log(`SEARCH_URL = ${SEARCH_URL}`);
  for (const attempt of [
    { label: 'GET ?houjinBangou', url: `${SEARCH_URL}?houjinBangou=${c.houjin_bangou}`, opts: {} },
    { label: 'POST houjinBangou', url: SEARCH_URL, opts: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `houjinBangou=${c.houjin_bangou}` } },
  ]) {
    try {
      const html = await fetchText(attempt.url, { ...attempt.opts, retries: 0, timeoutMs: 15000 });
      console.log(`\n===== ${attempt.label} : OK len=${html.length} =====`);
      console.log('被保険者数 含む?', /被保険者数/.test(html), '| <form 数', (html.match(/<form/gi) || []).length);
      // formのaction/inputを抽出して実パラメータ名を把握
      (html.match(/<form[^>]*>/gi) || []).slice(0, 3).forEach((f) => console.log('FORM:', f));
      (html.match(/<input[^>]*>/gi) || []).slice(0, 25).forEach((i) => console.log('INPUT:', i.replace(/\s+/g, ' ')));
      console.log('--- HTML head 1500 ---\n', html.slice(0, 1500));
    } catch (e) {
      console.log(`\n===== ${attempt.label} : FAIL ${e.message} =====`);
    }
    await sleep(1500);
  }
}

async function main() {
  const companies = loadCompanies(DATA_DIR).filter((c) => c.houjin_bangou && /^\d{13}$/.test(c.houjin_bangou));
  if (PROBE) { await probe(companies); return; }
  const insured = readJSON(`${DATA_DIR}/insured.json`, {});
  const date = today();
  let updated = 0, unchanged = 0, failed = 0, n = 0;

  for (const c of companies) {
    if (n++ >= LIMIT) break;
    try {
      const html = await queryByCorpNumber(c.houjin_bangou);
      const count = extractInsured(html);
      if (count == null) { failed++; console.warn(`parse-miss ${c.name}`); }
      else {
        const series = insured[c.houjin_bangou] || (insured[c.houjin_bangou] = []);
        const last = series[series.length - 1];
        if (!last || last.count !== count) {
          series.push({ date, count });
          updated++;
          console.log(`update ${c.name}: ${last ? last.count : '—'} -> ${count}`);
        } else {
          unchanged++;
        }
      }
    } catch (e) {
      failed++;
      console.warn(`fail ${c.name}: ${e.message}`);
    }
    await sleep(WAIT_MS);
  }

  writeJSON(`${DATA_DIR}/insured.json`, insured);
  console.log(`\ninsured: updated=${updated} unchanged=${unchanged} failed=${failed} of ${Math.min(companies.length, LIMIT)}`);
  if (updated === 0 && failed > 0) {
    console.error('WARN: 取得0件。エンドポイント/抽出ロジックを要確認（NENKIN_SEARCH_URL）。');
  }
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
