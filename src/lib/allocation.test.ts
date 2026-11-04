import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRegionalAllocation, buildSectorAllocation, hasMaterialCountryGap } from "./allocation";
import { parseIsharesHoldings, parseVanguardGeography } from "./analytics-providers";
import type { FundComposition } from "./portfolio-analytics";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
const composition = (countries: [string, number][], extra: Partial<FundComposition> = {}): FundComposition => ({
  source: "iShares", asOf: "2026-01-01", equityWeight: countries.reduce((sum, [, weight]) => sum + weight, 0),
  holdings: countries.map(([country, weight], index) => ({ symbol: `S${index}`, name: `Company ${index}`, country, weight })),
  geography: { basis: "holdings" }, ...extra,
});

test("engines reconcile to the entire portfolio and reserve T-Bills/Gold for their actual funds", () => {
  const result = buildSectorAllocation([
    { ticker: "VOO", value: 60, weights: { Technology: 0.5, Healthcare: 0.4 } },
    { ticker: "SGOV", value: 25, weights: { "Cash & Equiv": 1 } },
    { ticker: "IAU", value: 15, weights: { Commodities: 1 } },
  ]);
  close(result.reduce((sum, row) => sum + row.pct, 0), 100);
  const slices = result.flatMap(row => row.sectors);
  close(slices.find(row => row.name === "Other")!.pct, 6);
  close(slices.find(row => row.name === "T-Bills")!.pct, 25);
  close(slices.find(row => row.name === "Gold")!.pct, 15);
  assert.deepEqual(slices.find(row => row.name === "T-Bills")!.contributions, [{ ticker: "SGOV", pct: 25 }]);
  for (const slice of slices) close(slice.contributions.reduce((sum, item) => sum + item.pct, 0), slice.pct);
  const rankedDifferently = buildSectorAllocation([{ ticker: "VOO", value: 100, weights: { Technology: 0.1, Healthcare: 0.9 } }]);
  const technology = slices.find(row => row.name === "Technology")!;
  const reranked = rankedDifferently.flatMap(row => row.sectors).find(row => row.name === "Technology")!;
  assert.equal(technology.color, reranked.color);
  assert.equal(technology.opacity, reranked.opacity);
});

test("countries and regions share the full equity-fund denominator, preserving unknowns and cash", () => {
  const result = aggregateRegionalAllocation([
    { ticker: "VOO", value: 40 }, { ticker: "IDEV", value: 40 }, { ticker: "SGOV", value: 15 }, { ticker: "IAU", value: 5 },
  ], new Map([
    ["VOO", composition([["USA", 0.9]], { source: "Vanguard", geography: { basis: "fund-scope", country: "United States" } })],
    ["IDEV", composition([["UK", 0.5], ["Japan", 0.2], ["Atlantis", 0.1], ["-", 0.1]], { nonEquityWeight: 0.04 })],
  ]));
  close(result.equityPortfolioPct, 80);
  close(result.regions.reduce((sum, region) => sum + region.pct, 0), 80);
  close(result.mappedPct + result.residualPct, 100);
  close(result.regions.find(row => row.name === "Europe")!.pct, 25);
  close(result.regions.find(row => row.name === "North America")!.pct, 45);
  close(result.residuals.missingCountries[0].pct, 5);
  close(result.residuals.nonEquity[0].pct, 2);
  close(result.residuals.reportingGap.reduce((sum, row) => sum + row.pct, 0), 8);
  assert.equal(result.residuals.unmappedCountries[0].name, "Atlantis");
  close(result.residuals.unmappedCountries[0].pct, 5);
  const remainder = Object.values(result.residuals).flat().reduce((sum, row) => sum + row.pct, 0);
  close(remainder, result.residualPct);
  assert.deepEqual(result.fundScopeTickers, ["VOO"]);
  assert.deepEqual(result.outsideEquities, [{ ticker: "SGOV", pct: 15 }, { ticker: "IAU", pct: 5 }]);
  for (const region of result.regions) for (const country of region.countries) {
    close(country.contributions.reduce((sum, item) => sum + item.pct, 0), country.pct);
  }
});

test("legacy Vanguard country defaults are not treated as measured countries; missing funds remain visible", () => {
  const result = aggregateRegionalAllocation([{ ticker: "VOO", value: 50 }, { ticker: "NEW", value: 50 }], new Map([
    ["VOO", composition([["United States", 1]], { source: "Vanguard", geography: undefined })],
  ]));
  assert.deepEqual(result.missingTickers, ["VOO", "NEW"]);
  close(result.residualPct, 100);
  assert.deepEqual(result.regions, []);
  close(result.residuals.missingCountries.reduce((sum, row) => sum + row.pct, 0), 100);
  const empty = aggregateRegionalAllocation([{ ticker: "SGOV", value: 20 }], new Map());
  assert.equal(empty.equityPortfolioPct, 0);
  assert.deepEqual(empty.regions, []);
  assert.deepEqual(buildSectorAllocation([]), []);
});

test("cash and reporting residuals stay out of the regional bars and do not trigger country warnings", () => {
  const data = aggregateRegionalAllocation([{ ticker: "IDEV", value: 100 }], new Map([
    ["IDEV", composition([["Japan", 0.9865]], { nonEquityWeight: 0.0061 })],
  ]));
  close(data.regions[0].pct, 98.65);
  close(data.residuals.nonEquity[0].pct, 0.61);
  close(data.residuals.reportingGap[0].pct, 0.74);
  assert.equal(data.residuals.missingCountries.length, 0);
  assert.equal(hasMaterialCountryGap(data), false);
  // A rounded non-equity total cannot inflate the residual or change the original region percentages.
  const excess = aggregateRegionalAllocation([{ ticker: "IDEV", value: 100 }], new Map([
    ["IDEV", composition([["Japan", 0.999]], { nonEquityWeight: 0.002 })],
  ]));
  close(excess.residuals.nonEquity[0].pct, 0.1);
  assert.deepEqual(excess.residuals.reportingGap, []);
  close(excess.mappedPct + excess.residualPct, 100);
});

test("country warnings distinguish small gaps, material gaps, and an entire missing fund", () => {
  for (const [weight, warning] of [[0.009, false], [0.01, true]] as const) {
    const missing = aggregateRegionalAllocation([{ ticker: "IDEV", value: 100 }], new Map([
      ["IDEV", composition([["Japan", 1 - weight], ["-", weight]])],
    ]));
    assert.equal(hasMaterialCountryGap(missing), warning);
    assert.equal(missing.regions.length, 1);
    close(missing.regions[0].pct, (1 - weight) * 100);
  }
  const absent = aggregateRegionalAllocation([{ ticker: "IDEV", value: 99.9 }, { ticker: "NEW", value: 0.1 }], new Map([
    ["IDEV", composition([["Japan", 1]])],
  ]));
  assert.equal(hasMaterialCountryGap(absent), true);
});

test("issuer non-equity rows are measured separately from the unreconciled rounding balance", () => {
  const csv = ['Fund Holdings as of,"Jan 01, 2026"', 'Ticker,Name,Asset Class,Weight (%),Location',
    ...Array.from({ length: 20 }, (_, index) => `S${index},Company ${index},Equity,4.93,Japan`),
    'JPY,JPY CASH,Cash,0.5,Japan', 'XTSLA,Money market,Money Market,0.1,United States',
    'GSCFT,Collateral,Cash Collateral and Margins,0.05,Japan', 'FUT,Future,Futures,0,-',
  ].join("\n");
  const parsed = parseIsharesHoldings(csv);
  close(parsed.equityWeight, 0.986);
  close(parsed.nonEquityWeight!, 0.0065);
  assert.equal(parsed.holdings.length, 20);
  const data = aggregateRegionalAllocation([{ ticker: "IDEV", value: 100 }], new Map([["IDEV", parsed]]));
  close(data.residuals.nonEquity[0].pct, 0.65);
  close(data.residuals.reportingGap[0].pct, 0.75);
});

test("Vanguard geography requires the published domestic fund classification", () => {
  const html = (assetClass: string) => `<div data-vgn-funds-profile='${JSON.stringify({ overview: { assetClass } }).replace(/"/g, "&#34;")}'></div>`;
  assert.deepEqual(parseVanguardGeography(html("Domestic Stock - General")), { basis: "fund-scope", country: "United States" });
  for (const invalid of [html("International Stock"), "Domestic Stock - General", "<div data-vgn-funds-profile='broken'>"]) {
    assert.deepEqual(parseVanguardGeography(invalid), { basis: "unavailable" });
  }
});

test("iShares geography comes from security Location, keeping the issuer reporting date", () => {
  const csv = ['Fund Holdings as of,"Jan 01, 2026"', 'Ticker,Name,Asset Class,Weight (%),Location', ...Array.from({ length: 20 }, (_, index) => `S${index},Company ${index},Equity,5,${index % 2 ? "Japan" : "United Kingdom"}`)].join("\n");
  const result = parseIsharesHoldings(csv);
  assert.deepEqual(result.geography, { basis: "holdings", asOf: "2026-01-01" });
  assert.equal(result.holdings[0].country, "United Kingdom");
  assert.equal(result.holdings[1].country, "Japan");
  assert.throws(() => parseIsharesHoldings(csv.replace(",Location", ",Unknown column")), /country column is missing/);
});
