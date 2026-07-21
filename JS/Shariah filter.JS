/**
 * ============================================================================
 * NSE TRADING SYSTEM — SHARIAH COMPLIANCE FILTER (Day 5a of 7)
 * ============================================================================
 * Purpose: Screen a stock (or IPO) against standard Islamic finance
 *          screening ratios, using the same thresholds commonly applied by
 *          AAOIFI-style / Dow Jones Islamic Market style screens:
 *            - Debt / Market Cap            <= 33%
 *            - Liquid assets (cash + interest-bearing securities)
 *              / Market Cap                 <= 33%
 *            - Interest income / Revenue    <= 5%
 *          PLUS a business-activity screen: the core business itself must
 *          not be conventional banking/insurance, alcohol, tobacco,
 *          gambling, or similarly prohibited — no ratio passes that.
 *
 * IMPORTANT HONEST LIMITATION:
 *   Free, reliable, real-time fundamental data (debt, market cap, interest
 *   income) is NOT available through Yahoo Finance's public chart endpoint
 *   (that's price/volume only). Yahoo's separate "quoteSummary" fundamentals
 *   endpoint often requires a cookie/crumb handshake that free CORS proxies
 *   cannot reliably complete. `fetchFundamentals()` below attempts it as a
 *   best-effort convenience — but MANUAL ENTRY is the reliable path. Pull
 *   the figures from the company's latest quarterly results, screener.in,
 *   or NSE's disclosures, then run screenStock() on them directly.
 *
 * DISCLAIMER: This is a mechanical ratio screen, not a fatwa or substitute
 * for a qualified Shariah advisor. Different indices (AAOIFI, Dow Jones
 * Islamic Market, MSCI Islamic, S&P Shariah) use slightly different
 * thresholds and denominators (some use total assets instead of market
 * cap). Treat this as a first-pass filter, not a final ruling.
 *
 * Public API:
 *   ShariahFilter.screenStock(financials, options)
 *   ShariahFilter.fetchFundamentals(symbol)   -> best-effort, may fail
 *   ShariahFilter.PROHIBITED_SECTOR_KEYWORDS
 * ============================================================================
 */

const ShariahFilter = (() => {
  'use strict';

  const DEFAULT_THRESHOLDS = {
    debtToMarketCapMaxPct: 33,
    liquidAssetsToMarketCapMaxPct: 33,
    interestIncomeToRevenueMaxPct: 5,
  };

  // Business-activity screen: if the sector/business description matches
  // any of these (case-insensitive substring match), the stock fails
  // regardless of its financial ratios — this is a hard screen, not a
  // scored one, matching how real Islamic screens treat core business.
  const PROHIBITED_SECTOR_KEYWORDS = [
    'bank', // conventional banking (interest-based) — NBFCs/conventional banks
    'insurance', // conventional insurance (non-Takaful)
    'brewery',
    'liquor',
    'alcohol',
    'tobacco',
    'cigarette',
    'casino',
    'gambling',
    'lottery',
    'adult entertainment',
    'pork',
  ];

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function checkBusinessActivity(sectorOrDescription) {
    if (!sectorOrDescription) return { pass: true, matchedKeyword: null };
    const lower = sectorOrDescription.toLowerCase();
    const matched = PROHIBITED_SECTOR_KEYWORDS.find((kw) => lower.includes(kw));
    return { pass: !matched, matchedKeyword: matched || null };
  }

  /**
   * @param {object} financials
   * @param {string} [financials.sector]                       sector/business description
   * @param {number} financials.marketCap                      market capitalization (₹)
   * @param {number} financials.totalDebt                      total interest-bearing debt (₹)
   * @param {number} financials.cashAndInterestBearingSecurities  cash + short-term investments (₹)
   * @param {number} financials.interestIncome                 interest/non-operating income (₹, annual)
   * @param {number} financials.totalRevenue                   total revenue (₹, annual)
   * @param {object} [options]  override any DEFAULT_THRESHOLDS value
   */
  function screenStock(financials, options = {}) {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...options };
    const { sector, marketCap, totalDebt, cashAndInterestBearingSecurities, interestIncome, totalRevenue } = financials;

    if (!marketCap || marketCap <= 0) {
      throw new Error('marketCap is required and must be positive to run ratio screens');
    }

    const businessCheck = checkBusinessActivity(sector);

    const debtRatioPct = round2(((totalDebt || 0) / marketCap) * 100);
    const liquidAssetsRatioPct = round2(((cashAndInterestBearingSecurities || 0) / marketCap) * 100);
    const interestIncomeRatioPct =
      totalRevenue > 0 ? round2(((interestIncome || 0) / totalRevenue) * 100) : null;

    const debtPass = debtRatioPct <= thresholds.debtToMarketCapMaxPct;
    const liquidAssetsPass = liquidAssetsRatioPct <= thresholds.liquidAssetsToMarketCapMaxPct;
    const interestIncomePass =
      interestIncomeRatioPct === null ? null : interestIncomeRatioPct <= thresholds.interestIncomeToRevenueMaxPct;

    const ratioChecks = [
      { name: 'Debt / Market Cap', value: debtRatioPct, threshold: thresholds.debtToMarketCapMaxPct, pass: debtPass },
      {
        name: 'Liquid Assets / Market Cap',
        value: liquidAssetsRatioPct,
        threshold: thresholds.liquidAssetsToMarketCapMaxPct,
        pass: liquidAssetsPass,
      },
      {
        name: 'Interest Income / Revenue',
        value: interestIncomeRatioPct,
        threshold: thresholds.interestIncomeToRevenueMaxPct,
        pass: interestIncomePass,
      },
    ];

    const allRatiosPass = ratioChecks.every((c) => c.pass === true || c.pass === null);
    const missingData = ratioChecks.some((c) => c.pass === null);

    let verdict, compliant;
    if (!businessCheck.pass) {
      verdict = `Fails business-activity screen (matched: "${businessCheck.matchedKeyword}") — core business is not Shariah-compliant regardless of ratios.`;
      compliant = false;
    } else if (!allRatiosPass) {
      const failed = ratioChecks.filter((c) => c.pass === false).map((c) => c.name);
      verdict = `Fails financial ratio screen: ${failed.join(', ')}.`;
      compliant = false;
    } else if (missingData) {
      verdict = 'Business activity and available ratios pass, but some data was missing — treat as provisional, not final.';
      compliant = null;
    } else {
      verdict = 'Passes business-activity and all financial ratio screens.';
      compliant = true;
    }

    return {
      compliant,
      verdict,
      businessActivityCheck: businessCheck,
      ratioChecks,
      thresholds,
      disclaimer:
        'Mechanical ratio screen only — not a fatwa. Consult a qualified Shariah advisor before acting, and note that different Islamic indices use slightly different thresholds/denominators.',
    };
  }

  // --------------------------------------------------------------------
  // BEST-EFFORT FUNDAMENTALS FETCH (may fail — see module header)
  // --------------------------------------------------------------------
  async function fetchFundamentals(symbol) {
    if (typeof NSEData === 'undefined') {
      throw new Error('data-layer.js (NSEData) must be loaded to reuse its proxy configuration');
    }
    const sym = NSEData.normalizeSymbol(symbol);
    const modules = 'balanceSheetHistory,financialData,defaultKeyStatistics,summaryDetail';
    const targetUrl = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=${modules}`;

    const proxies = NSEData._config.PROXIES;
    let lastError = null;

    for (const buildProxyUrl of proxies) {
      try {
        const res = await fetch(buildProxyUrl(targetUrl));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const result = data?.quoteSummary?.result?.[0];
        if (!result) throw new Error('No fundamentals data in response — endpoint likely requires auth that the proxy could not provide');

        const bs = result.balanceSheetHistory?.balanceSheetStatements?.[0] || {};
        const fd = result.financialData || {};
        const ks = result.defaultKeyStatistics || {};
        const sd = result.summaryDetail || {};

        return {
          symbol: sym,
          marketCap: sd.marketCap?.raw ?? ks.enterpriseValue?.raw ?? null,
          totalDebt: fd.totalDebt?.raw ?? bs.totalLiab?.raw ?? null,
          cashAndInterestBearingSecurities: fd.totalCash?.raw ?? bs.cash?.raw ?? null,
          totalRevenue: fd.totalRevenue?.raw ?? null,
          interestIncome: null, // Yahoo doesn't cleanly expose this line item — usually needs manual entry from the P&L
          fetchedAt: new Date().toISOString(),
          note: 'Best-effort auto-fetch. interestIncome is not reliably available from this endpoint — verify all fields against the company\'s actual financial statements before using them for a compliance decision.',
        };
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Auto-fetch of fundamentals failed via all proxies (${lastError?.message || 'unknown error'}). This endpoint is unreliable through free CORS proxies — please enter the figures manually from screener.in, the company's latest results, or NSE filings.`
    );
  }

  return {
    screenStock,
    fetchFundamentals,
    PROHIBITED_SECTOR_KEYWORDS,
    DEFAULT_THRESHOLDS,
  };
})();

if (typeof window !== 'undefined') window.ShariahFilter = ShariahFilter;
if (typeof module !== 'undefined' && module.exports) module.exports = ShariahFilter;
