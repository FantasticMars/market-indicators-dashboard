import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INSTRUMENTS,
  applyBandHysteresis,
  buildHistoryPoint,
  buildMarketModel,
} from "../model.js";

const sampleQuotes = [
  quote("SPY", "US", 100, 80, 120, -3.5, "USD", 88),
  quote("QQQ", "US", 110, 70, 130, 0.2, "USD", 92),
  quote("IWM", "US", 90, 60, 100, 0.3, "USD", 82),
  quote("RSP", "US", 99, 70, 115, 0.1, "USD", 78),
  unavailableQuote("SPXA200R", "US", "S&P 500 % above 200DMA source unavailable."),
  fundamentalQuote("SP500_FUNDAMENTALS", "US", "S&P 500", 3.8, 26.32, 18.5, 7.4),
  seriesQuote("HY_OAS", "US", 3.65, 15, "%", "ICE BofA US High Yield OAS", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", "daily", "lower_is_better", [4.2, 4.0, 3.9, 3.8, 3.65]),
  seriesQuote("DGS10", "US", 4.25, 45, "%", "FRED 10Y Treasury Constant Maturity", "https://fred.stlouisfed.org/series/DGS10", "daily", "lower_is_better", [4.4, 4.35, 4.3, 4.28, 4.25]),
  seriesQuote("T10Y2Y", "US", 0.55, 68, "ppt", "FRED 10Y-2Y Treasury Spread", "https://fred.stlouisfed.org/series/T10Y2Y", "daily", "higher_is_better", [0.2, 0.28, 0.36, 0.45, 0.55]),
  seriesQuote("VIX", "US", 15, 38, "%", "CBOE delayed quotes", "https://www.cboe.com/tradable_products/vix/", "daily", "lower_is_better", [19, 17, 16, 15.5, 15]),
  seriesQuote("VIX3M", "US", 18, 45, "%", "CBOE delayed quotes", "https://www.cboe.com/tradable_products/vix/", "daily", "lower_is_better", [20, 19, 18.5, 18.2, 18]),
  seriesQuote("VIX9D", "US", 13, 32, "%", "CBOE delayed quotes", "https://www.cboe.com/tradable_products/vix/", "daily", "lower_is_better", [17, 15, 14, 13.5, 13]),
  quote("SHCOMP", "CN", 4000, 3300, 4300, -0.2, "CNY", 76),
  quote("CSI300", "CN", 4800, 3900, 5100, -0.1, "CNY", 74),
  quote("CSI300A200R", "CN", 58, 0, 100, 0, "%", 58, "TradingView Stock Screener", "https://www.tradingview.com/markets/stocks-china/market-movers-all-stocks/"),
  fundamentalQuote("CSI300_FUNDAMENTALS", "CN", "CSI 300", 6.2, 16.13, 11.8, 4.5),
  quote("HSI", "HK", 23000, 18000, 25000, 0.4, "HKD", 70),
  quote("HKA200R", "HK", 46, 0, 100, 0, "%", 46, "TradingView Stock Screener", "https://www.tradingview.com/markets/stocks-hong-kong/market-movers-all-stocks/"),
  fundamentalQuote("HSCEI_FUNDAMENTALS", "HK", "HSCEI", 7.1, 14.08, 10.2, 3.2),
  quote("FXI", "US", 32, 30, 42, -0.2, "USD", 72),
  quote("KWEB", "US", 24, 22, 41, 0.7, "USD", 75),
  macroQuote("CN_M1_M2_GAP", -3.07, 38, "percentage points", [-6.5, -5.9, -4.2, -3.4, -3.07]),
  macroQuote("CN_CORP_MLT_LOAN_YOY", 6.64, 45, "%", [4.9, 5.8, 6.1, 6.4, 6.64]),
  macroQuote("CN_HOUSEHOLD_NBFI_DEPOSIT_GAP", 36.41, 65, "bp", [-20, 4, 22, 34, 36.41]),
  macroQuote("CN_FX_SETTLEMENT_FLOW", 2447.66, 58, "100m CNY", [-400, 800, 1200, 1900, 2447.66]),
  quote("BTC", "CRYPTO", 65000, 50000, 75000, 2.4, "USD", 95, "CoinGecko spot BTC via local proxy", "https://www.coingecko.com/en/coins/bitcoin"),
];

test("builds four regional asset-class panels with expanded indicators and source links", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });

  assert.deepEqual(
    model.segments.map((segment) => segment.id),
    ["us", "china", "hong_kong", "crypto"],
  );

  for (const segment of model.segments) {
    assert.equal(typeof segment.score, "number");
    assert.ok(segment.indicators.length >= 3);
    for (const indicator of segment.indicators) {
      assert.ok(indicator.description.length > 10);
      assert.ok(indicator.sourceName.length > 3);
      assert.match(indicator.sourceUrl, /^https:\/\//);
      assert.ok(indicator.observedAt);
      assert.ok(Array.isArray(indicator.inputs));
      assert.ok(indicator.inputs.length > 0);
    }
  }
});

test("includes rate, breadth, separate China, separate Hong Kong, and BTC-specific indicators", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const indicatorIds = model.segments.flatMap((segment) => segment.indicators.map((indicator) => indicator.id));
  const defaultSymbols = DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol);

  assert.ok(indicatorIds.includes("us_rate_expectations"));
  assert.ok(indicatorIds.includes("us_pct_above_200dma"));
  assert.ok(indicatorIds.includes("us_market_breadth"));
  assert.ok(indicatorIds.includes("us_credit_spread"));
  assert.ok(indicatorIds.includes("us_vix_term_structure"));
  assert.ok(indicatorIds.includes("china_a_share"));
  assert.ok(indicatorIds.includes("china_pct_above_200dma"));
  assert.ok(indicatorIds.includes("china_m1_m2_gap"));
  assert.ok(indicatorIds.includes("china_corporate_mlt_credit"));
  assert.ok(indicatorIds.includes("china_deposit_rotation"));
  assert.ok(indicatorIds.includes("china_fx_flow"));
  assert.ok(indicatorIds.includes("hk_market_trend"));
  assert.ok(indicatorIds.includes("hk_pct_above_200dma"));
  assert.ok(indicatorIds.includes("hk_offshore_china_risk"));
  assert.ok(indicatorIds.includes("btc_trend"));
  assert.ok(defaultSymbols.includes("HY_OAS"));
  assert.ok(defaultSymbols.includes("DGS10"));
  assert.ok(defaultSymbols.includes("T10Y2Y"));
  assert.ok(defaultSymbols.includes("VIX"));
  assert.ok(defaultSymbols.includes("VIX3M"));
  assert.ok(defaultSymbols.includes("VIX9D"));
  assert.ok(defaultSymbols.includes("BTC"));
  assert.ok(defaultSymbols.includes("CSI300A200R"));
  assert.ok(defaultSymbols.includes("HKA200R"));
  assert.equal(defaultSymbols.includes("HYG"), false);
  assert.equal(defaultSymbols.includes("TLT"), false);
  assert.equal(defaultSymbols.includes("SHY"), false);
  assert.equal(defaultSymbols.includes("VXX"), false);
});

test("adds unscored fundamental anchors without changing tactical indicator weights", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const us = model.segments.find((segment) => segment.id === "us");
  const china = model.segments.find((segment) => segment.id === "china");
  const hk = model.segments.find((segment) => segment.id === "hong_kong");

  assert.equal(us.fundamentalAnchor.ok, true);
  assert.equal(us.fundamentalAnchor.metrics.find((metric) => metric.id === "earnings_yield").value, 3.8);
  assert.equal(us.fundamentalAnchor.metrics.find((metric) => metric.id === "erp").value, 3.8 - 4.25);
  assert.equal(china.fundamentalAnchor.title, "CSI 300 基本面锚");
  assert.equal(hk.fundamentalAnchor.title, "HSCEI 基本面锚");
  assert.equal(china.indicators.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.equal(hk.indicators.reduce((sum, item) => sum + item.weight, 0), 100);
});

test("organizes every market into four non-rolled-up pillars", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  for (const segment of model.segments) {
    assert.deepEqual(segment.pillars.map((pillar) => pillar.id), ["price", "stress", "liquidity", "fundamental"]);
    assert.equal(segment.pillars.find((pillar) => pillar.id === "fundamental").score, null);
    assert.equal(segment.pillars.find((pillar) => pillar.id === "fundamental").observationOnly, true);
  }
  const us = model.segments.find((segment) => segment.id === "us");
  assert.deepEqual(us.pillars.find((pillar) => pillar.id === "price").indicators.map((item) => item.id), [
    "us_equity_trend", "us_pct_above_200dma", "us_market_breadth",
  ]);
  assert.deepEqual(us.pillars.find((pillar) => pillar.id === "stress").indicators.map((item) => item.id), [
    "us_credit_spread", "us_rate_expectations", "us_vix_term_structure",
  ]);
});

test("uses smoothed 5D and 20D rate-of-change instead of raw one-day change", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const equityTrend = model.signals.find((indicator) => indicator.id === "us_equity_trend");
  const spyInput = equityTrend.inputs.find((input) => input.symbol === "SPY");

  assert.match(equityTrend.formula, /70%/);
  assert.match(equityTrend.formula, /5D\/20D/);
  assert.equal(spyInput.dayChangePct, -3.5);
  assert.equal(spyInput.roc5 > 0, true);
  assert.equal(spyInput.roc20 > 0, true);
  assert.equal(spyInput.trendDirection, "improving");
  assert.equal(equityTrend.score > 50, true);
});

test("scores credit, rates, VIX term structure, and BTC from native sources", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const credit = model.signals.find((indicator) => indicator.id === "us_credit_spread");
  const rates = model.signals.find((indicator) => indicator.id === "us_rate_expectations");
  const vol = model.signals.find((indicator) => indicator.id === "us_vix_term_structure");
  const btc = model.signals.find((indicator) => indicator.id === "btc_trend");

  assert.deepEqual(credit.inputs.map((input) => input.symbol), ["HY_OAS"]);
  assert.match(credit.sourceName, /FRED|ICE BofA/);
  assert.match(credit.formula, /20D/);
  assert.equal(credit.inputs[0].metricDirection, "lower_is_better");
  assert.deepEqual(rates.inputs.map((input) => input.symbol), ["DGS10", "T10Y2Y"]);
  assert.deepEqual(vol.inputs.map((input) => input.symbol), ["VIX", "VIX3M", "VIX9D"]);
  assert.match(vol.formula, /VIX\/VIX3M/);
  assert.equal(vol.score > 50, true);
  assert.equal(btc.inputs[0].sourceName, "CoinGecko spot BTC via local proxy");
  assert.doesNotMatch(btc.description, /ETF 代理/);
});

test("labels native frequency and as-of date, and scores macro series against their own distribution", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const macro = model.signals.find((indicator) => indicator.id === "china_m1_m2_gap");
  const input = macro.inputs[0];

  assert.equal(input.frequency, "monthly");
  assert.equal(input.asOfDate, "2026-05");
  assert.equal(input.dayChangePct, null);
  assert.equal(input.metricBasis, "historical_distribution");
  assert.match(macro.formula, /历史分布/);
  assert.equal(typeof input.rangePosition, "number");
});

test("builds local score history points for composite and all four blocks", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const point = buildHistoryPoint(model);

  assert.equal(point.timestamp, "2026-06-29T01:00:00Z");
  assert.equal(typeof point.composite, "number");
  assert.deepEqual(Object.keys(point.segments), ["us", "china", "hong_kong", "crypto"]);
  assert.equal(point.segments.us.score, model.segments.find((segment) => segment.id === "us").score);
  assert.equal(point.segments.us.fundamentals.metrics.earnings_yield, 3.8);
  assert.equal(point.segments.china.fundamentals.metrics.roe, 11.8);
  assert.equal(point.segments.hong_kong.fundamentals.metrics.earnings_growth, 3.2);
});

test("applies hysteresis before changing position bands", () => {
  const current = { activeRange: "40-60%", pendingRange: null, pendingCount: 0 };

  const first = applyBandHysteresis(64, current, { buffer: 3, confirmations: 2 });
  assert.equal(first.activeBand.range, "40-60%");
  assert.equal(first.pendingBand.range, "60-80%");
  assert.equal(first.pendingCount, 1);

  const second = applyBandHysteresis(65, first, { buffer: 3, confirmations: 2 });
  assert.equal(second.activeBand.range, "60-80%");
  assert.equal(second.pendingBand, null);
  assert.equal(second.pendingCount, 0);
});

test("scores mainland China separately from Hong Kong/offshore China", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const china = model.segments.find((segment) => segment.id === "china");
  const hongKong = model.segments.find((segment) => segment.id === "hong_kong");
  const weightsById = Object.fromEntries(china.indicators.map((indicator) => [indicator.id, indicator.weight]));
  const hkWeightsById = Object.fromEntries(hongKong.indicators.map((indicator) => [indicator.id, indicator.weight]));
  const totalWeight = china.indicators.reduce((sum, indicator) => sum + indicator.weight, 0);
  const hkTotalWeight = hongKong.indicators.reduce((sum, indicator) => sum + indicator.weight, 0);

  assert.equal(china.weight, 22);
  assert.equal(hongKong.weight, 13);
  assert.equal(totalWeight, 100);
  assert.deepEqual(weightsById, {
    china_a_share: 20,
    china_pct_above_200dma: 15,
    china_m1_m2_gap: 17,
    china_corporate_mlt_credit: 18,
    china_deposit_rotation: 13,
    china_fx_flow: 17,
  });
  assert.equal(hkTotalWeight, 100);
  assert.deepEqual(hkWeightsById, {
    hk_market_trend: 30,
    hk_pct_above_200dma: 20,
    hk_offshore_china_risk: 25,
    hk_offshore_consistency: 25,
  });
  assert.equal(china.availableWeight, 100);
  assert.equal(hongKong.availableWeight, 100);
  assert.ok(china.observationNotes.some((note) => note.title.includes("10Y 国债收益率 + ERP")));
  assert.ok(china.observationNotes.some((note) => note.body.includes("不纳入分数")));
});

test("uses explicit US indicator weights and excludes unavailable 200DMA breadth from the denominator", () => {
  const model = buildMarketModel({ quotes: sampleQuotes, timestamp: "2026-06-29T01:00:00Z" });
  const us = model.segments.find((segment) => segment.id === "us");
  const dmaBreadth = us.indicators.find((indicator) => indicator.id === "us_pct_above_200dma");
  const available = us.indicators.filter((indicator) => Number.isFinite(indicator.score));
  const expectedScore = available.reduce((sum, indicator) => sum + indicator.score * indicator.weight, 0)
    / available.reduce((sum, indicator) => sum + indicator.weight, 0);
  const simpleAverage = available.reduce((sum, indicator) => sum + indicator.score, 0) / available.length;

  assert.equal(us.weight, 45);
  assert.match(us.formula, /可用子指标分数 × 权重/);
  assert.equal(dmaBreadth.weight, 20);
  assert.equal(dmaBreadth.score, null);
  assert.equal(dmaBreadth.status.label, "无数据");
  assert.match(dmaBreadth.formula, /% above 200DMA/);
  assert.match(dmaBreadth.sourceUrl, /^https:\/\//);
  assert.equal(Math.round(us.score * 1000), Math.round(expectedScore * 1000));
  assert.notEqual(Math.round(us.score * 1000), Math.round(simpleAverage * 1000));
});

test("scores direct 200DMA breadth as its percent value when the source is available", () => {
  const quotes = sampleQuotes.map((item) => (
    item.symbol === "SPXA200R"
      ? quote("SPXA200R", "US", 63, 0, 100, 0, "%")
      : item
  ));
  const model = buildMarketModel({ quotes, timestamp: "2026-06-29T01:00:00Z" });
  const dmaBreadth = model.signals.find((indicator) => indicator.id === "us_pct_above_200dma");

  assert.equal(dmaBreadth.score, 63);
  assert.equal(dmaBreadth.status.label, "中性");
});

function quote(symbol, market, price, low52w, high52w, dayChangePct, currency = "USD", historyStart = price, source = null, sourceUrl = null) {
  const history = historyFromValues([historyStart, historyStart * 1.01, historyStart * 1.04, historyStart * 1.08, price]);
  return {
    ok: true,
    symbol,
    market,
    currency,
    price,
    previous_close: price / (1 + dayChangePct / 100),
    day_change_pct: dayChangePct,
    high_52w: high52w,
    low_52w: low52w,
    range_position: ((price - low52w) / (high52w - low52w)) * 100,
    source: source || (market === "CRYPTO" ? "CoinGecko spot BTC via local proxy" : "Tencent Finance via local proxy"),
    source_url: sourceUrl || (market === "CRYPTO"
      ? "https://www.coingecko.com/en/coins/bitcoin"
      : `https://gu.qq.com/${symbol}`),
    timestamp: "2026-06-29T01:00:00Z",
    quote_timestamp: "2026-06-29 09:00:00",
    realtime_status: market === "CRYPTO" ? "snapshot" : "snapshot_or_delayed",
    frequency: market === "CRYPTO" ? "24/7 spot" : "daily",
    as_of_date: "2026-06-29",
    history,
    metric_direction: "higher_is_better",
    metric_basis: "price_range_plus_momentum",
    confidence: 0.92,
  };
}

function fundamentalQuote(symbol, market, universe, earningsYield, pe, roe, growth) {
  return {
    ok: true,
    symbol,
    market,
    currency: "%",
    price: earningsYield,
    source: "TradingView Stock Screener (calculated by local proxy)",
    source_url: "https://www.tradingview.com/markets/stocks-usa/market-movers-all-stocks/",
    timestamp: "2026-06-29T01:00:00Z",
    quote_timestamp: "2026-06-29T01:00:00Z",
    as_of_date: "2026-06-29",
    realtime_status: "fundamental_snapshot_delayed_or_unknown",
    frequency: "daily snapshot; interpret monthly",
    confidence: 0.9,
    fundamentals: {
      universe,
      earnings_yield_pct: earningsYield,
      aggregate_pe_ttm: pe,
      aggregate_pb: 2.5,
      aggregate_roe_pct: roe,
      earnings_growth_weighted_median_pct: growth,
      dividend_yield_weighted_pct: 2.1,
      profitable_market_cap_pct: 92,
      score_status: "history_building_not_scored",
    },
    detail: "Fundamental test snapshot",
  };
}

function seriesQuote(symbol, market, value, score, currency, source, sourceUrl, frequency, metricDirection, values) {
  return {
    ok: true,
    symbol,
    market,
    currency,
    price: value,
    previous_close: null,
    day_change_pct: null,
    high_52w: 100,
    low_52w: 0,
    range_position: score,
    source,
    source_url: sourceUrl,
    timestamp: "2026-06-29T01:00:00Z",
    quote_timestamp: "2026-06-28",
    realtime_status: "official_daily_snapshot",
    frequency,
    as_of_date: "2026-06-28",
    history: historyFromValues(values),
    metric_direction: metricDirection,
    metric_basis: "historical_distribution",
    confidence: 0.95,
  };
}

function unavailableQuote(symbol, market, error) {
  return {
    ok: false,
    symbol,
    market,
    currency: "%",
    source: "S&P 500 % above 200DMA source unavailable",
    source_url: "https://stockcharts.com/h-sc/ui?s=%24SPXA200R",
    timestamp: "2026-06-29T01:00:00Z",
    quote_timestamp: "2026-06-29T01:00:00Z",
    realtime_status: "unavailable",
    error,
  };
}

function macroQuote(symbol, value, score, currency, values) {
  return {
    ok: true,
    symbol,
    market: "CN",
    currency,
    price: value,
    previous_close: null,
    day_change_pct: null,
    high_52w: 100,
    low_52w: 0,
    range_position: score,
    source: "PBOC / SAFE official statistics via local proxy",
    source_url: "https://www.pbc.gov.cn/diaochatongjisi/116219/116319/index.html",
    timestamp: "2026-06-29T01:00:00Z",
    quote_timestamp: "2026-05",
    realtime_status: "official_monthly_snapshot",
    frequency: "monthly",
    as_of_date: "2026-05",
    history: historyFromValues(values, "2026-01"),
    metric_direction: "higher_is_better",
    metric_basis: "historical_distribution",
    confidence: 0.9,
  };
}

function historyFromValues(values, startMonth = null) {
  return values.map((value, index) => ({
    date: startMonth ? `2026-${String(index + 1).padStart(2, "0")}` : `2026-06-${String(25 + index).padStart(2, "0")}`,
    value,
  }));
}
