import json
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

import server


class ServerSourceTransformTests(unittest.TestCase):
    def test_tradingview_breadth_calculates_percent_from_constituents(self):
        original_post_json = server.post_json
        try:
            server.post_json = lambda url, payload: {
                "totalCount": 4,
                "data": [
                    {"s": "TEST:A", "d": ["A", 110, 100]},
                    {"s": "TEST:B", "d": ["B", 90, 100]},
                    {"s": "TEST:C", "d": ["C", 101, 100]},
                    {"s": "TEST:D", "d": ["D", None, 100]},
                ],
            }
            quote = server.tradingview_breadth_quote("SPXA200R")
        finally:
            server.post_json = original_post_json

        self.assertTrue(quote["ok"])
        self.assertEqual(quote["price"], 66.67)
        self.assertEqual(quote["metric_basis"], "constituents_above_sma200")
        self.assertIn("2/3", quote["detail"])
        self.assertEqual(quote["realtime_status"], "daily_snapshot_delayed_or_unknown")

    def test_regional_breadth_universe_configuration_is_explicit(self):
        self.assertEqual(server.BREADTH_SYMBOLS["CSI300A200R"]["group"], "SSE:000300")
        self.assertNotIn("group", server.BREADTH_SYMBOLS["HKA200R"])
        self.assertEqual(server.market_for_symbol("CSI300A200R"), "CN")
        self.assertEqual(server.market_for_symbol("HKA200R"), "HK")

    def test_fred_quote_uses_daily_as_of_history_and_direction(self):
        csv_text = "\n".join(
            [
                "observation_date,BAMLH0A0HYM2",
                "2026-06-24,4.20",
                "2026-06-25,4.05",
                "2026-06-26,3.95",
                "2026-06-29,3.80",
                "2026-06-30,3.65",
            ]
        )

        quote = server.fred_quote_from_csv(
            "HY_OAS",
            csv_text,
            "BAMLH0A0HYM2",
            "ICE BofA US High Yield OAS",
            "%",
            "lower_is_better",
            "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
        )

        self.assertTrue(quote["ok"])
        self.assertEqual(quote["symbol"], "HY_OAS")
        self.assertEqual(quote["frequency"], "daily")
        self.assertEqual(quote["as_of_date"], "2026-06-30")
        self.assertEqual(quote["metric_direction"], "lower_is_better")
        self.assertEqual(quote["metric_basis"], "historical_distribution")
        self.assertGreater(len(quote["history"]), 3)
        self.assertIsNotNone(quote["range_position"])

    def test_coingecko_btc_quote_is_spot_not_ibit_proxy(self):
        payload = {
            "bitcoin": {
                "usd": 106500.0,
                "usd_24h_change": 1.25,
            }
        }

        quote = server.coingecko_btc_quote(payload)

        self.assertTrue(quote["ok"])
        self.assertEqual(quote["symbol"], "BTC")
        self.assertEqual(quote["market"], "CRYPTO")
        self.assertEqual(quote["source"], "CoinGecko spot BTC via local proxy")
        self.assertEqual(quote["frequency"], "24/7 spot")
        self.assertNotIn("IBIT", quote.get("proxy_note", ""))

    def test_score_history_appends_latest_point(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "market-history.json"
            point = {
                "timestamp": "2026-06-30T00:00:00Z",
                "composite": 62.5,
                "segments": {"us": {"score": 70}},
            }

            result = server.append_score_history(point, path=path, limit=3)

            self.assertEqual(result["points"], [point])
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["points"], [point])

    def test_bind_address_defaults_local_and_uses_cloud_env(self):
        self.assertEqual(server.bind_address({}), ("127.0.0.1", 8787))
        self.assertEqual(server.bind_address({"HOST": "0.0.0.0", "PORT": "9000"}), ("0.0.0.0", 9000))

    def test_history_file_path_can_be_configured_for_cloud_storage(self):
        default_path = server.history_file_path({})
        self.assertEqual(default_path.name, "market-history.json")
        self.assertEqual(server.history_file_path({"MARKET_HISTORY_FILE": "/tmp/cloud-history.json"}), Path("/tmp/cloud-history.json"))

    def test_optional_api_token_allows_private_cloud_access(self):
        env = {"DASHBOARD_ACCESS_TOKEN": "secret-token"}
        self.assertTrue(server.request_is_authorized({"X-Dashboard-Token": "secret-token"}, {}, env))
        self.assertTrue(server.request_is_authorized({}, {"access_token": ["secret-token"]}, env))
        self.assertFalse(server.request_is_authorized({"X-Dashboard-Token": "wrong"}, {}, env))
        self.assertTrue(server.request_is_authorized({}, {}, {}))

    def test_cors_headers_are_emitted_for_allowed_cloudbase_origin(self):
        headers = server.cors_headers("https://market.example.tcloudbaseapp.com", {"CORS_ALLOWED_ORIGIN": "https://market.example.tcloudbaseapp.com"})
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://market.example.tcloudbaseapp.com")
        self.assertIn("X-Dashboard-Token", headers["Access-Control-Allow-Headers"])
        self.assertEqual(server.cors_headers("https://other.example.com", {"CORS_ALLOWED_ORIGIN": "https://market.example.tcloudbaseapp.com"}), {})

    def test_special_sources_are_loaded_concurrently(self):
        original_special_quote = server.special_quote

        def slow_special_quote(symbol):
            time.sleep(0.1)
            return {
                "ok": True,
                "symbol": symbol,
                "name": symbol,
                "market": "US",
                "currency": "%",
                "price": 1,
                "source": "test",
                "timestamp": "2026-06-30T00:00:00Z",
                "quote_timestamp": "2026-06-30",
                "realtime_status": "snapshot",
                "frequency": "daily",
                "confidence": 1,
            }

        try:
            server.special_quote = slow_special_quote
            started = time.perf_counter()
            payload = server.fetch_quotes(["HY_OAS", "DGS10", "T10Y2Y", "VIX"])
            elapsed = time.perf_counter() - started
        finally:
            server.special_quote = original_special_quote

        self.assertEqual([quote["symbol"] for quote in payload["quotes"]], ["HY_OAS", "DGS10", "T10Y2Y", "VIX"])
        self.assertLess(elapsed, 0.25)

    def test_tencent_secondary_sources_are_loaded_concurrently(self):
        original_fetch_text = server.fetch_text
        original_fetch_yahoo_chart = server.fetch_yahoo_chart

        tencent_payload = "\n".join(
            [
                tencent_record("usSPY", 100),
                tencent_record("usQQQ", 200),
                tencent_record("usIWM", 300),
                tencent_record("usRSP", 400),
            ]
        )

        def fake_fetch_text(url, encoding="utf-8"):
            return tencent_payload, None

        def slow_yahoo_chart(symbol):
            time.sleep(0.1)
            return {
                "price": 100,
                "history": [{"date": "2026-06-30", "value": 100}],
                "timestamp": "2026-06-30",
            }

        try:
            server.fetch_text = fake_fetch_text
            server.fetch_yahoo_chart = slow_yahoo_chart
            started = time.perf_counter()
            payload = server.fetch_quotes(["SPY", "QQQ", "IWM", "RSP"])
            elapsed = time.perf_counter() - started
        finally:
            server.fetch_text = original_fetch_text
            server.fetch_yahoo_chart = original_fetch_yahoo_chart

        self.assertEqual([quote["symbol"] for quote in payload["quotes"]], ["SPY", "QQQ", "IWM", "RSP"])
        self.assertTrue(all(quote.get("secondary_source", {}).get("ok") for quote in payload["quotes"]))
        self.assertLess(elapsed, 0.25)

    def test_tencent_and_special_source_groups_are_loaded_concurrently(self):
        original_fetch_text = server.fetch_text
        original_fetch_yahoo_chart = server.fetch_yahoo_chart
        original_special_quote = server.special_quote

        def slow_fetch_text(url, encoding="utf-8"):
            time.sleep(0.1)
            return tencent_record("usSPY", 100), None

        def fast_yahoo_chart(symbol):
            return {
                "price": 100,
                "history": [{"date": "2026-06-30", "value": 100}],
                "timestamp": "2026-06-30",
            }

        def slow_special_quote(symbol):
            time.sleep(0.1)
            return {
                "ok": True,
                "symbol": symbol,
                "name": symbol,
                "market": "US",
                "currency": "%",
                "price": 1,
                "source": "test",
                "timestamp": "2026-06-30T00:00:00Z",
                "quote_timestamp": "2026-06-30",
                "realtime_status": "snapshot",
                "frequency": "daily",
                "confidence": 1,
            }

        try:
            server.fetch_text = slow_fetch_text
            server.fetch_yahoo_chart = fast_yahoo_chart
            server.special_quote = slow_special_quote
            started = time.perf_counter()
            payload = server.fetch_quotes(["SPY", "HY_OAS"])
            elapsed = time.perf_counter() - started
        finally:
            server.fetch_text = original_fetch_text
            server.fetch_yahoo_chart = original_fetch_yahoo_chart
            server.special_quote = original_special_quote

        self.assertEqual([quote["symbol"] for quote in payload["quotes"]], ["SPY", "HY_OAS"])
        self.assertLess(elapsed, 0.18)

    def test_quote_responses_are_cached_for_quick_reloads(self):
        original_special_quote = server.special_quote
        calls = 0

        def slow_special_quote(symbol):
            nonlocal calls
            calls += 1
            time.sleep(0.1)
            return {
                "ok": True,
                "symbol": symbol,
                "name": symbol,
                "market": "US",
                "currency": "%",
                "price": calls,
                "source": "test",
                "timestamp": "2026-06-30T00:00:00Z",
                "quote_timestamp": "2026-06-30",
                "realtime_status": "snapshot",
                "frequency": "daily",
                "confidence": 1,
            }

        try:
            server.special_quote = slow_special_quote
            started = time.perf_counter()
            first = server.fetch_quotes(["VIX9D"])
            second = server.fetch_quotes(["VIX9D"])
            elapsed = time.perf_counter() - started
        finally:
            server.special_quote = original_special_quote

        self.assertEqual(calls, 1)
        self.assertEqual(first["quotes"][0]["price"], second["quotes"][0]["price"])
        self.assertLess(elapsed, 0.16)


def tencent_record(remote_symbol, price, quote_timestamp=None):
    quote_timestamp = quote_timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    fields = [""] * 50
    fields[1] = remote_symbol
    fields[3] = str(price)
    fields[4] = str(price - 1)
    fields[30] = quote_timestamp
    fields[32] = "1.0"
    fields[35] = "USD"
    fields[46] = remote_symbol
    fields[48] = str(price + 10)
    fields[49] = str(price - 10)
    return f'v_{remote_symbol}="' + "~".join(fields) + '";'


if __name__ == "__main__":
    unittest.main()
