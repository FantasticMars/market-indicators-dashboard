#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INSTRUMENTS,
  buildHistoryPoint,
  buildMarketModel,
} from "../model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

export function mergeHistoryPoints(existingPoints = [], point, limit = 1200) {
  if (!point?.timestamp) return existingPoints.slice(-limit);
  const pointDate = utcDate(point.timestamp);
  const withoutSameDate = existingPoints.filter((existing) => utcDate(existing.timestamp) !== pointDate);
  return [...withoutSameDate, point]
    .filter((item) => item?.timestamp)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit);
}

export function buildStaticDataset(quotesPayload, existingHistory = { points: [] }, instruments = DEFAULT_INSTRUMENTS) {
  const timestamp = quotesPayload.timestamp || new Date().toISOString();
  const latest = {
    ...quotesPayload,
    timestamp,
    generated_at: new Date().toISOString(),
    snapshot_kind: "daily_static_snapshot",
    symbols: instruments.map((instrument) => instrument.symbol),
  };
  const model = buildMarketModel(latest, instruments);
  const point = buildHistoryPoint(model);
  const existingPoints = Array.isArray(existingHistory) ? existingHistory : existingHistory?.points || [];
  const points = mergeHistoryPoints(existingPoints, point);
  return {
    latest,
    history: {
      generated_at: latest.generated_at,
      snapshot_kind: "score_history",
      points,
    },
  };
}

export function writeStaticDataset(dataset, dataDir = resolve(root, "data")) {
  mkdirSync(dataDir, { recursive: true });
  writeJson(resolve(dataDir, "latest.json"), dataset.latest);
  writeJson(resolve(dataDir, "history.json"), dataset.history);
}

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function utcDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return String(timestamp || "").slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const options = {
    dataDir: resolve(root, "data"),
    quotesFile: "",
    python: process.env.PYTHON || "python3",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") options.dataDir = resolve(argv[++index]);
    if (arg === "--quotes-file") options.quotesFile = resolve(argv[++index]);
    if (arg === "--python") options.python = argv[++index];
  }
  return options;
}

function readExistingHistory(dataDir) {
  const path = resolve(dataDir, "history.json");
  if (!existsSync(path)) return { points: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

function readQuotesPayload(options) {
  if (options.quotesFile) {
    return JSON.parse(readFileSync(options.quotesFile, "utf8"));
  }

  const symbols = DEFAULT_INSTRUMENTS.map((instrument) => instrument.symbol).join(",");
  const scriptPath = resolve(root, "scripts", "fetch_quotes_json.py");
  const result = spawnSync(options.python, [scriptPath, "--symbols", symbols], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });
  if (result.status !== 0) {
    throw new Error(`Quote fetch failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

export function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const quotesPayload = readQuotesPayload(options);
  const existingHistory = readExistingHistory(options.dataDir);
  const dataset = buildStaticDataset(quotesPayload, existingHistory);
  writeStaticDataset(dataset, options.dataDir);
  return dataset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
