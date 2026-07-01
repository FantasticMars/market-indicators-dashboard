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
- China: `SHCOMP`, `CSI300`, `CN_M1_M2_GAP`, `CN_CORP_MLT_LOAN_YOY`, `CN_HOUSEHOLD_NBFI_DEPOSIT_GAP`, `CN_FX_SETTLEMENT_FLOW`
- Hong Kong / offshore China: `HSI`, `FXI`, `KWEB`
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
- S&P 500 % above 200DMA, 20%: direct breadth slot; currently unavailable from this environment
- US equal-weight breadth proxy, 13%: RSP versus SPY
- HY OAS credit spread, 18%: FRED `BAMLH0A0HYM2`; lower/widening spreads are scored as risk-off
- Real rate/curve signal, 12%: FRED `DGS10` and `T10Y2Y`
- VIX term structure, 15%: CBOE VIX/VIX3M and VIX9D stress
- China:
  - A-share trend, 25%: SHCOMP and CSI300
  - M1-M2 growth gap, 20%: PBOC money supply table
  - Corporate mid/long loan YoY, 20%: PBOC RMB credit funds table
  - Household vs NBFI deposit gap, 15%: PBOC RMB credit funds table
  - FX settlement surplus + CNY, 20%: SAFE bank settlement time series plus PBOC exchange rate table
- Hong Kong / offshore China:
  - Hong Kong market trend, 35%: HSI
  - Offshore China risk appetite, 35%: FXI and KWEB
  - Hong Kong / China ADR consistency, 30%: HSI, FXI, KWEB
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

Each refresh appends composite and four block scores to `market-history.json`. The UI renders sparklines plus 1D/5D deltas from that local history.

Position-band changes use hysteresis: the raw score must cross a boundary by 3 points and hold for 2 consecutive refreshes before the displayed band changes. During confirmation, the UI shows a pending band change.

## China Macro Sources

- M1-M2 growth gap: PBOC `货币供应量` xlsx, using latest M1 and M2 balances versus the same month last year.
- Corporate mid/long loan YoY: PBOC `金融机构人民币信贷收支表` xlsx, using `企（事）业单位贷款 / 中长期贷款`.
- Household vs NBFI deposit gap: PBOC `金融机构人民币信贷收支表` xlsx, comparing monthly change in `非银行业金融机构存款` versus `住户存款`.
- FX settlement surplus + CNY: SAFE `银行结售汇数据时间序列` xlsx and PBOC `汇率报表` xlsx.
- 10Y government bond yield + ERP: PBOC has `中债国债收益统计表`, but ERP needs a stable verified earnings-yield or PE data source. It is shown as a China detail-page observation note and is not included in scoring.

## 200DMA Breadth Limitation

`SPXA200R` is reserved for S&P 500 `% above 200DMA`. During setup, the local market-data/yfinance route returned no quote or history for `^SPXA200R`. StockCharts was blocked from this environment, and Yahoo's direct endpoint was rate limited. The dashboard therefore shows this indicator as unavailable and does not include it in the US score until a reachable data source or paid vendor is configured.

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

## GitHub And Cloud Deployment

The project is prepared for a private GitHub repository and China-cloud deployment.

Recommended production shape:

- GitHub private repository for version control and deployment source.
- Alibaba Cloud SAE backend using the included `Dockerfile`.
- Tencent CloudBase static hosting for the frontend pages.
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
- `deploy/aliyun-sae.md`
- `deploy/cloudbase.md`
