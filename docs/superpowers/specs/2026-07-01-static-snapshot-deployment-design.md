# Static Snapshot Deployment Design

## Goal

Replace the always-on cloud backend deployment path with a free-first static dashboard that updates market data once per day and can also be refreshed manually from GitHub Actions.

## Architecture

The browser should render the same dashboard UI and scoring model, but deployed pages should read static JSON files instead of calling a live backend. Local development keeps the existing `server.py` API path so the project remains easy to test and extend.

## Data Flow

1. A scheduled GitHub Actions workflow runs once per day.
2. The workflow runs a Node snapshot builder.
3. The Node builder asks the existing Python quote proxy to fetch the default symbols.
4. The builder calls the existing JavaScript scoring model to append one daily score-history point.
5. The workflow publishes HTML, CSS, JS, and `data/*.json` to GitHub Pages.
6. On GitHub Pages, the browser loads `data/latest.json` and `data/history.json`.

## Runtime Modes

- `api`: force `/api/quotes` and `/api/history`, useful for local backend testing.
- `static`: force `data/latest.json` and `data/history.json`, useful for GitHub Pages.
- `auto`: use API on `localhost` / `127.0.0.1`, and static data on hosted domains.

## Cost Model

No always-on cloud service is required. GitHub Pages serves static files, and GitHub Actions generates data on a schedule or manual trigger. If the repository stays public, this should be effectively free for this dashboard use case.

## User-Visible Behavior

The top controls should say daily snapshot instead of live auto-refresh when static mode is active. The refresh button reloads the latest published JSON; it does not fetch live market sources directly from the browser.

## Error Handling

If static JSON is missing or invalid, the dashboard shows a clear data-read failure. If any upstream market source fails during snapshot generation, the existing quote error rows are preserved and the affected indicators are excluded from score denominators.

## Deployment

GitHub Actions should include:

- CI checks for Python and Node tests.
- A scheduled workflow at a daily UTC time that maps to a reasonable morning refresh for Asia/Shanghai.
- Manual `workflow_dispatch`.
- GitHub Pages artifact upload and deployment.
