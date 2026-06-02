// Google News RSS から業界・関連会社ニュースを取得して data/news.json を生成。
// 業界キーワード＋主要企業名（売上上位など）で検索し、重複除去・新着順・上限で保存。
import path from 'node:path';
import { fetchText, decodeEntities, sleep, writeJSON, loadCompanies, today } from './lib/scrape.mjs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const MAX_ITEMS = 50;
const PER_QUERY = 6;

const INDUSTRY_KEYWORDS = [
  '瓦 職人', '社寺建築', '文化財 修復 建築', '屋根 葺き替え', '京都 瓦',
  '伝統建築 技術', '宮大工', '左官 伝統', '重要文化財 保存修理', '建設業 後継者',
];

const rss = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;

function parseRSS(xml, query) {
  const items = [];
  const blocks = xml.split('<item>').slice(1);
  for (const b of blocks) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      if (!m) return '';
      return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
    };
    const title = pick('title');
    const link = pick('link');
    if (!title || !link) continue;
    items.push({ title, link, pubDate: pick('pubDate'), source: pick('source'), query });
  }
  return items;
}

async function main() {
  const companies = loadCompanies(DATA_DIR);
  // 主要企業（被保険者数 or 名前のある法人）から最大12社をニュース対象に
  const companyNames = companies
    .filter((c) => c.type === '法人')
    .slice(0, 12)
    .map((c) => c.name);
  const queries = [...INDUSTRY_KEYWORDS, ...companyNames];

  const seen = new Set();
  const all = [];
  for (const q of queries) {
    try {
      const xml = await fetchText(rss(q), { timeoutMs: 20000 });
      const items = parseRSS(xml, q).slice(0, PER_QUERY);
      for (const it of items) {
        const key = it.title.slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(it);
      }
      console.log(`ok  ${q}  (+${items.length})`);
    } catch (e) {
      console.warn(`skip ${q}: ${e.message}`);
    }
    await sleep(1200);
  }

  all.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  const out = { updated: new Date().toISOString(), date: today(), items: all.slice(0, MAX_ITEMS) };
  writeJSON(`${DATA_DIR}/news.json`, out);
  console.log(`\nnews.json: ${out.items.length} items from ${queries.length} queries`);
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
