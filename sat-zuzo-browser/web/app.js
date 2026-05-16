// SAT図像ブラウザ叩き台のフロント。静的版（GitHub Pages 配信用）。
// data/items.json を読んでクライアント側で絞り込み/ページング。

const state = {
  q: "",
  category: "",
  limit: 60,
  offset: 0,
  all: [],
  filtered: [],
  facets: { 尊格: [] },
};

const $ = (sel) => document.querySelector(sel);
const els = {
  form: $("#search-form"),
  input: $("#search-input"),
  facetDeity: $("#facet-deity"),
  results: $("#results"),
  status: $("#status"),
  prev: $("#prev-page"),
  next: $("#next-page"),
  pageInfo: $("#page-info"),
  modal: $("#viewer-modal"),
  viewer: $("#viewer"),
  viewerClose: $("#viewer-close"),
  viewerTitle: $("#viewer-title"),
  viewerMeta: $("#viewer-meta"),
  menuToggle: $("#menu-toggle"),
  sidebar: $("#sidebar"),
};

let osdInstance = null;

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

function showStatus(message) {
  if (!message) {
    els.status.hidden = true;
    els.status.textContent = "";
    return;
  }
  els.status.hidden = false;
  els.status.textContent = message;
}

async function loadData() {
  showStatus("読み込み中…");
  try {
    const data = await fetchJSON("data/items.json");
    state.all = data.items || [];
    state.facets = data.facets || { 尊格: [] };
    renderFacets();
    applyFilters();
    showStatus(state.all.length ? null : "items.json が空です。");
  } catch (e) {
    showStatus(`データ読み込み失敗: ${e.message}`);
  }
}

function renderFacets() {
  const counts = countByCategory(state.all);
  els.facetDeity.innerHTML = "";
  els.facetDeity.appendChild(createFacetButton("すべて", "", state.all.length));
  for (const value of state.facets["尊格"] || []) {
    els.facetDeity.appendChild(createFacetButton(value, value, counts.get(value) || 0));
  }
  // 「尊格」リストに無いカテゴリ（曼荼羅など）も追加
  for (const [value, n] of counts) {
    if (!(state.facets["尊格"] || []).includes(value)) {
      els.facetDeity.appendChild(createFacetButton(value, value, n));
    }
  }
  updateFacetActive();
}

function countByCategory(items) {
  const m = new Map();
  for (const it of items) {
    if (!it.deity_category) continue;
    m.set(it.deity_category, (m.get(it.deity_category) || 0) + 1);
  }
  return m;
}

function createFacetButton(label, value, count) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.value = value;
  btn.textContent = label;
  if (count != null) {
    const span = document.createElement("span");
    span.className = "count";
    span.textContent = `(${count})`;
    btn.appendChild(span);
  }
  btn.addEventListener("click", () => {
    state.category = value;
    state.offset = 0;
    updateFacetActive();
    applyFilters();
    els.sidebar.classList.remove("open");
  });
  li.appendChild(btn);
  return li;
}

function updateFacetActive() {
  els.facetDeity.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === state.category);
  });
}

function applyFilters() {
  const q = state.q.toLowerCase();
  state.filtered = state.all.filter((it) => {
    if (state.category && it.deity_category !== state.category) return false;
    if (q) {
      const hay = `${it.title || ""} ${it.deity_category || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderResults();
  updatePager();
  if (state.filtered.length === 0) {
    showStatus("該当する画像がありません。");
  } else {
    showStatus(null);
  }
}

function renderResults() {
  const slice = state.filtered.slice(state.offset, state.offset + state.limit);
  els.results.innerHTML = "";
  for (const item of slice) {
    const li = document.createElement("li");
    li.className = "card";
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="thumb">${escapeHTML(item.deity_category || "—")}</div>
      <div class="body">
        <p class="title">${escapeHTML(item.title || "(無題)")}</p>
        <p class="meta-line">巻${item.volume} / 頁${item.page}</p>
      </div>
    `;
    li.addEventListener("click", () => openViewer(item));
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") openViewer(item);
    });
    els.results.appendChild(li);
  }
}

function updatePager() {
  const total = state.filtered.length;
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.max(1, Math.ceil(total / state.limit));
  els.pageInfo.textContent = `${page} / ${pages}（全${total}件）`;
  els.prev.disabled = state.offset <= 0;
  els.next.disabled = state.offset + state.limit >= total;
}

function openViewer(item) {
  els.modal.hidden = false;
  els.viewerTitle.textContent = item.title || "(無題)";
  els.viewerMeta.innerHTML = `
    <dt>巻 / 頁</dt><dd>${item.volume} / ${item.page}</dd>
    <dt>尊格</dt><dd>${escapeHTML(item.deity_category || "—")}</dd>
    <dt>IIIF Manifest</dt><dd><a href="${item.iiif_manifest_url}" target="_blank" rel="noopener">${item.iiif_manifest_url}</a></dd>
    <dt>注意</dt><dd>叩き台のサンプル URL は本家エンドポイント未調査のため、画像読込が失敗することがあります。</dd>
  `;
  initViewer(item.iiif_image_url);
}

function initViewer(tileSource) {
  if (osdInstance) {
    osdInstance.destroy();
    osdInstance = null;
  }
  els.viewer.innerHTML = "";
  if (typeof OpenSeadragon === "undefined") {
    els.viewer.textContent = "OpenSeadragon の読み込みに失敗しました。";
    return;
  }
  osdInstance = OpenSeadragon({
    element: els.viewer,
    prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
    tileSources: tileSource,
    showNavigationControl: true,
    crossOriginPolicy: "Anonymous",
  });
  osdInstance.addHandler("open-failed", (ev) => {
    els.viewer.innerHTML = `
      <div style="padding:20px;color:#faf6ef;font-size:13px;line-height:1.7;">
        画像 (info.json) の読み込みに失敗しました。<br>
        サンプル URL は本家エンドポイント未調査のため、現状では表示できません。<br>
        <code style="display:block;margin-top:8px;color:#c1272d;">${escapeHTML(tileSource)}</code>
      </div>`;
  });
}

function closeViewer() {
  els.modal.hidden = true;
  if (osdInstance) {
    osdInstance.destroy();
    osdInstance = null;
  }
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

els.form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  state.q = els.input.value.trim();
  state.offset = 0;
  applyFilters();
});

els.prev.addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - state.limit);
  renderResults();
  updatePager();
});
els.next.addEventListener("click", () => {
  state.offset += state.limit;
  renderResults();
  updatePager();
});

els.viewerClose.addEventListener("click", closeViewer);
els.modal.addEventListener("click", (ev) => {
  if (ev.target === els.modal) closeViewer();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !els.modal.hidden) closeViewer();
});

els.menuToggle.addEventListener("click", () => {
  els.sidebar.classList.toggle("open");
});

loadData();
