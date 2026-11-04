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

- Home displays a full-width Risk & Return scatter plot. Cumulative USD profit comes from the existing Assets calculation and is signed/color-coded independently of volatility in the selected-point details. Exact weights and contribution figures remain in the collapsed drawer.
- Each fund's annualized volatility is its sample standard deviation of the shared daily adjusted returns multiplied by `sqrt(252)`, expressed as a percentage.
- Total Portfolio uses the same annualization of the current-weighted daily portfolio return series, incorporating covariances. Its cumulative profit comes from the whole portfolio USD profit divided by Net Invested; it has no relative-impact figure. Valid zero portfolio volatility remains zero, with undefined contribution ratios left blank.
- One shared display classifier applies to both funds and portfolio: Low below 5%, Medium from 5% to below 15%, High from 15%. These group boundaries in the historical CESR/10-673 Box 2 grid; they are Pulse display conventions, not an official SRRI/PRIIPs rating, universal standard, personal suitability assessment, or safety claim. Source: https://www.esma.europa.eu/sites/default/files/library/2015/11/10_673.pdf. Pulse uses daily returns in a trailing-year window, unlike that historical methodology's five-year weekly/monthly sample.
- Blue/amber/purple volatility colors are independent of green/red profit/loss colors. Classification uses unrounded observations; display avoids rounding a value below a band boundary up to that boundary.
- The scatter plot maps annualized volatility to cumulative profit, retains a zero-profit line and exact observation positions, and supports hover, click and keyboard selection. Fund circles approximate current weight; a diamond identifies the portfolio. Labels may move to reduce overlap. The compact subtitle identifies all-time profit versus 1Y volatility; the drawer explains the different horizons and the absence of any efficiency or investment ranking. Visible axis titles are enlarged and simplified to Profit (%) and Volatility (%).
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

## Sector engines and regional allocation

- Home uses stacked horizontal engine bars with a shared scale. Segment/name selection shows each ETF’s contribution to the sector as a percentage of the entire portfolio. Stable engine colors and sector tints do not change with ranking.
- SGOV and IAU appear as T-Bills and Gold under Gold & T-Bills. Cash and unknown balances in other funds stay under Other; they are not relabeled Treasury bills.
- Regional percentages use the full current value of equity funds, including their cash/unknown balances. SGOV and IAU are excluded from this denominator and shown separately as percentages of the whole portfolio. Region/country/ETF contribution percentages use the same equity denominator.
- iShares country attribution comes from the existing full-holdings CSV Location field. Only mapped geographic regions appear in the chart. The disclosure separates issuer-reported cash/non-equity weights, unreconciled reporting/rounding differences, actually missing countries, and named countries awaiting regional mapping. Residuals retain per-fund contributions. Known country percentages retain the full equity-fund denominator and are not increased to total 100%.
- Non-equity weights are read from the same issuer CSV, including cash, money market, collateral and other non-equity rows. The reported net weight is capped at the remaining fund balance; the rest is an unreconciled reporting/rounding balance, not assumed cash. Legacy cached residuals without that breakdown remain reporting differences until an automatic metadata upgrade succeeds.
- Small residuals appear only in the drawer, without warning colors. A visible country-coverage notice appears for an entire fund with missing country data, or at least 1% of equity-fund value in missing countries/countries awaiting regional mapping. This is a UI convention, not a risk threshold; cash and reporting differences never trigger it. No equity funds and no mapped country data have distinct empty states.
- Vanguard’s VOO holdings response has no per-holding country field. Its US allocation uses an explicitly labeled fund-scope fallback, verified against the official product page’s `overview.assetClass = Domestic Stock - General`. This is market scope, not a measured country for each company, and is not inferred from security identifiers or exchange listings. Unavailable verification leaves VOO unclassified, or retains a previously verified composition and its original date.
- Region rows expand into countries (five initially, expandable to all); country selection shows ETF contributions. Countries follow provider classifications, not company revenue locations. Source, reporting/retrieval dates, fallback basis and stale status are in the disclosure.
- Cached compositions without geography metadata, or iShares compositions without non-equity weights, are upgraded on the next analytics request without waiting a full week. Failed upgrades preserve the payload and back off for an hour. Initial holdings with unavailable geography remain usable for company exposure while geographic verification retries hourly.

## Refresh and failure behavior

- Additive `analytics_cache` table, initialized idempotently. No edits to existing transactions, prices, snapshots or FX records by the analytics endpoint.
- Price history refreshes every six hours; compositions every seven days, via authenticated analytics requests and existing market sync. Public provider requests run concurrently with timeouts.
- Failed attempts retain the last valid payload and its original retrieval date, with one-hour retry backoff. Company source dates are distinguished from retrieval dates.
- Analytics loads independently after the main portfolio response. A provider failure cannot prevent portfolio rendering.

## Verification

- `npm run test:analytics`: accounting-history cases, covariance allocation, missing/stale data, dividend adjustment, company aggregation, issuer parser validation, cache failure/backoff.
- `npx tsx scripts/check-analytics-providers.ts`: optional read-only live public-provider smoke check; does not connect to the portfolio database.
- Existing accounting/sector tests, TypeScript, lint and production build remain applicable.
