#!/usr/bin/env python3
"""Local static server and market-data proxy for Market Indicators."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import ssl
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Any
from xml.etree import ElementTree
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
SOURCE = "Tencent Finance via local proxy"
REALTIME_STATUS = "snapshot_or_delayed"
TIMEOUT_SECONDS = 4
MAX_SOURCE_WORKERS = 8
QUOTE_CACHE_SECONDS = 45
TLS_FALLBACK_NOTE = "TLS verification fallback"
SPXA200R_SOURCE = "S&P 500 % above 200DMA source unavailable"
SPXA200R_SOURCE_URL = "https://stockcharts.com/h-sc/ui?s=%24SPXA200R"
CHINA_MACRO_SOURCE = "PBOC / SAFE official statistics via local proxy"
CHINA_MACRO_STATUS = "official_monthly_snapshot"
HISTORY_FILE = ROOT / "market-history.json"
PBC_BASE = "https://www.pbc.gov.cn"
SAFE_BASE = "https://www.safe.gov.cn"
FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
CBOE_BASE = "https://cdn.cboe.com/api/global/delayed_quotes/quotes"
COINGECKO_SIMPLE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true"
COINGECKO_CHART_URL = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90&interval=daily"
COINBASE_BTC_SPOT_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot"
COINBASE_BTC_CANDLES_URL = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RELS_NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
MACRO_CACHE: dict[str, Any] = {"timestamp": None, "quotes": None}
MACRO_CACHE_SECONDS = 30 * 60
QUOTE_CACHE: dict[str, Any] = {"key": None, "timestamp": None, "payload": None}
QUOTE_CACHE_LOCK = Lock()

PBC_CATEGORY_URLS = {
    2026: {
        "money": f"{PBC_BASE}/diaochatongjisi/116219/116319/2026ntjsj/hbtjgl/index.html",
        "credit": f"{PBC_BASE}/diaochatongjisi/116219/116319/2026ntjsj/jrjgxdsztj/index.html",
        "market": f"{PBC_BASE}/diaochatongjisi/116219/116319/2026ntjsj/jrsctj/index.html",
    },
    2025: {
        "money": f"{PBC_BASE}/diaochatongjisi/116219/116319/5570903/5570886/index.html",
        "credit": f"{PBC_BASE}/diaochatongjisi/116219/116319/5570903/5570888/index.html",
        "market": f"{PBC_BASE}/diaochatongjisi/116219/116319/5570903/5570889/index.html",
    },
}

CHINA_MACRO_SYMBOLS = {
    "CN_M1_M2_GAP",
    "CN_CORP_MLT_LOAN_YOY",
    "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP",
    "CN_FX_SETTLEMENT_FLOW",
}

FRED_SERIES = {
    "HY_OAS": {
        "series": "BAMLH0A0HYM2",
        "name": "ICE BofA US High Yield OAS",
        "currency": "%",
        "direction": "lower_is_better",
        "url": "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    },
    "DGS10": {
        "series": "DGS10",
        "name": "10Y Treasury yield",
        "currency": "%",
        "direction": "lower_is_better",
        "url": "https://fred.stlouisfed.org/series/DGS10",
    },
    "T10Y2Y": {
        "series": "T10Y2Y",
        "name": "10Y-2Y Treasury spread",
        "currency": "ppt",
        "direction": "higher_is_better",
        "url": "https://fred.stlouisfed.org/series/T10Y2Y",
    },
}

CBOE_SYMBOLS = {
    "VIX": "_VIX",
    "VIX3M": "_VIX3M",
    "VIX9D": "_VIX9D",
}

CHINA_MACRO_SOURCE_URLS = {
    "CN_M1_M2_GAP": PBC_CATEGORY_URLS[2026]["money"],
    "CN_CORP_MLT_LOAN_YOY": PBC_CATEGORY_URLS[2026]["credit"],
    "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP": PBC_CATEGORY_URLS[2026]["credit"],
    "CN_FX_SETTLEMENT_FLOW": "https://www.safe.gov.cn/safe/2023/0215/22329.html",
}

TENCENT_SYMBOLS = {
    "SPY": "usSPY",
    "QQQ": "usQQQ",
    "IWM": "usIWM",
    "RSP": "usRSP",
    "HYG": "usHYG",
    "TLT": "usTLT",
    "SHY": "usSHY",
    "GLD": "usGLD",
    "UUP": "usUUP",
    "FXI": "usFXI",
    "KWEB": "usKWEB",
    "VXX": "usVXX",
    "UVXY": "usUVXY",
    "SVXY": "usSVXY",
    "IBIT": "usIBIT",
    "SPX": "usINX",
    "NDX": "usIXIC",
    "DJI": "usDJI",
    "SHCOMP": "sh000001",
    "CSI300": "sh000300",
    "SZCOMP": "sz399001",
    "HSI": "hkHSI",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def parse_symbols(query: dict[str, list[str]]) -> list[str]:
    raw = ",".join(query.get("symbols", [""]))
    symbols = [item.strip().upper() for item in raw.replace(";", ",").split(",") if item.strip()]
    return list(dict.fromkeys(symbols))


def remote_symbol(symbol: str) -> str:
    upper = symbol.upper()
    if upper in TENCENT_SYMBOLS:
        return TENCENT_SYMBOLS[upper]
    if upper.startswith(("SH", "SZ", "HK", "US")):
        return symbol
    return f"us{upper}"


def fetch_text(url: str, encoding: str = "utf-8") -> tuple[str, str | None]:
    try:
        return read_url(url, encoding=encoding), None
    except URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        context = ssl._create_unverified_context()
        return read_url(url, context=context, encoding=encoding), TLS_FALLBACK_NOTE


def fetch_bytes(url: str) -> tuple[bytes, str | None]:
    try:
        return read_url_bytes(url), None
    except URLError as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        context = ssl._create_unverified_context()
        return read_url_bytes(url, context=context), TLS_FALLBACK_NOTE


def read_url(url: str, context: ssl.SSLContext | None = None, encoding: str = "utf-8") -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "MarketIndicators/1.0 local dashboard",
            "Accept": "text/plain,*/*",
        },
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS, context=context) as response:
        return response.read().decode(encoding, errors="replace")


def read_url_bytes(url: str, context: ssl.SSLContext | None = None) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": "MarketIndicators/1.0 local dashboard",
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
        },
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS, context=context) as response:
        return response.read()


def fetch_json(url: str) -> tuple[dict[str, Any], str | None]:
    text, transport_note = fetch_text(url)
    return json.loads(text), transport_note


def source_label(transport_note: str | None = None) -> str:
    return f"{SOURCE} ({transport_note})" if transport_note else SOURCE


def bind_address(env: dict[str, str] | None = None) -> tuple[str, int]:
    env = env or os.environ
    host = env.get("HOST", DEFAULT_HOST).strip() or DEFAULT_HOST
    raw_port = env.get("PORT", str(DEFAULT_PORT)).strip() or str(DEFAULT_PORT)
    try:
        port = int(raw_port)
    except ValueError:
        port = DEFAULT_PORT
    return host, port


def history_file_path(env: dict[str, str] | None = None) -> Path:
    env = env or os.environ
    configured = env.get("MARKET_HISTORY_FILE", "").strip()
    return Path(configured).expanduser() if configured else HISTORY_FILE


def access_token(env: dict[str, str] | None = None) -> str:
    env = env or os.environ
    return env.get("DASHBOARD_ACCESS_TOKEN", "").strip()


def request_is_authorized(
    headers: dict[str, str],
    query: dict[str, list[str]],
    env: dict[str, str] | None = None,
) -> bool:
    expected = access_token(env)
    if not expected:
        return True
    header_token = headers.get("X-Dashboard-Token") or headers.get("x-dashboard-token") or ""
    query_token = (query.get("access_token") or [""])[0]
    return header_token == expected or query_token == expected


def cors_headers(origin: str | None, env: dict[str, str] | None = None) -> dict[str, str]:
    env = env or os.environ
    allowed = env.get("CORS_ALLOWED_ORIGIN", "").strip()
    if not origin or not allowed:
        return {}
    allowed_origins = [item.strip() for item in allowed.split(",") if item.strip()]
    if "*" not in allowed_origins and origin not in allowed_origins:
        return {}
    return {
        "Access-Control-Allow-Origin": "*" if "*" in allowed_origins else origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Token",
        "Access-Control-Max-Age": "86400",
    }


def to_number(value: str | None) -> float | None:
    if value is None:
        return None
    cleaned = str(value).replace(",", "").strip()
    if not cleaned or cleaned.upper() == "N/D":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def clone_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(payload))


def cached_quote_payload(symbols: list[str]) -> dict[str, Any] | None:
    key = tuple(symbols)
    with QUOTE_CACHE_LOCK:
        cached_key = QUOTE_CACHE.get("key")
        cached_at = QUOTE_CACHE.get("timestamp")
        cached_payload = QUOTE_CACHE.get("payload")
        if cached_key != key or cached_at is None or cached_payload is None:
            return None
        age = (datetime.now(timezone.utc) - cached_at).total_seconds()
        if age > QUOTE_CACHE_SECONDS:
            return None
        return clone_payload(cached_payload)


def store_quote_payload(symbols: list[str], payload: dict[str, Any]) -> None:
    with QUOTE_CACHE_LOCK:
        QUOTE_CACHE["key"] = tuple(symbols)
        QUOTE_CACHE["timestamp"] = datetime.now(timezone.utc)
        QUOTE_CACHE["payload"] = clone_payload(payload)


def fetch_quotes(symbols: list[str]) -> dict[str, Any]:
    if not symbols:
        return {
            "quotes": [],
            "source": SOURCE,
            "timestamp": now_iso(),
            "realtime_status": REALTIME_STATUS,
        }

    cached = cached_quote_payload(symbols)
    if cached is not None:
        return cached

    tencent_symbols = [symbol for symbol in symbols if not is_special_symbol(symbol)]
    special_symbols = [symbol for symbol in symbols if is_special_symbol(symbol)]
    quotes_by_symbol: dict[str, dict[str, Any]] = {}
    special_quotes_by_symbol: dict[str, dict[str, Any]] = {}
    source = SOURCE if tencent_symbols else "mixed source local proxy"

    worker_count = (1 if tencent_symbols else 0) + (1 if special_symbols else 0)
    if worker_count:
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            tencent_future = executor.submit(fetch_tencent_quotes, tencent_symbols) if tencent_symbols else None
            special_future = executor.submit(fetch_special_quotes, special_symbols) if special_symbols else None

            if tencent_future:
                quotes_by_symbol, source = tencent_future.result()
            if special_future:
                special_quotes_by_symbol = special_future.result()

    quotes = [
        special_quotes_by_symbol.get(symbol, error_quote(symbol, "No special quote returned."))
        if is_special_symbol(symbol)
        else quotes_by_symbol.get(symbol, error_quote(symbol, "No quote returned."))
        for symbol in symbols
    ]

    payload = {
        "quotes": quotes,
        "source": source,
        "timestamp": now_iso(),
        "realtime_status": REALTIME_STATUS if tencent_symbols else CHINA_MACRO_STATUS,
    }
    store_quote_payload(symbols, payload)
    return payload


def fetch_tencent_quotes(symbols: list[str]) -> tuple[dict[str, dict[str, Any]], str]:
    symbol_map = {symbol: remote_symbol(symbol) for symbol in symbols}
    encoded = ",".join(quote(value, safe="") for value in symbol_map.values())
    url = f"https://qt.gtimg.cn/q={encoded}"

    try:
        text, transport_note = fetch_text(url, encoding="gbk")
        source = source_label(transport_note)
        records = parse_tencent_records(text)
        quotes_by_symbol = {
            symbol: parse_tencent_quote(symbol, mapped_symbol, records.get(mapped_symbol), source)
            for symbol, mapped_symbol in symbol_map.items()
        }
        return attach_secondary_quotes(quotes_by_symbol), source
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return {
            symbol: error_quote(symbol, f"Tencent Finance quote request failed: {exc}")
            for symbol in symbols
        }, SOURCE


def parse_tencent_records(text: str) -> dict[str, list[str]]:
    records: dict[str, list[str]] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or "=\"" not in line:
            continue
        key, value = line.split("=\"", 1)
        mapped_symbol = key.removeprefix("v_")
        body = value.rsplit("\"", 1)[0]
        records[mapped_symbol] = body.split("~")
    return records


def parse_tencent_quote(
    symbol: str,
    mapped_symbol: str,
    fields: list[str] | None,
    source: str,
) -> dict[str, Any]:
    if not fields:
        return error_quote(symbol, "No quote row returned from Tencent Finance.")

    price = field_number(fields, 3)
    quote_timestamp = field_text(fields, 30)
    high_52w = high_52w_for_symbol(symbol, mapped_symbol, fields)
    low_52w = low_52w_for_symbol(symbol, mapped_symbol, fields)

    if price is None:
        return error_quote(symbol, "No numeric quote price returned from Tencent Finance.")
    if is_stale_timestamp(quote_timestamp):
        stale = error_quote(symbol, f"Stale quote timestamp returned: {quote_timestamp or 'unknown'}.")
        stale["quote_timestamp"] = quote_timestamp
        return stale

    quote = {
        "ok": True,
        "symbol": symbol,
        "remote_symbol": mapped_symbol,
        "name": name_for_symbol(symbol, mapped_symbol, fields),
        "market": market_for_symbol(symbol),
        "currency": currency_field_for_symbol(symbol, mapped_symbol, fields),
        "price": price,
        "previous_close": field_number(fields, 4),
        "open": field_number(fields, 5),
        "high": field_number(fields, 33),
        "low": field_number(fields, 34),
        "volume": field_number(fields, 6),
        "change": field_number(fields, 31),
        "day_change_pct": field_number(fields, 32),
        "high_52w": high_52w,
        "low_52w": low_52w,
        "range_position": range_position_pct(price, low_52w, high_52w),
        "source": source,
        "source_url": source_url_for_symbol(symbol, mapped_symbol),
        "proxy_note": proxy_note_for_symbol(symbol),
        "timestamp": now_iso(),
        "quote_timestamp": quote_timestamp,
        "realtime_status": REALTIME_STATUS,
        "frequency": "daily",
        "as_of_date": as_of_date(quote_timestamp),
        "metric_direction": "higher_is_better",
        "metric_basis": "price_range_plus_momentum",
        "confidence": 0.75,
    }
    return quote


def fetch_special_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    unique_symbols = list(dict.fromkeys(symbols))
    if not unique_symbols:
        return {}

    results: dict[str, dict[str, Any]] = {}
    macro_symbols = [symbol for symbol in unique_symbols if symbol.upper() in CHINA_MACRO_SYMBOLS]
    other_symbols = [symbol for symbol in unique_symbols if symbol.upper() not in CHINA_MACRO_SYMBOLS]
    worker_count = min(MAX_SOURCE_WORKERS, max(len(other_symbols) + (1 if macro_symbols else 0), 1))

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(special_quote, symbol): symbol for symbol in other_symbols}
        macro_future = executor.submit(china_macro_quotes) if macro_symbols else None

        for future in as_completed(futures):
            symbol = futures[future]
            try:
                results[symbol] = future.result()
            except Exception as exc:
                results[symbol] = error_quote(symbol, f"Special quote failed: {exc}")

        if macro_future:
            try:
                macro_quotes = macro_future.result()
            except Exception as exc:
                macro_quotes = {symbol: macro_error_quote(symbol, f"Official macro data retrieval failed: {exc}") for symbol in macro_symbols}
            for symbol in macro_symbols:
                results[symbol] = macro_quotes.get(symbol.upper()) or macro_error_quote(symbol, "China macro symbol did not return a row.")

    return results


def error_quote(symbol: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "symbol": symbol,
        "market": market_for_symbol(symbol),
        "currency": currency_for_symbol(symbol),
        "source": SOURCE,
        "source_url": source_url_for_symbol(symbol, remote_symbol(symbol)),
        "timestamp": now_iso(),
        "quote_timestamp": now_iso(),
        "as_of_date": today_label(),
        "realtime_status": "failed",
        "frequency": default_frequency(symbol),
        "metric_direction": "higher_is_better",
        "metric_basis": "unavailable",
        "confidence": 0.0,
        "error": message,
    }


def is_special_symbol(symbol: str) -> bool:
    upper = symbol.upper()
    return upper == "SPXA200R" or upper in CHINA_MACRO_SYMBOLS or upper in FRED_SERIES or upper in CBOE_SYMBOLS or upper == "BTC"


def special_quote(symbol: str) -> dict[str, Any]:
    upper = symbol.upper()
    if upper == "SPXA200R":
        return {
            "ok": False,
            "symbol": "SPXA200R",
            "name": "S&P 500 % above 200DMA",
            "market": "US",
            "currency": "%",
            "source": SPXA200R_SOURCE,
            "source_url": SPXA200R_SOURCE_URL,
            "timestamp": now_iso(),
            "quote_timestamp": now_iso(),
            "as_of_date": today_label(),
            "realtime_status": "unavailable",
            "frequency": "daily",
            "metric_direction": "higher_is_better",
            "metric_basis": "unavailable",
            "confidence": 0.0,
            "error": "当前环境无法读取 % above 200DMA：market_data/yfinance 无报价，StockCharts 被阻止，Yahoo 限流；该指标暂不计入综合分。",
        }
    if upper in FRED_SERIES:
        return fred_quote(upper)
    if upper in CBOE_SYMBOLS:
        return cboe_quote(upper)
    if upper == "BTC":
        return btc_spot_quote()
    if upper in CHINA_MACRO_SYMBOLS:
        return china_macro_quotes().get(upper) or macro_error_quote(upper, "China macro symbol did not return a row.")
    return error_quote(symbol, "Special symbol is not configured.")


def fred_quote(symbol: str) -> dict[str, Any]:
    config = FRED_SERIES[symbol]
    start_date = (datetime.now(timezone.utc) - timedelta(days=730)).date().isoformat()
    url = f"{FRED_BASE}?id={config['series']}&cosd={start_date}"
    try:
        csv_text, transport_note = fetch_text(url)
        quote = fred_quote_from_csv(
            symbol,
            csv_text,
            config["series"],
            config["name"],
            config["currency"],
            config["direction"],
            config["url"],
        )
        if transport_note:
            quote["source"] = f"{quote['source']} ({transport_note})"
        return quote
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return error_quote_for_special(symbol, config["name"], config["currency"], config["url"], f"FRED series failed: {exc}")


def fred_quote_from_csv(
    symbol: str,
    csv_text: str,
    series_id: str,
    name: str,
    currency: str,
    metric_direction: str,
    source_url: str,
) -> dict[str, Any]:
    rows = parse_csv_series(csv_text, series_id)
    if not rows:
        raise ValueError(f"No numeric FRED rows for {series_id}")
    latest = rows[-1]
    values = [row["value"] for row in rows[-520:]]
    value = latest["value"]
    return {
        "ok": True,
        "symbol": symbol,
        "name": name,
        "market": "US",
        "currency": currency,
        "price": value,
        "previous_close": rows[-2]["value"] if len(rows) > 1 else None,
        "day_change_pct": percent_change(value, rows[-2]["value"]) if len(rows) > 1 and rows[-2]["value"] else None,
        "high_52w": max(values),
        "low_52w": min(values),
        "range_position": historical_percentile(value, values),
        "source": f"FRED {series_id} via local proxy",
        "source_url": source_url,
        "timestamp": now_iso(),
        "quote_timestamp": latest["date"],
        "as_of_date": latest["date"],
        "realtime_status": "official_daily_snapshot",
        "frequency": "daily",
        "history": rows[-120:],
        "metric_direction": metric_direction,
        "metric_basis": "historical_distribution",
        "confidence": 0.95,
    }


def parse_csv_series(csv_text: str, series_id: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in csv_text.splitlines() if line.strip()]
    if not lines:
        return []
    header = [item.strip() for item in lines[0].split(",")]
    try:
        date_index = header.index("observation_date")
        value_index = header.index(series_id)
    except ValueError as exc:
        raise ValueError(f"Unexpected FRED CSV header: {header}") from exc
    rows: list[dict[str, Any]] = []
    for line in lines[1:]:
        columns = [item.strip() for item in line.split(",")]
        if len(columns) <= max(date_index, value_index):
            continue
        value = to_number(columns[value_index])
        if value is None:
            continue
        rows.append({"date": columns[date_index], "value": value})
    return rows


def cboe_quote(symbol: str) -> dict[str, Any]:
    remote_symbol = CBOE_SYMBOLS[symbol]
    url = f"{CBOE_BASE}/{remote_symbol}.json"
    try:
        payload, transport_note = fetch_json(url)
        quote = cboe_quote_from_json(symbol, payload, url)
        if transport_note:
            quote["source"] = f"{quote['source']} ({transport_note})"
        return quote
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return error_quote_for_special(symbol, symbol, "%", url, f"CBOE delayed quote failed: {exc}")


def cboe_quote_from_json(symbol: str, payload: dict[str, Any], source_url: str) -> dict[str, Any]:
    data = payload.get("data", payload)
    if isinstance(data, list):
        row = data[0] if data else {}
    elif isinstance(data, dict):
        row = data
    else:
        row = {}
    price = first_number(row, ["last_price", "last", "current_price", "price", "close"])
    if price is None:
        price = first_number(payload, ["last_price", "last", "current_price", "price", "close"])
    if price is None:
        raise ValueError("No CBOE price field found")
    as_of = first_text(row, ["trade_time", "last_trade_time", "quote_time", "updated", "as_of"]) or today_label()
    return {
        "ok": True,
        "symbol": symbol,
        "name": f"CBOE {symbol}",
        "market": "US",
        "currency": "%",
        "price": price,
        "previous_close": first_number(row, ["prev_close", "previous_close"]),
        "high_52w": None,
        "low_52w": None,
        "range_position": None,
        "source": "CBOE delayed quotes via local proxy",
        "source_url": source_url,
        "timestamp": now_iso(),
        "quote_timestamp": as_of,
        "as_of_date": as_of_date(as_of),
        "realtime_status": "delayed_snapshot",
        "frequency": "daily",
        "history": [],
        "metric_direction": "lower_is_better",
        "metric_basis": "level_plus_term_structure",
        "confidence": 0.9,
    }


def btc_spot_quote() -> dict[str, Any]:
    try:
        payload, transport_note = fetch_json(COINGECKO_SIMPLE_URL)
        history = coingecko_btc_history()
        quote = coingecko_btc_quote(payload, history=history)
        if transport_note:
            quote["source"] = f"{quote['source']} ({transport_note})"
        return quote
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        try:
            payload, _ = fetch_json(COINBASE_BTC_SPOT_URL)
            return coinbase_btc_quote(payload, f"CoinGecko failed: {exc}")
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as fallback_exc:
            return error_quote_for_special("BTC", "Bitcoin spot", "USD", "https://www.coingecko.com/en/coins/bitcoin", f"BTC spot sources failed: CoinGecko {exc}; Coinbase {fallback_exc}")


def coingecko_btc_quote(payload: dict[str, Any], history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    bitcoin = payload.get("bitcoin") or {}
    price = to_number(bitcoin.get("usd"))
    if price is None:
        raise ValueError("CoinGecko BTC payload has no USD price")
    history = history or [{"date": today_label(), "value": price}]
    values = [point["value"] for point in history if to_number(point.get("value")) is not None]
    day_change = to_number(bitcoin.get("usd_24h_change"))
    return {
        "ok": True,
        "symbol": "BTC",
        "name": "Bitcoin spot",
        "market": "CRYPTO",
        "currency": "USD",
        "price": price,
        "previous_close": price / (1 + day_change / 100) if day_change is not None else None,
        "day_change_pct": day_change,
        "high_52w": max(values) if values else None,
        "low_52w": min(values) if values else None,
        "range_position": range_position_pct(price, min(values) if values else None, max(values) if values else None),
        "source": "CoinGecko spot BTC via local proxy",
        "source_url": "https://www.coingecko.com/en/coins/bitcoin",
        "timestamp": now_iso(),
        "quote_timestamp": now_iso(),
        "as_of_date": today_label(),
        "realtime_status": "snapshot",
        "frequency": "24/7 spot",
        "history": history,
        "metric_direction": "higher_is_better",
        "metric_basis": "spot_price_range_plus_momentum",
        "confidence": 0.9,
    }


def coingecko_btc_history() -> list[dict[str, Any]]:
    payload, _ = fetch_json(COINGECKO_CHART_URL)
    prices = payload.get("prices") or []
    history: list[dict[str, Any]] = []
    for row in prices:
        if not isinstance(row, list) or len(row) < 2:
            continue
        value = to_number(row[1])
        if value is None:
            continue
        date = datetime.fromtimestamp(row[0] / 1000, tz=timezone.utc).date().isoformat()
        history.append({"date": date, "value": value})
    return history[-120:]


def coinbase_btc_quote(payload: dict[str, Any], note: str) -> dict[str, Any]:
    data = payload.get("data") or {}
    price = to_number(data.get("amount"))
    if price is None:
        raise ValueError("Coinbase BTC payload has no amount")
    try:
        history = coinbase_btc_history()
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        history = [{"date": today_label(), "value": price}]
    values = [point["value"] for point in history if to_number(point.get("value")) is not None]
    return {
        "ok": True,
        "symbol": "BTC",
        "name": "Bitcoin spot",
        "market": "CRYPTO",
        "currency": "USD",
        "price": price,
        "previous_close": None,
        "day_change_pct": None,
        "high_52w": max(values) if values else None,
        "low_52w": min(values) if values else None,
        "range_position": range_position_pct(price, min(values) if values else None, max(values) if values else None),
        "source": "Coinbase BTC spot via local proxy",
        "source_url": "https://www.coinbase.com/price/bitcoin",
        "timestamp": now_iso(),
        "quote_timestamp": now_iso(),
        "as_of_date": today_label(),
        "realtime_status": "snapshot",
        "frequency": "24/7 spot",
        "history": history,
        "metric_direction": "higher_is_better",
        "metric_basis": "spot_price_range_plus_momentum",
        "confidence": 0.75,
        "detail": note,
    }


def coinbase_btc_history() -> list[dict[str, Any]]:
    payload, _ = fetch_json(COINBASE_BTC_CANDLES_URL)
    if not isinstance(payload, list):
        raise ValueError("Coinbase candles payload is not a list")
    history: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, list) or len(row) < 5:
            continue
        close = to_number(row[4])
        if close is None:
            continue
        date = datetime.fromtimestamp(row[0], tz=timezone.utc).date().isoformat()
        history.append({"date": date, "value": close})
    history.sort(key=lambda item: item["date"])
    return history[-120:]


def error_quote_for_special(symbol: str, name: str, currency: str, source_url: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "symbol": symbol,
        "name": name,
        "market": market_for_symbol(symbol),
        "currency": currency,
        "source": "source unavailable",
        "source_url": source_url,
        "timestamp": now_iso(),
        "quote_timestamp": now_iso(),
        "as_of_date": today_label(),
        "realtime_status": "unavailable",
        "frequency": "unknown",
        "metric_direction": "higher_is_better",
        "metric_basis": "unavailable",
        "confidence": 0.0,
        "error": message,
    }


def china_macro_quotes() -> dict[str, dict[str, Any]]:
    cached_at = MACRO_CACHE.get("timestamp")
    cached_quotes = MACRO_CACHE.get("quotes")
    if cached_at and cached_quotes and (datetime.now(timezone.utc) - cached_at).total_seconds() < MACRO_CACHE_SECONDS:
        return cached_quotes

    try:
        quotes = build_china_macro_quotes()
    except (HTTPError, URLError, TimeoutError, OSError, KeyError, TypeError, ValueError, zipfile.BadZipFile) as exc:
        quotes = {symbol: macro_error_quote(symbol, f"Official macro data retrieval failed: {exc}") for symbol in CHINA_MACRO_SYMBOLS}

    MACRO_CACHE["timestamp"] = datetime.now(timezone.utc)
    MACRO_CACHE["quotes"] = quotes
    return quotes


def build_china_macro_quotes() -> dict[str, dict[str, Any]]:
    current_year = max(PBC_CATEGORY_URLS)
    previous_year = current_year - 1

    money_url = pbc_xlsx_url(current_year, "money", "货币供应量")
    money_previous_url = pbc_xlsx_url(previous_year, "money", "货币供应量")
    credit_url = pbc_xlsx_url(current_year, "credit", "金融机构人民币信贷收支表")
    credit_previous_url = pbc_xlsx_url(previous_year, "credit", "金融机构人民币信贷收支表")
    exchange_url = pbc_xlsx_url(current_year, "money", "汇率报表")
    safe_url = safe_time_series_xlsx_url()

    money_rows = xlsx_rows(fetch_bytes(money_url)[0])
    money_previous_rows = xlsx_rows(fetch_bytes(money_previous_url)[0])
    credit_rows = xlsx_rows(fetch_bytes(credit_url)[0])
    credit_previous_rows = xlsx_rows(fetch_bytes(credit_previous_url)[0])
    exchange_rows = xlsx_rows(fetch_bytes(exchange_url)[0])
    safe_rows = xlsx_rows(fetch_bytes(safe_url)[0], sheet_name="以人民币计价（月度）")

    quotes: dict[str, dict[str, Any]] = {}
    quotes["CN_M1_M2_GAP"] = m1_m2_gap_quote(money_rows, money_previous_rows, money_url)
    quotes["CN_CORP_MLT_LOAN_YOY"] = corporate_credit_quote(credit_rows, credit_previous_rows, credit_url)
    quotes["CN_HOUSEHOLD_NBFI_DEPOSIT_GAP"] = deposit_rotation_quote(credit_rows, credit_url)
    quotes["CN_FX_SETTLEMENT_FLOW"] = fx_flow_quote(safe_rows, exchange_rows, safe_url, exchange_url)
    return quotes


def pbc_xlsx_url(year: int, category: str, title: str) -> str:
    page_url = PBC_CATEGORY_URLS[year][category]
    html, _ = fetch_text(page_url)
    href = link_after_title(html, title)
    if not href.endswith(".xlsx"):
        raise ValueError(f"PBC source for {title} is not xlsx: {href}")
    return absolute_url(PBC_BASE, href)


def safe_time_series_xlsx_url() -> str:
    page_url = CHINA_MACRO_SOURCE_URLS["CN_FX_SETTLEMENT_FLOW"]
    html, _ = fetch_text(page_url)
    match = re.search(r'href=["\']([^"\']+\.xlsx)["\'][^>]*>\s*银行结售汇数据时间序列', html, flags=re.IGNORECASE)
    href = match.group(1) if match else ""
    if not href:
        all_links = re.findall(r'href=["\']([^"\']+\.xlsx)["\']', html, flags=re.IGNORECASE)
        href = all_links[0] if all_links else ""
    if not href.endswith(".xlsx"):
        raise ValueError(f"SAFE time series source is not xlsx: {href}")
    return absolute_url(SAFE_BASE, href)


def link_after_title(html: str, title: str) -> str:
    position = html.find(title)
    if position < 0:
        raise ValueError(f"Cannot find source title: {title}")
    snippet = html[max(0, position - 400):position + 1800]
    match = re.search(r'href=["\']([^"\']+\.(?:xlsx|xls))["\']', snippet, flags=re.IGNORECASE)
    if not match:
        raise ValueError(f"Cannot find xlsx link after title: {title}")
    return match.group(1)


def absolute_url(base: str, href: str) -> str:
    if href.startswith("http"):
        return href
    return f"{base}{href if href.startswith('/') else '/' + href}"


def xlsx_rows(blob: bytes, sheet_name: str | None = None) -> list[list[str]]:
    with zipfile.ZipFile(BytesIO(blob)) as workbook:
        shared = shared_strings(workbook)
        sheet_path = sheet_path_for_name(workbook, sheet_name)
        root = ElementTree.fromstring(workbook.read(sheet_path))
        rows: list[list[str]] = []
        for row in root.findall(".//a:sheetData/a:row", XLSX_NS):
            values: list[str] = []
            for cell in row.findall("a:c", XLSX_NS):
                cell_index = excel_col_index(cell.attrib.get("r", "A"))
                while len(values) < cell_index:
                    values.append("")
                values.append(cell_value(cell, shared))
            rows.append(values)
        return rows


def shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
    return ["".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS)) for item in root.findall("a:si", XLSX_NS)]


def sheet_path_for_name(workbook: zipfile.ZipFile, sheet_name: str | None) -> str:
    if sheet_name is None:
        return "xl/worksheets/sheet1.xml"

    workbook_root = ElementTree.fromstring(workbook.read("xl/workbook.xml"))
    rels_root = ElementTree.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
    rels = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels_root}
    for sheet in workbook_root.findall(".//a:sheets/a:sheet", RELS_NS):
        if sheet.attrib.get("name") == sheet_name:
            target = rels[sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]]
            return f"xl/{target}"
    raise ValueError(f"Cannot find xlsx sheet: {sheet_name}")


def excel_col_index(reference: str) -> int:
    letters = "".join(character for character in reference if character.isalpha())
    index = 0
    for letter in letters:
        index = index * 26 + ord(letter.upper()) - 64
    return max(index - 1, 0)


def cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    if cell.attrib.get("t") == "inlineStr":
        return "".join(text.text or "" for text in cell.findall(".//a:t", XLSX_NS))
    value = cell.find("a:v", XLSX_NS)
    if value is None:
        return ""
    raw = value.text or ""
    if cell.attrib.get("t") == "s":
        return shared[int(raw)]
    return raw


def m1_m2_gap_quote(current_rows: list[list[str]], previous_rows: list[list[str]], source_url: str) -> dict[str, Any]:
    current_m1 = find_row(current_rows, "货币（M1）")
    current_m2 = find_row(current_rows, "货币和准货币（M2）")
    previous_m1 = find_row(previous_rows, "货币（M1）")
    previous_m2 = find_row(previous_rows, "货币和准货币（M2）")
    column = latest_numeric_column(current_m2)
    m1_yoy = percent_change(to_number(current_m1[column]), to_number(previous_m1[column]))
    m2_yoy = percent_change(to_number(current_m2[column]), to_number(previous_m2[column]))
    gap = m1_yoy - m2_yoy
    headers = header_row(current_rows)
    gaps = []
    gap_headers = []
    for index in range(1, min(len(current_m1), len(previous_m1), len(current_m2), len(previous_m2))):
        if to_number(current_m1[index]) is None or to_number(previous_m1[index]) is None:
            continue
        item_gap = percent_change(to_number(current_m1[index]), to_number(previous_m1[index])) - percent_change(to_number(current_m2[index]), to_number(previous_m2[index]))
        gaps.append(item_gap)
        gap_headers.append(headers[index])
    score = historical_percentile(gap, gaps) or clamp_number(50 + gap * 4, 0, 100)
    period = period_label(header_row(current_rows)[column])
    detail = f"M1同比 {m1_yoy:.2f}%，M2同比 {m2_yoy:.2f}%，剪刀差 {gap:.2f}pct。"
    return macro_quote("CN_M1_M2_GAP", "M1-M2 growth gap", gap, score, "ppt", source_url, period, detail, history=history_from_columns(gap_headers, gaps))


def corporate_credit_quote(current_rows: list[list[str]], previous_rows: list[list[str]], source_url: str) -> dict[str, Any]:
    current_row = enterprise_mid_long_loan_row(current_rows)
    previous_row = enterprise_mid_long_loan_row(previous_rows)
    column = latest_numeric_column(current_row)
    yoy = percent_change(to_number(current_row[column]), to_number(previous_row[column]))
    headers = header_row(current_rows)
    yoy_values = []
    yoy_headers = []
    for index in range(1, min(len(current_row), len(previous_row))):
        if to_number(current_row[index]) is None or to_number(previous_row[index]) is None:
            continue
        yoy_values.append(percent_change(to_number(current_row[index]), to_number(previous_row[index])))
        yoy_headers.append(headers[index])
    score = historical_percentile(yoy, yoy_values) or clamp_number(50 + (yoy - 8) * 4, 0, 100)
    period = period_label(header_row(current_rows)[column])
    detail = f"企事业单位中长期贷款余额同比 {yoy:.2f}%；8% 作为中性锚。"
    return macro_quote("CN_CORP_MLT_LOAN_YOY", "Corporate mid/long loan YoY", yoy, score, "%", source_url, period, detail, history=history_from_columns(yoy_headers, yoy_values))


def deposit_rotation_quote(rows: list[list[str]], source_url: str) -> dict[str, Any]:
    household = find_row(rows, "住户存款")
    nbfi = find_row(rows, "非银行业金融机构存款")
    total = find_row(rows, "各项存款")
    column = latest_numeric_column(nbfi)
    if column <= 1:
        raise ValueError("Deposit table does not have a previous month for rotation calculation.")
    household_change = to_number(household[column]) - to_number(household[column - 1])
    nbfi_change = to_number(nbfi[column]) - to_number(nbfi[column - 1])
    spread = nbfi_change - household_change
    spread_bp = spread / to_number(total[column]) * 10000
    headers = header_row(rows)
    spread_values = []
    spread_headers = []
    for index in range(2, min(len(household), len(nbfi), len(total))):
        if to_number(household[index]) is None or to_number(nbfi[index]) is None or to_number(total[index]) is None:
            continue
        item_spread = (to_number(nbfi[index]) - to_number(nbfi[index - 1])) - (to_number(household[index]) - to_number(household[index - 1]))
        spread_values.append(item_spread / to_number(total[index]) * 10000)
        spread_headers.append(headers[index])
    score = historical_percentile(spread_bp, spread_values) or clamp_number(50 + spread_bp * 0.4, 0, 100)
    period = period_label(header_row(rows)[column])
    detail = f"非银存款月增 {nbfi_change:.0f}亿元，住户存款月增 {household_change:.0f}亿元，剪刀差 {spread_bp:.1f}bp。"
    return macro_quote("CN_HOUSEHOLD_NBFI_DEPOSIT_GAP", "Household vs NBFI deposit gap", spread_bp, score, "bp", source_url, period, detail, history=history_from_columns(spread_headers, spread_values))


def fx_flow_quote(safe_rows: list[list[str]], exchange_rows: list[list[str]], safe_url: str, exchange_url: str) -> dict[str, Any]:
    settlement = find_row(safe_rows, "三、差额")
    column = latest_numeric_column(settlement)
    surplus = to_number(settlement[column])
    usd_cny = find_row(exchange_rows, "一美元折合人民币（期末数）")
    fx_column = latest_numeric_column(usd_cny)
    appreciation = 0.0
    if fx_column > 1:
        appreciation = (to_number(usd_cny[fx_column - 1]) - to_number(usd_cny[fx_column])) / to_number(usd_cny[fx_column - 1]) * 100
    headers = safe_rows[3]
    surplus_values = []
    surplus_headers = []
    for index in range(1, len(settlement)):
        value = to_number(settlement[index])
        if value is None:
            continue
        surplus_values.append(value)
        surplus_headers.append(headers[index])
    score = historical_percentile(surplus, surplus_values) or clamp_number(50 + surplus / 1000 * 3 + appreciation * 5, 0, 100)
    period = period_label(safe_rows[3][column])
    detail = f"银行结售汇差额 {surplus:.0f}亿元；美元兑人民币期末 {to_number(usd_cny[fx_column]):.4f}，人民币月变化 {appreciation:.2f}%。"
    return macro_quote("CN_FX_SETTLEMENT_FLOW", "FX settlement surplus + CNY", surplus, score, "100m CNY", safe_url, period, detail, source_url_secondary=exchange_url, history=history_from_columns(surplus_headers, surplus_values))


def macro_quote(
    symbol: str,
    name: str,
    value: float,
    score: float,
    currency: str,
    source_url: str,
    period: str,
    detail: str,
    source_url_secondary: str | None = None,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if source_url_secondary:
        detail = f"{detail} 汇率来源：{source_url_secondary}"
    return {
        "ok": True,
        "symbol": symbol,
        "name": name,
        "market": "CN",
        "currency": currency,
        "price": value,
        "previous_close": None,
        "day_change_pct": None,
        "high_52w": 100,
        "low_52w": 0,
        "range_position": score,
        "source": CHINA_MACRO_SOURCE,
        "source_url": source_url,
        "timestamp": now_iso(),
        "quote_timestamp": period,
        "as_of_date": period,
        "realtime_status": CHINA_MACRO_STATUS,
        "frequency": "monthly",
        "history": history or [{"date": period, "value": value}],
        "metric_direction": "higher_is_better",
        "metric_basis": "historical_distribution",
        "confidence": 0.9,
        "detail": detail,
    }


def macro_error_quote(symbol: str, message: str) -> dict[str, Any]:
    return {
        "ok": False,
        "symbol": symbol,
        "name": macro_symbol_name(symbol),
        "market": "CN",
        "currency": currency_for_symbol(symbol),
        "source": CHINA_MACRO_SOURCE,
        "source_url": CHINA_MACRO_SOURCE_URLS.get(symbol, PBC_CATEGORY_URLS[2026]["money"]),
        "timestamp": now_iso(),
        "quote_timestamp": now_iso(),
        "as_of_date": today_label(),
        "realtime_status": "unavailable",
        "frequency": "monthly",
        "metric_direction": "higher_is_better",
        "metric_basis": "historical_distribution",
        "confidence": 0.0,
        "error": message,
    }


def macro_symbol_name(symbol: str) -> str:
    return {
        "CN_M1_M2_GAP": "M1-M2 growth gap",
        "CN_CORP_MLT_LOAN_YOY": "Corporate mid/long loan YoY",
        "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP": "Household vs NBFI deposit gap",
        "CN_FX_SETTLEMENT_FLOW": "FX settlement surplus + CNY",
    }.get(symbol, symbol)


def header_row(rows: list[list[str]]) -> list[str]:
    for row in rows:
        if row and "项目" in row[0]:
            return row
    raise ValueError("Cannot find xlsx header row.")


def find_row(rows: list[list[str]], text: str) -> list[str]:
    for row in rows:
        if text in " ".join(str(value) for value in row):
            return row
    raise ValueError(f"Cannot find xlsx row: {text}")


def enterprise_mid_long_loan_row(rows: list[list[str]]) -> list[str]:
    enterprise_seen = False
    for row in rows:
        text = " ".join(str(value) for value in row)
        if "企（事）业单位贷款" in text:
            enterprise_seen = True
            continue
        if enterprise_seen and "中长期贷款" in text:
            return row
    raise ValueError("Cannot find enterprise mid/long loan row.")


def latest_numeric_column(row: list[str]) -> int:
    for index in range(len(row) - 1, 0, -1):
        if to_number(row[index]) is not None:
            return index
    raise ValueError("Cannot find latest numeric column.")


def period_label(value: str) -> str:
    number = to_number(value)
    if number and number > 30000:
        date = datetime(1899, 12, 30) + timedelta(days=number)
        return date.strftime("%Y-%m")
    text = str(value).strip()
    match = re.match(r"(\d{4})\.(\d{1,2})", text)
    if match:
        return f"{match.group(1)}-{int(match.group(2)):02d}"
    return text or "official monthly snapshot"


def as_of_date(value: str | None) -> str:
    if not value:
        return today_label()
    text = str(value).strip()
    if re.match(r"^\d{4}-\d{2}$", text):
        return text
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y%m%d%H%M%S", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:19], fmt).date().isoformat()
        except ValueError:
            continue
    return text


def today_label() -> str:
    return datetime.now(timezone.utc).astimezone().date().isoformat()


def clamp_number(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def historical_percentile(value: float, values: list[float]) -> float | None:
    usable = sorted(item for item in values if item is not None)
    if not usable:
        return None
    below_or_equal = sum(1 for item in usable if item <= value)
    return clamp_number((below_or_equal - 1) / max(len(usable) - 1, 1) * 100, 0, 100)


def history_from_columns(headers: list[str], values: list[float | None]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    for header, value in zip(headers, values):
        if value is None:
            continue
        history.append({"date": period_label(header), "value": value})
    return history


def first_number(row: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = to_number(row.get(key))
        if value is not None:
            return value
    return None


def first_text(row: dict[str, Any], keys: list[str]) -> str | None:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def field_text(fields: list[str], index: int) -> str | None:
    if index >= len(fields):
        return None
    value = fields[index].strip()
    return value or None


def field_number(fields: list[str], index: int) -> float | None:
    return to_number(field_text(fields, index))


def range_position_pct(price: float | None, low: float | None, high: float | None) -> float | None:
    if price is None or low is None or high is None or high <= low:
        return None
    return max(0.0, min(100.0, ((price - low) / (high - low)) * 100.0))


def percent_change(current: float | None, previous: float | None) -> float:
    if current is None or previous is None or previous == 0:
        raise ValueError("Cannot calculate percent change without two numeric values.")
    return ((current - previous) / previous) * 100.0


def attach_secondary_quotes(quotes_by_symbol: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    items = list(quotes_by_symbol.items())
    if not items:
        return {}

    enriched: dict[str, dict[str, Any]] = {}
    worker_count = min(MAX_SOURCE_WORKERS, len(items))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(attach_secondary_price_data, quote): symbol for symbol, quote in items}
        for future in as_completed(futures):
            symbol = futures[future]
            try:
                enriched[symbol] = future.result()
            except Exception as exc:
                quote = quotes_by_symbol[symbol]
                quote["secondary_source"] = {
                    "ok": False,
                    "name": "Yahoo chart API",
                    "error": str(exc),
                }
                quote["confidence"] = min(float(quote.get("confidence", 0.75)), 0.75)
                enriched[symbol] = quote
    return enriched


def attach_secondary_price_data(quote_row: dict[str, Any]) -> dict[str, Any]:
    symbol = quote_row["symbol"].upper()
    yahoo_symbol_value = yahoo_symbol(symbol)
    if not yahoo_symbol_value or not quote_row.get("ok"):
        return quote_row
    try:
        yahoo_data = fetch_yahoo_chart(yahoo_symbol_value)
        history = yahoo_data.get("history") or []
        secondary_price = yahoo_data.get("price")
        if history:
            quote_row["history"] = history
        divergence_pct = None
        if secondary_price and quote_row.get("price"):
            divergence_pct = abs(secondary_price - quote_row["price"]) / quote_row["price"] * 100
        divergence_flag = divergence_pct is not None and divergence_pct > 0.75
        quote_row["secondary_source"] = {
            "ok": True,
            "name": "Yahoo chart API",
            "price": secondary_price,
            "timestamp": yahoo_data.get("timestamp"),
            "divergence_pct": divergence_pct,
        }
        quote_row["divergence_flag"] = divergence_flag
        quote_row["confidence"] = 0.55 if divergence_flag else 0.92
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        quote_row["history"] = quote_row.get("history") or []
        quote_row["secondary_source"] = {
            "ok": False,
            "name": "Yahoo chart API",
            "error": str(exc),
        }
        quote_row["confidence"] = min(float(quote_row.get("confidence", 0.75)), 0.75)
    return quote_row


def yahoo_symbol(symbol: str) -> str | None:
    return {
        "SPY": "SPY",
        "QQQ": "QQQ",
        "IWM": "IWM",
        "RSP": "RSP",
        "FXI": "FXI",
        "KWEB": "KWEB",
        "SHCOMP": "000001.SS",
        "CSI300": "000300.SS",
        "HSI": "^HSI",
    }.get(symbol)


def fetch_yahoo_chart(symbol: str) -> dict[str, Any]:
    encoded = quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=3mo&interval=1d"
    payload, _ = fetch_json(url)
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        raise ValueError("Yahoo chart has no result")
    timestamps = result.get("timestamp") or []
    quote_block = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    closes = quote_block.get("close") or []
    history: list[dict[str, Any]] = []
    for timestamp, close in zip(timestamps, closes):
        value = to_number(close)
        if value is None:
            continue
        date = datetime.fromtimestamp(timestamp, tz=timezone.utc).date().isoformat()
        history.append({"date": date, "value": value})
    if not history:
        raise ValueError("Yahoo chart has no numeric close history")
    return {
        "price": history[-1]["value"],
        "history": history[-120:],
        "timestamp": history[-1]["date"],
    }


def read_score_history(path: Path = HISTORY_FILE) -> dict[str, Any]:
    path = history_file_path() if path == HISTORY_FILE else path
    if not path.exists():
        return {"points": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"points": []}
    points = payload.get("points")
    return {"points": points if isinstance(points, list) else []}


def append_score_history(point: dict[str, Any], path: Path = HISTORY_FILE, limit: int = 1200) -> dict[str, Any]:
    path = history_file_path() if path == HISTORY_FILE else path
    history = read_score_history(path)
    points = history["points"]
    if not point.get("timestamp"):
        point["timestamp"] = now_iso()
    points.append(point)
    history["points"] = points[-limit:]
    path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return history


def market_for_symbol(symbol: str) -> str:
    upper = symbol.upper()
    if upper in CHINA_MACRO_SYMBOLS:
        return "CN"
    if upper == "BTC":
        return "CRYPTO"
    if upper in FRED_SERIES or upper in CBOE_SYMBOLS:
        return "US"
    if upper in {"SHCOMP", "CSI300", "SZCOMP"}:
        return "CN"
    if (upper.startswith("SH") or upper.startswith("SZ")) and upper[2:].isdigit():
        return "CN"
    if upper.startswith("HK") or upper == "HSI":
        return "HK"
    return "US"


def name_for_symbol(symbol: str, mapped_symbol: str, fields: list[str]) -> str:
    if market_for_symbol(symbol) == "CN":
        return field_text(fields, 1) or symbol
    return field_text(fields, 46) or field_text(fields, 1) or symbol


def currency_field_for_symbol(symbol: str, mapped_symbol: str, fields: list[str]) -> str:
    market = market_for_symbol(symbol)
    if market == "CN":
        return field_text(fields, 82) or "CNY"
    if market == "HK":
        return field_text(fields, 75) or "HKD"
    return field_text(fields, 35) or currency_for_symbol(symbol)


def high_52w_for_symbol(symbol: str, mapped_symbol: str, fields: list[str]) -> float | None:
    if market_for_symbol(symbol) == "CN":
        return field_number(fields, 67)
    return field_number(fields, 48)


def low_52w_for_symbol(symbol: str, mapped_symbol: str, fields: list[str]) -> float | None:
    if market_for_symbol(symbol) == "CN":
        return field_number(fields, 68)
    return field_number(fields, 49)


def source_url_for_symbol(symbol: str, mapped_symbol: str) -> str:
    if symbol.upper() in FRED_SERIES:
        return FRED_SERIES[symbol.upper()]["url"]
    if symbol.upper() in CBOE_SYMBOLS:
        return f"{CBOE_BASE}/{CBOE_SYMBOLS[symbol.upper()]}.json"
    if symbol.upper() in CHINA_MACRO_SYMBOLS:
        return CHINA_MACRO_SOURCE_URLS.get(symbol.upper(), PBC_CATEGORY_URLS[2026]["money"])
    if symbol.upper() == "SPXA200R":
        return SPXA200R_SOURCE_URL
    if symbol.upper() == "BTC":
        return "https://www.coingecko.com/en/coins/bitcoin"
    return f"https://gu.qq.com/{mapped_symbol}"


def proxy_note_for_symbol(symbol: str) -> str | None:
    return None


def currency_for_symbol(symbol: str) -> str:
    upper = symbol.upper()
    if upper == "CN_M1_M2_GAP":
        return "ppt"
    if upper == "CN_CORP_MLT_LOAN_YOY":
        return "%"
    if upper == "CN_HOUSEHOLD_NBFI_DEPOSIT_GAP":
        return "bp"
    if upper == "CN_FX_SETTLEMENT_FLOW":
        return "100m CNY"
    if upper in FRED_SERIES:
        return FRED_SERIES[upper]["currency"]
    if upper in CBOE_SYMBOLS:
        return "%"
    if symbol.upper() == "SPXA200R":
        return "%"
    market = market_for_symbol(symbol)
    if market == "CN":
        return "CNY"
    if market == "HK":
        return "HKD"
    return "USD"


def default_frequency(symbol: str) -> str:
    upper = symbol.upper()
    if upper in CHINA_MACRO_SYMBOLS:
        return "monthly"
    if upper == "BTC":
        return "24/7 spot"
    return "daily"


def is_stale_timestamp(value: str | None) -> bool:
    if not value:
        return False
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y%m%d%H%M%S"):
        try:
            observed = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
            age_seconds = (datetime.now(timezone.utc) - observed).total_seconds()
            return age_seconds > 7 * 24 * 60 * 60
        except ValueError:
            continue
    return False


def fetch_histories(symbols: list[str], days: int) -> dict[str, Any]:
    histories = {
        symbol: {
            "ok": False,
            "symbol": symbol,
            "bars": [],
            "source": SOURCE,
            "timestamp": now_iso(),
            "realtime_status": "unavailable",
            "error": "History endpoint is not used in the Tencent snapshot version.",
        }
        for symbol in symbols
    }
    return {
        "histories": histories,
        "source": SOURCE,
        "timestamp": now_iso(),
        "realtime_status": "unavailable",
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/quotes":
            query = parse_qs(parsed.query)
            if not self.authorized(query):
                self.send_json({"error": "unauthorized"}, status=401)
                return
            self.send_json(fetch_quotes(parse_symbols(query)))
            return
        if parsed.path == "/api/history":
            query = parse_qs(parsed.query)
            if not self.authorized(query):
                self.send_json({"error": "unauthorized"}, status=401)
                return
            if not parse_symbols(query):
                self.send_json(read_score_history())
                return
            days = int(query.get("days", ["260"])[0])
            self.send_json(fetch_histories(parse_symbols(query), days))
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/history":
            try:
                if not self.authorized(parse_qs(parsed.query)):
                    self.send_json({"error": "unauthorized"}, status=401)
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length).decode("utf-8")
                payload = json.loads(body) if body else {}
                point = payload.get("point", payload)
                if not isinstance(point, dict):
                    raise ValueError("history point must be an object")
                self.send_json(append_score_history(point))
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, status=400)
            return
        self.send_error(404)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_HEAD(self) -> None:
        parsed = urlparse(self.path)
        self.serve_static(parsed.path, head_only=True)

    def authorized(self, query: dict[str, list[str]]) -> bool:
        return request_is_authorized(dict(self.headers.items()), query)

    def send_cors_headers(self) -> None:
        for key, value in cors_headers(self.headers.get("Origin")).items():
            self.send_header(key, value)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, request_path: str, head_only: bool = False) -> None:
        relative = request_path.lstrip("/") or "index.html"
        target = (ROOT / relative).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def main() -> None:
    host, port = bind_address()
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Market Indicators running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
