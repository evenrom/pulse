import { parseYahooSectorWeights } from "./sector-allocation";

const USER_AGENT = "Mozilla/5.0";
const SESSION_LIFETIME_MS = 60 * 60 * 1000;
type YahooSession = { cookie: string; crumb: string; createdAt: number };

/** A server-only session shared across tickers, with one retry on expired authentication. */
export function createYahooSectorFetcher(fetcher: typeof fetch = fetch) {
  let sessionPromise: Promise<YahooSession> | null = null;

  async function createSession(): Promise<YahooSession> {
    const cookies = new Map<string, string>();
    const collectCookies = (response: Response) => {
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        const separator = pair.indexOf("=");
        if (separator > 0) cookies.set(pair.slice(0, separator), pair);
      }
    };
    const cookieResponse = await fetcher("https://fc.yahoo.com", {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    // fc.yahoo.com normally responds with 404 while still setting the session cookie.
    collectCookies(cookieResponse);
    await cookieResponse.body?.cancel();
    if (!cookies.size) throw new Error("Yahoo did not provide a session cookie");

    const crumbResponse = await fetcher("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": USER_AGENT, Cookie: Array.from(cookies.values()).join("; ") },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!crumbResponse.ok) throw new Error(`Yahoo session request failed (${crumbResponse.status})`);
    collectCookies(crumbResponse);
    const crumb = (await crumbResponse.text()).trim();
    if (!crumb || crumb.length > 256 || /[\s<>]/.test(crumb)) throw new Error("Invalid Yahoo session response");
    return { cookie: Array.from(cookies.values()).join("; "), crumb, createdAt: Date.now() };
  }

  async function getSession(): Promise<YahooSession> {
    if (!sessionPromise) {
      sessionPromise = createSession().catch(error => {
        sessionPromise = null;
        throw error;
      });
    }
    const session = await sessionPromise;
    if (Date.now() - session.createdAt >= SESSION_LIFETIME_MS) {
      sessionPromise = null;
      return getSession();
    }
    return session;
  }

  return async function fetchYahooSectorWeights(ticker: string): Promise<Record<string, number>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await getSession();
      const url = new URL(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`);
      url.search = new URLSearchParams({ modules: "topHoldings", formatted: "false", crumb: session.crumb }).toString();
      const response = await fetcher(url, {
        headers: { "User-Agent": USER_AGENT, Cookie: session.cookie },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if ((response.status === 401 || response.status === 403) && attempt === 0) {
        await response.body?.cancel();
        // Another ticker may already have replaced this shared session.
        if (sessionPromise && await sessionPromise === session) sessionPromise = null;
        continue;
      }
      if (!response.ok) throw new Error(`Yahoo sector request failed (${response.status})`);
      const payload = await response.json();
      if (payload.quoteSummary?.error) throw new Error("Yahoo could not provide fund sector data");
      return parseYahooSectorWeights(payload.quoteSummary?.result?.[0]?.topHoldings?.sectorWeightings);
    }
    throw new Error("Yahoo sector authentication failed");
  };
}

export const fetchYahooSectorWeights = createYahooSectorFetcher();
