// CIIC「経営事項審査 結果公表システム」(http://www7.ciic.or.jp/)
//
// 実機（GitHub Actions）からは接続不可（fetch failed）であることが判明。加えて結果はPDF・最新分のみ・
// 年1更新で自動抽出の難度が高い。そのため本スクリプトは既定では**ネットワークアクセスを行わず**、
// 既存の keishin.json（経審の財務seed）を保持するだけにする。経審の最新確認はダッシュボードの
// 「経審を公式確認」リンク（CIIC）から手動で行う運用。
//
// PROBE=1 のときだけ接続テストを行い、到達可否をログに出す（将来到達可能になった場合の確認用）。
import path from 'node:path';
import { fetchText, loadCompanies } from './lib/scrape.mjs';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const SEARCH_URL = process.env.CIIC_SEARCH_URL || 'http://www7.ciic.or.jp/';
const PROBE = !!process.env.PROBE;

async function main() {
  if (PROBE) {
    const c = loadCompanies(DATA_DIR).find((x) => x.license_no);
    console.log(`PROBE CIIC ${SEARCH_URL} (許可番号 ${c && c.license_no})`);
    try {
      const html = await fetchText(SEARCH_URL, { retries: 0, timeoutMs: 15000 });
      console.log(`OK len=${html.length} | 経営事項審査 含む? ${/経営事項審査|経審/.test(html)}`);
      console.log(html.slice(0, 1200));
    } catch (e) {
      console.log(`接続不可: ${e.message}（Actionsランナーからは到達できません。手動確認リンク運用を継続）`);
    }
    return;
  }
  console.log('経審(CIIC)はActionsから接続不可のため自動取得をスキップ。keishin.json(seed)を保持し、');
  console.log('ダッシュボードの「経審を公式確認」リンクから手動確認する運用です。');
}

main().catch((e) => { console.error('fatal', e); process.exit(1); });
