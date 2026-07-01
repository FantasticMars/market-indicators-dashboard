# GitHub Pages Static Snapshot Deployment

This is the recommended free-first deployment path.

## What It Runs

- GitHub Pages hosts the static dashboard files.
- GitHub Actions runs `scripts/generate-static-snapshot.mjs` once per day.
- The snapshot builder uses `server.py` to fetch market data, then uses `model.js` to compute the dashboard score history.
- Hosted pages read:
  - `data/latest.json`
  - `data/history.json`

No always-on backend is required.

## GitHub Settings

1. Open the repository on GitHub.
2. Go to `Settings` -> `Pages`.
3. Set the build/deploy source to `GitHub Actions` if GitHub asks for a source.
4. Open the `Actions` tab.
5. Run `Daily Snapshot Pages` manually once, or wait for the next scheduled run.

## Schedule

The workflow runs at:

```text
22:30 UTC every day
06:30 Asia/Shanghai every day
```

This is after the US cash session close. Some official daily/monthly sources may still publish with their own delay; the UI keeps each indicator's native frequency and as-of date visible.

## Manual Refresh

In GitHub:

1. Open `Actions`.
2. Select `Daily Snapshot Pages`.
3. Click `Run workflow`.

This refreshes the deployed `data/latest.json` without running a paid cloud server.

## History Persistence

Before generating a new snapshot, the workflow tries to download the currently deployed `data/history.json` from GitHub Pages. If it exists, the new point is appended or replaces the point for the same UTC date.

If this download fails on the first run, the workflow starts a new history file with the latest point.

## Local Development

Local development can still use the existing API mode:

```bash
python3 server.py
```

Then open:

```text
http://127.0.0.1:8787/index.html
```

Hosted domains automatically use static mode through `DATA_MODE: "auto"` in `config.js`.
