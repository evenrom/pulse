# Portfolio analytics

The main Portfolio Profit chart remains the primary view. Its periods are `1M`, `1Q`, `1Y`, and `ALL`. Fund detail expands underneath it; company exposures are on Assets. Rebalance and exchange-rate providers/calculations are unchanged.

## Fund profit

- Each active fund has its own percentage chart, with shared time and percentage axes.
- The numerator and Net Invested denominator use `calculateAssetMetrics`, exactly like the existing portfolio metrics. This is profit on the recorded invested basis, not time-weighted performance.
- Filters select dates without rebasing to zero. Zero means no total profit relative to that fund's Net Invested.
- Uses unadjusted-for-dividends closing prices and the recorded BUY/SELL/DRIP ledger. Dividend-adjusted prices are **not** used for profit, avoiding double counting reinvestments.
- ILS preserves the existing lens: current USD/ILS applied to valuation and recorded transaction rates applied to costs and realized gains. No new FX requests or rate corrections.
- No percentages are invented for nonpositive invested basis, missing starting history, or a split that cannot be reconciled with the ledger's supported actions.
- Daily closing observations may differ from the main chart's latest intraday snapshot. Each fund shows its closing date.

## Volatility contribution

- Home displays one compact Risk & Return table, ordered by each fund's own annualized volatility. Cumulative USD profit comes from the existing Assets calculation and is signed/color-coded independently of volatility.
- Each fund's annualized volatility is its sample standard deviation of the shared daily adjusted returns multiplied by `sqrt(252)`, expressed as a percentage.
- Total Portfolio uses the same annualization of the current-weighted daily portfolio return series, incorporating covariances. Its cumulative profit comes from the whole portfolio USD profit divided by Net Invested; it has no relative-impact figure. Valid zero portfolio volatility remains zero, with undefined contribution ratios left blank.
- One shared display classifier applies to both funds and portfolio: Low below 5%, Medium from 5% to below 15%, High from 15%. These group boundaries in the historical CESR/10-673 Box 2 grid; they are Pulse display conventions, not an official SRRI/PRIIPs rating, universal standard, personal suitability assessment, or safety claim. Source: https://www.esma.europa.eu/sites/default/files/library/2015/11/10_673.pdf. Pulse uses daily returns in a trailing-year window, unlike that historical methodology's five-year weekly/monthly sample.
- Blue/amber/purple volatility colors are independent of green/red profit/loss colors. Classification uses unrounded observations; display avoids rounding a value below a band boundary up to that boundary.
- A complementary scatter plot maps annualized volatility to cumulative profit, retains a zero-profit line and exact observation positions, and supports hover, click and keyboard selection. Fund circles approximate current weight; a diamond identifies the portfolio. Labels may move to reduce overlap. The visible caption explicitly states that profit and volatility horizons can differ; no efficiency or investment ranking is inferred.
- Relative impact combines the two weights into `volatility contribution / portfolio weight`. `1x` means the portfolio-average contribution per invested dollar. Negative contributions appear as "Offsets", with the signed multiplier available in the drawer. This is not the fund's own volatility or a probability of loss; a high multiplier need not be the largest absolute portfolio contribution.
- Cumulative profit and the one-year risk sample have different horizons; no return-to-risk score is calculated from these unlike periods. Methodology and exact weight figures are in the collapsed drawer.

- Uses current market-value weights and the last calendar year's dividend-adjusted daily USD returns.
- Aligns matching start/end dates of daily return intervals across **all** active funds. Missing observations are not zero-filled; missing funds are not dropped and weights are not renormalized around them.
- Requires at least 126 shared returns and a shared closing date no older than seven calendar days.
- For portfolio return `p = sum(w_i * r_i)`, contribution is `100 * w_i * Cov(r_i, p) / Var(p)`.
- Contributions reconcile to 100% before display rounding. They may be negative or exceed 100% when other funds offset volatility. These are retrospective estimates for today's allocation, not historical account-value changes or forecasts.
- The risk sample is independent of the profit date filter and currency toggle and is explicitly labeled in USD with its sample dates.

## Companies

- Full equity holdings from Vanguard (VOO) and iShares (USMV and IDEV); stocks and REITs are included, cash, rights, and non-equity funds excluded from the company list.
- Exposure = fund value / **total portfolio value** × company weight in the fund, aggregated across funds. SGOV and IAU remain in the denominator.
- Ten companies shown initially, expandable to twenty. Alphabet, Berkshire, Fox and News share classes have explicit issuer aliases. Other identifiers retain the country to avoid merging unrelated tickers on different national markets.
- Provider rounding excesses up to the validation tolerance are reconciled; actual cash residuals are preserved. The UI reports mapped equity exposure and source dates. Missing fund data is explicitly labeled as a partial ranking.
- Unsupported equity funds are reported as unavailable rather than assigned guessed holdings.

## Refresh and failure behavior

- Additive `analytics_cache` table, initialized idempotently. No edits to existing transactions, prices, snapshots or FX records by the analytics endpoint.
- Price history refreshes every six hours; compositions every seven days, via authenticated analytics requests and existing market sync. Public provider requests run concurrently with timeouts.
- Failed attempts retain the last valid payload and its original retrieval date, with one-hour retry backoff. Company source dates are distinguished from retrieval dates.
- Analytics loads independently after the main portfolio response. A provider failure cannot prevent portfolio rendering.

## Verification

- `npm run test:analytics`: accounting-history cases, covariance allocation, missing/stale data, dividend adjustment, company aggregation, issuer parser validation, cache failure/backoff.
- `npx tsx scripts/check-analytics-providers.ts`: optional read-only live public-provider smoke check; does not connect to the portfolio database.
- Existing accounting/sector tests, TypeScript, lint and production build remain applicable.
