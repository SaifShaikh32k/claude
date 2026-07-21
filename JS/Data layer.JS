/**
 * ============================================================================
 * NSE TRADING SYSTEM — DATA LAYER (Day 1 of 7)
 * ============================================================================
 * Purpose: Reliable, resilient fetching of NSE stock data for a GitHub Pages
 *          static site (no backend server, no API keys, no build step).
 *
 * Why this exists:
 *   NSE's official site blocks direct browser (CORS) requests, so a pure
 *   client-side app cannot call nseindia.com directly. This module instead
 *   uses Yahoo Finance's public chart endpoint (NSE tickers use a ".NS"
 *   suffix, e.g. "RELIANCE.NS") through a CORS proxy, with:
 *     - Automatic proxy fallback (3 proxies tried in order)
 *     - Exponential backoff retries
 *     - Request queue + rate limiting (Yahoo throttles bursts)
 *     - localStorage caching with TTL (avoids re-fetching unchanged data)
 *     - Data normalization into a single clean OHLCV shape
 *
 * Every later module (pattern engine, screener, risk engine, backtester)
 * will consume data ONLY through this layer's public functions. Nothing
 * downstream should ever call fetch() directly against a data source —
 * that keeps the whole system swappable if a data source dies.
 *
 * Public API:
 *   NSEData.getQuote(symbol)                 -> single latest quote
 *   NSEData.getHistory(symbol, range, interval) -> OHLCV candle array
 *   NSEData.getBatch(symbols, range, interval)  -> map of symbol -> history
 *   NSEData.clearCache()                     -> wipe local cache
 *   NSEData.getCacheInfo()                   -> debug/inspection helper
 * ============================================================================
 */

const NSEData = (() => {
  'use strict';

  // --------------------------------------------------------------------
  // CONFIG
  // --------------------------------------------------------------------
  const CONFIG = {
    // CORS proxies tried in order. If one is down/rate-limited, we fall
    // through to the next. All are free, no-signup, publicly documented.
    PROXIES: [
      (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    ],
    YAHOO_CHART_BASE: 'https://query1.finance.yahoo.com/v8/finance/chart/',
    CACHE_PREFIX: 'nseData_v1_',
    CACHE_TTL_MS: {
      quote: 60 * 1000,          // live quote: 1 min
      intraday: 5 * 60 * 1000,   // intraday candles: 5 min
      daily: 6 * 60 * 60 * 1000, // daily candles: 6 hours
    },
    MAX_RETRIES: 3,
    BASE_RETRY_DELAY_MS: 800,
    MIN_REQUEST_GAP_MS: 350, // spacing between outgoing requests (queue)
    REQUEST_TIMEOUT_MS: 12000,
  };

  // --------------------------------------------------------------------
  // REQUEST QUEUE (serializes calls so we don't burst and get blocked)
  // --------------------------------------------------------------------
  let queueTail = Promise.resolve();

  function enqueue(taskFn) {
    const run = () =>
      taskFn().finally(
        () => new Promise((resolve) => setTimeout(resolve, CONFIG.MIN_REQUEST_GAP_MS))
      );
    const result = queueTail.then(run, run);
    // Prevent one failed task from permanently poisoning the queue chain
    queueTail = result.catch(() => {});
    return result;
  }

  // --------------------------------------------------------------------
  // LOW-LEVEL FETCH WITH TIMEOUT
  // --------------------------------------------------------------------
  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --------------------------------------------------------------------
  // PROXY + RETRY ORCHESTRATION
  // --------------------------------------------------------------------
  async function fetchWithFallback(targetUrl) {
    let lastError = null;

    for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
      for (const buildProxyUrl of CONFIG.PROXIES) {
        const proxied = buildProxyUrl(targetUrl);
        try {
          const data = await fetchWithTimeout(proxied, CONFIG.REQUEST_TIMEOUT_MS);
          return data; // success
        } catch (err) {
          lastError = err;
          // try next proxy immediately, no delay between proxies
        }
      }
      // all proxies failed this attempt — back off before retrying the round
      const delay = CONFIG.BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
    }

    throw new Error(
      `All data sources failed after ${CONFIG.MAX_RETRIES} attempts. Last error: ${lastError?.message || 'unknown'}`
    );
  }

  // --------------------------------------------------------------------
  // CACHE (localStorage-backed, TTL aware)
  // --------------------------------------------------------------------
  function cacheKey(kind, symbol, range, interval) {
    return `${CONFIG.CACHE_PREFIX}${kind}_${symbol}_${range || ''}_${interval || ''}`;
  }

  function readCache(key, ttlMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.savedAt > ttlMs) return null; // expired
      return parsed.payload;
    } catch {
      return null; // corrupted entry — treat as cache miss
    }
  }

  function writeCache(key, payload) {
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), payload }));
    } catch {
      // localStorage full or unavailable — fail silently, cache is best-effort
    }
  }

  function clearCache() {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CONFIG.CACHE_PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length;
  }

  function getCacheInfo() {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CONFIG.CACHE_PREFIX));
    return {
      count: keys.length,
      totalBytes: keys.reduce((sum, k) => sum + (localStorage.getItem(k) || '').length, 0),
      keys,
    };
  }

  // --------------------------------------------------------------------
  // SYMBOL NORMALIZATION
  // --------------------------------------------------------------------
  // Accepts "RELIANCE", "reliance", "RELIANCE.NS" -> always returns "RELIANCE.NS"
  // NSE main-board tickers use .NS; a few (rare) use .BO for BSE — caller can
  // pass the full suffixed symbol explicitly if they need BSE instead.
  function normalizeSymbol(symbol) {
    if (!symbol || typeof symbol !== 'string') {
      throw new Error('Symbol must be a non-empty string');
    }
    const trimmed = symbol.trim().toUpperCase();
    if (trimmed.endsWith('.NS') || trimmed.endsWith('.BO')) return trimmed;
    return `${trimmed}.NS`;
  }

  // --------------------------------------------------------------------
  // NORMALIZATION: raw Yahoo chart JSON -> clean OHLCV array
  // --------------------------------------------------------------------
  function normalizeChartResponse(raw, symbol) {
    const result = raw?.chart?.result?.[0];
    if (!result) {
      const err = raw?.chart?.error;
      throw new Error(err?.description || `No data returned for ${symbol}`);
    }

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];

    const candles = timestamps
      .map((ts, i) => {
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        const volume = quote.volume?.[i];
        // Yahoo returns null for non-trading gaps inside the array — skip those
        if ([open, high, low, close].some((v) => v === null || v === undefined)) {
          return null;
        }
        return {
          timestamp: ts * 1000, // ms epoch
          date: new Date(ts * 1000).toISOString(),
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          adjClose: adjClose[i] != null ? Number(adjClose[i].toFixed(2)) : Number(close.toFixed(2)),
          volume: volume || 0,
        };
      })
      .filter(Boolean);

    const meta = result.meta || {};

    return {
      symbol,
      currency: meta.currency || 'INR',
      exchangeName: meta.exchangeName,
      instrumentType: meta.instrumentType,
      timezone: meta.exchangeTimezoneName,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      regularMarketPrice: meta.regularMarketPrice ?? null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
      candles,
      fetchedAt: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------
  // PUBLIC: getHistory
  // --------------------------------------------------------------------
  /**
   * @param {string} symbol   e.g. "RELIANCE" or "TATASTEEL.NS"
   * @param {string} range    Yahoo range token: "1d","5d","1mo","3mo","6mo","1y","2y","5y","max"
   * @param {string} interval Yahoo interval token: "1m","5m","15m","1d","1wk","1mo"
   *                          (intraday intervals only work with short ranges)
   */
  async function getHistory(symbol, range = '6mo', interval = '1d') {
    const sym = normalizeSymbol(symbol);
    const kind = interval.includes('m') && !interval.includes('mo') ? 'intraday' : 'daily';
    const key = cacheKey(kind, sym, range, interval);

    const cached = readCache(key, CONFIG.CACHE_TTL_MS[kind]);
    if (cached) return { ...cached, fromCache: true };

    const url = `${CONFIG.YAHOO_CHART_BASE}${sym}?range=${range}&interval=${interval}`;

    return enqueue(async () => {
      const raw = await fetchWithFallback(url);
      const normalized = normalizeChartResponse(raw, sym);
      writeCache(key, normalized);
      return { ...normalized, fromCache: false };
    });
  }

  // --------------------------------------------------------------------
  // PUBLIC: getQuote (latest price snapshot, derived from a 1d/5m pull)
  // --------------------------------------------------------------------
  async function getQuote(symbol) {
    const sym = normalizeSymbol(symbol);
    const key = cacheKey('quote', sym, '1d', '5m');

    const cached = readCache(key, CONFIG.CACHE_TTL_MS.quote);
    if (cached) return { ...cached, fromCache: true };

    const history = await getHistory(sym, '1d', '5m');
    const last = history.candles[history.candles.length - 1];

    const quote = {
      symbol: sym,
      price: last?.close ?? history.regularMarketPrice ?? null,
      open: last?.open ?? null,
      dayHigh: Math.max(...history.candles.map((c) => c.high), -Infinity),
      dayLow: Math.min(...history.candles.map((c) => c.low), Infinity),
      previousClose: history.previousClose,
      change: last && history.previousClose ? Number((last.close - history.previousClose).toFixed(2)) : null,
      changePct:
        last && history.previousClose
          ? Number((((last.close - history.previousClose) / history.previousClose) * 100).toFixed(2))
          : null,
      volume: history.candles.reduce((sum, c) => sum + (c.volume || 0), 0),
      fiftyTwoWeekHigh: history.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: history.fiftyTwoWeekLow,
      fetchedAt: new Date().toISOString(),
    };

    writeCache(key, quote);
    return { ...quote, fromCache: false };
  }

  // --------------------------------------------------------------------
  // PUBLIC: getBatch (many symbols, still respects the single queue/rate-limit)
  // --------------------------------------------------------------------
  /**
   * Fetches history for many symbols. Failures are isolated per-symbol so
   * one bad ticker never aborts the whole batch — the screener/pattern
   * engine can rely on this always resolving.
   *
   * @returns {Promise<{results: Object<string,object>, errors: Object<string,string>}>}
   */
  async function getBatch(symbols, range = '6mo', interval = '1d') {
    const results = {};
    const errors = {};

    // Sequential via the shared queue (not Promise.all) so we never burst
    // past MIN_REQUEST_GAP_MS across the whole batch, regardless of size.
    for (const rawSymbol of symbols) {
      const sym = normalizeSymbol(rawSymbol);
      try {
        results[sym] = await getHistory(sym, range, interval);
      } catch (err) {
        errors[sym] = err.message || 'Unknown fetch error';
      }
    }

    return { results, errors };
  }

  // --------------------------------------------------------------------
  // PUBLIC EXPORTS
  // --------------------------------------------------------------------
  return {
    getQuote,
    getHistory,
    getBatch,
    clearCache,
    getCacheInfo,
    normalizeSymbol, // exposed: useful for other modules (e.g. watchlists)
    _config: CONFIG,  // exposed read-only for debugging/tuning in console
  };
})();

// Support both browser <script> usage and future ES module / bundler usage
if (typeof window !== 'undefined') window.NSEData = NSEData;
if (typeof module !== 'undefined' && module.exports) module.exports = NSEData;
