/**
 * ============================================================================
 * NSE TRADING SYSTEM — IPO TRACKER (Day 5b of 7)
 * ============================================================================
 * Purpose: Track an IPO's allotment odds and expected listing gain from
 *          manually-entered subscription and GMP data, and optionally run
 *          it through the Shariah filter (Day 5a).
 *
 * IMPORTANT HONEST LIMITATION:
 *   Grey Market Premium (GMP) and live subscription figures are NOT
 *   available from any free, stable public API — sites that publish them
 *   (Chittorgarh, InvestorGain, IPO Watch) don't offer one, and scraping
 *   their HTML through a free CORS proxy is fragile and liable to break
 *   the moment their markup changes. Rather than ship something that
 *   silently breaks, this module takes subscription/GMP numbers as INPUT
 *   (you check the site once, type in three numbers) and does the actual
 *   math — allotment probability and expected gain — reliably.
 *
 * Allotment probability method:
 *   SEBI's actual retail allotment is a computerized lottery draw, not a
 *   simple formula — but for an oversubscribed issue, the standard
 *   approximation used across the industry is:
 *     probability(at least 1 lot) ≈ min(1, totalRetailLotsAvailable / totalRetailApplicants)
 *   This is the same approximation retail investors use to gauge odds
 *   before the actual draw; it is NOT a guarantee, just an estimate.
 *
 * Public API:
 *   IPOTracker.calcAllotmentProbability({ totalLotsAvailable, totalApplicants, lotsApplied })
 *   IPOTracker.calcListingGainEstimate({ issuePrice, lotSize, gmp })
 *   IPOTracker.evaluateIPO({ ...allotment inputs, ...listing inputs, shariahFinancials })
 * ============================================================================
 */

const IPOTracker = (() => {
  'use strict';

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // --------------------------------------------------------------------
  // ALLOTMENT PROBABILITY (approximation of SEBI's proportional lottery)
  // --------------------------------------------------------------------
  /**
   * @param {object} p
   * @param {number} p.totalLotsAvailable  total lots available in the category (e.g. retail)
   * @param {number} p.totalApplicants     total number of applicants in that category
   * @param {number} [p.lotsApplied=1]     how many lots this specific application is for
   */
  function calcAllotmentProbability({ totalLotsAvailable, totalApplicants, lotsApplied = 1 }) {
    if (!totalLotsAvailable || totalLotsAvailable <= 0) throw new Error('totalLotsAvailable must be positive');
    if (!totalApplicants || totalApplicants <= 0) throw new Error('totalApplicants must be positive');

    const oversubscriptionRatio = round2(totalApplicants / totalLotsAvailable);
    const fullySubscribedOrLess = totalApplicants <= totalLotsAvailable;

    // If not oversubscribed, everyone gets at least their applied lots (subject to available lots)
    const probabilityAtLeastOneLot = fullySubscribedOrLess ? 1 : Math.min(1, totalLotsAvailable / totalApplicants);

    // Expected value framing: on average, across many applicants at this
    // oversubscription level, this is the expected number of lots allotted
    // for someone who applied for `lotsApplied` lots (retail is typically
    // capped at 1 lot per applicant in the lottery for oversubscribed SME/
    // mainboard retail category — most retail investors apply for 1 lot).
    const expectedLotsAllotted = fullySubscribedOrLess
      ? lotsApplied
      : Number((lotsApplied * probabilityAtLeastOneLot).toFixed(3));

    let odds;
    if (fullySubscribedOrLess) odds = 'Likely full allotment (not oversubscribed)';
    else if (probabilityAtLeastOneLot >= 0.5) odds = 'Favorable odds';
    else if (probabilityAtLeastOneLot >= 0.2) odds = 'Moderate odds — allotment is a real possibility but not likely';
    else odds = 'Low odds — heavily oversubscribed';

    return {
      oversubscriptionRatio,
      probabilityAtLeastOneLotPct: round2(probabilityAtLeastOneLot * 100),
      expectedLotsAllotted,
      odds,
      methodNote:
        'Approximation of SEBI\'s proportional lottery (probability ≈ lots available / total applicants). The actual allotment is a randomized computerized draw — this estimates your odds, it does not predict your specific outcome.',
    };
  }

  // --------------------------------------------------------------------
  // LISTING GAIN ESTIMATE (from Grey Market Premium)
  // --------------------------------------------------------------------
  /**
   * @param {object} p
   * @param {number} p.issuePrice   IPO issue price per share (₹)
   * @param {number} p.lotSize      shares per lot
   * @param {number} p.gmp          grey market premium per share (₹) — can be negative
   */
  function calcListingGainEstimate({ issuePrice, lotSize, gmp }) {
    if (!issuePrice || issuePrice <= 0) throw new Error('issuePrice must be positive');
    if (!lotSize || lotSize <= 0) throw new Error('lotSize must be positive');
    if (gmp === undefined || gmp === null) throw new Error('gmp is required (can be 0 or negative)');

    const estimatedListingPrice = round2(issuePrice + gmp);
    const gainPctPerShare = round2((gmp / issuePrice) * 100);
    const gainAmountPerLot = round2(gmp * lotSize);
    const investmentPerLot = round2(issuePrice * lotSize);

    return {
      estimatedListingPrice,
      gainPctPerShare,
      gainAmountPerLot,
      investmentPerLot,
      verdict:
        gmp > 0
          ? `GMP suggests a listing gain of roughly ${gainPctPerShare}% — but GMP is an unregulated, informal indicator and can swing sharply right up to listing day.`
          : gmp < 0
          ? `GMP suggests a possible listing loss of roughly ${Math.abs(gainPctPerShare)}% — treat this as a caution signal, not certainty.`
          : 'GMP is flat — market is not pricing in a significant listing pop or drop.',
      disclaimer: 'GMP is an unofficial, unregulated grey-market indicator, not a SEBI-recognized price signal. It has moved sharply (in both directions) between the last GMP quote and actual listing on numerous past IPOs.',
    };
  }

  // --------------------------------------------------------------------
  // COMBINED EVALUATION
  // --------------------------------------------------------------------
  /**
   * Combines allotment odds + expected listing gain + (optional) Shariah
   * screen into one view, and produces a probability-weighted expected
   * value for the trade: P(allotment) × expected gain per lot.
   */
  function evaluateIPO({
    totalLotsAvailable,
    totalApplicants,
    lotsApplied = 1,
    issuePrice,
    lotSize,
    gmp,
    shariahFinancials = null,
  }) {
    const allotment = calcAllotmentProbability({ totalLotsAvailable, totalApplicants, lotsApplied });
    const listing = calcListingGainEstimate({ issuePrice, lotSize, gmp });

    const probableLotsAllotted = allotment.expectedLotsAllotted;
    const expectedGainAmount = round2(probableLotsAllotted * listing.gainAmountPerLot / lotsApplied || 0);
    // (expected value across the probability of getting allotted at all,
    // scaled to the fraction of applied lots actually expected to be allotted)
    const probabilityWeightedGain = round2((allotment.probabilityAtLeastOneLotPct / 100) * listing.gainAmountPerLot);

    let shariah = null;
    if (shariahFinancials && typeof ShariahFilter !== 'undefined') {
      shariah = ShariahFilter.screenStock(shariahFinancials);
    }

    return {
      allotment,
      listing,
      probabilityWeightedExpectedGain: probabilityWeightedGain,
      shariah,
      summary:
        `${allotment.odds}. If allotted, GMP implies roughly ${listing.gainPctPerShare}% listing gain. ` +
        `Probability-weighted expected gain per lot applied: ₹${probabilityWeightedGain}.` +
        (shariah ? ` Shariah screen: ${shariah.verdict}` : ''),
    };
  }

  return {
    calcAllotmentProbability,
    calcListingGainEstimate,
    evaluateIPO,
  };
})();

if (typeof window !== 'undefined') window.IPOTracker = IPOTracker;
if (typeof module !== 'undefined' && module.exports) module.exports = IPOTracker;
