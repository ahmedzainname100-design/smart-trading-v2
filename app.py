"""Smart Trading — Arabic market dashboard.
Live market data is provided by Twelve Data when TWELVE_DATA_API_KEY is configured.
TradingView's public chart widget is used for interactive charts.
"""
from __future__ import annotations

import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("smart-trading")

API_KEY = os.getenv("TWELVE_DATA_API_KEY", "").strip()
API_BASE = "https://api.twelvedata.com"
HTTP_TIMEOUT = float(os.getenv("MARKET_DATA_TIMEOUT", "8"))
CACHE_TTL = int(os.getenv("MARKET_DATA_CACHE_SECONDS", "30"))

ASSETS: dict[str, dict[str, str]] = {
    "XAU/USD": {"name": "الذهب", "category": "معادن", "tv": "OANDA:XAUUSD", "digits": "2"},
    "XAG/USD": {"name": "الفضة", "category": "معادن", "tv": "OANDA:XAGUSD", "digits": "3"},
    "EUR/USD": {"name": "اليورو / الدولار", "category": "فوركس", "tv": "OANDA:EURUSD", "digits": "5"},
    "GBP/USD": {"name": "الإسترليني / الدولار", "category": "فوركس", "tv": "OANDA:GBPUSD", "digits": "5"},
    "USD/JPY": {"name": "الدولار / الين", "category": "فوركس", "tv": "OANDA:USDJPY", "digits": "3"},
    "BTC/USD": {"name": "بيتكوين", "category": "عملات رقمية", "tv": "COINBASE:BTCUSD", "digits": "2"},
}

# Fallback values are illustrative only and are never presented as live data.
DEMO_VALUES = {
    "XAU/USD": 3980.00,
    "XAG/USD": 47.20,
    "EUR/USD": 1.16420,
    "GBP/USD": 1.33150,
    "USD/JPY": 152.350,
    "BTC/USD": 109500.00,
}
_cache: dict[str, tuple[float, Any]] = {}


def cached(key: str):
    item = _cache.get(key)
    if item and time.time() - item[0] < CACHE_TTL:
        return item[1]
    return None


def store_cache(key: str, value: Any) -> Any:
    _cache[key] = (time.time(), value)
    return value


def safe_float(value: Any, default: float | None = None) -> float | None:
    try:
        result = float(value)
        return result if result == result and abs(result) != float("inf") else default
    except (TypeError, ValueError):
        return default


def fetch_twelve_data(endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
    if not API_KEY:
        raise RuntimeError("TWELVE_DATA_API_KEY is not configured")
    request_params = dict(params)
    request_params["apikey"] = API_KEY
    response = requests.get(f"{API_BASE}/{endpoint}", params=request_params, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict) and (data.get("status") == "error" or data.get("code")):
        message = str(data.get("message", "Market data provider error"))
        raise RuntimeError(message[:220])
    return data


def quote_for(symbol: str) -> dict[str, Any]:
    cache_key = f"quote:{symbol}"
    previous = cached(cache_key)
    if previous is not None:
        return previous
    asset = ASSETS[symbol]
    if API_KEY:
        try:
            data = fetch_twelve_data("quote", {"symbol": symbol, "dp": int(asset["digits"])})
            price = safe_float(data.get("close"))
            if price is None:
                price = safe_float(data.get("price"))
            if price is None:
                raise RuntimeError("Provider did not return a valid price")
            change = safe_float(data.get("change"), 0.0) or 0.0
            pct = safe_float(data.get("percent_change"), 0.0) or 0.0
            result = {
                "symbol": symbol, "name": asset["name"], "category": asset["category"],
                "price": price, "change": change, "change_percent": pct,
                "currency": data.get("currency") or "USD", "is_live": True,
                "source": "Twelve Data", "updated_at": data.get("datetime") or data.get("timestamp"),
                "market_open": data.get("is_market_open"), "tv_symbol": asset["tv"],
            }
            return store_cache(cache_key, result)
        except Exception as exc:  # degrade gracefully if provider limits or symbol access fails
            logger.warning("Quote unavailable for %s: %s", symbol, exc)
            stale = _cache.get(cache_key)
            if stale:
                result = dict(stale[1])
                result["is_live"] = False
                result["warning"] = "تعذر تحديث السعر؛ المعروض آخر سعر ناجح مخزّن."
                return result
            return {
                "symbol": symbol, "name": asset["name"], "category": asset["category"],
                "price": None, "change": None, "change_percent": None, "currency": "USD",
                "is_live": False, "source": "غير متاح", "error": "تعذر جلب السعر من مزود البيانات.",
                "tv_symbol": asset["tv"],
            }
    return {
        "symbol": symbol, "name": asset["name"], "category": asset["category"],
        "price": DEMO_VALUES[symbol], "change": 0.0, "change_percent": 0.0,
        "currency": "USD", "is_live": False, "demo": True,
        "source": "قيمة توضيحية — ليست سعرًا حيًا", "updated_at": None,
        "tv_symbol": asset["tv"],
    }


@app.get("/")
def index():
    return render_template("index.html", api_configured=bool(API_KEY))


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "Smart Trading", "api_key_configured": bool(API_KEY)})


@app.get("/api/market")
def market():
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(6, len(ASSETS))) as pool:
        futures = {pool.submit(quote_for, symbol): symbol for symbol in ASSETS}
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as exc:
                logger.exception("Market item failed: %s", exc)
    order = {symbol: index for index, symbol in enumerate(ASSETS)}
    results.sort(key=lambda item: order.get(item.get("symbol", ""), 99))
    return jsonify({"items": results, "api_configured": bool(API_KEY), "refresh_seconds": CACHE_TTL})


@app.get("/api/quote")
def quote():
    symbol = request.args.get("symbol", "XAU/USD").upper().strip()
    if symbol not in ASSETS:
        return jsonify({"error": "رمز السوق غير مدعوم."}), 400
    return jsonify(quote_for(symbol))


@app.get("/api/candles")
def candles():
    symbol = request.args.get("symbol", "XAU/USD").upper().strip()
    interval = request.args.get("interval", "5min").strip()
    allowed_intervals = {"1min", "5min", "15min", "30min", "1h", "4h", "1day", "1week"}
    if symbol not in ASSETS:
        return jsonify({"error": "رمز السوق غير مدعوم."}), 400
    if interval not in allowed_intervals:
        return jsonify({"error": "الفاصل الزمني غير مدعوم."}), 400
    if not API_KEY:
        return jsonify({"available": False, "demo": True,
                         "message": "أضف TWELVE_DATA_API_KEY لجلب بيانات الشموع من الخادم. يمكنك استخدام الشارت التفاعلي المضمن أدناه."}), 200
    cache_key = f"candles:{symbol}:{interval}"
    previous = cached(cache_key)
    if previous is not None:
        return jsonify(previous)
    try:
        data = fetch_twelve_data("time_series", {"symbol": symbol, "interval": interval, "outputsize": 120, "order": "asc"})
        values = data.get("values", [])
        clean = []
        for candle in values:
            try:
                clean.append({
                    "datetime": candle.get("datetime"), "open": float(candle["open"]),
                    "high": float(candle["high"]), "low": float(candle["low"]),
                    "close": float(candle["close"]),
                })
            except (KeyError, TypeError, ValueError):
                continue
        result = {"available": bool(clean), "symbol": symbol, "interval": interval, "candles": clean,
                  "source": "Twelve Data", "is_live": True}
        return jsonify(store_cache(cache_key, result))
    except Exception as exc:
        logger.warning("Candles unavailable for %s/%s: %s", symbol, interval, exc)
        return jsonify({"available": False, "error": "تعذر جلب بيانات الشموع. تحقق من مفتاح API وحدود الباقة."}), 502


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "المسار غير موجود."}), 404
    return render_template("index.html", api_configured=bool(API_KEY)), 404


@app.errorhandler(500)
def server_error(error):
    logger.exception("Internal server error: %s", error)
    if request.path.startswith("/api/"):
        return jsonify({"error": "حدث خطأ داخلي غير متوقع."}), 500
    return "حدث خطأ داخلي. راجع سجلات التطبيق.", 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False)
