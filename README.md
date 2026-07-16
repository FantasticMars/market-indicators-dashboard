# Market Indicators

HTML-based market health dashboard for monitoring broad risk appetite and position-sizing signals.

## Run

```bash
cd "Market Indicators"
python3 server.py
```

Then open:

```text
http://127.0.0.1:8787
```

Local mode uses:

```text
HOST=127.0.0.1
PORT=8787
```

Cloud mode can override these with environment variables.

Standalone detail pages:

- `http://127.0.0.1:8787/us.html`
- `http://127.0.0.1:8787/china.html`
- `http://127.0.0.1:8787/hong-kong.html`
- `http://127.0.0.1:8787/crypto.html`

## Data Source

The default proxy reads free Tencent Finance quote snapshots from a local Python server, plus official monthly China macro tables from PBOC and SAFE, CBOE delayed volatility quotes, FRED CSV macro/credit series, and 24/7 BTC spot data.

- Source shown in the UI: `Tencent Finance via local proxy`
- Real-time label shown in the UI: `snapshot_or_delayed`
- China macro labels shown in the UI: `PBOC / SAFE official statistics via local proxy`, `official_monthly_snapshot`
- US credit/rate labels shown in the UI: FRED CSV series, daily official snapshot when reachable
- VIX labels shown in the UI: CBOE delayed quotes, daily delayed snapshot
- BTC labels shown in the UI: CoinGecko spot first, Coinbase spot fallback
- Every refresh displays source timestamp and coverage
- Each indicator shows native frequency, as-of date, and confidence
- Failed symbols are shown as failures; the dashboard does not fabricate current prices

Free market data should be treated as delayed/snapshot data. For trading-grade live data, replace the proxy in `server.py` with a paid data vendor such as Polygon, FactSet, Bloomberg, Refinitiv, IEX Cloud, or another provider that covers your required markets.

## Default Watchlist

The initial dashboard is organized into four panels:

- United States: `SPY`, `QQQ`, `IWM`, `RSP`, `SPXA200R`, `HY_OAS`, `DGS10`, `T10Y2Y`, `VIX`, `VIX3M`, `VIX9D`
- China: `SHCOMP`, `CSI300`, `CSI300A200R`, `CN_M1_M2_GAP`, `CN_CORP_MLT_LOAN_YOY`, `CN_HOUSEHOLD_NBFI_DEPOSIT_GAP`, `CN_FX_SETTLEMENT_FLOW`
- Hong Kong / offshore China: `HSI`, `HKA200R`, `FXI`, `KWEB`
- Crypto / BTC: `BTC`, mapped to 24/7 spot BTC through CoinGecko or Coinbase fallback

The homepage is a compact dashboard. Each standalone panel page can be expanded down to indicator inputs. Each input shows value, 5D/20D ROC when history is available, level score, native frequency, as-of date, confidence, source link, and data detail.

## Scoring Framework

The health score is a weighted average of the four panels:

- United States: 45%
- China: 22%
- Hong Kong / offshore China: 13%
- Crypto / BTC: 20%

Panel indicators include:

- Price-style indicators use `70% level + 30% 5D/20D ROC and slope`. Single-day percent change is displayed but no longer directly drives regime scores.
- Macro/series indicators use their own historical distribution rather than a price-style 52-week range.
- US equity trend, 22%: SPY/QQQ/IWM level plus 5D/20D ROC
- S&P 500 % above 200DMA, 20%: calculated from TradingView scanner close and SMA200 fields for current S&P 500 constituents
- US equal-weight breadth proxy, 13%: RSP versus SPY
- HY OAS credit spread, 18%: FRED `BAMLH0A0HYM2`; lower/widening spreads are scored as risk-off
- Real rate/curve signal, 12%: FRED `DGS10` and `T10Y2Y`
- VIX term structure, 15%: CBOE VIX/VIX3M and VIX9D stress
- China:
  - A-share trend, 20%: SHCOMP and CSI300
  - CSI 300 % above 200DMA, 15%: calculated breadth from current index constituents
  - M1-M2 growth gap, 17%: PBOC money supply table
  - Corporate mid/long loan YoY, 18%: PBOC RMB credit funds table
  - Household vs NBFI deposit gap, 13%: PBOC RMB credit funds table
  - FX settlement surplus + CNY, 17%: SAFE bank settlement time series plus PBOC exchange rate table
- Hong Kong / offshore China:
  - Hong Kong market trend, 30%: HSI
  - Hong Kong primary common stocks % above 200DMA, 20%: broad-market breadth, not Hang Seng or pure H-share constituents
  - Offshore China risk appetite, 25%: FXI and KWEB
  - Hong Kong / China ADR consistency, 25%: HSI, FXI, KWEB
- BTC spot trend, smoothed momentum, and drawdown pressure using 24/7 spot data

Each panel score uses:

```text
Panel score = Σ(available indicator score × indicator weight) / Σ(available indicator weight)
```

The total health score uses:

```text
Total score = United States × 45% + China × 22% + Hong Kong / offshore China × 13% + Crypto / BTC × 20%
```

If a source fails, that signal is excluded from the weighted average denominator and the coverage status is lowered. The UI shows available weight versus total intended weight.

In local API mode, each refresh appends composite and four block scores to `market-history.json`. In GitHub Pages static mode, GitHub Actions writes the same structure to `data/history.json`. The UI renders sparklines plus 1D/5D deltas from that history.

Position-band changes use hysteresis: the raw score must cross a boundary by 3 points and hold for 2 consecutive refreshes before the displayed band changes. During confirmation, the UI shows a pending band change.

## China Macro Sources

- M1-M2 growth gap: PBOC `货币供应量` xlsx, using latest M1 and M2 balances versus the same month last year.
- Corporate mid/long loan YoY: PBOC `金融机构人民币信贷收支表` xlsx, using `企（事）业单位贷款 / 中长期贷款`.
- Household vs NBFI deposit gap: PBOC `金融机构人民币信贷收支表` xlsx, comparing monthly change in `非银行业金融机构存款` versus `住户存款`.
- FX settlement surplus + CNY: SAFE `银行结售汇数据时间序列` xlsx and PBOC `汇率报表` xlsx.
- 10Y government bond yield + ERP: PBOC has `中债国债收益统计表`, but ERP needs a stable verified earnings-yield or PE data source. It is shown as a China detail-page observation note and is not included in scoring.

## 200DMA Breadth Sources and Method

The dashboard calculates breadth directly from TradingView Stock Screener rows instead of requesting the unsupported Yahoo-style `^SPXA200R` symbol. For each eligible security, it compares the scanner's `close` with `SMA200`, then reports `count(close > SMA200) / count(valid close and SMA200)`.

- `SPXA200R`: S&P 500 constituent group (`SP:SPX`).
- `CSI300A200R`: CSI 300 constituent group (`SSE:000300`).
- `HKA200R`: primary common stocks listed in Hong Kong. TradingView's scanner did not return a usable Hang Seng constituent group during verification, so this is explicitly a broad Hong Kong market measure rather than a Hang Seng or pure H-share measure.

These are daily scanner snapshots with delayed/unknown real-time status, not trading-grade live feeds. Each response includes the valid-security numerator/denominator, retrieval timestamp, source link, and an explicit failure state if the scanner is unavailable.

## FRED Limitation

FRED CSV is configured for:

- HY OAS: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2`
- 10Y yield: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10`
- 2s10s curve: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y`

From this current network environment, those FRED requests timed out during verification on June 30, 2026. The dashboard labels the affected indicators as unavailable, excludes them from the US score denominator, and shows the failure in the run log. The code is already wired to use them when the endpoint is reachable.

## Crypto Source

BTC uses CoinGecko spot plus market-chart history first. If CoinGecko rate-limits, Coinbase spot and Coinbase daily candles are used as fallback. IBIT is no longer used as the BTC price.

## Position Framework

The dashboard maps health score to a rule-based exposure band:

- 75-100: 80-100%
- 60-74: 60-80%
- 45-59: 40-60%
- 30-44: 20-40%
- 0-29: 0-25%

This is a rules-based monitoring framework, not personalized investment advice.

## GitHub Pages Static Deployment

The recommended free-first deployment is GitHub Pages plus GitHub Actions daily snapshots.

Recommended production shape:

- GitHub repository for version control and deployment source.
- GitHub Actions runs `scripts/generate-static-snapshot.mjs` once per day, and can also be triggered manually.
- GitHub Pages hosts `index.html`, detail pages, CSS/JS, and `data/latest.json` / `data/history.json`.
- No always-on backend or paid SAE instance is required for daily snapshots.

The hosted dashboard uses `DATA_MODE: "auto"` in `config.js`. Localhost uses API mode, while hosted domains use static snapshot mode.

Static snapshot files:

```text
data/latest.json
data/history.json
```

Deployment guide:

- `deploy/github-pages.md`

## Optional Always-On Cloud Backend

The project can still run as a live backend if needed later.

Optional cloud backend shape:

- Alibaba Cloud SAE backend using the included `Dockerfile`.
- Tencent CloudBase static hosting for frontend pages.
- Optional API protection through `DASHBOARD_ACCESS_TOKEN`.

Cloud backend environment variables:

```text
HOST=0.0.0.0
PORT=8787
MARKET_HISTORY_FILE=/tmp/market-history.json
DASHBOARD_ACCESS_TOKEN=<private-token>
CORS_ALLOWED_ORIGIN=<CloudBase frontend origin>
```

Frontend API configuration is in `config.js`:

```js
window.MARKET_INDICATORS_CONFIG = {
  API_BASE_URL: "",
  ACCESS_TOKEN: "",
};
```

- Keep `API_BASE_URL` empty for local same-origin use.
- Set `API_BASE_URL` to the SAE backend URL when hosting frontend files on CloudBase.
- Keep `ACCESS_TOKEN` empty in committed files. The page will ask for the token and save it on the current device.

Deployment guides:

- `deploy/github-desktop.md`
- `deploy/github-pages.md`
- `deploy/aliyun-sae.md`
- `deploy/cloudbase.md`
