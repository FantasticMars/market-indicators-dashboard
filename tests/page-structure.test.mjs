import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("dashboard homepage is compact and links to standalone segment pages", () => {
  const html = readFileSync(resolve(root, "index.html"), "utf8");

  assert.match(html, /data-page="dashboard"/);
  assert.match(html, /href="us.html"/);
  assert.match(html, /href="china.html"/);
  assert.match(html, /href="hong-kong.html"/);
  assert.match(html, /href="crypto.html"/);
  assert.match(html, /id="frameworkMatrix"/);
  assert.match(html, /class="sidebar"/);
  assert.match(html, /href="settings.html"/);
  assert.doesNotMatch(html, /id="healthScore"/);
  assert.doesNotMatch(html, /每个板块都可以展开查看底层指标/);
});

test("standalone segment detail pages declare the segment they render", () => {
  for (const [file, segmentId] of [
    ["us.html", "us"],
    ["china.html", "china"],
    ["hong-kong.html", "hong_kong"],
    ["crypto.html", "crypto"],
  ]) {
    const path = resolve(root, file);
    assert.equal(existsSync(path), true, `${file} should exist`);
    const html = readFileSync(path, "utf8");
    assert.match(html, /data-page="segment-detail"/);
    assert.match(html, new RegExp(`data-segment-id="${segmentId}"`));
    assert.match(html, /id="segmentDetail"/);
  }
});

test("all app pages load cloud runtime config before app module", () => {
  for (const file of ["index.html", "us.html", "china.html", "hong-kong.html", "crypto.html", "settings.html"]) {
    const html = readFileSync(resolve(root, file), "utf8");
    const configIndex = html.indexOf('src="config.js"');
    const appIndex = html.indexOf('src="app.js"');

    assert.notEqual(configIndex, -1, `${file} should load config.js`);
    assert.notEqual(appIndex, -1, `${file} should load app.js`);
    assert.ok(configIndex < appIndex, `${file} should load config.js before app.js`);
  }
});
