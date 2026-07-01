# Static Snapshot Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free-first GitHub Pages deployment path that serves static dashboard files and daily generated market snapshots.

**Architecture:** Keep `server.py` as the market data fetcher, keep `model.js` as the scoring source of truth, and add a snapshot builder that writes `data/latest.json` plus `data/history.json`. The browser chooses API or static mode from `config.js` and the current host.

**Tech Stack:** HTML/CSS/JavaScript ES modules, Python standard library, Node.js test runner, GitHub Actions, GitHub Pages.

---

### Task 1: Static Runtime Selection

**Files:**
- Modify: `config.js`
- Modify: `app.js`
- Test: `tests/static-runtime.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that verify hosted pages default to static mode, localhost defaults to API mode, and configured values override auto-detection.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test tests/static-runtime.test.mjs`

- [ ] **Step 3: Implement runtime helpers**

Export testable helpers from `app.js` for choosing `api` versus `static`, building static data URLs, and normalizing history payloads.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/static-runtime.test.mjs`

### Task 2: Snapshot Builder

**Files:**
- Create: `scripts/fetch_quotes_json.py`
- Create: `scripts/generate-static-snapshot.mjs`
- Create: `data/latest.json`
- Create: `data/history.json`
- Test: `tests/static-snapshot.test.mjs`

- [ ] **Step 1: Write failing tests**

Add tests that feed fixture quote data into the snapshot builder and assert that it writes a latest quote file plus a daily de-duplicated history file.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test tests/static-snapshot.test.mjs`

- [ ] **Step 3: Implement the scripts**

Use Python only for quote retrieval and JavaScript only for model scoring/history generation.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/static-snapshot.test.mjs`

### Task 3: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Create: `deploy/github-pages.md`

- [ ] **Step 1: Add workflow checks**

Extend syntax checks to include the new scripts.

- [ ] **Step 2: Add Pages workflow**

Generate a snapshot, upload the static site artifact, and deploy to Pages on schedule, manual dispatch, and pushes to `main`.

- [ ] **Step 3: Update docs**

Document the free static architecture, how to enable GitHub Pages, and how to trigger a manual refresh.

- [ ] **Step 4: Verify**

Run: `python -B -m unittest tests.test_server_sources`

Run: `node --test tests/*.test.mjs`

Run: `node --check app.js && node --check model.js && node --check scripts/generate-static-snapshot.mjs`
