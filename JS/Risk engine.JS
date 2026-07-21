/**
 * ============================================================================
 * NSE TRADING SYSTEM — RISK ENGINE (Day 4 of 7)
 * ============================================================================
 * Purpose: This is the module that actually protects capital. A pattern
 *          engine can be wrong; a risk engine that's followed consistently
 *          is what keeps one wrong trade from becoming a account-damaging
 *          one. Every function here is deliberately simple and transparent
 *          — risk math should never be a black box you have to trust.
 *
 * Covers:
 *   - Position sizing from account risk %, entry, and stop
 *   - ATR-based stop-loss suggestion (volatility-adjusted, not a fixed %)
 *   - Reward:risk ratio check against a target
 *   - Portfolio heat: total open risk across all positions right now
 *   - Sector concentration: are you stacking correlated bets without
 *     realizing it (e.g. 5 different "long crude" names at once)?
 *
 * Depends on:
 *   - js/pattern-engine.js's `_helpers.atr` for ATR-based stops (optional —
 *     you can also pass a plain candles array and this module computes ATR
 *     itself, so it works standalone too)
 *
 * Public API:
 *   RiskEngine.calcPositionSize({ capital, riskPct, entry, stop })
 *   RiskEngine.calcATRStop(candles, { multiplier, period })
 *   RiskEngine.calcRewardRisk({ entry, stop, target })
 *   RiskEngine.portfolioHeat(openPositions)
 *   RiskEngine.sectorConcentration(openPositions)
 *   RiskEngine.evaluateTrade({ capital, riskPct, entry, stop, target, openPositions })
 * ============================================================================
 */

const RiskEngine = (() => {
  'use strict';

  const DEFAULTS = {
    maxRiskPerTradePct: 1.0, // % of capital risked on a single trade — conservative default
    maxPortfolioHeatPct: 8.0, // total open risk across all positions before "stop adding risk"
    maxSectorConcentrationPct: 30.0, // % of total risk capital in one sector before flagging
    atrMultiplier: 2.5,
    atrPeriod: 14,
  };

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // --------------------------------------------------------------------
  // POSITION SIZING
  // --------------------------------------------------------------------
  /**
   * The core rule: never decide position size from "how much do I want to
   * own" — decide it from "how much am I willing to lose if the stop is
   * hit." Shares = (capital * riskPct) / (entry - stop).
   *
   * @param {object} p
   * @param {number} p.capital   total trading capital available (₹)
   * @param {number} p.riskPct   % of capital to risk on this trade (e.g. 1 = 1%)
   * @param {number} p.entry     planned entry price
   * @param {number} p.stop      planned stop-loss price (must be below entry for a long)
   */
  function calcPositionSize({ capital, riskPct, entry, stop }) {
    if (!capital || capital <= 0) throw new Error('capital must be a positive number');
    if (!riskPct || riskPct <= 0) throw new Error('riskPct must be a positive number');
    if (!entry || entry <= 0) throw new Error('entry must be a positive number');
    if (stop === undefined || stop === null) throw new Error('stop is required');

    const riskPerShare = Math.abs(entry - stop);
    if (riskPerShare === 0) throw new Error('entry and stop cannot be equal — no risk-per-share to size against');

    const riskAmount = capital * (riskPct / 100);
    const rawShares = riskAmount / riskPerShare;
    const shares = Math.floor(rawShares);
    const positionValue = shares * entry;
    const actualRiskAmount = shares * riskPerShare;
    const positionPctOfCapital = (positionValue / capital) * 100;

    const warnings = [];
    if (positionValue > capital) {
      warnings.push(
        'Position value exceeds total capital at this share count — your stop is too close relative to account size for full sizing; consider a wider stop, smaller riskPct, or accept a smaller position than the raw risk math suggests.'
      );
    }
    if (riskPerShare / entry > 0.15) {
      warnings.push('Stop is more than 15% away from entry — this is a wide stop; double-check it reflects real support, not just a round number.');
    }

    return {
      shares,
      riskAmount: round2(riskAmount),
      actualRiskAmount: round2(actualRiskAmount),
      riskPerShare: round2(riskPerShare),
      positionValue: round2(positionValue),
      positionPctOfCapital: round2(positionPctOfCapital),
      warnings,
    };
  }

  // --------------------------------------------------------------------
  // ATR-BASED STOP-LOSS
  // --------------------------------------------------------------------
  /**
   * Volatility-adjusted stop: entry - (ATR * multiplier). This adapts to
   * how much the stock actually moves day-to-day, instead of a fixed %
   * that's too tight for a volatile stock and too loose for a quiet one.
   *
   * @param {Array} candles   OHLCV candles (see data-layer.js getHistory)
   * @param {object} options  { multiplier = 2.5, period = 14, entry }
   *                          if entry is omitted, uses the last close as entry
   */
  function calcATRStop(candles, options = {}) {
    if (!Array.isArray(candles) || candles.length < 2) {
      throw new Error('calcATRStop requires at least 2 candles');
    }
    const multiplier = options.multiplier ?? DEFAULTS.atrMultiplier;
    const period = options.period ?? DEFAULTS.atrPeriod;

    // Compute ATR inline (kept self-contained so this module works without
    // pattern-engine.js loaded, but will reuse it if present to avoid drift)
    let atrSeries;
    if (typeof PatternEngine !== 'undefined' && PatternEngine._helpers?.atr) {
      atrSeries = PatternEngine._helpers.atr(candles, period);
    } else {
      const trs = [0];
      for (let i = 1; i < candles.length; i++) {
        const curr = candles[i];
        const prev = candles[i - 1];
        trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev.close), Math.abs(curr.low - prev.close)));
      }
      atrSeries = trs.map((_, i) => {
        const start = Math.max(0, i - period + 1);
        const slice = trs.slice(start, i + 1);
        return i >= period - 1 ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
      });
    }

    const lastATR = atrSeries[atrSeries.length - 1];
    if (lastATR === null || lastATR === undefined) {
      throw new Error(`Not enough candles to compute a ${period}-period ATR`);
    }

    const entry = options.entry ?? candles[candles.length - 1].close;
    const suggestedStop = round2(entry - lastATR * multiplier);
    const stopDistancePct = round2(((entry - suggestedStop) / entry) * 100);

    return {
      entry: round2(entry),
      atr: round2(lastATR),
      multiplier,
      suggestedStop,
      stopDistancePct,
    };
  }

  // --------------------------------------------------------------------
  // REWARD:RISK
  // --------------------------------------------------------------------
  function calcRewardRisk({ entry, stop, target }) {
    if (!entry || stop === undefined || !target) throw new Error('entry, stop, and target are all required');
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk === 0) throw new Error('entry and stop cannot be equal');
    const ratio = Number((reward / risk).toFixed(2));

    return {
      risk: round2(risk),
      reward: round2(reward),
      ratio,
      meetsMinimum: ratio >= 2, // common baseline: don't take trades below 2:1
      verdict:
        ratio >= 3
          ? 'Strong reward:risk'
          : ratio >= 2
          ? 'Acceptable reward:risk'
          : 'Weak reward:risk — reward does not justify the risk taken',
    };
  }

  // --------------------------------------------------------------------
  // PORTFOLIO HEAT
  // --------------------------------------------------------------------
  /**
   * Sums the risk (in ₹ and in % of capital) currently "live" across all
   * open positions — i.e. what you'd actually lose if every single stop
   * got hit today. This is the number that keeps you from unconsciously
   * over-leveraging by adding "just one more small position" repeatedly.
   *
   * @param {Array<{symbol, sector, capital, entry, stop, shares}>} openPositions
   *        `capital` here should be the SAME total account capital figure
   *        for every position (i.e. your total trading capital), not
   *        per-position capital — it's used to express heat as % of the account.
   */
  function portfolioHeat(openPositions) {
    if (!Array.isArray(openPositions) || openPositions.length === 0) {
      return { totalRiskAmount: 0, totalHeatPct: 0, withinLimit: true, positions: [] };
    }

    const capital = openPositions[0].capital;
    const positions = openPositions.map((p) => {
      const riskPerShare = Math.abs(p.entry - p.stop);
      const riskAmount = riskPerShare * p.shares;
      const heatPct = capital ? (riskAmount / capital) * 100 : 0;
      return { symbol: p.symbol, sector: p.sector, riskAmount: round2(riskAmount), heatPct: round2(heatPct) };
    });

    const totalRiskAmount = round2(positions.reduce((s, p) => s + p.riskAmount, 0));
    const totalHeatPct = round2(positions.reduce((s, p) => s + p.heatPct, 0));

    return {
      totalRiskAmount,
      totalHeatPct,
      withinLimit: totalHeatPct <= DEFAULTS.maxPortfolioHeatPct,
      limit: DEFAULTS.maxPortfolioHeatPct,
      positions,
    };
  }

  // --------------------------------------------------------------------
  // SECTOR CONCENTRATION
  // --------------------------------------------------------------------
  /**
   * Flags when too much of your total open RISK (not just capital, but
   * risk) sits in one sector — the thing that turns "five separate good
   * trades" into "one large correlated bet without realizing it."
   */
  function sectorConcentration(openPositions) {
    const heat = portfolioHeat(openPositions);
    if (heat.positions.length === 0) return { bySector: [], flagged: [] };

    const bySectorMap = {};
    heat.positions.forEach((p) => {
      const sector = p.sector || 'Unknown';
      if (!bySectorMap[sector]) bySectorMap[sector] = 0;
      bySectorMap[sector] += p.riskAmount;
    });

    const bySector = Object.entries(bySectorMap)
      .map(([sector, riskAmount]) => ({
        sector,
        riskAmount: round2(riskAmount),
        pctOfTotalRisk: heat.totalRiskAmount ? round2((riskAmount / heat.totalRiskAmount) * 100) : 0,
      }))
      .sort((a, b) => b.pctOfTotalRisk - a.pctOfTotalRisk);

    const flagged = bySector.filter((s) => s.pctOfTotalRisk > DEFAULTS.maxSectorConcentrationPct);

    return { bySector, flagged, limit: DEFAULTS.maxSectorConcentrationPct };
  }

  // --------------------------------------------------------------------
  // COMBINED TRADE EVALUATION
  // --------------------------------------------------------------------
  /**
   * Convenience wrapper: given a proposed trade plus your existing open
   * positions, returns position size, reward:risk, and what your portfolio
   * heat WOULD become if you took this trade — so you see the consequence
   * before you act, not after.
   */
  function evaluateTrade({ capital, riskPct, entry, stop, target, sector, openPositions = [] }) {
    const sizing = calcPositionSize({ capital, riskPct, entry, stop });
    const rewardRisk = target ? calcRewardRisk({ entry, stop, target }) : null;

    const hypotheticalPositions = [
      ...openPositions,
      { symbol: 'PROPOSED', sector, capital, entry, stop, shares: sizing.shares },
    ];
    const projectedHeat = portfolioHeat(hypotheticalPositions);
    const projectedConcentration = sectorConcentration(hypotheticalPositions);

    const blockers = [];
    if (!projectedHeat.withinLimit) {
      blockers.push(`Taking this trade would push portfolio heat to ${projectedHeat.totalHeatPct}%, above the ${DEFAULTS.maxPortfolioHeatPct}% limit.`);
    }
    const overConcentrated = projectedConcentration.flagged.find((f) => f.sector === sector);
    if (overConcentrated) {
      blockers.push(`This would put ${overConcentrated.pctOfTotalRisk}% of total open risk in ${sector}, above the ${DEFAULTS.maxSectorConcentrationPct}% limit.`);
    }
    if (rewardRisk && !rewardRisk.meetsMinimum) {
      blockers.push(`Reward:risk is only ${rewardRisk.ratio}:1 — below the 2:1 minimum.`);
    }

    return {
      sizing,
      rewardRisk,
      projectedPortfolioHeatPct: projectedHeat.totalHeatPct,
      projectedSectorPct: overConcentrated ? overConcentrated.pctOfTotalRisk : null,
      blockers,
      verdict: blockers.length === 0 ? 'Trade passes risk checks' : 'Trade flagged — review blockers before proceeding',
    };
  }

  // --------------------------------------------------------------------
  // PUBLIC EXPORTS
  // --------------------------------------------------------------------
  return {
    calcPositionSize,
    calcATRStop,
    calcRewardRisk,
    portfolioHeat,
    sectorConcentration,
    evaluateTrade,
    DEFAULTS,
  };
})();

if (typeof window !== 'undefined') window.RiskEngine = RiskEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = RiskEngine;
