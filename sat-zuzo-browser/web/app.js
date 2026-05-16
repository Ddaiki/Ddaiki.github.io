// SAT図像ブラウザ叩き台のフロント。フレームワーク無し、状態は単純なオブジェクト。

const state = {
  q: "",
  category: "",
  limit: 60,
  offset: 0,
  total: 0,
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

function buildSearchURL() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.category) params.set("category", state.category);
  params.set("limit", state.limit);
  params.set("offset", state.offset);
  return `/api/search?${params}`;
}

async function loadFacets() {
  try {
    const data = await fetchJSON("/api/facets");
    const deity = data.tags["尊格"] || [];
    const counts = new Map(
      (data.deity_categories || []).map((c) => [c.value, c.n])
    );
    els.facetDeity.innerHTML = "";
    const allBtn = createFacetButton("すべて", "", counts.size ? null : 0);
    els.facetDeity.appendChild(allBtn);
    for (const value of deity) {
      els.facetDeity.appendChild(createFacetButton(value, value, counts.get(value)));
    }
    updateFacetActive();
  } catch (e) {
    showStatus(`ファセット取得失敗: ${e.message}`);
  }
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
    loadResults();
  });
  li.appendChild(btn);
  return li;
}

function updateFacetActive() {
  els.facetDeity.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.value === state.category);
  });
}

async function loadResults() {
  showStatus("読み込み中…");
  try {
    const data = await fetchJSON(buildSearchURL());
    state.total = data.total;
    renderResults(data.items);
    updatePager();
    showStatus(
      data.items.length
        ? null
        : "該当する画像がありません。fetch_manifests.py --seed を実行しましたか？"
    );
  } catch (e) {
    showStatus(`検索失敗: ${e.message}`);
  }
}

function renderResults(items) {
  els.results.innerHTML = "";
  for (const item of items) {
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
    li.addEventListener("click", () => openViewer(item.id));
    li.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") openViewer(item.id);
    });
    els.results.appendChild(li);
  }
}

function updatePager() {
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  els.pageInfo.textContent = `${page} / ${pages}（全${state.total}件）`;
  els.prev.disabled = state.offset <= 0;
  els.next.disabled = state.offset + state.limit >= state.total;
}

async function openViewer(id) {
  try {
    const item = await fetchJSON(`/api/items/${id}`);
    els.modal.hidden = false;
    els.viewerTitle.textContent = item.title || "(無題)";
    els.viewerMeta.innerHTML = `
      <dt>巻 / 頁</dt><dd>${item.volume} / ${item.page}</dd>
      <dt>尊格</dt><dd>${escapeHTML(item.deity_category || "—")}</dd>
      <dt>IIIF Manifest</dt><dd><a href="${item.iiif_manifest_url}" target="_blank" rel="noopener">${item.iiif_manifest_url}</a></dd>
    `;
    initViewer(item.iiif_image_url);
  } catch (e) {
    showStatus(`詳細取得失敗: ${e.message}`);
  }
}

function initViewer(tileSource) {
  if (osdInstance) {
    osdInstance.destroy();
    osdInstance = null;
  }
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
  loadResults();
});

els.prev.addEventListener("click", () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadResults();
});
els.next.addEventListener("click", () => {
  state.offset += state.limit;
  loadResults();
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

loadFacets().then(loadResults);
