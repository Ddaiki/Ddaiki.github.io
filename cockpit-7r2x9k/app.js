'use strict';
/* 瓦・伝統建設業コクピット — データ読込・指標計算・描画 */

const DATA = 'data/';
const NEWS_SEARCH = (q) =>
  `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;
const CIIC_URL = 'http://www7.ciic.or.jp/';
const ETSURAN_URL = 'https://etsuran2.mlit.go.jp/TAKKEN/kensetuKensaku.do';

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// k は「千円」単位
function yen(k) {
  if (k == null || Number.isNaN(k)) return '—';
  const man = k / 10; // 千円 -> 万円
  if (Math.abs(man) >= 10000) return (man / 10000).toFixed(Math.abs(man / 10000) >= 10 ? 1 : 2) + '億円';
  return Math.round(man).toLocaleString('ja-JP') + '万円';
}
function percentile(value, arr) {
  if (value == null || !arr.length) return null;
  const below = arr.filter((v) => v <= value).length;
  return Math.round((below / arr.length) * 100);
}
function prefOf(address) {
  const m = String(address || '').match(/^(.+?[都道府県])/);
  return m ? m[1] : 'その他';
}
// 基準日ラベルを読みやすく
function dlabel(d) {
  if (!d) return '基準日不明';
  const s = String(d);
  if (/初期|不明/.test(s)) return '基準日不明';
  if (/seed/i.test(s)) return '初期値';
  const m = s.match(/(\d{4})[-/年]?\s*(\d{1,2})?/);
  if (m) return m[1] + (m[2] ? '/' + String(m[2]).padStart(2, '0') : '');
  return s;
}
async function getJSON(name, fallback) {
  try {
    const r = await fetch(DATA + name, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('load failed', name, e);
    return fallback;
  }
}

/* ---------- merge ---------- */
function financials(recs) {
  let rev = null, revPrev = null, revKijunbi = null, revPrevKijunbi = null;
  let eq = null, eqPrev = null, eqKijunbi = null, eqPrevKijunbi = null;
  let fa = null, p = null, latestKijunbi = null;
  for (const rec of recs || []) {
    if (rec.revenue_k != null) { revPrev = rev; revPrevKijunbi = revKijunbi; rev = rec.revenue_k; revKijunbi = rec.kijunbi || null; }
    if (rec.equity_k != null) { eqPrev = eq; eqPrevKijunbi = eqKijunbi; eq = rec.equity_k; eqKijunbi = rec.kijunbi || null; }
    if (rec.fixed_assets_k != null) fa = rec.fixed_assets_k;
    if (rec.p_score != null) p = rec.p_score;
    if (rec.kijunbi) latestKijunbi = rec.kijunbi;
  }
  return { rev, revPrev, revKijunbi, revPrevKijunbi, eq, eqPrev, eqKijunbi, eqPrevKijunbi, fa, p, latestKijunbi, records: recs || [] };
}
function employment(series) {
  const all = (series || []).filter((p) => typeof p.count === 'number');
  if (!all.length) return { latest: null, earliest: null, delta: null, n: 0 };
  // 基準日が分かるスナップショットが2つ以上あればそれを優先（増減の基準を明確化）
  const dated = all.filter((p) => p.date && !/初期|不明/.test(String(p.date)));
  const use = dated.length >= 2 ? dated : all;
  const first = use[0], last = use[use.length - 1];
  return { latest: last.count, latestDate: last.date, earliest: first.count, earliestDate: first.date, delta: last.count - first.count, n: use.length, series: all };
}
function buildModel(d) {
  return d.companies.companies.map((c) => {
    const f = financials(d.keishin[c.license_no]);
    const emp = employment(d.insured[c.houjin_bangou]);
    const permit = d.permits[c.license_no] || null;
    const kmeta = d.keishin[`_meta:${c.license_no}`] || null;
    const changed = permit && Array.isArray(permit.changes) && permit.changes.length > 0;
    const insolvent = f.eq != null && f.eq < 0;
    const bankrupt = /倒産|廃業|解散/.test(c.keishin_status || '');
    return { ...c, excludeCompare: !!c.exclude_compare, f, emp, permit, kmeta, changed, insolvent, bankrupt };
  });
}

/* ---------- greeting ---------- */
function renderGreeting() {
  const now = new Date();
  const h = now.getHours();
  let g = 'こんばんは';
  if (h < 5) g = '夜更かしですね';
  else if (h < 10) g = 'おはようございます';
  else if (h < 16) g = 'こんにちは';
  else if (h < 22) g = 'お疲れさまです';
  $('#greet').textContent = g;
  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  $('#today').textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}（${wd}）`;
}

/* ---------- spotlight ---------- */
function renderSpotlight(compareModel) {
  const pool = compareModel.filter((m) => m.f.rev != null || m.emp.latest != null);
  if (!pool.length) { $('#spotlight-body').textContent = 'データがありません'; return; }
  const doy = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const m = pool[doy % pool.length];
  const tags = [];
  if (m.is_self) tags.push('<span class="self-flag">自社</span>');
  if (m.emp.delta > 0) tags.push(`<span class="tag delta-up">雇用 +${m.emp.delta}</span>`);
  else if (m.emp.delta < 0) tags.push(`<span class="tag delta-down">雇用 ${m.emp.delta}</span>`);
  if (m.f.rev != null) tags.push(`<span class="tag">売上 ${yen(m.f.rev)}</span>`);
  if (m.insolvent) tags.push('<span class="badge warn">債務超過</span>');
  if (m.bankrupt) tags.push('<span class="badge warn">倒産記載</span>');
  $('#spotlight-body').innerHTML = `
    <div class="spot-name">${esc(m.name)}</div>
    <div class="spot-meta">${esc(prefOf(m.address))}・${esc(m.representative || '代表者不明')}・${esc(m.license_class || '')}</div>
    <div class="spot-tags">${tags.join('')}</div>
    <div class="co-actions">
      <a href="${NEWS_SEARCH(m.name)}" target="_blank" rel="noopener">ニュースを見る</a>
      ${m.website ? `<a class="muted" href="${esc(m.website)}" target="_blank" rel="noopener">Web</a>` : ''}
    </div>`;
}

/* ---------- self summary ---------- */
function renderSelf(compareModel, fullModel) {
  const me = fullModel.find((m) => m.is_self);
  if (!me) { $('#self').style.display = 'none'; return; }
  $('#self-name').textContent = `（${me.name}）`;
  const revs = compareModel.map((m) => m.f.rev).filter((v) => v != null);
  const eqs = compareModel.map((m) => m.f.eq).filter((v) => v != null);
  const revPct = percentile(me.f.rev, revs);

  const eqArrow = me.f.eqPrev != null && me.f.eq != null
    ? (me.f.eq > me.f.eqPrev ? '<span class="delta-up">▲改善</span>' : me.f.eq < me.f.eqPrev ? '<span class="delta-down">▼減</span>' : '<span class="delta-flat">→</span>')
    : '';
  const empArrow = me.emp.delta > 0 ? `<span class="delta-up">+${me.emp.delta}</span>`
    : me.emp.delta < 0 ? `<span class="delta-down">${me.emp.delta}</span>`
    : me.emp.delta === 0 ? '<span class="delta-flat">±0</span>' : '';

  const revBase = me.f.revKijunbi ? `基準 ${dlabel(me.f.revKijunbi)}` : '';
  const eqBase = me.f.eqPrev != null ? `${dlabel(me.f.eqPrevKijunbi)}→${dlabel(me.f.eqKijunbi)}` : (me.f.eqKijunbi ? `基準 ${dlabel(me.f.eqKijunbi)}` : '');
  const empBase = me.emp.n ? `${dlabel(me.emp.earliestDate)}→${dlabel(me.emp.latestDate)}` : '';

  const kpis = [
    ['売上高', yen(me.f.rev), [revPct != null ? `業界 上位${100 - revPct}%圏` : '', revBase].filter(Boolean).join(' / ')],
    ['自己資本', yen(me.f.eq), [eqArrow, eqBase].filter(Boolean).join(' ')],
    ['被保険者数', me.emp.latest != null ? me.emp.latest + '<span class="kpi-unit">人</span>' : '—', [empArrow, empBase].filter(Boolean).join(' ')],
    ['資本金', yen(me.capital_k), ''],
  ];
  $('#self-kpis').innerHTML = kpis.map(([l, v, s]) =>
    `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`
  ).join('');

  const empTxt = me.emp.delta > 0 ? '雇用は<b>増加傾向</b>' : me.emp.delta < 0 ? '雇用は<b>減少</b>' : me.emp.n ? '雇用は<b>横ばい</b>' : '雇用データは未取得';
  const eqTxt = me.insolvent ? '<b>債務超過に注意</b>' : (me.f.eqPrev != null && me.f.eq != null)
    ? (me.f.eq > me.f.eqPrev ? '自己資本は<b>改善</b>' : me.f.eq < me.f.eqPrev ? '自己資本は<b>微減</b>' : '自己資本は安定')
    : '自己資本は安定';
  const posTxt = revPct == null ? '売上規模は不明'
    : revPct >= 67 ? '売上は業界<b>上位</b>' : revPct >= 34 ? '売上は業界<b>中位</b>' : '売上は業界<b>下位</b>';
  let advice;
  if (me.insolvent) advice = '財務基盤の立て直しが最優先。';
  else if (me.emp.delta < 0) advice = '人手の確保・定着が今後の鍵。';
  else if (revPct != null && revPct < 34) advice = '受注単価と高付加価値（社寺・文化財）への寄せ方が伸びしろ。';
  else advice = '堅調。強みの継承と次世代の採用で優位を固められる。';
  $('#self-fortune').innerHTML =
    `<div class="card-eyebrow">今後を占う</div>${esc(me.name)}は、${empTxt}・${eqTxt}・${posTxt}。${advice}` +
    `<div class="fortune-base">※比較は HIRAYAMA など「比較対象外」を除いた業界内での位置づけ</div>`;
}

/* ---------- rankings ---------- */
let RANK_MODEL = [];
function renderRank(mode) {
  const list = $('#rank-list');
  let arr, valFn, baseFn, clay = false;
  if (mode === 'revenue') { arr = RANK_MODEL.filter((m) => m.f.rev != null).sort((a, b) => b.f.rev - a.f.rev).slice(0, 8); valFn = (m) => [m.f.rev, yen(m.f.rev)]; baseFn = (m) => m.f.revKijunbi; }
  else if (mode === 'revenue_low') { arr = RANK_MODEL.filter((m) => m.f.rev != null).sort((a, b) => a.f.rev - b.f.rev).slice(0, 8); valFn = (m) => [m.f.rev, yen(m.f.rev)]; baseFn = (m) => m.f.revKijunbi; }
  else { arr = RANK_MODEL.filter((m) => m.f.eq != null).sort((a, b) => b.f.eq - a.f.eq).slice(0, 8); valFn = (m) => [m.f.eq, yen(m.f.eq)]; baseFn = (m) => m.f.eqKijunbi; clay = true; }
  const max = Math.max(...arr.map((m) => Math.abs(valFn(m)[0])), 1);
  list.innerHTML = arr.map((m) => {
    const [v, label] = valFn(m);
    const w = Math.max(3, (Math.abs(v) / max) * 100);
    const base = baseFn(m) ? `<span class="base-note">基準 ${dlabel(baseFn(m))}</span>` : '';
    return `<div class="bar-row"><div class="bar-head"><span class="bar-name">${m.is_self ? '★ ' : ''}${esc(m.name)}</span><span class="bar-val">${label} ${base}</span></div>
      <div class="bar-track"><div class="bar-fill ${clay ? 'clay' : ''}" style="width:${w}%"></div></div></div>`;
  }).join('') || '<div class="loading">データなし</div>';
}
function renderInsolvency(model) {
  const ins = model.filter((m) => m.insolvent).sort((a, b) => a.f.eq - b.f.eq);
  const bk = model.filter((m) => m.bankrupt);
  let html = '';
  if (ins.length) html += `<h3>債務超過（自己資本マイナス）${ins.length}社</h3>` +
    ins.map((m) => `<span class="chip">${esc(m.name)} ${yen(m.f.eq)}<small>（${dlabel(m.f.eqKijunbi)}）</small></span>`).join('');
  if (bk.length) html += `<h3 style="margin-top:10px">倒産・廃業の記載 ${bk.length}社</h3>` +
    bk.map((m) => `<span class="chip">${esc(m.name)}</span>`).join('');
  $('#insolvency').innerHTML = html;
}

/* ---------- employment chart ---------- */
function renderEmployChart(compareModel) {
  const withDelta = compareModel.filter((m) => m.emp.delta != null && m.emp.n >= 2 && m.emp.delta !== 0);
  withDelta.sort((a, b) => b.emp.delta - a.emp.delta);
  const ups = withDelta.filter((m) => m.emp.delta > 0).slice(0, 7);
  const downs = withDelta.filter((m) => m.emp.delta < 0).slice(-7);
  const picked = [...ups, ...downs];
  if (!picked.length) { $('#employChart').replaceWith(el('div', 'loading', '増減データがまだありません')); return; }
  const labels = picked.map((m) => (m.is_self ? '★' : '') + m.name);
  const data = picked.map((m) => m.emp.delta);
  const colors = data.map((v) => (v >= 0 ? '#34d399' : '#f87171'));
  const canvas = $('#employChart');
  canvas.parentElement.style.height = picked.length * 28 + 64 + 'px';
  new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 4, barThickness: 'flex' }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${c.raw > 0 ? '+' : ''}${c.raw} 人`,
            afterLabel: (c) => { const m = picked[c.dataIndex]; return `基準: ${dlabel(m.emp.earliestDate)}（${m.emp.earliest}）→ ${dlabel(m.emp.latestDate)}（${m.emp.latest}）`; },
          },
        },
      },
      scales: {
        x: { grid: { color: '#263a49' }, ticks: { color: '#9fb1bf' }, title: { display: true, text: '被保険者数の増減（人）', color: '#9fb1bf' } },
        y: { grid: { display: false }, ticks: { color: '#e8eef2', font: { size: 11 } } },
      },
    },
  });
}

/* ---------- distributions ---------- */
function renderDist(model) {
  const tally = (keyFn) => {
    const m = {};
    model.forEach((c) => { const k = keyFn(c); if (!k) return; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const draw = (sel, entries) => {
    const max = Math.max(...entries.map((e) => e[1]), 1);
    $(sel).innerHTML = entries.map(([k, n]) =>
      `<div class="bar-row"><div class="bar-head"><span class="bar-name">${esc(k)}</span><span class="bar-val">${n}社</span></div>
      <div class="bar-track"><div class="bar-fill clay" style="width:${(n / max) * 100}%"></div></div></div>`).join('');
  };
  draw('#dist-region', tally((c) => prefOf(c.address)).slice(0, 8));
  draw('#dist-type', tally((c) => c.type || '不明'));
  draw('#dist-license', tally((c) => (/大臣/.test(c.license_class) ? '大臣許可' : /知事/.test(c.license_class) ? '知事許可' : '不明')));
}

/* ---------- company list ---------- */
let LIST_MODEL = [];
function permitLine(m) {
  const parts = [];
  if (m.permit && m.permit.snapshot && m.permit.snapshot.trades && m.permit.snapshot.trades.length)
    parts.push(`許可業種: ${esc(m.permit.snapshot.trades.join('・'))}`);
  if (m.permit && m.permit.snapshot && m.permit.snapshot.valid_until)
    parts.push(`有効期間: ${esc(m.permit.snapshot.valid_until)}`);
  if (m.f.p != null) parts.push(`経審P点: ${m.f.p}`);
  // 「自動取得」表示は、許可情報が実際に取得できた社のみ（年金/許可の最新化が成功したとき）
  if (m.permit && m.permit.last_checked && m.permit.snapshot && m.permit.snapshot.trades && m.permit.snapshot.trades.length)
    parts.push(`<span class="base-note">許可情報 自動取得 ${esc(m.permit.last_checked)}</span>`);
  return parts.length ? `<div class="co-detail">${parts.join(' ／ ')}</div>` : '';
}
function renderList() {
  const q = $('#search').value.trim();
  const key = $('#sortkey').value;
  let arr = LIST_MODEL.slice();
  if (q) {
    const qq = q.toLowerCase();
    arr = arr.filter((m) =>
      [m.name, m.furigana, m.representative, m.address, m.license_class].some((s) => String(s || '').toLowerCase().includes(qq)));
  }
  const nn = (v) => (v == null ? -Infinity : v);
  const sorters = {
    revenue: (a, b) => nn(b.f.rev) - nn(a.f.rev),
    equity: (a, b) => nn(b.f.eq) - nn(a.f.eq),
    insured: (a, b) => nn(b.emp.latest) - nn(a.emp.latest),
    employ_delta: (a, b) => nn(b.emp.delta) - nn(a.emp.delta),
    name: (a, b) => String(a.furigana || a.name).localeCompare(String(b.furigana || b.name), 'ja'),
  };
  arr.sort(sorters[key]);
  $('#company-count').textContent = `${arr.length} / ${LIST_MODEL.length}社`;

  $('#company-list').innerHTML = arr.map((m) => {
    const badges = [];
    if (m.is_self) badges.push('<span class="self-flag">自社</span>');
    if (m.excludeCompare) badges.push('<span class="badge">比較対象外</span>');
    if (m.insolvent) badges.push('<span class="badge warn">債務超過</span>');
    if (m.bankrupt) badges.push('<span class="badge warn">倒産記載</span>');
    if (m.changed) badges.push('<span class="badge">許可変更</span>');
    const dCls = m.emp.delta > 0 ? 'delta-up' : m.emp.delta < 0 ? 'delta-down' : 'delta-flat';
    const dStr = m.emp.delta == null ? '' : ` <span class="${dCls}">(${m.emp.delta > 0 ? '+' : ''}${m.emp.delta})</span>`;
    const empDate = m.emp.latestDate ? `<span class="base-note">${dlabel(m.emp.latestDate)}</span>` : '';
    const empSpan = m.emp.n >= 2 ? `<span class="base-note">[${dlabel(m.emp.earliestDate)}→${dlabel(m.emp.latestDate)}]</span>` : '';
    const revBase = m.f.revKijunbi ? `<span class="base-note">基準 ${dlabel(m.f.revKijunbi)}</span>` : '';
    return `<div class="co">
      <div class="co-head"><div><span class="co-name">${esc(m.name)}</span> ${badges.join(' ')}</div>
        <span class="co-loc">${esc(prefOf(m.address))}</span></div>
      <div class="co-metrics">
        <span>売上 <b>${yen(m.f.rev)}</b> ${revBase}</span>
        <span>自己資本 <b>${yen(m.f.eq)}</b></span>
        <span>被保険者 <b>${m.emp.latest ?? '—'}</b> ${empDate}${dStr} ${empSpan}</span>
      </div>
      ${permitLine(m)}
      <div class="co-actions">
        <a href="${NEWS_SEARCH(m.name)}" target="_blank" rel="noopener">ニュース検索</a>
        <a class="muted" href="${ETSURAN_URL}" target="_blank" rel="noopener">許可を公式確認</a>
        <a class="muted" href="${(m.kmeta && m.kmeta.confirm_url) || CIIC_URL}" target="_blank" rel="noopener">経審を公式確認</a>
        ${m.website ? `<a class="muted" href="${esc(m.website)}" target="_blank" rel="noopener">Web</a>` : ''}
        ${m.instagram ? `<a class="muted" href="${esc(m.instagram)}" target="_blank" rel="noopener">IG</a>` : ''}
      </div>
    </div>`;
  }).join('') || '<div class="loading">該当なし</div>';
}

/* ---------- news ---------- */
function renderNews(news) {
  const items = (news && news.items) || [];
  $('#news-updated').textContent = news && news.updated ? `更新 ${new Date(news.updated).toLocaleDateString('ja-JP')}` : '';
  if (!items.length) {
    $('#news-list').innerHTML = '<div class="news-empty">ニュースは毎日自動取得されます（初回更新までお待ちください）。各企業の「ニュース検索」からも確認できます。</div>';
    return;
  }
  $('#news-list').innerHTML = items.slice(0, 40).map((it) =>
    `<a class="news-item" href="${esc(it.link)}" target="_blank" rel="noopener">
      <div class="news-title">${esc(it.title)}</div>
      <div class="news-meta">${esc(it.source || '')}${it.pubDate ? ' ・ ' + new Date(it.pubDate).toLocaleDateString('ja-JP') : ''}${it.query ? ' ・ ' + esc(it.query) : ''}</div>
    </a>`).join('');
}

/* ---------- boot ---------- */
async function main() {
  renderGreeting();
  const [companies, insured, keishin, permits, news] = await Promise.all([
    getJSON('companies.json', { companies: [] }),
    getJSON('insured.json', {}),
    getJSON('keishin.json', {}),
    getJSON('permits.json', {}),
    getJSON('news.json', { items: [] }),
  ]);
  const model = buildModel({ companies, insured, keishin, permits });
  const compare = model.filter((m) => !m.excludeCompare); // HIRAYAMA等の「比較対象外」を除外
  RANK_MODEL = compare;
  LIST_MODEL = model;

  renderSpotlight(compare);
  renderSelf(compare, model);
  renderRank('revenue');
  renderInsolvency(model);
  renderEmployChart(compare);
  renderDist(model);
  renderList();
  renderNews(news);

  const excluded = model.filter((m) => m.excludeCompare).map((m) => m.name);
  $('#data-stamp').textContent =
    `マスター更新: ${companies.updated ? new Date(companies.updated).toLocaleString('ja-JP') : '—'}` +
    (excluded.length ? ` ／ 比較対象外: ${excluded.join('、')}` : '');

  document.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('is-active'));
      t.classList.add('is-active');
      renderRank(t.dataset.rank);
    }));
  $('#search').addEventListener('input', renderList);
  $('#sortkey').addEventListener('change', renderList);

  setupAddForm();
}
main();

/* ---------- 企業追加フォーム（GitHubに自動保存） ---------- */
const GH_OWNER = 'Ddaiki';
const GH_REPO = 'Ddaiki.github.io';
const CSV_PATH = 'cockpit-7r2x9k/data/companies.csv';
const TOKEN_KEY = 'cockpit_gh_pat';

const b64encodeUtf8 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64decodeUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
// CSVの1行をフィールド配列に（ヘッダ解析用・簡易RFC4180）
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  }
  out.push(cur);
  return out;
}

function setupAddForm() {
  const modal = $('#modal');
  const open = () => { modal.hidden = false; refreshTokenState(); };
  const close = () => { modal.hidden = true; };
  $('#fab').addEventListener('click', open);
  $('#modal-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const refreshTokenState = () => {
    const t = localStorage.getItem(TOKEN_KEY);
    $('#token-state').textContent = t ? 'トークン保存済み（この端末）' : 'トークン未設定';
    if (!t) $('#settings').open = true;
  };
  $('#f-savetoken').addEventListener('click', () => {
    const t = $('#f-token').value.trim();
    if (t) { localStorage.setItem(TOKEN_KEY, t); $('#f-token').value = ''; }
    refreshTokenState();
  });
  $('#f-cleartoken').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); refreshTokenState(); });

  $('#f-submit').addEventListener('click', submitAdd);
}

async function submitAdd() {
  const msg = $('#form-msg');
  const setMsg = (t, cls) => { msg.textContent = t; msg.className = 'form-msg ' + (cls || ''); };
  const name = $('#f-name').value.trim();
  if (!name) { setMsg('会社名は必須です', 'err'); return; }
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { setMsg('先に「保存先の設定」でトークンを保存してください', 'err'); $('#settings').open = true; return; }
  const branch = ($('#f-branch').value.trim() || 'main');

  // ヘッダ列名 -> 入力値
  const values = {
    '会社名': name,
    'フリガナ': '',
    '法人番号': $('#f-houjin').value.trim(),
    '許可番号': $('#f-license').value.trim(),
    '大臣知事区分': $('#f-class').value.trim(),
    '法人個人': $('#f-type').value,
    '郵便番号': '',
    '所在地': $('#f-address').value.trim(),
    '代表者名': $('#f-rep').value.trim(),
    '代表者フリガナ': '',
    '資本金千円': $('#f-capital').value.trim(),
    'Web': $('#f-web').value.trim(),
    'Instagram': $('#f-ig').value.trim(),
    '経審ステータス': '',
    '文化財入札': '',
    '自社': $('#f-self').checked ? '○' : '',
    '比較対象外': $('#f-exclude').checked ? '○' : '',
  };

  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${CSV_PATH}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  setMsg('保存中…');
  try {
    const getRes = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (!getRes.ok) throw new Error(`CSV取得失敗 (${getRes.status})。トークン権限/ブランチを確認してください`);
    const file = await getRes.json();
    const content = b64decodeUtf8(file.content);
    const lines = content.replace(/\n+$/,'').split('\n');
    const header = parseCsvLine(lines[0]);
    const row = header.map((h) => csvCell(values[h] ?? '')).join(',');
    const newContent = content.replace(/\n*$/, '\n') + row + '\n';

    const putRes = await fetch(api, {
      method: 'PUT', headers,
      body: JSON.stringify({ message: `data: add ${name}`, content: b64encodeUtf8(newContent), sha: file.sha, branch }),
    });
    if (!putRes.ok) { const e = await putRes.json().catch(() => ({})); throw new Error(`保存失敗 (${putRes.status}) ${e.message || ''}`); }

    setMsg('✓ 保存しました。1〜2分後に自動反映されます（被保険者数等は次回の自動取得で付与）。', 'ok');
    // 即時フィードバック: 一覧に仮表示
    const provisional = buildModel({ companies: { companies: [{
      id: values['許可番号'] || values['法人番号'] || `new-${Date.now()}`,
      name, furigana: '', houjin_bangou: values['法人番号'], license_no: values['許可番号'],
      license_class: values['大臣知事区分'], type: values['法人個人'], postal: '', address: values['所在地'],
      representative: values['代表者名'], rep_furigana: '', capital_k: Number(values['資本金千円'].replace(/[,\s]/g,''))||null,
      website: values['Web'], instagram: values['Instagram'], keishin_status: '', bunkazai: '',
      is_self: !!values['自社'], exclude_compare: !!values['比較対象外'],
    }] }, insured: {}, keishin: {}, permits: {} })[0];
    LIST_MODEL = [provisional, ...LIST_MODEL];
    renderList();
    ['#f-name','#f-houjin','#f-license','#f-class','#f-address','#f-rep','#f-capital','#f-web','#f-ig'].forEach((s)=>{$(s).value='';});
    $('#f-self').checked = false; $('#f-exclude').checked = false;
  } catch (e) {
    setMsg('⚠ ' + e.message, 'err');
  }
}
