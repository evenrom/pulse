import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRegionalAllocation, buildSectorAllocation } from "./allocation";
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
    ["IDEV", composition([["UK", 0.5], ["Japan", 0.2], ["Atlantis", 0.1], ["-", 0.1]])],
  ]));
  close(result.equityPortfolioPct, 80);
  close(result.regions.reduce((sum, region) => sum + region.pct, 0), 100);
  close(result.mappedPct + result.unclassifiedPct, 100);
  close(result.regions.find(row => row.name === "Europe")!.pct, 25);
  close(result.regions.find(row => row.name === "North America")!.pct, 45);
  close(result.regions.find(row => row.name === "Unclassified")!.pct, 15);
  assert.equal(result.regions.find(row => row.name === "Unmapped countries")!.countries[0].name, "Atlantis");
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
  close(result.unclassifiedPct, 100);
  assert.deepEqual(result.regions.map(row => row.name), ["Unclassified"]);
  const empty = aggregateRegionalAllocation([{ ticker: "SGOV", value: 20 }], new Map());
  assert.equal(empty.equityPortfolioPct, 0);
  assert.deepEqual(empty.regions, []);
  assert.deepEqual(buildSectorAllocation([]), []);
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
