import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStaticDataset,
  mergeHistoryPoints,
  writeStaticDataset,
} from "../scripts/generate-static-snapshot.mjs";

test("mergeHistoryPoints replaces an existing point for the same UTC date", () => {
  const existing = [
    { timestamp: "2026-06-30T10:00:00Z", composite: 40, segments: {} },
    { timestamp: "2026-07-01T01:00:00Z", composite: 50, segments: {} },
  ];
  const replacement = { timestamp: "2026-07-01T09:00:00Z", composite: 60, segments: {} };

  assert.deepEqual(mergeHistoryPoints(existing, replacement, 10), [existing[0], replacement]);
});

test("buildStaticDataset creates latest quotes and score history from a quote payload", () => {
  const quotesPayload = samplePayload();
  const dataset = buildStaticDataset(quotesPayload, { points: [] }, sampleInstruments());

  assert.equal(dataset.latest.snapshot_kind, "daily_static_snapshot");
  assert.equal(dataset.latest.symbols.length, 4);
  assert.equal(dataset.history.points.length, 1);
  assert.equal(dataset.history.points[0].timestamp, "2026-07-01T00:00:00Z");
  assert.equal(typeof dataset.history.points[0].composite, "number");
  assert.ok(Object.hasOwn(dataset.history.points[0].segments, "us"));
});

test("writeStaticDataset writes GitHub Pages readable JSON files", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "market-static-"));
  const dataset = buildStaticDataset(samplePayload(), { points: [] }, sampleInstruments());

  writeStaticDataset(dataset, dataDir);

  const latest = JSON.parse(readFileSync(join(dataDir, "latest.json"), "utf8"));
  const history = JSON.parse(readFileSync(join(dataDir, "history.json"), "utf8"));
  assert.equal(latest.snapshot_kind, "daily_static_snapshot");
  assert.equal(history.points.length, 1);
});

test("buildStaticDataset reads existing history arrays from disk-compatible payloads", () => {
  const point = { timestamp: "2026-06-30T00:00:00Z", composite: 48, segments: {} };
  const dataset = buildStaticDataset(samplePayload(), [point], sampleInstruments());

  assert.equal(dataset.history.points.length, 2);
  assert.equal(dataset.history.points[0].timestamp, point.timestamp);
});

function samplePayload() {
  return {
    quotes: [
      quote("SPY", "US", 100, 80, 120),
      quote("QQQ", "US", 110, 80, 125),
      quote("IWM", "US", 90, 70, 100),
      quote("BTC", "CRYPTO", 65000, 50000, 75000, "USD", "24/7 spot"),
    ],
    source: "test source",
    timestamp: "2026-07-01T00:00:00Z",
    realtime_status: "daily_snapshot",
  };
}

function sampleInstruments() {
  return [
    { symbol: "SPY", name: "S&P 500 ETF", role: "US large-cap trend", group: "risk", segment: "us" },
    { symbol: "QQQ", name: "Nasdaq 100 ETF", role: "Growth leadership", group: "risk", segment: "us" },
    { symbol: "IWM", name: "Russell 2000 ETF", role: "Small-cap breadth", group: "risk", segment: "us" },
    { symbol: "BTC", name: "Bitcoin spot", role: "24/7 BTC spot risk", group: "crypto", segment: "crypto" },
  ];
}

function quote(symbol, market, price, low52w, high52w, currency = "USD", frequency = "daily") {
  return {
    ok: true,
    symbol,
    market,
    currency,
    price,
    previous_close: price * 0.99,
    day_change_pct: 1,
    high_52w: high52w,
    low_52w: low52w,
    range_position: ((price - low52w) / (high52w - low52w)) * 100,
    source: "test source",
    source_url: "https://example.com",
    timestamp: "2026-07-01T00:00:00Z",
    quote_timestamp: "2026-07-01",
    realtime_status: "daily_snapshot",
    frequency,
    as_of_date: "2026-07-01",
    history: [
      { date: "2026-06-27", value: price * 0.94 },
      { date: "2026-06-28", value: price * 0.96 },
      { date: "2026-06-29", value: price * 0.98 },
      { date: "2026-06-30", value: price * 0.99 },
      { date: "2026-07-01", value: price },
    ],
    metric_direction: "higher_is_better",
    metric_basis: "price_range_plus_momentum",
    confidence: 0.9,
  };
}
