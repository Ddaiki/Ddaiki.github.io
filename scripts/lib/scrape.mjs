// 共通スクレイピング補助。GitHub Actions のランナーから実行される前提。
// 方針: 礼儀正しいUA・リクエスト間ウェイト・リトライ・タイムアウト。失敗時は例外を投げ、
// 呼び出し側が「既存データを壊さずスキップ」できるようにする。
import fs from 'node:fs';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36 (+ddaiki-cockpit; personal industry monitor)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// レート制限つき fetch（テキスト取得）。リトライ＋指数バックオフ。
// 既定は「速く失敗」寄り（到達不可サイトで長時間ハングしないため）。
export async function fetchText(url, opts = {}) {
  const { method = 'GET', body = null, headers = {}, retries = 1, timeoutMs = 12000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'ja,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ');
}
export const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// 全角数字→半角、カンマ・空白除去して整数化
export function toInt(s) {
  if (s == null) return null;
  const half = String(s).replace(/[０-９]/g, (d) => '０１２３４５６７８９'.indexOf(d))
    .replace(/[,，、\s円人千]/g, '').replace(/[△▲−]/g, '-');
  const m = half.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export function readJSON(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return fallback; }
}
export function writeJSON(path, obj) {
  fs.writeFileSync(path, JSON.stringify(obj, null, 1));
}

export function loadCompanies(dataDir) {
  const j = readJSON(`${dataDir}/companies.json`, { companies: [] });
  return j.companies || [];
}

// 今日の日付 YYYY-MM-DD
export const today = () => new Date().toISOString().slice(0, 10);
