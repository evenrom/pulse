import type { DailyPrice, FundComposition, FundHolding, PriceHistory } from "./portfolio-analytics";

const HEADERS = { "User-Agent": "Mozilla/5.0", Accept: "application/json,text/csv,text/html" };
const HOLDING_SECTORS = new Map([
  ["Information Technology", "Technology"],
  ["Financials", "Financials"],
  ["Health Care", "Healthcare"],
  ["Consumer Discretionary", "Consumer Cyclical"],
  ["Communication", "Communications"],
  ["Communication Services", "Communications"],
  ["Industrials", "Industrials"],
  ["Consumer Staples", "Consumer Defensive"],
  ["Energy", "Energy"],
  ["Real Estate", "Real Estate"],
  ["Materials", "Basic Materials"],
  ["Utilities", "Utilities"],
]);
async function get(url: string) {
  const response = await fetch(url, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Data provider returned ${response.status}`);
  return response;
}

export function parseYahooHistory(payload: unknown, requestedFrom: string, now = Date.now()): PriceHistory {
  const data = payload as { chart?: { result?: { timestamp?: number[]; meta?: { currentTradingPeriod?: { regular?: { end?: number } } }; indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] }; events?: { splits?: Record<string, { date: number }> } }[] } };
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error("No daily price history returned");
  const todayNy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const prices: DailyPrice[] = [];
  result.timestamp.forEach((timestamp, index) => {
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    // A partial trading day's candle is not a daily return observation.
    if (date >= todayNy && now < (result.meta?.currentTradingPeriod?.regular?.end || Infinity) * 1000) return;
    const close = result.indicators?.quote?.[0]?.close?.[index];
    const adjustedClose = result.indicators?.adjclose?.[0]?.adjclose?.[index];
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0 || typeof adjustedClose !== "number" || !Number.isFinite(adjustedClose) || adjustedClose <= 0) return;
    prices.push({ date, close, adjustedClose });
  });
  if (!prices.length) throw new Error("No completed daily prices returned");
  return { prices: prices.sort((a, b) => a.date.localeCompare(b.date)), requestedFrom, splitDates: Object.values(result.events?.splits || {}).map(split => new Date(split.date * 1000).toISOString().slice(0, 10)) };
}

export async function fetchPriceHistory(ticker: string, from: string): Promise<PriceHistory> {
  const period1 = Math.floor(Date.parse(from) / 1000) - 7 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplits`;
  return parseYahooHistory(await (await get(url)).json(), from);
}

/** RFC 4180 cells, including embedded commas/newlines and doubled quotation marks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Truncated holdings CSV");
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function isoDate(value: string): string {
  // Issuer dates are calendar dates, never local-midnight instants (which shift in UTC).
  const numeric = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const natural = value.match(/^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/);
  const month = numeric ? Number(numeric[1]) - 1 : natural ? ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(natural[1]) : -1;
  const day = Number(numeric?.[2] || natural?.[2]);
  const year = Number(numeric?.[3] || natural?.[3]);
  if (month < 0 || month > 11 || !day || !year) throw new Error("Holdings date is missing or invalid");
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) throw new Error("Holdings date is invalid");
  return date.toISOString().slice(0, 10);
}

function validateComposition(holdings: FundHolding[], asOf: string, source: string): FundComposition {
  const equityWeight = holdings.reduce((sum, holding) => sum + holding.weight, 0);
  if (holdings.length < 20 || holdings.some(holding => !holding.name || !holding.symbol || !Number.isFinite(holding.weight) || holding.weight < 0 || holding.weight > 1) || equityWeight < 0.9 || equityWeight > 1.03) {
    throw new Error("Incomplete or invalid equity holdings; keeping the last valid composition");
  }
  if (Date.parse(asOf) > Date.now() + 86400000) throw new Error("Holdings date is in the future");
  // Reconcile small rounding excesses without inflating a genuine cash residual.
  const divisor = Math.max(1, equityWeight);
  return { holdings: holdings.map(holding => ({ ...holding, weight: holding.weight / divisor })), asOf, source, equityWeight: equityWeight / divisor };
}

export function parseIsharesHoldings(text: string): FundComposition {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const asOf = isoDate(rows.find(row => row[0] === "Fund Holdings as of")?.[1] || "");
  const headerIndex = rows.findIndex(row => row.includes("Ticker") && row.includes("Weight (%)") && row.includes("Asset Class"));
  if (headerIndex < 0) throw new Error("Holdings columns are missing");
  const header = rows[headerIndex];
  if (!header.includes("Location")) throw new Error("Holding country column is missing; keeping the last valid composition");
  const field = (row: string[], name: string) => row[header.indexOf(name)] || "";
  const holdings = rows.slice(headerIndex + 1).filter(row => field(row, "Asset Class") === "Equity").map(row => ({
    symbol: field(row, "Ticker"), name: field(row, "Name"), country: field(row, "Location"), weight: Number(field(row, "Weight (%)").replace(/,/g, "")) / 100,
    sector: HOLDING_SECTORS.get(field(row, "Sector")),
  }));
  const composition = validateComposition(holdings, asOf, "iShares");
  const nonEquityWeights = rows.slice(headerIndex + 1)
    .filter(row => field(row, "Asset Class") && field(row, "Asset Class") !== "Equity")
    .map(row => Number(field(row, "Weight (%)").replace(/,/g, "")) / 100);
  if (nonEquityWeights.some(weight => !Number.isFinite(weight))) throw new Error("Invalid non-equity weights; keeping the last valid composition");
  // Keep the same rounding divisor as the equity holdings. Never call the entire residual cash.
  const divisor = Math.max(1, holdings.reduce((sum, holding) => sum + holding.weight, 0));
  return { ...composition, nonEquityWeight: Math.max(0, nonEquityWeights.reduce((sum, weight) => sum + weight, 0)) / divisor, geography: { basis: "holdings", asOf }, sectorSource: holdings.some(holding => holding.sector) ? "issuer" : null };
}

function sectorSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[ ./-]+/g, ".");
}

/** IVV supplies sector labels for the shared index securities. VOO weights always come from Vanguard. */
export function classifyVanguardHoldings(composition: FundComposition, csv: string): FundComposition {
  const rows = parseCsv(csv);
  const headerIndex = rows.findIndex(row => row.includes("Ticker") && row.includes("Sector") && row.includes("Asset Class"));
  if (headerIndex < 0) throw new Error("Missing IVV sector columns");
  const header = rows[headerIndex];
  const tickerIndex = header.indexOf("Ticker");
  const sectorIndex = header.indexOf("Sector");
  const assetClassIndex = header.indexOf("Asset Class");
  const sectors = new Map<string, string | undefined>();
  for (const row of rows.slice(headerIndex + 1)) {
    if (row[assetClassIndex] !== "Equity" || !row[tickerIndex]) continue;
    const symbol = sectorSymbol(row[tickerIndex]);
    const sector = HOLDING_SECTORS.get(row[sectorIndex]);
    if (sectors.has(symbol) && sectors.get(symbol) !== sector) sectors.set(symbol, undefined);
    else sectors.set(symbol, sector);
  }
  if (sectors.size < 400) throw new Error("Incomplete IVV sector data");
  const holdings = composition.holdings.map(holding => ({ ...holding, sector: sectors.get(sectorSymbol(holding.symbol)) }));
  return { ...composition, holdings, sectorSource: holdings.some(holding => holding.sector) ? "ivv" : null };
}

export function parseVanguardHoldings(payload: unknown): FundComposition {
  const details = (payload as { holdingDetails?: { asOfDate?: string; equityHoldings?: { securityType?: string; ticker?: string; securityLongDescription?: string; marketValuePercentage?: string }[] } })?.holdingDetails;
  if (!details?.equityHoldings?.length) throw new Error("Vanguard equity holdings are missing");
  // The equity bucket also includes contingent-value rights without company weights.
  const holdings = details.equityHoldings.filter(row => row.securityType === "EQ.STOCK" || row.securityType === "EQ.REIT").map(row => ({ symbol: row.ticker || "", name: row.securityLongDescription || "", country: "United States", weight: Number(row.marketValuePercentage?.replace("%", "")) / 100 }));
  return { ...validateComposition(holdings, isoDate(details.asOfDate || ""), "Vanguard"), geography: { basis: "unavailable" } };
}

/** Verify the published fund scope rather than pretending Vanguard supplies per-holding countries. */
export function parseVanguardGeography(html: string): NonNullable<FundComposition["geography"]> {
  const encoded = html.match(/data-vgn-funds-profile\s*=\s*'([^']+)'/)?.[1];
  if (!encoded) return { basis: "unavailable" };
  try {
    const decoded = encoded.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const profile = JSON.parse(decoded) as { overview?: { assetClass?: string } };
    if (profile.overview?.assetClass !== "Domestic Stock - General") return { basis: "unavailable" };
    return { basis: "fund-scope", country: "United States" };
  } catch { return { basis: "unavailable" }; }
}

type FranklinHolding = {
  asofdate: string; secticker: string; isinsecnbr: string; secname: string;
  sctrname: string; pctofnetassetsstd: string; assetclasscatg: string;
};
type FranklinAllocation = {
  asofdate: string; brkdwnpctstd: string; calcnamestd: string;
  brkdwnname?: string; sectorname?: string; parent?: string; parentsectorname?: string;
};
const FRANKLIN_CASH = "Cash & Cash Equivalents";

function franklinMix(rows: FranklinAllocation[] | undefined, kind: "country" | "sector") {
  const totals = rows?.filter(row => row.calcnamestd === "TOTAL_PCT_OF_TOTAL" && !row.parent && !row.parentsectorname) ?? [];
  const asOf = isoDate(totals[0]?.asofdate ?? "");
  const weights = new Map<string, number>();
  for (const row of totals) {
    const name = kind === "country" ? row.brkdwnname : row.sectorname;
    const weight = Number(row.brkdwnpctstd) / 100;
    if (!name || !row.brkdwnpctstd?.trim() || !Number.isFinite(weight) || weight < 0 || weight > 1
      || weights.has(name) || isoDate(row.asofdate) !== asOf) {
      throw new Error(`Invalid Franklin Templeton ${kind} allocation`);
    }
    weights.set(name, weight);
  }
  const total = Array.from(weights.values()).reduce((sum, weight) => sum + weight, 0);
  if (weights.size < 5 || Math.abs(total - 1) > 0.002 || Date.parse(asOf) > Date.now() + 86400000) {
    throw new Error(`Incomplete Franklin Templeton ${kind} allocation`);
  }
  return { weights, asOf, total };
}

export function parseFranklinComposition(payload: unknown): FundComposition {
  const response = payload as { errors?: unknown[]; data?: { Portfolio?: {
    fundname?: string;
    portfolio?: { dailyholdings?: FranklinHolding[]; countryallocation?: FranklinAllocation[]; sectorallocation?: FranklinAllocation[] };
  } } };
  const fund = response?.data?.Portfolio;
  const data = fund?.portfolio;
  if (response?.errors?.length || fund?.fundname !== "Franklin FTSE Asia ex Japan ETF" || !Array.isArray(data?.dailyholdings)) {
    throw new Error("Invalid Franklin Templeton FLAX holdings");
  }
  const asOf = isoDate(data.dailyholdings[0]?.asofdate ?? "");
  const equity = new Set(["COMMON STOCK", "FOREIGN STOCK", "PREFERRED STOCK"]);
  const holdings = data.dailyholdings.filter(row => equity.has(row.assetclasscatg)).map(row => {
    if (isoDate(row.asofdate) !== asOf) throw new Error("Mixed FLAX holding dates");
    const isin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(row.isinsecnbr) ? row.isinsecnbr : undefined;
    return {
      symbol: row.secticker && row.secticker !== "—" ? row.secticker : isin ?? "",
      name: row.secname,
      country: "",
      isin,
      weight: row.pctofnetassetsstd?.trim() ? Number(row.pctofnetassetsstd) / 100 : NaN,
      sector: HOLDING_SECTORS.get(row.sctrname),
    };
  }).filter(holding => holding.weight !== 0);
  const composition = validateComposition(holdings, asOf, "Franklin Templeton");
  const countries = franklinMix(data.countryallocation, "country");
  const cashWeight = countries.weights.get(FRANKLIN_CASH) ?? 0;
  countries.weights.delete(FRANKLIN_CASH);
  const sectors = franklinMix(data.sectorallocation, "sector");
  const sectorWeights: Record<string, number> = {};
  for (const [name, weight] of Array.from(sectors.weights)) {
    const key = name === FRANKLIN_CASH ? "Cash & Equivalents" : HOLDING_SECTORS.get(name) ?? "Other";
    sectorWeights[key] = (sectorWeights[key] ?? 0) + weight / Math.max(1, sectors.total);
  }
  return {
    ...composition,
    sectorAllocation: { asOf: sectors.asOf, weights: sectorWeights },
    geography: {
      basis: "issuer-allocation", asOf: countries.asOf, cashWeight,
      countries: Array.from(countries.weights, ([country, weight]) => ({ country, weight })),
    },
  };
}

async function fetchFranklinComposition() {
  // This is the public data service used by Franklin Templeton's FLAX fund page.
  const query = `query Holdings($productId: String!, $countryCode: String!, $languageCode: String!) {
    Portfolio(fundid: $productId, countrycode: $countryCode, languagecode: $languageCode) {
      fundname
      portfolio {
        dailyholdings { asofdate secticker isinsecnbr secname sctrname pctofnetassetsstd assetclasscatg }
        countryallocation { asofdate brkdwnname brkdwnpctstd calcnamestd parent }
        sectorallocation { asofdate sectorname brkdwnpctstd calcnamestd parentsectorname }
      }
    }
  }`;
  const response = await fetch("https://www.franklintempleton.com/api/pds/price-and-performance?op=Holdings", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, operationName: "Holdings", variables: { productId: "26346", countryCode: "US", languageCode: "en_US" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Franklin Templeton returned ${response.status}`);
  return parseFranklinComposition(await response.json());
}

const ISHARES: Record<string, string> = {
  USMV: "239695/ishares-msci-usa-minimum-volatility-etf",
  IDEV: "286762/ishares-core-msci-international-developed-markets-etf",
};

export async function fetchFundComposition(ticker: string): Promise<FundComposition> {
  if (ticker === "FLAX") return fetchFranklinComposition();
  if (ticker === "VOO") {
    const [payload, scope, sectorCsv] = await Promise.all([
      get("https://investor.vanguard.com/irr/funds/profile/VOO-AdditionalFundData").then(response => response.json()),
      get("https://investor.vanguard.com/investment-products/etfs/profile/voo").then(response => response.text()).then(parseVanguardGeography).catch(() => ({ basis: "unavailable" as const })),
      get("https://www.ishares.com/us/products/239726/ishares-core-sp-500-etf/latest-holdings.csv").then(response => response.text()).catch(() => null),
    ]);
    const composition: FundComposition = { ...parseVanguardHoldings(payload), geography: scope, sectorSource: null };
    if (sectorCsv) {
      try { return classifyVanguardHoldings(composition, sectorCsv); }
      catch { /* Holdings remain usable if the sector feed fails. */ }
    }
    return composition;
  }
  if (!ISHARES[ticker]) throw new Error(`Full holdings are not configured for ${ticker}`);
  return parseIsharesHoldings(await (await get(`https://www.ishares.com/us/products/${ISHARES[ticker]}/latest-holdings.csv`)).text());
}
