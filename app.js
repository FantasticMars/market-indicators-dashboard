import {
  DEFAULT_INSTRUMENTS,
  EXPOSURE_BANDS,
  applyBandHysteresis,
  buildHistoryPoint,
  buildMarketModel,
} from "./model.js";

const hasDocument = typeof document !== "undefined";
const runtimeConfig = globalThis.window?.MARKET_INDICATORS_CONFIG || {};

const state = {
  instruments: [...DEFAULT_INSTRUMENTS],
  refreshTimer: null,
  loading: false,
  lastEvents: [],
  bandState: loadBandState(),
  lastDataMode: "api",
};

const pageConfig = {
  page: hasDocument ? document.body.dataset.page || "dashboard" : "dashboard",
  segmentId: hasDocument ? document.body.dataset.segmentId || null : null,
};

const DETAIL_URLS = {
  us: "us.html",
  china: "china.html",
  hong_kong: "hong-kong.html",
  crypto: "crypto.html",
};

const LEGACY_DEFAULT_SYMBOLS = [
  "SPY", "QQQ", "IWM", "RSP", "HYG", "TLT", "SHY", "VXX",
  "SHCOMP", "CSI300", "HSI", "FXI", "KWEB", "BTC",
];
const PRE_MACRO_DEFAULT_SYMBOLS = [...LEGACY_DEFAULT_SYMBOLS, "SPXA200R"];
const PRE_REGIONAL_BREADTH_DEFAULT_SYMBOLS = DEFAULT_INSTRUMENTS
  .map((item) => item.symbol)
  .filter((symbol) => !["CSI300A200R", "HKA200R", "SP500_FUNDAMENTALS", "CSI300_FUNDAMENTALS", "HSCEI_FUNDAMENTALS"].includes(symbol));
const PRE_FUNDAMENTAL_DEFAULT_SYMBOLS = DEFAULT_INSTRUMENTS
  .map((item) => item.symbol)
  .filter((symbol) => !["SP500_FUNDAMENTALS", "CSI300_FUNDAMENTALS", "HSCEI_FUNDAMENTALS"].includes(symbol));
const PRE_NATIVE_DEFAULT_SYMBOLS = [
  "SPY", "QQQ", "IWM", "RSP", "SPXA200R", "HYG", "TLT", "SHY", "VXX",
  "SHCOMP", "CSI300", "HSI", "FXI", "KWEB",
  "CN_M1_M2_GAP", "CN_CORP_MLT_LOAN_YOY", "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP", "CN_FX_SETTLEMENT_FLOW",
  "BTC",
];

const els = hasDocument ? {
  autoRefreshToggle: document.querySelector("#autoRefreshToggle"),
  refreshInterval: document.querySelector("#refreshInterval"),
  refreshButton: document.querySelector("#refreshButton"),
  applySymbolsButton: document.querySelector("#applySymbolsButton"),
  resetSymbolsButton: document.querySelector("#resetSymbolsButton"),
  symbolInput: document.querySelector("#symbolInput"),
  statusBanner: document.querySelector("#statusBanner"),
  healthScore: document.querySelector("#healthScore"),
  headlineTrend: document.querySelector("#headlineTrend"),
  regimeLabel: document.querySelector("#regimeLabel"),
  exposureGuide: document.querySelector("#exposureGuide"),
  scoreMeterFill: document.querySelector("#scoreMeterFill"),
  scoreNarrative: document.querySelector("#scoreNarrative"),
  dataSource: document.querySelector("#dataSource"),
  lastUpdated: document.querySelector("#lastUpdated"),
  realtimeStatus: document.querySelector("#realtimeStatus"),
  coverageStatus: document.querySelector("#coverageStatus"),
  segmentsGrid: document.querySelector("#segmentsGrid"),
  segmentDetail: document.querySelector("#segmentDetail"),
  marketTableBody: document.querySelector("#marketTableBody"),
  exposureBands: document.querySelector("#exposureBands"),
  eventLog: document.querySelector("#eventLog"),
} : {};

function loadBandState() {
  try {
    return JSON.parse(localStorage.getItem("marketIndicators.bandState") || "{}");
  } catch {
    return {};
  }
}

function init() {
  const savedSymbols = localStorage.getItem("marketIndicators.symbols");
  if (savedSymbols) {
    state.instruments = parseSymbols(savedSymbols);
    if (isLegacyDefaultSymbols(savedSymbols)) {
      state.instruments = [...DEFAULT_INSTRUMENTS];
      localStorage.setItem("marketIndicators.symbols", getSymbols().join(","));
    }
  }
  syncSymbolInput();
  applyRuntimeUi();
  if (els.exposureBands) renderExposureBands(null);
  bindEvents();
  refreshDashboard();
  scheduleRefresh();
}

function applyRuntimeUi() {
  const mode = currentDataMode();
  state.lastDataMode = mode;
  const toggleText = hasDocument ? document.querySelector(".toggle span") : null;
  if (mode === "static") {
    if (els.autoRefreshToggle) els.autoRefreshToggle.checked = false;
    if (els.refreshInterval) els.refreshInterval.disabled = true;
    if (toggleText) toggleText.textContent = "每日快照";
    if (els.refreshButton) els.refreshButton.textContent = "重新读取";
    if (els.statusBanner) {
      els.statusBanner.innerHTML = "<strong>正在读取每日快照...</strong><span>数据由 GitHub Actions 定时生成，不需要常驻云服务器。</span>";
    }
    return;
  }

  if (els.refreshInterval) els.refreshInterval.disabled = false;
  if (toggleText) toggleText.textContent = "自动刷新";
}

function isLegacyDefaultSymbols(value) {
  const symbols = value
    .split(/[\s,;]+/)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const set = new Set(symbols);
  const hasDeprecatedDefault = ["HYG", "TLT", "SHY", "VXX"].some((symbol) => set.has(symbol));
  const hasNativeDefault = ["HY_OAS", "DGS10", "T10Y2Y", "VIX", "VIX3M", "VIX9D"].some((symbol) => set.has(symbol));
  return (
    set.size === LEGACY_DEFAULT_SYMBOLS.length
      && !set.has("SPXA200R")
      && LEGACY_DEFAULT_SYMBOLS.every((symbol) => set.has(symbol))
  ) || (
    set.size === PRE_MACRO_DEFAULT_SYMBOLS.length
      && PRE_MACRO_DEFAULT_SYMBOLS.every((symbol) => set.has(symbol))
  ) || (
    set.size === PRE_NATIVE_DEFAULT_SYMBOLS.length
    && PRE_NATIVE_DEFAULT_SYMBOLS.every((symbol) => set.has(symbol))
  ) || (
    set.size === PRE_REGIONAL_BREADTH_DEFAULT_SYMBOLS.length
    && PRE_REGIONAL_BREADTH_DEFAULT_SYMBOLS.every((symbol) => set.has(symbol))
  ) || (
    set.size === PRE_FUNDAMENTAL_DEFAULT_SYMBOLS.length
    && PRE_FUNDAMENTAL_DEFAULT_SYMBOLS.every((symbol) => set.has(symbol))
  ) || (
    hasDeprecatedDefault
      && !hasNativeDefault
      && ["SPY", "QQQ", "IWM", "RSP", "SHCOMP", "CSI300", "HSI", "FXI", "KWEB", "BTC"].every((symbol) => set.has(symbol))
  );
}

function bindEvents() {
  els.refreshButton?.addEventListener("click", refreshDashboard);
  els.refreshInterval?.addEventListener("change", scheduleRefresh);
  els.autoRefreshToggle?.addEventListener("change", scheduleRefresh);
  els.applySymbolsButton?.addEventListener("click", () => {
    state.instruments = parseSymbols(els.symbolInput.value);
    localStorage.setItem("marketIndicators.symbols", getSymbols().join(","));
    refreshDashboard();
    scheduleRefresh();
  });
  els.resetSymbolsButton?.addEventListener("click", () => {
    state.instruments = [...DEFAULT_INSTRUMENTS];
    localStorage.removeItem("marketIndicators.symbols");
    syncSymbolInput();
    refreshDashboard();
    scheduleRefresh();
  });
}

function parseSymbols(value) {
  const defaultMap = new Map(DEFAULT_INSTRUMENTS.map((item) => [item.symbol, item]));
  const symbols = value
    .split(/[\s,;]+/)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(symbols)];
  return unique.length
    ? unique.map((symbol) => defaultMap.get(symbol) || {
        symbol,
        name: symbol,
        role: "Custom watch item",
        group: "custom",
        segment: "custom",
      })
    : [...DEFAULT_INSTRUMENTS];
}

function getSymbols() {
  return state.instruments.map((item) => item.symbol);
}

function syncSymbolInput() {
  if (!els.symbolInput) return;
  els.symbolInput.value = getSymbols().join(", ");
}

function scheduleRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }
  if (currentDataMode() === "static") {
    return;
  }
  if (!els.autoRefreshToggle?.checked) {
    return;
  }
  state.refreshTimer = window.setInterval(refreshDashboard, Number(els.refreshInterval?.value || 60) * 1000);
}

async function refreshDashboard() {
  if (state.loading) return;
  state.loading = true;
  setLoading(true);
  const symbols = getSymbols();
  const mode = currentDataMode();
  state.lastDataMode = mode;

  try {
    const quotesPayload = mode === "static"
      ? await fetchStaticQuotes()
      : await fetchJson(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`);
    const model = buildMarketModel(quotesPayload, state.instruments);
    const historyPayload = mode === "static"
      ? await fetchStaticHistory(model)
      : await persistHistoryPoint(model);
    model.history = normalizeHistoryPayload(historyPayload);
    if (!model.history.length && model.healthScore !== null) {
      model.history = [buildHistoryPoint(model)];
    }
    model.dataMode = mode;
    model.bandState = applyBandHysteresis(model.healthScore, state.bandState, { buffer: 3, confirmations: 2 });
    state.bandState = {
      activeRange: model.bandState.activeBand?.range || null,
      pendingRange: model.bandState.pendingBand?.range || null,
      pendingCount: model.bandState.pendingCount || 0,
    };
    localStorage.setItem("marketIndicators.bandState", JSON.stringify(state.bandState));
    renderDashboard(model);
  } catch (error) {
    renderFailure(error);
  } finally {
    state.loading = false;
    setLoading(false);
  }
}

function apiUrl(path) {
  const baseUrl = String(runtimeConfig.API_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function currentDataMode() {
  return dataMode(runtimeConfig, globalThis.window?.location || { protocol: "", hostname: "" });
}

export function dataMode(config = {}, locationLike = { protocol: "", hostname: "" }) {
  const configured = String(config.DATA_MODE || "auto").trim().toLowerCase();
  if (configured === "api" || configured === "static") return configured;
  if (String(config.API_BASE_URL || "").trim()) return "api";

  const protocol = String(locationLike.protocol || "");
  const hostname = String(locationLike.hostname || "").toLowerCase();
  if (protocol === "file:") return "static";
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return "api";
  return "static";
}

export function staticDataUrl(path, config = {}) {
  const baseUrl = String(config.DATA_BASE_URL || "").replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "").replace(/^data\//, "");
  return baseUrl ? `${baseUrl}/${cleanPath}` : `data/${cleanPath}`;
}

export function normalizeHistoryPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.points)) return payload.points;
  return [];
}

function dashboardToken() {
  return runtimeConfig.ACCESS_TOKEN || localStorage.getItem("marketIndicators.accessToken") || "";
}

function apiHeaders(extraHeaders = {}) {
  const token = dashboardToken();
  return {
    ...extraHeaders,
    ...(token ? { "X-Dashboard-Token": token } : {}),
  };
}

async function fetchJson(url, retryAuth = true) {
  const response = await fetch(apiUrl(url), {
    headers: apiHeaders(),
    cache: "no-store",
  });
  if (response.status === 401 && retryAuth && requestAccessToken()) {
    return fetchJson(url, false);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchStaticQuotes() {
  const payload = await fetchRawJson(staticDataUrl("latest.json", runtimeConfig));
  if (!Array.isArray(payload.quotes)) {
    throw new Error("静态快照缺少 quotes 数据，请先运行 GitHub Actions 生成 data/latest.json。");
  }
  return payload;
}

async function fetchStaticHistory(model) {
  try {
    return await fetchRawJson(staticDataUrl("history.json", runtimeConfig));
  } catch (error) {
    pushEvent(`静态历史记录读取失败：${error.message}`);
    return { points: model.healthScore === null ? [] : [buildHistoryPoint(model)] };
  }
}

async function fetchRawJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function postJson(url, payload, retryAuth = true) {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: apiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (response.status === 401 && retryAuth && requestAccessToken()) {
    return postJson(url, payload, false);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

function requestAccessToken() {
  const token = window.prompt("请输入 Market Indicators 访问令牌");
  if (!token) return false;
  localStorage.setItem("marketIndicators.accessToken", token.trim());
  return true;
}

async function persistHistoryPoint(model) {
  try {
    return await postJson("/api/history", { point: buildHistoryPoint(model) });
  } catch (error) {
    pushEvent(`历史记录保存失败：${error.message}`);
    return { points: [] };
  }
}

function setLoading(isLoading) {
  if (els.refreshButton) {
    els.refreshButton.disabled = isLoading;
    els.refreshButton.textContent = isLoading ? "读取中" : currentDataMode() === "static" ? "重新读取" : "刷新";
  }
  if (els.applySymbolsButton) els.applySymbolsButton.disabled = isLoading;
}

function renderDashboard(model) {
  const roundedScore = model.healthScore === null ? null : Math.round(model.healthScore);
  const failedCount = model.failed.length;
  const warning = failedCount > 0;

  if (els.statusBanner) {
    els.statusBanner.className = `status-banner ${warning ? "warning" : "success"}`;
    const successTitle = model.dataMode === "static" ? "每日快照读取完成" : "行情读取完成";
    const successText = model.dataMode === "static"
      ? "已读取 GitHub Actions 生成的静态数据文件。"
      : "所有可用 symbol 已更新。";
    els.statusBanner.innerHTML = warning
      ? `<strong>部分数据不可用</strong><span>${failedCount} 个 symbol 读取失败；对应指标会排除或标记。</span>`
      : `<strong>${successTitle}</strong><span>${successText}</span>`;
  }

  if (els.healthScore) els.healthScore.textContent = roundedScore === null ? "--" : String(roundedScore);
  if (els.scoreMeterFill) els.scoreMeterFill.style.width = roundedScore === null ? "0%" : `${Math.max(0, Math.min(100, roundedScore))}%`;
  const displayBand = model.bandState?.activeBand || model.activeBand;
  if (els.regimeLabel) els.regimeLabel.textContent = displayBand ? displayBand.label : getRegimeLabel(model.healthScore);
  if (els.exposureGuide) {
    const pending = model.bandState?.pendingBand
      ? `；待确认切换到 ${model.bandState.pendingBand.range}（${model.bandState.pendingCount}/2）`
      : "";
    els.exposureGuide.textContent = displayBand
      ? `参考仓位区间：${displayBand.range}（${displayBand.label}）${pending}`
      : "可用数据不足，暂不输出仓位区间";
  }
  if (els.headlineTrend) els.headlineTrend.innerHTML = renderScoreHistory(model.history, "composite");
  if (els.scoreNarrative) els.scoreNarrative.textContent = buildNarrative(model);
  if (els.dataSource) els.dataSource.textContent = model.source;
  if (els.lastUpdated) els.lastUpdated.textContent = formatDateTime(model.timestamp);
  if (els.realtimeStatus) els.realtimeStatus.textContent = formatRealtimeStatus(model.realtimeStatus);
  if (els.coverageStatus) els.coverageStatus.textContent = `${model.successful}/${model.components.length} symbols`;

  if (els.segmentsGrid) renderSegmentSummaries(model.segments, model.history);
  if (els.segmentDetail) renderSegmentDetail(model.segments, model.history);
  if (els.marketTableBody) renderMarketTable(model.components);
  if (els.exposureBands) renderExposureBands(displayBand, model.bandState);
  pushEvent(
    warning
      ? `更新完成，但 ${failedCount} 个 symbol 失败：${model.failed.map((item) => item.symbol).join(", ")}`
      : `更新完成：${model.successful} 个 symbol 可用。`
  );
}

function renderFailure(error) {
  if (els.statusBanner) {
    els.statusBanner.className = "status-banner error";
    els.statusBanner.innerHTML = `<strong>数据读取失败</strong><span>${escapeHtml(error.message)}</span>`;
  }
  if (els.dataSource) els.dataSource.textContent = "unavailable";
  if (els.lastUpdated) els.lastUpdated.textContent = formatDateTime(new Date().toISOString());
  if (els.realtimeStatus) els.realtimeStatus.textContent = "failed";
  if (els.coverageStatus) els.coverageStatus.textContent = "0/" + state.instruments.length + " symbols";
  if (els.healthScore) els.healthScore.textContent = "--";
  if (els.headlineTrend) els.headlineTrend.innerHTML = "";
  if (els.scoreMeterFill) els.scoreMeterFill.style.width = "0%";
  if (els.regimeLabel) els.regimeLabel.textContent = "等待可用数据";
  if (els.exposureGuide) els.exposureGuide.textContent = "暂无仓位参考区间";
  if (els.scoreNarrative) els.scoreNarrative.textContent = "当前没有可用行情。请确认本地 server.py 正在运行，且网络可以访问数据源。";
  if (els.scoreNarrative && state.lastDataMode === "static") {
    els.scoreNarrative.textContent = "当前没有可用快照。请确认 GitHub Actions 已生成 data/latest.json 和 data/history.json。";
  }
  if (els.segmentsGrid) els.segmentsGrid.innerHTML = `<div class="empty-state">没有可用信号。</div>`;
  if (els.segmentDetail) els.segmentDetail.innerHTML = `<div class="empty-state">没有可用信号。</div>`;
  if (els.marketTableBody) els.marketTableBody.innerHTML = state.instruments
    .map((instrument) => `
      <tr>
        <td class="symbol-cell"><strong>${escapeHtml(instrument.symbol)}</strong><span>${escapeHtml(instrument.name)}</span></td>
        <td class="role-cell">${escapeHtml(instrument.role)}</td>
        <td colspan="6">数据不可用</td>
      </tr>
    `)
    .join("");
  if (els.exposureBands) renderExposureBands(null);
  pushEvent(`数据读取失败：${error.message}`);
}

function renderSegmentSummaries(segments, history = []) {
  els.segmentsGrid.innerHTML = segments.map((segment) => `
    <article class="segment-card compact-segment-card">
      <div class="segment-head">
        <div>
          <div class="panel-label">${escapeHtml(segment.name)}</div>
          <h3>${segment.score === null ? "--" : Math.round(segment.score)}<span>/100</span></h3>
        </div>
        <div class="segment-badges">
          <span class="tag ${segment.status.tone}">${escapeHtml(segment.status.label)}</span>
          <span class="tag ${segment.trend.tone}">${escapeHtml(segment.trend.symbol)} ${escapeHtml(segment.trend.label)}</span>
        </div>
      </div>
      <p class="segment-description">${escapeHtml(segment.description)}</p>
      ${renderFundamentalSummary(segment.fundamentalAnchor)}
      <div class="segment-formula">
        <span>总分权重 ${formatWeight(segment.weight)}</span>
        <span>可用子权重 ${formatWeight(segment.availableWeight)} / ${formatWeight(segment.totalWeight)}</span>
        <span>confidence ${formatConfidence(segment.confidence)}</span>
      </div>
      ${renderScoreHistory(history, segment.id)}
      <div class="mini-meter" aria-hidden="true"><span style="width:${segment.score === null ? 0 : clamp(segment.score, 0, 100)}%"></span></div>
      <div class="summary-signal-list">
        ${renderSummarySignals(segment)}
      </div>
      <a class="detail-link" href="${escapeAttribute(DETAIL_URLS[segment.id] || "index.html")}">查看${escapeHtml(segment.name)}详情</a>
    </article>
  `).join("");
}

function renderSummarySignals(segment) {
  const sorted = [...segment.indicators]
    .sort((a, b) => (a.score ?? -1) - (b.score ?? -1))
    .slice(0, 3);
  return sorted.map((indicator) => `
    <div class="summary-signal">
      <span>${escapeHtml(indicator.name)}</span>
      <strong>${indicator.score === null ? "--" : Math.round(indicator.score)}</strong>
    </div>
  `).join("");
}

function renderSegmentDetail(segments, history = []) {
  const segment = segments.find((item) => item.id === pageConfig.segmentId);
  if (!segment) {
    els.segmentDetail.innerHTML = `<div class="empty-state">没有找到对应板块。</div>`;
    return;
  }
  els.segmentDetail.innerHTML = `
    <article class="segment-card detail-segment-card">
      <div class="segment-head">
        <div>
          <div class="panel-label">${escapeHtml(segment.name)}</div>
          <h3>${segment.score === null ? "--" : Math.round(segment.score)}<span>/100</span></h3>
        </div>
        <div class="segment-badges">
          <span class="tag ${segment.status.tone}">${escapeHtml(segment.status.label)}</span>
          <span class="tag ${segment.trend.tone}">${escapeHtml(segment.trend.symbol)} ${escapeHtml(segment.trend.label)}</span>
        </div>
      </div>
      <p class="segment-description">${escapeHtml(segment.description)}</p>
      <div class="segment-formula">
        <span>总分权重 ${formatWeight(segment.weight)}</span>
        <span>可用子权重 ${formatWeight(segment.availableWeight)} / ${formatWeight(segment.totalWeight)}</span>
        <span>confidence ${formatConfidence(segment.confidence)}</span>
        <span>${escapeHtml(segment.formula)}</span>
      </div>
      ${renderScoreHistory(history, segment.id)}
      ${renderObservationNotes(segment.observationNotes)}
      ${renderFundamentalAnchor(segment.fundamentalAnchor)}
      <div class="indicator-list detail-indicator-list">
        ${segment.indicators.map(renderIndicator).join("")}
      </div>
    </article>
  `;
}

function renderFundamentalSummary(anchor) {
  if (!anchor) return "";
  if (!anchor.ok) return `<div class="fundamental-summary unavailable"><strong>基本面锚</strong><span>数据不可用，不影响战术分</span></div>`;
  const primary = anchor.metrics.filter((metric) => ["earnings_yield", "earnings_growth", "roe"].includes(metric.id));
  return `
    <div class="fundamental-summary">
      <strong>基本面锚 · 暂不计分</strong>
      <span>${primary.map((metric) => `${escapeHtml(metric.label)} ${formatFundamentalValue(metric)}`).join(" · ")}</span>
    </div>
  `;
}

function renderFundamentalAnchor(anchor) {
  if (!anchor) return "";
  if (!anchor.ok) {
    return `
      <section class="fundamental-anchor unavailable">
        <div><span class="panel-label">基本面锚 · 暂不计分</span><h3>${escapeHtml(anchor.title)}</h3></div>
        <p>${escapeHtml(anchor.error || "数据不可用")}</p>
      </section>
    `;
  }
  return `
    <section class="fundamental-anchor">
      <div class="fundamental-anchor-head">
        <div><span class="panel-label">基本面锚 · 暂不计分</span><h3>${escapeHtml(anchor.title)}</h3></div>
        <span class="tag neutral">历史积累中</span>
      </div>
      <p>${escapeHtml(anchor.subtitle)}</p>
      <div class="fundamental-grid">
        ${anchor.metrics.map((metric) => `
          <article class="fundamental-metric">
            <span>${escapeHtml(metric.label)}</span>
            <strong>${formatFundamentalValue(metric)}</strong>
            <small>${escapeHtml(metric.note)}</small>
          </article>
        `).join("")}
      </div>
      <div class="fundamental-source">
        <span>${escapeHtml(anchor.detail || "")}</span>
        <a href="${escapeAttribute(anchor.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(anchor.sourceName)}</a>
        <span>${anchor.observedAt ? escapeHtml(anchor.observedAt) : "--"} · ${escapeHtml(formatRealtimeStatus(anchor.realtimeStatus))}</span>
      </div>
    </section>
  `;
}

function formatFundamentalValue(metric) {
  if (!Number.isFinite(metric?.value)) return "--";
  return `${metric.value.toFixed(2)}${metric.suffix || ""}`;
}

function renderObservationNotes(notes = []) {
  if (!notes.length) return "";
  return `
    <div class="observation-notes">
      ${notes.map((note) => `
        <div class="observation-note">
          <strong>${escapeHtml(note.title)}</strong>
          <span>${escapeHtml(note.body)}</span>
          ${note.sourceUrl ? `<a href="${escapeAttribute(note.sourceUrl)}" target="_blank" rel="noreferrer">来源</a>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderIndicator(indicator) {
  const score = indicator.score === null ? "--" : Math.round(indicator.score);
  return `
    <details class="indicator-detail">
      <summary>
        <span>
          <strong>${escapeHtml(indicator.name)} <small class="weight-pill">权重 ${formatWeight(indicator.weight)}</small></strong>
          <em>${escapeHtml(indicator.description)}</em>
        </span>
        <span class="indicator-score">
          ${score}/100
          <small class="tag ${indicator.status.tone}">${escapeHtml(indicator.status.label)}</small>
        </span>
      </summary>
      <div class="indicator-body">
        <dl class="indicator-meta">
          <div><dt>权重</dt><dd>${formatWeight(indicator.weight)}（同板块内${indicator.score === null ? "；无数据时排除" : ""}）</dd></div>
          <div><dt>计算方式</dt><dd>${escapeHtml(indicator.formula)}</dd></div>
          <div><dt>来源</dt><dd><a href="${escapeAttribute(indicator.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(indicator.sourceName)}</a></dd></div>
          <div><dt>频率</dt><dd>${escapeHtml(formatFrequency(indicator.frequency))}</dd></div>
          <div><dt>源时间</dt><dd>${indicator.observedAt ? escapeHtml(indicator.observedAt) : "--"}</dd></div>
          <div><dt>实时性</dt><dd>${escapeHtml(formatRealtimeStatus(indicator.realtimeStatus))}</dd></div>
          <div><dt>confidence</dt><dd>${formatConfidence(indicator.confidence)}</dd></div>
        </dl>
        <div class="input-grid">
          ${indicator.inputs.map(renderIndicatorInput).join("")}
        </div>
      </div>
    </details>
  `;
}

function renderIndicatorInput(input) {
  const source = input.sourceUrl
    ? `<a href="${escapeAttribute(input.sourceUrl)}" target="_blank" rel="noreferrer">验证</a>`
    : "--";
  return `
    <div class="input-row ${input.frequency === "monthly" ? "slow-input-row" : ""} ${input.divergenceFlag ? "divergence-row" : ""}">
      <div class="input-title">
        <strong>${escapeHtml(input.symbol)}</strong>
        <span>${escapeHtml(input.name || "")}</span>
      </div>
      <div>${formatPrice(input.price, input.currency)}</div>
      <div>${formatRoc(input.roc5, "5D")}</div>
      <div>${formatRoc(input.roc20, "20D")}</div>
      <div>${formatRangePosition(input.levelScore ?? input.rangePosition)}</div>
      <div>${escapeHtml(formatFrequency(input.frequency))}<br>${input.asOfDate || input.observedAt ? escapeHtml(input.asOfDate || input.observedAt) : "--"}</div>
      <div>${source}</div>
      <p class="input-note">方向：${escapeHtml(formatTrendDirection(input.trendDirection))}；basis：${escapeHtml(input.metricBasis || "unknown")}；confidence ${formatConfidence(input.confidence)}</p>
      ${input.secondarySource ? `<p class="input-note ${input.divergenceFlag ? "error-text" : ""}">二源：${escapeHtml(input.secondarySource.ok ? "ok" : "failed")} ${input.secondarySource.divergence_pct ? `divergence ${formatNumber(input.secondarySource.divergence_pct)}%` : ""}</p>` : ""}
      ${input.detail ? `<p class="input-note">${escapeHtml(input.detail)}</p>` : ""}
      ${input.proxyNote ? `<p class="input-note">${escapeHtml(input.proxyNote)}</p>` : ""}
      ${input.error ? `<p class="input-note error-text">${escapeHtml(input.error)}</p>` : ""}
    </div>
  `;
}

function renderMarketTable(components) {
  els.marketTableBody.innerHTML = components
    .map((component) => `
      <tr>
        <td class="symbol-cell">
          <strong>${escapeHtml(component.symbol)}</strong>
          <span>${escapeHtml(component.name)}</span>
          ${component.proxyNote ? `<small>${escapeHtml(component.proxyNote)}</small>` : ""}
        </td>
        <td class="role-cell">${escapeHtml(component.role)}</td>
        <td>${formatPrice(component.price, component.currency)}</td>
        <td>${formatPct(component.dayChangePct)}</td>
        <td>${formatRangePosition(component.levelScore ?? component.rangePosition)}</td>
        <td>
          <div class="trend-stack">
            <span class="tag ${component.trend.tone}">${escapeHtml(component.trend.label)}</span>
            <small>${escapeHtml(component.trend.detail)}；5D ${formatPlainPct(component.roc5)} / 20D ${formatPlainPct(component.roc20)}</small>
          </div>
        </td>
        <td>${escapeHtml(formatFrequency(component.frequency))}<br>${component.asOfDate ? escapeHtml(component.asOfDate) : "--"}</td>
        <td>${component.sourceUrl ? `<a href="${escapeAttribute(component.sourceUrl)}" target="_blank" rel="noreferrer">source</a>` : "--"}</td>
      </tr>
    `)
    .join("");
}

function renderExposureBands(activeBand, bandState = null) {
  els.exposureBands.innerHTML = EXPOSURE_BANDS.map((band) => `
    <div class="band-row ${activeBand && activeBand.range === band.range ? "active" : ""} ${bandState?.pendingBand?.range === band.range ? "pending" : ""}">
      <div class="band-range">${band.range}</div>
      <div>
        <span class="band-label">${band.label}</span>
        <span class="band-note">${band.note}${bandState?.pendingBand?.range === band.range ? ` 待确认 ${bandState.pendingCount}/2` : ""}</span>
      </div>
    </div>
  `).join("");
}

function pushEvent(message) {
  if (!els.eventLog) return;
  const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  state.lastEvents.unshift(`${timestamp} - ${message}`);
  state.lastEvents = state.lastEvents.slice(0, 12);
  els.eventLog.innerHTML = state.lastEvents.map((event) => `<li>${escapeHtml(event)}</li>`).join("");
}

function getRegimeLabel(score) {
  if (score === null || !Number.isFinite(score)) return "数据不足";
  if (score >= 75) return "Risk-on";
  if (score >= 60) return "偏积极";
  if (score >= 45) return "中性震荡";
  if (score >= 30) return "防御";
  return "风险收缩";
}

function buildNarrative(model) {
  if (model.healthScore === null) {
    return "可用数据不足，暂不生成市场判断。";
  }
  const strongest = [...model.segments]
    .filter((segment) => segment.score !== null)
    .sort((a, b) => b.score - a.score)[0];
  const weakest = [...model.segments]
    .filter((segment) => segment.score !== null)
    .sort((a, b) => a.score - b.score)[0];
  if (!strongest || !weakest) {
    return "信号覆盖不足，请检查数据源。";
  }
  return `总分按板块权重计算：美国 45%、中国 22%、香港/离岸 13%、加密 20%；当前最强板块是 ${strongest.name}，最弱板块是 ${weakest.name}。`;
}

function renderScoreHistory(history = [], key = "composite") {
  const series = scoreSeries(history, key);
  if (!series.length) {
    return `<div class="score-history empty-history">等待历史记录</div>`;
  }
  const latest = series[series.length - 1]?.value;
  return `
    <div class="score-history">
      ${renderSparkline(series.map((point) => point.value))}
      <span>${formatDelta(deltaForDays(series, 1), "1D")}</span>
      <span>${formatDelta(deltaForDays(series, 5), "5D")}</span>
      <span>latest ${latest === null || !Number.isFinite(latest) ? "--" : Math.round(latest)}</span>
    </div>
  `;
}

function scoreSeries(history, key) {
  return (history || [])
    .map((point) => {
      const value = key === "composite" ? point.composite : point.segments?.[key]?.score;
      return {
        timestamp: point.timestamp,
        value: Number.isFinite(Number(value)) ? Number(value) : null,
      };
    })
    .filter((point) => point.timestamp && Number.isFinite(point.value));
}

function deltaForDays(series, days) {
  if (series.length < 2) return null;
  const latest = series[series.length - 1];
  const targetMs = new Date(latest.timestamp).getTime() - days * 24 * 60 * 60 * 1000;
  let prior = null;
  for (const point of series) {
    const pointMs = new Date(point.timestamp).getTime();
    if (Number.isFinite(pointMs) && pointMs <= targetMs) prior = point;
  }
  prior ||= series[Math.max(0, series.length - 1 - days)];
  return latest.value - prior.value;
}

function renderSparkline(values) {
  const usable = values.slice(-32).filter((value) => Number.isFinite(value));
  if (usable.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 96 28" aria-hidden="true"></svg>`;
  }
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const span = max - min || 1;
  const points = usable.map((value, index) => {
    const x = (index / (usable.length - 1)) * 96;
    const y = 26 - ((value - min) / span) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<svg class="sparkline" viewBox="0 0 96 28" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
}

function formatDelta(value, label) {
  if (value === null || !Number.isFinite(value)) return `${label} --`;
  const className = value > 0.05 ? "number-up" : value < -0.05 ? "number-down" : "number-flat";
  const sign = value > 0 ? "+" : "";
  return `<span class="${className}">${label} ${sign}${value.toFixed(1)}</span>`;
}

function formatWeight(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${formatNumber(value)}%`;
}

function formatRoc(value, label) {
  if (value === null || !Number.isFinite(value)) return `${label} --`;
  return `${label} ${formatPct(value)}`;
}

function formatPlainPct(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatFrequency(value) {
  const normalized = String(value || "unknown");
  if (normalized === "monthly") return "月度";
  if (normalized === "daily") return "日频";
  if (normalized === "24/7 spot") return "24/7 spot";
  return normalized.replace(/_/g, " ");
}

function formatConfidence(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${Math.round(value * 100)}%`;
}

function formatTrendDirection(value) {
  if (value === "improving") return "改善";
  if (value === "deteriorating") return "恶化";
  return "走平";
}

function formatPct(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  const className = value > 0.05 ? "number-up" : value < -0.05 ? "number-down" : "number-flat";
  const sign = value > 0 ? "+" : "";
  return `<span class="${className}">${sign}${value.toFixed(2)}%</span>`;
}

function formatRangePosition(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `<span class="number-flat">${value.toFixed(0)}%</span>`;
}

function formatPrice(value, currency) {
  if (value === null || !Number.isFinite(value)) return "--";
  return `${formatNumber(value)} ${escapeHtml(currency || "")}`.trim();
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 2 : 3,
  }).format(value);
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatRealtimeStatus(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

if (hasDocument) {
  init();
}
