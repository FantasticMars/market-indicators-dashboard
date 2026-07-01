import test from "node:test";
import assert from "node:assert/strict";
import {
  dataMode,
  normalizeHistoryPayload,
  staticDataUrl,
} from "../app.js";

test("auto runtime uses API on local development hosts", () => {
  assert.equal(dataMode({ DATA_MODE: "auto" }, { protocol: "http:", hostname: "127.0.0.1" }), "api");
  assert.equal(dataMode({ DATA_MODE: "auto" }, { protocol: "http:", hostname: "localhost" }), "api");
});

test("auto runtime uses static snapshots on hosted domains and file URLs", () => {
  assert.equal(dataMode({ DATA_MODE: "auto" }, { protocol: "https:", hostname: "fantasticmars.github.io" }), "static");
  assert.equal(dataMode({ DATA_MODE: "auto" }, { protocol: "file:", hostname: "" }), "static");
});

test("explicit runtime config overrides auto detection", () => {
  assert.equal(dataMode({ DATA_MODE: "static" }, { protocol: "http:", hostname: "127.0.0.1" }), "static");
  assert.equal(dataMode({ DATA_MODE: "api" }, { protocol: "https:", hostname: "fantasticmars.github.io" }), "api");
});

test("static data URLs can point at the same origin or a configured base URL", () => {
  assert.equal(staticDataUrl("latest.json", {}), "data/latest.json");
  assert.equal(staticDataUrl("/history.json", { DATA_BASE_URL: "https://cdn.example.com/snapshots/" }), "https://cdn.example.com/snapshots/history.json");
});

test("history payload normalization accepts both wrapped and array payloads", () => {
  const point = { timestamp: "2026-07-01T00:00:00Z", composite: 55, segments: {} };

  assert.deepEqual(normalizeHistoryPayload({ points: [point] }), [point]);
  assert.deepEqual(normalizeHistoryPayload([point]), [point]);
  assert.deepEqual(normalizeHistoryPayload(null), []);
});
