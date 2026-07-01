# Alibaba Cloud SAE Backend Deployment

Use SAE for the Python backend. Prefer Hong Kong or Singapore region because the dashboard reads overseas financial sources such as FRED, CBOE, CoinGecko, and Coinbase.

## Deployment Shape

- Runtime: Docker image
- Entrypoint: `python3 server.py`
- Service port: `8787`
- Health URL: `/index.html`

## Environment Variables

Set these in SAE:

```text
HOST=0.0.0.0
PORT=8787
MARKET_HISTORY_FILE=/tmp/market-history.json
DASHBOARD_ACCESS_TOKEN=<choose-a-long-private-token>
CORS_ALLOWED_ORIGIN=<your-cloudbase-frontend-origin>
```

Notes:

- `DASHBOARD_ACCESS_TOKEN` protects API calls.
- `CORS_ALLOWED_ORIGIN` should be the CloudBase static website origin, for example `https://xxxx.tcloudbaseapp.com`.
- `/tmp/market-history.json` is acceptable for an initial deployment, but it can be lost when the container is recreated. For durable long-term score history, move history storage to a database or mounted storage.

## GitHub-Based Deployment

1. Push this repository to GitHub as a private repository.
2. In SAE, create an application from image build or source build.
3. Connect the GitHub repository.
4. Use the included `Dockerfile`.
5. Confirm the exposed container port is `8787`.
6. Add the environment variables above.
7. Deploy.

## After Deployment

Open the SAE public URL:

```text
https://<sae-backend-domain>/index.html
```

If the page asks for a token, enter the same value configured in `DASHBOARD_ACCESS_TOKEN`.

## Production Upgrade Path

For a more durable version:

- Add a custom domain with HTTPS.
- Move `market-history.json` to a persistent database.
- Add scheduled refresh jobs so users do not wait on cold data.
- Add alerting for failed upstream sources.
