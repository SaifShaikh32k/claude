/**
 * ============================================================================
 * NSE TRADING SYSTEM — SCREENER (Day 3 of 7)
 * ============================================================================
 * Purpose: Run the Day 2 pattern engine and a relative-strength calculation
 *          across an entire stock universe (js/nse-universe.js), then rank
 *          results by composite setup quality AND by sector rotation —
 *          telling you not just "what looks good" but "which sectors money
 *          is actually rotating into right now."
 *
 * Depends on:
 *   - js/data-layer.js    (NSEData.getHistory / getBatch)
 *   - js/pattern-engine.js (PatternEngine.analyze)
 *
 * Relative Strength (RS) method:
 *   For each stock, over N-day and M-day windows, compute the stock's %
 *   price change minus the benchmark's (Nifty 50, ticker "^NSEI") % change
 *   over the same window. Positive = outperforming the index (classic IBD/
 *   Minervini-style relative strength, without needing a paid RS-rating feed).
 *
 * Public API:
 *   Screener.runScreener(universe, options, onProgress) -> full report
 *   Screener.computeRelativeStrength(stockCandles, benchmarkCandles)
 *   Screener.rankSectors(results)
 * ============================================================================
 */

const Screener = (() => {
  'use strict';

  const BENCHMARK_SYMBOL = '^NSEI'; // Nifty 50 index, Yahoo ticker

  const DEFAULT_OPTIONS = {
    range: '1y',
    interval: '1d',
    rsWindows: [21, 63], // ~1 month, ~3 months of trading days
    minCompositeScore: 0, // set >0 to only return stocks with active setups
  };

  function pctChange(from, to) {
    if (!from) return 0;
    return ((to - from) / from) * 100;
  }

  // --------------------------------------------------------------------
  // RELATIVE STRENGTH
  // --------------------------------------------------------------------
  /**
   * Returns per-window RS values: stock % change minus benchmark % change,
   * for each window size in `windows` (trading days, counted back from the
   * most recent candle in each series).
   */
  function computeRelativeStrength(stockCandles, benchmarkCandles, windows = DEFAULT_OPTIONS.rsWindows) {
    const results = {};
    const stockLast = stockCandles[stockCandles.length - 1];
    const benchLast = benchmarkCandles[benchmarkCandles.length - 1];

    windows.forEach((w) => {
      const stockPast = stockCandles[stockCandles.length - 1 - w];
      const benchPast = benchmarkCandles[benchmarkCandles.length - 1 - w];
      if (!stockPast || !benchPast) {
        results[`rs_${w}d`] = null;
        return;
      }
      const stockPct = pctChange(stockPast.close, stockLast.close);
      const benchPct = pctChange(benchPast.close, benchLast.close);
      results[`rs_${w}d`] = Number((stockPct - benchPct).toFixed(2));
      results[`stockPct_${w}d`] = Number(stockPct.toFixed(2));
      results[`benchPct_${w}d`] = Number(benchPct.toFixed(2));
    });

    // Blended RS score: average of the window RS values that are available,
    // weighted slightly toward the shorter window (more responsive to
    // rotation happening right now).
    const available = windows.map((w) => results[`rs_${w}d`]).filter((v) => v !== null);
    results.rsBlended =
      available.length > 0
        ? Number((available.reduce((a, b, i) => a + b * (i === 0 ? 1.5 : 1), 0) / (available.length === 1 ? 1 : 2.5)).toFixed(2))
        : null;

    return results;
  }

  // --------------------------------------------------------------------
  // MAIN SCREENER RUN
  // --------------------------------------------------------------------
  /**
   * @param {Array<{symbol,name,sector}>} universe
   * @param {object} options  see DEFAULT_OPTIONS
   * @param {function} onProgress  optional (current, total, symbol) => void,
   *                                called after each stock so a UI can show
   *                                a progress bar (a 140-stock run takes a
   *                                few minutes due to rate-limit spacing).
   */
  async function runScreener(universe, options = {}, onProgress = null) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!Array.isArray(universe) || universe.length === 0) {
      throw new Error('runScreener requires a non-empty universe array');
    }
    if (typeof NSEData === 'undefined') throw new Error('NSEData (data-layer.js) is required but not loaded');
    if (typeof PatternEngine === 'undefined') throw new Error('PatternEngine (pattern-engine.js) is required but not loaded');

    // Fetch benchmark once — every stock's RS is measured against this same series
    const benchmark = await NSEData.getHistory(BENCHMARK_SYMBOL, opts.range, opts.interval);

    const results = [];
    const errors = {};

    for (let i = 0; i < universe.length; i++) {
      const stock = universe[i];
      try {
        const hist = await NSEData.getHistory(stock.symbol, opts.range, opts.interval);
        if (hist.candles.length < 40) {
          errors[stock.symbol] = 'Insufficient history returned';
          if (onProgress) onProgress(i + 1, universe.length, stock.symbol);
          continue;
        }

        const patternReport = PatternEngine.analyze(hist.candles, stock.symbol);
        const rs = computeRelativeStrength(hist.candles, benchmark.candles, opts.rsWindows);

        results.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          lastClose: patternReport.lastClose,
          asOf: patternReport.asOf,
          stage: patternReport.stage.detected ? patternReport.stage.label : 'Unknown',
          stageNum: patternReport.stage.detected ? patternReport.stage.stage : null,
          compositeScore: patternReport.compositeScore,
          detectedPatterns: patternReport.detectedPatterns.map((p) => p.name),
          rs,
          // Screener rank score blends setup quality with relative strength,
          // so a stock needs BOTH a real pattern AND market leadership to
          // rank highly — not just one or the other.
          screenerScore: Number(
            (patternReport.compositeScore * 0.6 + Math.max(0, Math.min(rs.rsBlended || 0, 50)) * 0.8).toFixed(1)
          ),
        });
      } catch (err) {
        errors[stock.symbol] = err.message || 'Unknown error';
      }
      if (onProgress) onProgress(i + 1, universe.length, stock.symbol);
    }

    const filtered = results.filter((r) => r.compositeScore >= opts.minCompositeScore);
    const rankedResults = filtered.sort((a, b) => b.screenerScore - a.screenerScore);
    const sectorRanking = rankSectors(results);

    return {
      asOf: new Date().toISOString(),
      benchmarkSymbol: BENCHMARK_SYMBOL,
      universeSize: universe.length,
      succeeded: results.length,
      failed: Object.keys(errors).length,
      errors,
      results: rankedResults,
      sectorRanking,
    };
  }

  // --------------------------------------------------------------------
  // SECTOR ROTATION RANKING
  // --------------------------------------------------------------------
  /**
   * Averages relative strength (blended) across all stocks in each sector,
   * so you can see which sectors are actually leading vs lagging the index
   * right now — the "where is money rotating into" question.
   */
  function rankSectors(results) {
    const bySector = {};
    results.forEach((r) => {
      if (r.rs.rsBlended === null || r.rs.rsBlended === undefined) return;
      if (!bySector[r.sector]) bySector[r.sector] = { sector: r.sector, rsValues: [], compositeValues: [], count: 0 };
      bySector[r.sector].rsValues.push(r.rs.rsBlended);
      bySector[r.sector].compositeValues.push(r.compositeScore);
      bySector[r.sector].count += 1;
    });

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    return Object.values(bySector)
      .map((s) => ({
        sector: s.sector,
        avgRelativeStrength: Number(avg(s.rsValues).toFixed(2)),
        avgCompositeScore: Number(avg(s.compositeValues).toFixed(1)),
        stockCount: s.count,
      }))
      .sort((a, b) => b.avgRelativeStrength - a.avgRelativeStrength);
  }

  // --------------------------------------------------------------------
  // PUBLIC EXPORTS
  // --------------------------------------------------------------------
  return {
    runScreener,
    computeRelativeStrength,
    rankSectors,
    BENCHMARK_SYMBOL,
  };
})();

if (typeof window !== 'undefined') window.Screener = Screener;
if (typeof module !== 'undefined' && module.exports) module.exports = Screener;
