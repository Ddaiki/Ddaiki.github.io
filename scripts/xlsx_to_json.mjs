// companies.xlsx（人が編集するマスター） → companies.json（アプリ・スクレイパーが読む機械可読形式）
// GitHub Actions の data.yml から実行される。ローカルでも `npm run build` で実行可。
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const XLSX_PATH = path.join(DATA_DIR, 'companies.xlsx');
const OUT_PATH = path.join(DATA_DIR, 'companies.json');

function s(v) { return v == null ? '' : String(v).trim(); }
function n(v) {
  if (v == null || v === '') return null;
  const x = Number(String(v).replace(/[,，\s]/g, ''));
  return Number.isFinite(x) ? x : null;
}
// 法人番号や許可番号が数値化で先頭ゼロを失わないよう、文字列で保持
function code(v) { return s(v).replace(/\s/g, ''); }

const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const companies = rows.map((r, i) => {
  const houjin = code(r['法人番号']);
  const license = code(r['許可番号']);
  const name = s(r['会社名']);
  return {
    id: license || houjin || `idx-${i}`,
    name,
    furigana: s(r['フリガナ']),
    houjin_bangou: houjin,
    license_no: license,
    license_class: s(r['大臣知事区分']),
    type: s(r['法人個人']),
    postal: s(r['郵便番号']),
    address: s(r['所在地']),
    representative: s(r['代表者名']),
    rep_furigana: s(r['代表者フリガナ']),
    capital_k: n(r['資本金千円']),
    website: s(r['Web']),
    instagram: s(r['Instagram']),
    keishin_status: s(r['経審ステータス']),
    bunkazai: s(r['文化財入札']),
    is_self: /[○◯oO]/.test(s(r['自社'])),
    exclude_compare: /[○◯oO]/.test(s(r['比較対象外'])),
  };
}).filter((c) => c.name);

fs.writeFileSync(OUT_PATH, JSON.stringify({ updated: new Date().toISOString(), companies }, null, 1));
console.log(`companies.json written: ${companies.length} companies`);
