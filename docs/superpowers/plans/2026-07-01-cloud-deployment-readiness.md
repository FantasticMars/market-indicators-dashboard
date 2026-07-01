# Cloud Deployment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Market Indicators for private GitHub version control and stable China-cloud deployment.

**Architecture:** Keep the current Python server and HTML dashboard intact, then add cloud runtime configuration, optional API token protection, cross-origin support for a CloudBase-hosted frontend, and deployment docs for Alibaba Cloud SAE plus Tencent CloudBase. Preserve local `python3 server.py` usage.

**Tech Stack:** Python standard library HTTP server, vanilla HTML/CSS/JavaScript, Dockerfile for SAE container deployment, GitHub Desktop for first-time repository management.

---

### Task 1: Runtime Configuration

**Files:**
- Modify: `server.py`
- Test: `tests/test_server_sources.py`

- [ ] Add tests for environment-derived bind host, port, history path, CORS headers, and optional token authorization.
- [ ] Implement helpers so local defaults remain `127.0.0.1:8787`, while cloud deployments can set `HOST=0.0.0.0` and `PORT`.
- [ ] Add optional `DASHBOARD_ACCESS_TOKEN` support for API endpoints.
- [ ] Add optional `CORS_ALLOWED_ORIGIN` support for CloudBase frontend calls.

### Task 2: Frontend API Configuration

**Files:**
- Create: `config.js`
- Modify: `index.html`, `us.html`, `china.html`, `hong-kong.html`, `crypto.html`, `app.js`

- [ ] Load `config.js` before `app.js`.
- [ ] Let API calls use `window.MARKET_INDICATORS_CONFIG.API_BASE_URL` when deployed separately.
- [ ] Store a per-device access token in browser localStorage when the backend returns 401.

### Task 3: GitHub And Deployment Files

**Files:**
- Create: `.gitignore`, `.dockerignore`, `Dockerfile`, `requirements.txt`
- Create: `deploy/github-desktop.md`, `deploy/aliyun-sae.md`, `deploy/cloudbase.md`
- Modify: `README.md`

- [ ] Ignore generated caches, local history, and local secrets.
- [ ] Add a container entrypoint compatible with Alibaba Cloud SAE.
- [ ] Document GitHub Desktop private-repo setup.
- [ ] Document SAE backend deployment and CloudBase static frontend deployment.

### Task 4: Verification

**Files:**
- Test: `tests/*.test.mjs`, `tests/test_server_sources.py`

- [ ] Run Python unit tests.
- [ ] Run Node dashboard tests.
- [ ] Run syntax checks for `server.py`, `app.js`, and `model.js`.
- [ ] Report exact next steps for the user's GitHub Desktop flow.
