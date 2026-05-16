// SAT図像ブラウザ叩き台のフロント。静的版（GitHub Pages 配信用）。
// data/items.json を読んでクライアント側で絞り込み/ページング。

const state = {
  q: "",
  titleFilter: "",
  limit: 60,
  offset: 0,
  all: [],
  filtered: [],
  currentIndex: -1,
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
  viewerPrev: $("#viewer-prev"),
  viewerNext: $("#viewer-next"),
  menuToggle: $("#menu-toggle"),
  sidebar: $("#sidebar"),
};

// ── データ読み込み ──────────────────────────────

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json();
}

function showStatus(message) {
  if (!message) { els.status.hidden = true; els.status.textContent = ""; return; }
  els.status.hidden = false;
  els.status.textContent = message;
}

async function loadData() {
  showStatus("読み込み中…");
  try {
    const data = await fetchJSON("data/items.json");
    state.all = data.items || [];
    renderFacets();
    applyFilters();
    showStatus(state.all.length ? null : "items.json が空です。");
  } catch (e) {
    showStatus(`データ読み込み失敗: ${e.message}`);
  }
}

// ── 絞り込みフィルタ ────────────────────────────

function renderFacets() {
  // タイトルごとに件数を集計し、降順ソートしてボタンを生成
  const counts = new Map();
  for (const it of state.all) {
    if (!it.title) continue;
    counts.set(it.title, (counts.get(it.title) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  els.facetDeity.innerHTML = "";
  els.facetDeity.appendChild(makeFacetBtn("すべて", "", state.all.length));
  for (const [title, n] of sorted) {
    els.facetDeity.appendChild(makeFacetBtn(title, title, n));
  }
  updateFacetActive();
}

function makeFacetBtn(label, value, count) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.value = value;
  btn.textContent = label;
  const span = document.createElement("span");
  span.className = "count";
  span.textContent = `(${count})`;
  btn.appendChild(span);
  btn.addEventListener("click", () => {
    state.titleFilter = value;
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
    b.classList.toggle("active", b.dataset.value === state.titleFilter);
  });
}

// ── フィルタ＆検索 ──────────────────────────────

function applyFilters() {
  const q = state.q.toLowerCase();
  state.filtered = state.all.filter((it) => {
    if (state.titleFilter && it.title !== state.titleFilter) return false;
    if (q) {
      const hay = (it.title || "").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  renderResults();
  updatePager();
  showStatus(state.filtered.length === 0 ? "該当する画像がありません。" : null);
}

// ── グリッド描画 ────────────────────────────────

function renderResults() {
  const slice = state.filtered.slice(state.offset, state.offset + state.limit);
  els.results.innerHTML = "";
  for (const item of slice) {
    const li = document.createElement("li");
    li.className = "card";
    li.tabIndex = 0;
    const thumbSrc = item.iiif_image_service
      ? `${item.iiif_image_service}/full/200,/0/default.jpg`
      : null;
    li.innerHTML = `
      <div class="thumb">
        ${thumbSrc
          ? `<img src="${escapeHTML(thumbSrc)}" alt="${escapeHTML(item.title || "図像")}" loading="lazy" onerror="this.style.display='none'">`
          : `<span class="thumb-label">${escapeHTML(item.title || "—")}</span>`
        }
      </div>
      <div class="body">
        <p class="title">${escapeHTML(item.title || "(無題)")}</p>
        <p class="meta-line">巻${item.volume} / 頁${item.page}</p>
      </div>
    `;
    li.addEventListener("click", () => {
      const idx = state.filtered.indexOf(item);
      openViewer(idx);
    });
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        const idx = state.filtered.indexOf(item);
        openViewer(idx);
      }
    });
    els.results.appendChild(li);
  }
}

// ── ページャ ────────────────────────────────────

function updatePager() {
  const total = state.filtered.length;
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.max(1, Math.ceil(total / state.limit));
  els.pageInfo.textContent = `${page} / ${pages}（全${total}件）`;
  els.prev.disabled = state.offset <= 0;
  els.next.disabled = state.offset + state.limit >= total;
}

// ── ビューワ ────────────────────────────────────

function openViewer(index) {
  const item = state.filtered[index];
  if (!item) return;
  state.currentIndex = index;

  els.modal.hidden = false;
  els.viewerTitle.textContent = item.title || "(無題)";
  const vol = String(item.volume).padStart(2, "0");
  const satUrl = `https://dzkimgs.l.u-tokyo.ac.jp/SATi/images.php?vol=${vol}`;
  els.viewerMeta.innerHTML = `
    <dt>巻 / 頁</dt><dd>巻${item.volume} / 頁${item.page}</dd>
    <dt>出典</dt><dd><a href="${escapeHTML(satUrl)}" target="_blank" rel="noopener">SAT大正蔵図像DB 第${item.volume}巻</a><span class="meta-note">（本家サイトで p.${item.page} を参照）</span></dd>
  `;

  // 前後ボタンの活性制御
  els.viewerPrev.disabled = index <= 0;
  els.viewerNext.disabled = index >= state.filtered.length - 1;

  loadViewerImage(item.iiif_image_service);
}

function loadViewerImage(imageService) {
  els.viewer.innerHTML = '<p class="viewer-msg">読み込み中…</p>';
  if (!imageService) {
    els.viewer.innerHTML = '<p class="viewer-msg">画像URLが不明です。</p>';
    return;
  }
  const img = document.createElement("img");
  img.className = "viewer-img";
  img.alt = "";
  img.src = `${imageService}/full/1500,/0/default.jpg`;
  img.addEventListener("load", () => {
    els.viewer.innerHTML = "";
    els.viewer.appendChild(img);
    els.viewer.scrollTop = 0;
  });
  img.addEventListener("error", () => {
    els.viewer.innerHTML = '<p class="viewer-msg">画像を読み込めませんでした。</p>';
  });
}

function closeViewer() {
  els.modal.hidden = true;
  els.viewer.innerHTML = "";
  state.currentIndex = -1;
}

// ── イベント ────────────────────────────────────

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
  window.scrollTo(0, 0);
});
els.next.addEventListener("click", () => {
  state.offset += state.limit;
  renderResults();
  updatePager();
  window.scrollTo(0, 0);
});

els.viewerClose.addEventListener("click", closeViewer);
els.modal.addEventListener("click", (ev) => { if (ev.target === els.modal) closeViewer(); });
document.addEventListener("keydown", (ev) => {
  if (els.modal.hidden) return;
  if (ev.key === "Escape") closeViewer();
  if (ev.key === "ArrowLeft") navigateViewer(-1);
  if (ev.key === "ArrowRight") navigateViewer(1);
});

els.viewerPrev.addEventListener("click", () => navigateViewer(-1));
els.viewerNext.addEventListener("click", () => navigateViewer(1));

function navigateViewer(delta) {
  const next = state.currentIndex + delta;
  if (next >= 0 && next < state.filtered.length) openViewer(next);
}

els.menuToggle.addEventListener("click", () => {
  els.sidebar.classList.toggle("open");
});

// ── ユーティリティ ───────────────────────────────

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

loadData();
