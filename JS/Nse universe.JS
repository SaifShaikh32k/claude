/**
 * ============================================================================
 * NSE STOCK UNIVERSE (Day 3 support data)
 * ============================================================================
 * A curated starter list of ~140 well-known, actively traded NSE main-board
 * stocks across 15 sectors. This is NOT the full 500+ NSE universe — it's a
 * verified, honest starting point so the screener has something real to run
 * against on day one.
 *
 * To expand: just add more { symbol, name, sector } entries. The screener
 * (screener.js) is generic — it doesn't care how many stocks or which
 * sectors you give it.
 * ============================================================================
 */

const NSE_UNIVERSE = [
  // Banking & Financial Services
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking & Financial Services' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking & Financial Services' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking & Financial Services' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking & Financial Services' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking & Financial Services' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking & Financial Services' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda', sector: 'Banking & Financial Services' },
  { symbol: 'PNB', name: 'Punjab National Bank', sector: 'Banking & Financial Services' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank', sector: 'Banking & Financial Services' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank', sector: 'Banking & Financial Services' },

  // IT
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT' },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT' },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT' },
  { symbol: 'LTIM', name: 'LTIMindtree', sector: 'IT' },
  { symbol: 'MPHASIS', name: 'Mphasis', sector: 'IT' },
  { symbol: 'PERSISTENT', name: 'Persistent Systems', sector: 'IT' },
  { symbol: 'COFORGE', name: 'Coforge', sector: 'IT' },
  { symbol: 'LTTS', name: 'L&T Technology Services', sector: 'IT' },

  // Pharma & Healthcare
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma & Healthcare' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Labs", sector: 'Pharma & Healthcare' },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma & Healthcare' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories", sector: 'Pharma & Healthcare' },
  { symbol: 'LUPIN', name: 'Lupin', sector: 'Pharma & Healthcare' },
  { symbol: 'AUROPHARMA', name: 'Aurobindo Pharma', sector: 'Pharma & Healthcare' },
  { symbol: 'TORNTPHARM', name: 'Torrent Pharmaceuticals', sector: 'Pharma & Healthcare' },
  { symbol: 'ALKEM', name: 'Alkem Laboratories', sector: 'Pharma & Healthcare' },
  { symbol: 'ZYDUSLIFE', name: 'Zydus Lifesciences', sector: 'Pharma & Healthcare' },
  { symbol: 'BIOCON', name: 'Biocon', sector: 'Pharma & Healthcare' },

  // Auto & Ancillaries
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto & Ancillaries' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Auto & Ancillaries' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', sector: 'Auto & Ancillaries' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'Auto & Ancillaries' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'Auto & Ancillaries' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Auto & Ancillaries' },
  { symbol: 'ASHOKLEY', name: 'Ashok Leyland', sector: 'Auto & Ancillaries' },
  { symbol: 'TVSMOTOR', name: 'TVS Motor Company', sector: 'Auto & Ancillaries' },
  { symbol: 'BHARATFORG', name: 'Bharat Forge', sector: 'Auto & Ancillaries' },
  { symbol: 'MOTHERSON', name: 'Samvardhana Motherson', sector: 'Auto & Ancillaries' },

  // FMCG
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG' },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG' },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG' },
  { symbol: 'DABUR', name: 'Dabur India', sector: 'FMCG' },
  { symbol: 'MARICO', name: 'Marico', sector: 'FMCG' },
  { symbol: 'GODREJCP', name: 'Godrej Consumer Products', sector: 'FMCG' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG' },
  { symbol: 'COLPAL', name: 'Colgate-Palmolive India', sector: 'FMCG' },
  { symbol: 'VBL', name: 'Varun Beverages', sector: 'FMCG' },

  // Energy & Oil/Gas
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy & Oil/Gas' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corp', sector: 'Energy & Oil/Gas' },
  { symbol: 'IOC', name: 'Indian Oil Corporation', sector: 'Energy & Oil/Gas' },
  { symbol: 'BPCL', name: 'Bharat Petroleum', sector: 'Energy & Oil/Gas' },
  { symbol: 'HINDPETRO', name: 'Hindustan Petroleum', sector: 'Energy & Oil/Gas' },
  { symbol: 'GAIL', name: 'GAIL India', sector: 'Energy & Oil/Gas' },
  { symbol: 'OIL', name: 'Oil India', sector: 'Energy & Oil/Gas' },
  { symbol: 'PETRONET', name: 'Petronet LNG', sector: 'Energy & Oil/Gas' },
  { symbol: 'IGL', name: 'Indraprastha Gas', sector: 'Energy & Oil/Gas' },
  { symbol: 'MGL', name: 'Mahanagar Gas', sector: 'Energy & Oil/Gas' },

  // Metals & Mining
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals & Mining' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals & Mining' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals & Mining' },
  { symbol: 'VEDL', name: 'Vedanta', sector: 'Metals & Mining' },
  { symbol: 'SAIL', name: 'Steel Authority of India', sector: 'Metals & Mining' },
  { symbol: 'NMDC', name: 'NMDC', sector: 'Metals & Mining' },
  { symbol: 'JINDALSTEL', name: 'Jindal Steel & Power', sector: 'Metals & Mining' },
  { symbol: 'NATIONALUM', name: 'National Aluminium Co', sector: 'Metals & Mining' },
  { symbol: 'HINDZINC', name: 'Hindustan Zinc', sector: 'Metals & Mining' },
  { symbol: 'APLAPOLLO', name: 'APL Apollo Tubes', sector: 'Metals & Mining' },

  // Defence
  { symbol: 'HAL', name: 'Hindustan Aeronautics', sector: 'Defence' },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'Defence' },
  { symbol: 'BDL', name: 'Bharat Dynamics', sector: 'Defence' },
  { symbol: 'MAZDOCK', name: 'Mazagon Dock Shipbuilders', sector: 'Defence' },
  { symbol: 'COCHINSHIP', name: 'Cochin Shipyard', sector: 'Defence' },
  { symbol: 'BEML', name: 'BEML', sector: 'Defence' },
  { symbol: 'SOLARINDS', name: 'Solar Industries India', sector: 'Defence' },
  { symbol: 'DATAPATTNS', name: 'Data Patterns India', sector: 'Defence' },

  // Infrastructure & Construction
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Infrastructure & Construction' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'Infrastructure & Construction' },
  { symbol: 'GMRINFRA', name: 'GMR Airports Infra', sector: 'Infrastructure & Construction' },
  { symbol: 'IRB', name: 'IRB Infrastructure', sector: 'Infrastructure & Construction' },
  { symbol: 'NCC', name: 'NCC Limited', sector: 'Infrastructure & Construction' },
  { symbol: 'KNRCON', name: 'KNR Constructions', sector: 'Infrastructure & Construction' },
  { symbol: 'RVNL', name: 'Rail Vikas Nigam', sector: 'Infrastructure & Construction' },
  { symbol: 'IRCON', name: 'Ircon International', sector: 'Infrastructure & Construction' },

  // Realty
  { symbol: 'DLF', name: 'DLF Limited', sector: 'Realty' },
  { symbol: 'GODREJPROP', name: 'Godrej Properties', sector: 'Realty' },
  { symbol: 'OBEROIRLTY', name: 'Oberoi Realty', sector: 'Realty' },
  { symbol: 'PRESTIGE', name: 'Prestige Estates', sector: 'Realty' },
  { symbol: 'PHOENIXLTD', name: 'Phoenix Mills', sector: 'Realty' },
  { symbol: 'SOBHA', name: 'Sobha Limited', sector: 'Realty' },
  { symbol: 'BRIGADE', name: 'Brigade Enterprises', sector: 'Realty' },
  { symbol: 'LODHA', name: 'Macrotech Developers (Lodha)', sector: 'Realty' },

  // Telecom
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom' },
  { symbol: 'IDEA', name: 'Vodafone Idea', sector: 'Telecom' },
  { symbol: 'INDUSTOWER', name: 'Indus Towers', sector: 'Telecom' },
  { symbol: 'TATACOMM', name: 'Tata Communications', sector: 'Telecom' },
  { symbol: 'RAILTEL', name: 'RailTel Corporation', sector: 'Telecom' },

  // Cement
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement' },
  { symbol: 'SHREECEM', name: 'Shree Cement', sector: 'Cement' },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements', sector: 'Cement' },
  { symbol: 'ACC', name: 'ACC Limited', sector: 'Cement' },
  { symbol: 'DALBHARAT', name: 'Dalmia Bharat', sector: 'Cement' },
  { symbol: 'JKCEMENT', name: 'JK Cement', sector: 'Cement' },
  { symbol: 'RAMCOCEM', name: 'Ramco Cements', sector: 'Cement' },

  // Chemicals
  { symbol: 'PIDILITIND', name: 'Pidilite Industries', sector: 'Chemicals' },
  { symbol: 'SRF', name: 'SRF Limited', sector: 'Chemicals' },
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite', sector: 'Chemicals' },
  { symbol: 'AARTIIND', name: 'Aarti Industries', sector: 'Chemicals' },
  { symbol: 'NAVINFLUOR', name: 'Navin Fluorine', sector: 'Chemicals' },
  { symbol: 'TATACHEM', name: 'Tata Chemicals', sector: 'Chemicals' },
  { symbol: 'UPL', name: 'UPL Limited', sector: 'Chemicals' },
  { symbol: 'ATUL', name: 'Atul Limited', sector: 'Chemicals' },
  { symbol: 'VINATIORGA', name: 'Vinati Organics', sector: 'Chemicals' },

  // Consumer Durables
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer Durables' },
  { symbol: 'HAVELLS', name: 'Havells India', sector: 'Consumer Durables' },
  { symbol: 'VOLTAS', name: 'Voltas', sector: 'Consumer Durables' },
  { symbol: 'CROMPTON', name: 'Crompton Greaves Consumer', sector: 'Consumer Durables' },
  { symbol: 'DIXON', name: 'Dixon Technologies', sector: 'Consumer Durables' },
  { symbol: 'WHIRLPOOL', name: 'Whirlpool of India', sector: 'Consumer Durables' },
  { symbol: 'BLUESTARCO', name: 'Blue Star', sector: 'Consumer Durables' },
  { symbol: 'SYMPHONY', name: 'Symphony Limited', sector: 'Consumer Durables' },

  // PSU / Diversified
  { symbol: 'NTPC', name: 'NTPC', sector: 'PSU & Diversified' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation', sector: 'PSU & Diversified' },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'PSU & Diversified' },
  { symbol: 'BHEL', name: 'Bharat Heavy Electricals', sector: 'PSU & Diversified' },
  { symbol: 'CONCOR', name: 'Container Corporation of India', sector: 'PSU & Diversified' },
  { symbol: 'NBCC', name: 'NBCC India', sector: 'PSU & Diversified' },
  { symbol: 'NLCINDIA', name: 'NLC India', sector: 'PSU & Diversified' },
  { symbol: 'RECLTD', name: 'REC Limited', sector: 'PSU & Diversified' },
  { symbol: 'PFC', name: 'Power Finance Corporation', sector: 'PSU & Diversified' },
];

if (typeof window !== 'undefined') window.NSE_UNIVERSE = NSE_UNIVERSE;
if (typeof module !== 'undefined' && module.exports) module.exports = NSE_UNIVERSE;
