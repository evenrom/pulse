export const PALETTE = ['#1A42A8', '#168B9E', '#0C8663', '#6B51B0', '#B33E3E', '#D19030', '#D96A33', '#759614'];

export const ENGINE_MAP: Record<string, string[]> = {
  'Innovation': ['Technology', 'Communications'],
  'Human Life': ['Healthcare', 'Consumer Defensive', 'Consumer Cyclical'],
  'Capital': ['Financials', 'Real Estate'],
  'Production': ['Industrials', 'Basic Materials'],
  'Energy': ['Energy', 'Utilities'],
  'Gold & T-Bills': ['Gold', 'T-Bills']
};

export const SECTOR_TO_ENGINE: Record<string, string> = Object.entries(ENGINE_MAP).reduce((acc, [engine, sectors]) => {
  sectors.forEach(sector => {
    acc[sector] = engine;
  });
  return acc;
}, {} as Record<string, string>);

// Non-equity funds keep their explicit classification; Yahoo has no sector mix for them.
export const CUSTOM_SECTOR_BREAKDOWN: Record<string, Record<string, number>> = {
  SGOV: { 'Cash & Equivalents': 1.0 },
  IAU: { 'Commodities': 1.0 },
};

// Initial fallback only, used until a valid Yahoo allocation has been cached.
export const SECTOR_BREAKDOWN: Record<string, Record<string, number>> = {
  'VOO': {
    'Technology': 0.30,
    'Financials': 0.13,
    'Healthcare': 0.12,
    'Consumer Cyclical': 0.10,
    'Communications': 0.09,
    'Industrials': 0.08,
    'Consumer Defensive': 0.06,
    'Energy': 0.04,
    'Real Estate': 0.02,
    'Basic Materials': 0.02,
    'Utilities': 0.02,
    'Cash & Equivalents': 0.02
  },
  'USMV': {
    'Healthcare': 0.20,
    'Financials': 0.17,
    'Technology': 0.16,
    'Consumer Defensive': 0.14,
    'Industrials': 0.11,
    'Communications': 0.06,
    'Utilities': 0.06,
    'Consumer Cyclical': 0.05,
    'Basic Materials': 0.03,
    'Real Estate': 0.01,
    'Energy': 0.01
  },
  'SGOV': {
    'Cash & Equivalents': 1.0
  },
  'IAU': {
    'Commodities': 1.0
  },
  'VEA': {
    'Financials': 0.19,
    'Industrials': 0.17,
    'Healthcare': 0.12,
    'Consumer Cyclical': 0.11,
    'Consumer Defensive': 0.09,
    'Technology': 0.09,
    'Basic Materials': 0.07,
    'Communications': 0.05,
    'Energy': 0.04,
    'Utilities': 0.03,
    'Real Estate': 0.03,
    'Cash & Equivalents': 0.01
  },
  'EFAV': {
    'Healthcare': 0.17,
    'Financials': 0.16,
    'Industrials': 0.14,
    'Consumer Defensive': 0.13,
    'Communications': 0.10,
    'Consumer Cyclical': 0.08,
    'Technology': 0.07,
    'Utilities': 0.06,
    'Basic Materials': 0.04,
    'Real Estate': 0.03,
    'Energy': 0.01,
    'Cash & Equivalents': 0.01
  },
  'IDEV': {
    'Financials': 0.19,
    'Industrials': 0.17,
    'Healthcare': 0.12,
    'Consumer Cyclical': 0.11,
    'Consumer Defensive': 0.09,
    'Technology': 0.09,
    'Basic Materials': 0.08,
    'Communications': 0.05,
    'Energy': 0.04,
    'Utilities': 0.03,
    'Real Estate': 0.03
  },
  'VEU': {
    'Financials': 0.20,
    'Industrials': 0.15,
    'Technology': 0.12,
    'Consumer Cyclical': 0.11,
    'Healthcare': 0.09,
    'Basic Materials': 0.08,
    'Consumer Defensive': 0.07,
    'Communications': 0.06,
    'Energy': 0.05,
    'Real Estate': 0.03,
    'Utilities': 0.03,
    'Cash & Equivalents': 0.01
  },
  'EIS': {
    'Technology': 0.35,
    'Financials': 0.28,
    'Healthcare': 0.10,
    'Industrials': 0.08,
    'Real Estate': 0.06,
    'Communications': 0.05,
    'Consumer Cyclical': 0.04,
    'Consumer Defensive': 0.02,
    'Basic Materials': 0.01,
    'Energy': 0.01
  }
};
