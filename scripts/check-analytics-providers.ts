/** Read-only public provider smoke check. Does not connect to the portfolio database. */
import { fetchFundComposition, fetchPriceHistory } from "../src/lib/analytics-providers";

async function main() {
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() - 1); start.setUTCDate(start.getUTCDate() - 10);
  const results = await Promise.allSettled(["VOO", "USMV", "IDEV", "SGOV", "IAU"].map(async ticker => {
    const [history, holdings] = await Promise.all([fetchPriceHistory(ticker, start.toISOString().slice(0, 10)), ["SGOV", "IAU"].includes(ticker) ? null : fetchFundComposition(ticker)]);
    return { ticker, dailyPrices: history.prices.length, through: history.prices.at(-1)?.date, holdings: holdings?.holdings.length ?? "non-equity", holdingsAsOf: holdings?.asOf, equityWeight: holdings?.equityWeight };
  }));
  for (const result of results) {
    if (result.status === "fulfilled") console.log(JSON.stringify(result.value));
    else { console.error(result.reason); process.exitCode = 1; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
