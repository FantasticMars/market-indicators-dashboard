#!/usr/bin/env python3
"""Fetch market quotes with the existing local proxy and print JSON."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch Market Indicators quotes as JSON.")
    parser.add_argument("--symbols", required=True, help="Comma-separated symbol list.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    symbols = [symbol.strip().upper() for symbol in args.symbols.split(",") if symbol.strip()]
    payload = server.fetch_quotes(symbols)
    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
