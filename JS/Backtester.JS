/**
 * ============================================================================
 * NSE TRADING SYSTEM — BACKTESTING HARNESS (Day 6 of 7)
 * ============================================================================
 * Purpose: Before trusting ANY pattern's score from the Day 2 engine, run it
 *          against real history and see its actual historical win rate and
 *          expectancy. A pattern that "looks right" but backtests at a 35%
 *          win rate is a pattern you should stop trusting.
 *
 * THE ONE RULE THAT MATTERS: NO LOOKAHEAD BIAS.
 *   At each simulated "today" (index i), the detector only ever sees
 *   candles[0..i] — never a single bar beyond it. The entry is taken at
 *   the NEXT bar's open (you can't buy at today's close after seeing
 *   today's close — realistically you'd enter tomorrow morning), and
 *   forward returns are measured from that entry. This is slower than
 *   just running the detector once on the whole series and is
 *   deliberately built this way — that's the only way the backtest
 *   result means anything.
 *
 * Method:
 *   For each bar i (after a minimum warm-up window), run one detector on
 *   the trailing window candles[i-window..i]. If it fires with confidence
 *   >= minConfidence, record a signal. Entry = candles[i+1].open. For each
 *   forward-day horizon (default 5/10/20 trading days), exit price =
 *   candles[entryIndex + horizon].close. Compute return %, aggregate into
 *   win rate / average return / expectancy per horizon.
 *
 * Public API:
 *   Backtester.backtestPattern(candles, patternName, options)
 *   Backtester.backtestAll(candles, options)   -> runs every pattern type
 * ============================================================================
 */

const Backtester = (() => {
  'use strict';

  const DETECTOR_MAP = {
    breakout: 'detectBreakout',
    vcp: 'detectVCP',
    cupHandle: 'detectCupAndHandle',
    flag: 'detectFlagPennant',
    doubleBottom: 'detectDoubleBottom',
    gap: 'detectGap',
  };

  const DEFAULT_OPTIONS = {
    windowSize: 120, // trailing bars the detector sees at each simulated "today"
    forwardHorizons: [5, 10, 20], // trading days forward to measure return
    minConfidence: 60,
    minSignalSpacing: 5, // avoid clustering near-duplicate signals from the same pattern instance
  };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function pctChange(from, to) {
    if (!from) return 0;
    return ((to - from) / from) * 100;
  }

  // --------------------------------------------------------------------
  // SINGLE-PATTERN BACKTEST
  // --------------------------------------------------------------------
  function backtestPattern(candles, patternName, options = {}) {
    if (typeof PatternEngine === 'undefined') throw new Error('pattern-engine.js (PatternEngine) must be loaded');
    const detectorFn = PatternEngine[DETECTOR_MAP[patternName]];
    if (!detectorFn) throw new Error(`Unknown pattern name "${patternName}". Valid: ${Object.keys(DETECTOR_MAP).join(', ')}`);

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const maxHorizon = Math.max(...opts.forwardHorizons);
    const signals = [];

    let lastSignalIdx = -Infinity;

    // i is the index of "today" in full candles. We need i+1 (entry bar) and
    // i+1+maxHorizon (furthest exit bar) to exist, so stop early enough.
    for (let i = opts.windowSize; i < candles.length - maxHorizon - 1; i++) {
      if (i - lastSignalIdx < opts.minSignalSpacing) continue; // skip near-duplicate signals

      // CRITICAL: only pass data up to and including "today" — no future bars.
      const trailingWindow = candles.slice(i - opts.windowSize + 1, i + 1);

      let result;
      try {
        result = detectorFn(trailingWindow);
      } catch (err) {
        continue; // detector couldn't run on this window (e.g. insufficient data) — skip
      }

      if (!result.detected || result.confidence < opts.minConfidence) continue;

      const entryBar = candles[i + 1]; // enter at NEXT bar's open, not today's close
      const entryPrice = entryBar.open;
      const entryIndex = i + 1;

      const forwardReturns = {};
      opts.forwardHorizons.forEach((h) => {
        const exitBar = candles[entryIndex + h];
        if (!exitBar) {
          forwardReturns[h] = null;
          return;
        }
        forwardReturns[h] = round2(pctChange(entryPrice, exitBar.close));
      });

      signals.push({
        signalIndex: i,
        signalDate: candles[i].date,
        entryIndex,
        entryDate: entryBar.date,
        entryPrice: round2(entryPrice),
        confidence: result.confidence,
        forwardReturns,
      });

      lastSignalIdx = i;
    }

    // Aggregate per forward horizon
    const byHorizon = {};
    opts.forwardHorizons.forEach((h) => {
      const returns = signals.map((s) => s.forwardReturns[h]).filter((r) => r !== null);
      if (returns.length === 0) {
        byHorizon[h] = { sampleSize: 0, winRatePct: null, avgReturnPct: null, expectancyPct: null };
        return;
      }
      const wins = returns.filter((r) => r > 0);
      const losses = returns.filter((r) => r <= 0);
      const winRatePct = round2((wins.length / returns.length) * 100);
      const avgReturnPct = round2(returns.reduce((a, b) => a + b, 0) / returns.length);
      const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
      const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
      // Expectancy: (win% * avgWin) + (loss% * avgLoss) — avgLoss is negative, so this nets correctly
      const expectancyPct = round2((wins.length / returns.length) * avgWin + (losses.length / returns.length) * avgLoss);

      byHorizon[h] = {
        sampleSize: returns.length,
        winRatePct,
        avgReturnPct,
        avgWinPct: round2(avgWin),
        avgLossPct: round2(avgLoss),
        expectancyPct,
      };
    });

    return {
      pattern: patternName,
      totalSignals: signals.length,
      byHorizon,
      signals: signals.slice(-30), // cap returned signal list to the most recent 30 to keep payload small
      warning:
        signals.length < 20
          ? `Only ${signals.length} historical signals found — sample size is too small to draw reliable conclusions. Treat any win rate here as indicative at best.`
          : null,
    };
  }

  // --------------------------------------------------------------------
  // BACKTEST EVERY PATTERN TYPE
  // --------------------------------------------------------------------
  function backtestAll(candles, options = {}) {
    const results = {};
    Object.keys(DETECTOR_MAP).forEach((name) => {
      try {
        results[name] = backtestPattern(candles, name, options);
      } catch (err) {
        results[name] = { pattern: name, error: err.message };
      }
    });

    // Rank patterns by expectancy at the 10-day horizon (or first available)
    const ranked = Object.values(results)
      .filter((r) => !r.error && r.totalSignals > 0)
      .sort((a, b) => {
        const aExp = a.byHorizon[10]?.expectancyPct ?? a.byHorizon[Object.keys(a.byHorizon)[0]]?.expectancyPct ?? -999;
        const bExp = b.byHorizon[10]?.expectancyPct ?? b.byHorizon[Object.keys(b.byHorizon)[0]]?.expectancyPct ?? -999;
        return bExp - aExp;
      })
      .map((r) => r.pattern);

    return { byPattern: results, rankedByExpectancy: ranked };
  }

  return { backtestPattern, backtestAll, DETECTOR_MAP, DEFAULT_OPTIONS };
})();

if (typeof window !== 'undefined') window.Backtester = Backtester;
if (typeof module !== 'undefined' && module.exports) module.exports = Backtester;
