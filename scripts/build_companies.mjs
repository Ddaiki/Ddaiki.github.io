// companies.csv（人が編集／アプリのフォームが追記するマスター） → companies.json
// CSV は Excel でもそのまま開けます。GitHub Actions の data ワークフローから実行。
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const DATA_DIR = path.resolve(import.meta.dirname, '..', 'cockpit-7r2x9k', 'data');
const CSV_PATH = path.join(DATA_DIR, 'companies.csv');
const OUT_PATH = path.join(DATA_DIR, 'companies.json');

function s(v) { return v == null ? '' : String(v).trim(); }
function n(v) {
  if (v == null || v === '') return null;
  const x = Number(String(v).replace(/[,，\s]/g, ''));
  return Number.isFinite(x) ? x : null;
}
function code(v) { return s(v).replace(/\s/g, ''); }
const flag = (v) => /[○◯oO✓]/.test(s(v));

const wb = XLSX.read(fs.readFileSync(CSV_PATH, 'utf8'), { type: 'string', raw: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

const companies = rows.map((r, i) => {
  const houjin = code(r['法人番号']);
  const license = code(r['許可番号']);
  return {
    id: license || houjin || `idx-${i}`,
    name: s(r['会社名']),
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
    is_self: flag(r['自社']),
    exclude_compare: flag(r['比較対象外']),
  };
}).filter((c) => c.name);

fs.writeFileSync(OUT_PATH, JSON.stringify({ updated: new Date().toISOString(), companies }, null, 1));
console.log(`companies.json written: ${companies.length} companies`);
