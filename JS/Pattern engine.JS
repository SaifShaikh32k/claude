/**
 * ============================================================================
 * NSE TRADING SYSTEM — PATTERN & SETUP ENGINE (Day 2 of 7)
 * ============================================================================
 * Purpose: Take OHLCV candles (from js/data-layer.js) and detect structural
 *          chart patterns with a confidence score, plus Weinstein stage
 *          context — the same context a discretionary chart reader uses
 *          before trusting any single pattern.
 *
 * Design principle: every detector is a PURE FUNCTION — candles in, a
 * result object out. No fetching, no caching, no DOM. That means the
 * screener (Day 3) and backtester (Day 6) can both call these same
 * functions without duplicating logic.
 *
 * Detectors included:
 *   - detectStage        Weinstein Stage 1-4 classification
 *   - detectBreakout     Consolidation breakout + volume confirmation
 *   - detectVCP          Volatility Contraction Pattern (Minervini-style)
 *   - detectCupAndHandle Cup-and-handle base
 *   - detectFlagPennant  Pole + tight consolidation
 *   - detectDoubleBottom Double bottom / "W" reversal
 *   - detectGap          Gap up/down with volume confirmation
 *
 * Public API:
 *   PatternEngine.analyze(candles, symbol) -> full report, all detectors run
 *   PatternEngine.detectStage(candles)
 *   PatternEngine.detectBreakout(candles)
 *   PatternEngine.detectVCP(candles)
 *   PatternEngine.detectCupAndHandle(candles)
 *   PatternEngine.detectFlagPennant(candles)
 *   PatternEngine.detectDoubleBottom(candles)
 *   PatternEngine.detectGap(candles)
 * ============================================================================
 */

const PatternEngine = (() => {
  'use strict';

  // --------------------------------------------------------------------
  // MATH / SERIES HELPERS
  // --------------------------------------------------------------------
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function stdDev(values) {
    const n = values.length;
    if (n === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  function pctChange(from, to) {
    if (!from) return 0;
    return ((to - from) / from) * 100;
  }

  function avgVolume(candles, period, endIndex) {
    const start = Math.max(0, endIndex - period + 1);
    const slice = candles.slice(start, endIndex + 1);
    if (slice.length === 0) return 0;
    return slice.reduce((s, c) => s + c.volume, 0) / slice.length;
  }

  function trueRange(curr, prev) {
    return Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
  }

  function atr(candles, period = 14) {
    const trs = [0];
    for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i], candles[i - 1]));
    return sma(trs, period);
  }

  // Local swing highs/lows: a bar is a pivot high if its high is the max
  // within [i-left, i+right], pivot low if its low is the min in that window.
  function findPivots(candles, left = 3, right = 3) {
    const pivots = [];
    for (let i = left; i < candles.length - right; i++) {
      const windowSlice = candles.slice(i - left, i + right + 1);
      const highs = windowSlice.map((c) => c.high);
      const lows = windowSlice.map((c) => c.low);
      if (candles[i].high === Math.max(...highs)) {
        pivots.push({ index: i, price: candles[i].high, type: 'high', volume: candles[i].volume });
      }
      if (candles[i].low === Math.min(...lows)) {
        pivots.push({ index: i, price: candles[i].low, type: 'low', volume: candles[i].volume });
      }
    }
    return pivots.sort((a, b) => a.index - b.index);
  }

  function clampScore(n) {
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  const MIN_CANDLES = {
    stage: 60,
    breakout: 25,
    vcp: 60,
    cupHandle: 60,
    flag: 20,
    doubleBottom: 40,
    gap: 2,
  };

  function insufficientData(needed, got) {
    return { detected: false, confidence: 0, reason: `Insufficient data (need ${needed}, have ${got})` };
  }

  // --------------------------------------------------------------------
  // WEINSTEIN STAGE ANALYSIS
  // --------------------------------------------------------------------
  /**
   * Classifies the stock into Stage 1 (basing), 2 (advancing), 3 (topping),
   * or 4 (declining) using a long moving average and its slope, relative to
   * the 52-week range. Uses a 150-period MA on daily data (~30 trading
   * weeks) as the standard Weinstein proxy; falls back to a shorter MA
   * (min 30) if less history is available, with reduced confidence.
   */
  function detectStage(candles) {
    if (candles.length < MIN_CANDLES.stage) return insufficientData(MIN_CANDLES.stage, candles.length);

    const closes = candles.map((c) => c.close);
    const maPeriod = Math.min(150, Math.max(30, Math.floor(candles.length * 0.6)));
    const usingShortProxy = maPeriod < 150;
    const ma = sma(closes, maPeriod);

    const lastIdx = candles.length - 1;
    const lastClose = closes[lastIdx];
    const lastMA = ma[lastIdx];
    if (lastMA === null) return insufficientData(maPeriod, candles.length);

    // Slope: compare current MA to MA ~20 bars back (~1 month)
    const slopeLookback = Math.min(20, lastIdx - maPeriod);
    const priorMA = slopeLookback > 0 ? ma[lastIdx - slopeLookback] : ma[maPeriod - 1];
    const maSlopePct = priorMA ? pctChange(priorMA, lastMA) : 0;

    const lookbackRange = candles.slice(-Math.min(252, candles.length));
    const high52w = Math.max(...lookbackRange.map((c) => c.high));
    const low52w = Math.min(...lookbackRange.map((c) => c.low));
    const pctOffHigh = pctChange(high52w, lastClose); // negative number
    const pctOffLow = pctChange(low52w, lastClose); // positive number

    const priceAboveMA = lastClose > lastMA;
    const maFlat = Math.abs(maSlopePct) < 1.5;
    const maRising = maSlopePct >= 1.5;
    const maFalling = maSlopePct <= -1.5;

    let stage, label, confidence;

    if (priceAboveMA && maRising && pctOffHigh > -15) {
      stage = 2;
      label = 'Stage 2 — Advancing';
      confidence = clampScore(60 + Math.min(maSlopePct, 20) + (pctOffHigh > -8 ? 10 : 0));
    } else if (!priceAboveMA && maFalling) {
      stage = 4;
      label = 'Stage 4 — Declining';
      confidence = clampScore(60 + Math.min(Math.abs(maSlopePct), 20));
    } else if (maFlat && pctOffLow < 25) {
      stage = 1;
      label = 'Stage 1 — Basing';
      confidence = clampScore(55 + (pctOffLow < 12 ? 15 : 0));
    } else if (priceAboveMA && (maFlat || maFalling) && pctOffHigh > -12) {
      stage = 3;
      label = 'Stage 3 — Topping';
      confidence = clampScore(55 + (Math.abs(maSlopePct) < 3 ? 10 : 0));
    } else {
      // Transitional / ambiguous — still report best guess with lower confidence
      stage = priceAboveMA ? 2 : 4;
      label = priceAboveMA ? 'Stage 2 (weak) — Advancing' : 'Stage 4 (weak) — Declining';
      confidence = 40;
    }

    if (usingShortProxy) confidence = clampScore(confidence * 0.85);

    return {
      detected: true,
      stage,
      label,
      confidence,
      maPeriod,
      usingShortProxy,
      maSlopePct: Number(maSlopePct.toFixed(2)),
      pctOffHigh: Number(pctOffHigh.toFixed(2)),
      pctOffLow: Number(pctOffLow.toFixed(2)),
      lastClose,
      lastMA: Number(lastMA.toFixed(2)),
    };
  }

  // --------------------------------------------------------------------
  // BREAKOUT DETECTION
  // --------------------------------------------------------------------
  /**
   * Looks for a tight consolidation range over the last `lookback` bars
   * (excluding the most recent bar), then checks whether the latest close
   * breaks above that range's high on above-average volume.
   */
  function detectBreakout(candles, lookback = 20) {
    if (candles.length < MIN_CANDLES.breakout) return insufficientData(MIN_CANDLES.breakout, candles.length);

    const lastIdx = candles.length - 1;
    const rangeSlice = candles.slice(lastIdx - lookback, lastIdx); // excludes latest bar
    const rangeHigh = Math.max(...rangeSlice.map((c) => c.high));
    const rangeLow = Math.min(...rangeSlice.map((c) => c.low));
    const rangeTightnessPct = pctChange(rangeLow, rangeHigh); // width of range as % of low

    const today = candles[lastIdx];
    const avgVol = avgVolume(candles, lookback, lastIdx - 1);
    const volumeRatio = avgVol ? today.volume / avgVol : 0;

    const isBreakout = today.close > rangeHigh && volumeRatio >= 1.3;
    if (!isBreakout) {
      return {
        detected: false,
        confidence: 0,
        rangeHigh: Number(rangeHigh.toFixed(2)),
        rangeLow: Number(rangeLow.toFixed(2)),
        rangeTightnessPct: Number(rangeTightnessPct.toFixed(2)),
        volumeRatio: Number(volumeRatio.toFixed(2)),
        reason: today.close <= rangeHigh ? 'Price has not cleared range high' : 'Volume confirmation missing',
      };
    }

    // Tighter prior range + bigger volume surge = higher-quality breakout
    let confidence = 50;
    if (rangeTightnessPct < 8) confidence += 20;
    else if (rangeTightnessPct < 15) confidence += 10;
    confidence += Math.min((volumeRatio - 1.3) * 15, 25);

    return {
      detected: true,
      confidence: clampScore(confidence),
      breakoutLevel: Number(rangeHigh.toFixed(2)),
      rangeLow: Number(rangeLow.toFixed(2)),
      rangeTightnessPct: Number(rangeTightnessPct.toFixed(2)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
      suggestedStop: Number(rangeLow.toFixed(2)), // conservative: below the base
    };
  }

  // --------------------------------------------------------------------
  // VOLATILITY CONTRACTION PATTERN (VCP)
  // --------------------------------------------------------------------
  /**
   * Identifies a series of successive pullbacks (swing-high to swing-low)
   * where each pullback is shallower than the last, ideally accompanied by
   * declining volume — the classic Minervini-style contraction that often
   * precedes a breakout.
   */
  function detectVCP(candles, lookback = 90) {
    if (candles.length < MIN_CANDLES.vcp) return insufficientData(MIN_CANDLES.vcp, candles.length);

    const windowCandles = candles.slice(-lookback);
    const offset = candles.length - windowCandles.length;
    const pivots = findPivots(windowCandles, 3, 3);

    if (pivots.length < 4) {
      return { detected: false, confidence: 0, reason: 'Not enough swing points to assess contraction' };
    }

    // Build contraction legs: consecutive high->low pivot pairs
    const legs = [];
    for (let i = 0; i < pivots.length - 1; i++) {
      if (pivots[i].type === 'high' && pivots[i + 1].type === 'low') {
        const depthPct = Math.abs(pctChange(pivots[i].price, pivots[i + 1].price));
        legs.push({
          startIdx: pivots[i].index,
          endIdx: pivots[i + 1].index,
          depthPct,
          volume: avgVolume(windowCandles, pivots[i + 1].index - pivots[i].index || 1, pivots[i + 1].index),
        });
      }
    }

    if (legs.length < 2) {
      return { detected: false, confidence: 0, reason: 'Fewer than 2 pullback legs identified' };
    }

    // Use the most recent 2-4 legs to check for contraction
    const recentLegs = legs.slice(-4);
    let contractingCount = 0;
    for (let i = 1; i < recentLegs.length; i++) {
      if (recentLegs[i].depthPct < recentLegs[i - 1].depthPct) contractingCount++;
    }
    const isContracting = contractingCount >= recentLegs.length - 2 && recentLegs.length >= 2;

    let volumeDryingUp = false;
    if (recentLegs.length >= 2) {
      const firstVol = recentLegs[0].volume;
      const lastVol = recentLegs[recentLegs.length - 1].volume;
      volumeDryingUp = firstVol > 0 && lastVol < firstVol * 0.85;
    }

    if (!isContracting) {
      return {
        detected: false,
        confidence: 0,
        legDepths: recentLegs.map((l) => Number(l.depthPct.toFixed(1))),
        reason: 'Pullback depths are not consistently contracting',
      };
    }

    let confidence = 50 + contractingCount * 10;
    if (volumeDryingUp) confidence += 15;
    if (recentLegs[recentLegs.length - 1].depthPct < 10) confidence += 10; // tight final contraction

    return {
      detected: true,
      confidence: clampScore(confidence),
      legDepths: recentLegs.map((l) => Number(l.depthPct.toFixed(1))),
      volumeDryingUp,
      finalContractionPct: Number(recentLegs[recentLegs.length - 1].depthPct.toFixed(1)),
      lastPivotIndexAbs: recentLegs[recentLegs.length - 1].endIdx + offset,
    };
  }

  // --------------------------------------------------------------------
  // CUP AND HANDLE
  // --------------------------------------------------------------------
  /**
   * Splits the lookback window into thirds: left lip (high), cup bottom
   * (low), right lip (high, should recover near the left lip). Then checks
   * the most recent bars for a shallow "handle" pullback near the highs.
   */
  function detectCupAndHandle(candles, lookback = 90) {
    if (candles.length < MIN_CANDLES.cupHandle) return insufficientData(MIN_CANDLES.cupHandle, candles.length);

    const win = candles.slice(-lookback);
    const third = Math.floor(win.length / 3);
    const leftSlice = win.slice(0, third);
    const midSlice = win.slice(third, third * 2);
    const rightSlice = win.slice(third * 2);

    const leftLip = Math.max(...leftSlice.map((c) => c.high));
    const cupBottom = Math.min(...midSlice.map((c) => c.low));
    const rightLip = Math.max(...rightSlice.map((c) => c.high));

    const cupDepthPct = Math.abs(pctChange(leftLip, cupBottom));
    const lipSymmetryPct = Math.abs(pctChange(leftLip, rightLip));

    // Handle: last ~10-15% of candles, should pull back modestly from rightLip
    const handleLen = Math.max(5, Math.floor(win.length * 0.12));
    const handleSlice = win.slice(-handleLen);
    const handleLow = Math.min(...handleSlice.map((c) => c.low));
    const handleDepthPct = Math.abs(pctChange(rightLip, handleLow));
    const lastClose = win[win.length - 1].close;

    const validCup = cupDepthPct >= 12 && cupDepthPct <= 50 && lipSymmetryPct <= 8;
    const validHandle = handleDepthPct > 0 && handleDepthPct <= cupDepthPct * 0.4 && lastClose >= handleLow;

    if (!validCup) {
      return {
        detected: false,
        confidence: 0,
        cupDepthPct: Number(cupDepthPct.toFixed(1)),
        lipSymmetryPct: Number(lipSymmetryPct.toFixed(1)),
        reason: 'No valid U-shaped cup found (depth or lip symmetry out of range)',
      };
    }
    if (!validHandle) {
      return {
        detected: false,
        confidence: 30,
        cupDepthPct: Number(cupDepthPct.toFixed(1)),
        reason: 'Cup shape present but no valid handle has formed yet',
      };
    }

    let confidence = 55;
    if (cupDepthPct >= 15 && cupDepthPct <= 35) confidence += 15; // "textbook" depth
    if (lipSymmetryPct <= 4) confidence += 10;
    if (handleDepthPct <= cupDepthPct * 0.25) confidence += 10; // shallow, tight handle

    return {
      detected: true,
      confidence: clampScore(confidence),
      cupDepthPct: Number(cupDepthPct.toFixed(1)),
      lipSymmetryPct: Number(lipSymmetryPct.toFixed(1)),
      handleDepthPct: Number(handleDepthPct.toFixed(1)),
      pivotLevel: Number(rightLip.toFixed(2)), // buy point: break above right lip
      suggestedStop: Number(handleLow.toFixed(2)),
    };
  }

  // --------------------------------------------------------------------
  // FLAG / PENNANT
  // --------------------------------------------------------------------
  /**
   * Pole: a sharp directional move over a short span with above-average
   * volume. Flag: a subsequent tight, low-volume consolidation.
   */
  function detectFlagPennant(candles, poleLookback = 10, flagLookback = 12) {
    const needed = poleLookback + flagLookback + 5;
    if (candles.length < Math.max(MIN_CANDLES.flag, needed)) {
      return insufficientData(Math.max(MIN_CANDLES.flag, needed), candles.length);
    }

    const lastIdx = candles.length - 1;
    const flagSlice = candles.slice(lastIdx - flagLookback + 1, lastIdx + 1);
    const poleSlice = candles.slice(lastIdx - flagLookback - poleLookback + 1, lastIdx - flagLookback + 1);

    const poleStart = poleSlice[0].close;
    const poleEnd = poleSlice[poleSlice.length - 1].close;
    const polePct = pctChange(poleStart, poleEnd);
    const poleAvgVol = poleSlice.reduce((s, c) => s + c.volume, 0) / poleSlice.length;

    const flagHigh = Math.max(...flagSlice.map((c) => c.high));
    const flagLow = Math.min(...flagSlice.map((c) => c.low));
    const flagRangePct = pctChange(flagLow, flagHigh);
    const flagAvgVol = flagSlice.reduce((s, c) => s + c.volume, 0) / flagSlice.length;
    const flagCloses = flagSlice.map((c) => c.close);
    const flagSlopePct = pctChange(flagCloses[0], flagCloses[flagCloses.length - 1]);

    const validPole = Math.abs(polePct) >= 12; // meaningful directional thrust
    const validFlag =
      flagRangePct <= Math.abs(polePct) * 0.6 && // consolidation much tighter than the pole move
      flagAvgVol < poleAvgVol * 0.85 && // volume contracting during the flag
      Math.abs(flagSlopePct) <= flagRangePct; // drifting sideways/slightly against pole, not trending hard

    if (!validPole) {
      return { detected: false, confidence: 0, polePct: Number(polePct.toFixed(1)), reason: 'No sharp pole move found' };
    }
    if (!validFlag) {
      return {
        detected: false,
        confidence: 25,
        polePct: Number(polePct.toFixed(1)),
        flagRangePct: Number(flagRangePct.toFixed(1)),
        reason: 'Pole found but consolidation is too wide or volume has not contracted',
      };
    }

    const direction = polePct > 0 ? 'bullish' : 'bearish';
    let confidence = 55;
    if (flagAvgVol < poleAvgVol * 0.7) confidence += 15;
    if (flagRangePct < Math.abs(polePct) * 0.35) confidence += 15;

    return {
      detected: true,
      direction,
      confidence: clampScore(confidence),
      polePct: Number(polePct.toFixed(1)),
      flagRangePct: Number(flagRangePct.toFixed(1)),
      breakoutLevel: Number((direction === 'bullish' ? flagHigh : flagLow).toFixed(2)),
      suggestedStop: Number((direction === 'bullish' ? flagLow : flagHigh).toFixed(2)),
    };
  }

  // --------------------------------------------------------------------
  // DOUBLE BOTTOM
  // --------------------------------------------------------------------
  /**
   * Two swing lows at a similar price level, separated by an intervening
   * peak ("neckline"). Second low ideally on lighter volume (selling
   * exhaustion), and price should be approaching/breaking the neckline.
   */
  function detectDoubleBottom(candles, lookback = 80) {
    if (candles.length < MIN_CANDLES.doubleBottom) return insufficientData(MIN_CANDLES.doubleBottom, candles.length);

    const win = candles.slice(-lookback);
    const offset = candles.length - win.length;
    const pivots = findPivots(win, 3, 3);
    const lows = pivots.filter((p) => p.type === 'low');
    const highs = pivots.filter((p) => p.type === 'high');

    if (lows.length < 2 || highs.length < 1) {
      return { detected: false, confidence: 0, reason: 'Not enough pivots to form a double bottom' };
    }

    const low2 = lows[lows.length - 1];
    const low1 = lows[lows.length - 2];
    const neckline = highs.find((h) => h.index > low1.index && h.index < low2.index);

    if (!neckline) {
      return { detected: false, confidence: 0, reason: 'No intervening peak (neckline) found between the two lows' };
    }

    const lowSimilarityPct = Math.abs(pctChange(low1.price, low2.price));
    const necklineHeightPct = pctChange(low1.price, neckline.price);
    const lastClose = win[win.length - 1].close;

    const validShape = lowSimilarityPct <= 4 && necklineHeightPct >= 8;
    if (!validShape) {
      return {
        detected: false,
        confidence: 0,
        lowSimilarityPct: Number(lowSimilarityPct.toFixed(1)),
        necklineHeightPct: Number(necklineHeightPct.toFixed(1)),
        reason: 'Lows are not level enough, or the neckline peak is too shallow',
      };
    }

    const volumeExhaustion = low2.volume < low1.volume;
    const nearingNeckline = lastClose >= neckline.price * 0.97;
    const brokeNeckline = lastClose > neckline.price;

    let confidence = 50;
    if (volumeExhaustion) confidence += 15;
    if (lowSimilarityPct <= 2) confidence += 10;
    if (brokeNeckline) confidence += 20;
    else if (nearingNeckline) confidence += 10;

    return {
      detected: true,
      confidence: clampScore(confidence),
      lowSimilarityPct: Number(lowSimilarityPct.toFixed(1)),
      necklineHeightPct: Number(necklineHeightPct.toFixed(1)),
      necklineLevel: Number(neckline.price.toFixed(2)),
      volumeExhaustion,
      brokeNeckline,
      suggestedStop: Number((Math.min(low1.price, low2.price) * 0.98).toFixed(2)),
    };
  }

  // --------------------------------------------------------------------
  // GAP DETECTION
  // --------------------------------------------------------------------
  function detectGap(candles) {
    if (candles.length < MIN_CANDLES.gap) return insufficientData(MIN_CANDLES.gap, candles.length);

    const lastIdx = candles.length - 1;
    const today = candles[lastIdx];
    const prevClose = candles[lastIdx - 1].close;
    const gapPct = pctChange(prevClose, today.open);
    const avgVol = avgVolume(candles, 20, lastIdx - 1);
    const volumeRatio = avgVol ? today.volume / avgVol : 0;

    const isGapUp = gapPct >= 2 && volumeRatio >= 1.2;
    const isGapDown = gapPct <= -2 && volumeRatio >= 1.2;

    if (!isGapUp && !isGapDown) {
      return { detected: false, confidence: 0, gapPct: Number(gapPct.toFixed(1)), volumeRatio: Number(volumeRatio.toFixed(2)) };
    }

    let confidence = 50 + Math.min(Math.abs(gapPct) * 3, 30) + Math.min((volumeRatio - 1.2) * 15, 20);

    return {
      detected: true,
      direction: isGapUp ? 'up' : 'down',
      confidence: clampScore(confidence),
      gapPct: Number(gapPct.toFixed(1)),
      volumeRatio: Number(volumeRatio.toFixed(2)),
    };
  }

  // --------------------------------------------------------------------
  // COMPOSITE ANALYSIS
  // --------------------------------------------------------------------
  const PATTERN_WEIGHTS = {
    breakout: 30,
    vcp: 25,
    cupHandle: 20,
    flag: 15,
    doubleBottom: 15,
    gap: 10,
  };

  function analyze(candles, symbol = 'UNKNOWN') {
    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error('analyze() requires a non-empty candles array (see data-layer.js getHistory output)');
    }

    const stage = detectStage(candles);
    const breakout = detectBreakout(candles);
    const vcp = detectVCP(candles);
    const cupHandle = detectCupAndHandle(candles);
    const flag = detectFlagPennant(candles);
    const doubleBottom = detectDoubleBottom(candles);
    const gap = detectGap(candles);

    const patternMap = { breakout, vcp, cupHandle, flag, doubleBottom, gap };

    const detectedPatterns = Object.entries(patternMap)
      .filter(([, result]) => result.detected)
      .map(([name, result]) => ({ name, ...result }));

    // Weighted composite score: sum(weight * confidence/100) normalized to 0-100
    let weightedSum = 0;
    let weightTotal = 0;
    detectedPatterns.forEach((p) => {
      const weight = PATTERN_WEIGHTS[p.name] || 10;
      weightedSum += weight * (p.confidence / 100);
      weightTotal += weight;
    });
    let compositeScore = weightTotal > 0 ? clampScore((weightedSum / weightTotal) * 100) : 0;

    // Stage context adjusts the composite: patterns matter far more in
    // Stage 2 (advancing) than Stage 4 (declining) — a "breakout" in a
    // downtrend is a much weaker signal than the same pattern in an uptrend.
    if (stage.detected && detectedPatterns.length > 0) {
      if (stage.stage === 2) compositeScore = clampScore(compositeScore * 1.1);
      else if (stage.stage === 4) compositeScore = clampScore(compositeScore * 0.6);
      else if (stage.stage === 1) compositeScore = clampScore(compositeScore * 1.0);
      else if (stage.stage === 3) compositeScore = clampScore(compositeScore * 0.75);
    }

    return {
      symbol,
      asOf: candles[candles.length - 1].date,
      lastClose: candles[candles.length - 1].close,
      stage,
      patterns: patternMap,
      detectedPatterns,
      compositeScore,
      summary:
        detectedPatterns.length === 0
          ? 'No high-confidence setups detected currently.'
          : `${detectedPatterns.length} setup(s) detected: ${detectedPatterns.map((p) => p.name).join(', ')}. ` +
            `Context: ${stage.detected ? stage.label : 'stage unknown'}.`,
    };
  }

  // --------------------------------------------------------------------
  // PUBLIC EXPORTS
  // --------------------------------------------------------------------
  return {
    analyze,
    detectStage,
    detectBreakout,
    detectVCP,
    detectCupAndHandle,
    detectFlagPennant,
    detectDoubleBottom,
    detectGap,
    _helpers: { sma, stdDev, atr, findPivots, avgVolume }, // exposed for Day 3+ reuse
  };
})();

if (typeof window !== 'undefined') window.PatternEngine = PatternEngine;
if (typeof module !== 'undefined' && module.exports) module.exports = PatternEngine;
