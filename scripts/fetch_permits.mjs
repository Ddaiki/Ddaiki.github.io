// 国交省「建設業者・宅建業者等企業情報検索システム」から建設業許可情報を取得し permits.json を更新。
// 許可番号で1件ずつ照会し、前回スナップショットと差分（許可更新・業種追加・代表者変更等）を検知。
// 月次 cron 想定。
//
// ※重要: 政府系サイトは開発サンドボックスから到達不可。エンドポイント/抽出は GitHub Actions の
//   workflow_dispatch で初回検証して確定すること。失敗社はスキップし既存データを壊さない。
//   設定上書き: MLIT_SEARCH_URL / LIMIT
import path from 'node:path';
import { fetchText, stripTags, sleep, readJSON, writeJSON, loadCompanies, today } from './lib/scrape.mjs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const SEARCH_URL = process.env.MLIT_SEARCH_URL || 'https://etsuran2.mlit.go.jp/TAKKEN/kensetuKensaku.do';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const WAIT_MS = Number(process.env.WAIT_MS || 1500);
const PROBE = !!process.env.PROBE;

// 許可番号 "26-002465" -> {gyosei:"26", num:"002465"}
function splitLicense(no) {
  const m = String(no).match(/(\d{2})\s*[-－]\s*(\d{6})/);
  return m ? { gyosei: m[1], num: m[2] } : null;
}

// 照会結果HTMLから主要項目を抽出（ラベル近傍を拾う、耐性重視）。
function extractPermit(html) {
  const text = stripTags(html);
  const grab = (label) => {
    const m = text.match(new RegExp(label + '[：:\\s]{0,3}([^\\s／/｜|]{1,40})'));
    return m ? m[1].trim() : '';
  };
  const snap = {
    representative: grab('代表者') || grab('代表者氏名'),
    valid_until: grab('許可の有効期間') || grab('有効期間'),
    last_update: grab('許可年月日') || grab('更新'),
  };
  // 許可業種（土木一式・建築一式…屋根…の出現）
  const trades = ['土木一式','建築一式','大工','左官','とび','石','屋根','電気','管','タイル','鋼構造物','鉄筋','舗装','板金','ガラス','塗装','防水','内装仕上','造園','建具','解体']
    .filter((t) => text.includes(t));
  snap.trades = trades;
  const hasAny = snap.representative || snap.valid_until || trades.length;
  return hasAny ? snap : null;
}

function diff(prev, cur) {
  const changes = [];
  if (!prev) return changes;
  for (const k of ['representative', 'valid_until', 'last_update']) {
    if (prev[k] && cur[k] && prev[k] !== cur[k]) changes.push({ field: k, old: prev[k], new: cur[k] });
  }
  const pa = new Set(prev.trades || []), ca = new Set(cur.trades || []);
  const added = [...ca].filter((t) => !pa.has(t));
  const removed = [...pa].filter((t) => !ca.has(t));
  if (added.length) changes.push({ field: 'trades_added', new: added.join('・') });
  if (removed.length) changes.push({ field: 'trades_removed', old: removed.join('・') });
  return changes;
}

async function probe(companies) {
  const c = companies[0];
  const { gyosei, num } = splitLicense(c.license_no);
  console.log(`PROBE 国交省 ${c.name} (許可番号 ${c.license_no} -> gyosei=${gyosei} num=${num})`);
  console.log(`SEARCH_URL = ${SEARCH_URL}`);
  const base = SEARCH_URL.replace(/kensetuKensaku\.do.*$/, '');
  for (const attempt of [
    { label: 'GET top', url: base, opts: {} },
    { label: 'GET kensetuKensaku', url: SEARCH_URL, opts: {} },
    { label: 'GET ?gyoseiCd&kyokaNo', url: `${SEARCH_URL}?gyoseiCd=${gyosei}&kyokaNo=${num}`, opts: {} },
  ]) {
    try {
      const html = await fetchText(attempt.url, { ...attempt.opts, retries: 0, timeoutMs: 15000 });
      console.log(`\n===== ${attempt.label} : OK len=${html.length} =====`);
      console.log('許可番号 含む?', /許可番号/.test(html), '| form数', (html.match(/<form/gi) || []).length);
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
  const companies = loadCompanies(DATA_DIR).filter((c) => splitLicense(c.license_no));
  if (PROBE) { await probe(companies); return; }
  const permits = readJSON(`${DATA_DIR}/permits.json`, {});
  const date = today();
  let changedCount = 0, ok = 0, failed = 0, n = 0;

  for (const c of companies) {
    if (n++ >= LIMIT) break;
    const { gyosei, num } = splitLicense(c.license_no);
    try {
      const url = `${SEARCH_URL}?gyoseiCd=${gyosei}&kyokaNo=${encodeURIComponent(num)}`;
      const html = await fetchText(url, { timeoutMs: 25000 });
      const snap = extractPermit(html);
      if (!snap) { failed++; console.warn(`parse-miss ${c.name}`); }
      else {
        const rec = permits[c.license_no] || (permits[c.license_no] = { snapshot: {}, changes: [] });
        const changes = diff(rec.snapshot && Object.keys(rec.snapshot).length ? rec.snapshot : null, snap);
        if (changes.length) {
          rec.changes.unshift({ date, changes });
          rec.changes = rec.changes.slice(0, 20);
          changedCount++;
          console.log(`CHANGE ${c.name}: ${JSON.stringify(changes)}`);
        }
        rec.snapshot = { name: c.name, ...rec.snapshot, ...snap };
        rec.last_checked = date;
        ok++;
      }
    } catch (e) {
      failed++;
      console.warn(`fail ${c.name}: ${e.message}`);
    }
    await sleep(WAIT_MS);
  }

  writeJSON(`${DATA_DIR}/permits.json`, permits);
  console.log(`\npermits: ok=${ok} changed=${changedCount} failed=${failed}`);
  if (ok === 0 && failed > 0) console.error('WARN: 取得0件。MLIT_SEARCH_URL/抽出ロジックを要確認。');
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
