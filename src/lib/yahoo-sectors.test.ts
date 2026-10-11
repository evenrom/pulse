import assert from "node:assert/strict";
import test from "node:test";
import { createYahooSectorFetcher } from "./yahoo-sectors";

const fundResponse = () => Response.json({
  quoteSummary: { result: [{ topHoldings: { sectorWeightings: [{ technology: 0.4 }, { financial_services: 0.6 }] } }], error: null },
});

test("the fetcher establishes one cookie/crumb session shared by concurrent tickers", async () => {
  let cookieCalls = 0;
  let crumbCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.equal(init?.cache, "no-store");
    if (url === "https://fc.yahoo.com") {
      cookieCalls++;
      return new Response(null, { status: 404, headers: { "Set-Cookie": "A3=test-session; Path=/; Secure" } });
    }
    assert.equal(new Headers(init?.headers).get("Cookie"), "A3=test-session");
    if (url.includes("getcrumb")) { crumbCalls++; return new Response("test/crumb+"); }
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("crumb"), "test/crumb+");
    assert.equal(parsed.searchParams.get("modules"), "topHoldings");
    return fundResponse();
  };
  const getWeights = createYahooSectorFetcher(fetcher);
  const results = await Promise.all([getWeights("VOO"), getWeights("VEA")]);
  assert.equal(cookieCalls, 1);
  assert.equal(crumbCalls, 1);
  assert.deepEqual(results, [{ Technology: 0.4, Financials: 0.6 }, { Technology: 0.4, Financials: 0.6 }]);
});

test("expired authentication gets a new session and retries once", async () => {
  let sessions = 0;
  let quotes = 0;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") {
      sessions++;
      return new Response(null, { status: 404, headers: { "Set-Cookie": `A3=session-${sessions}; Path=/` } });
    }
    if (url.includes("getcrumb")) return new Response(`crumb-${sessions}`);
    quotes++;
    return quotes === 1 ? new Response(null, { status: 401 }) : fundResponse();
  };
  assert.deepEqual(await createYahooSectorFetcher(fetcher)("VOO"), { Technology: 0.4, Financials: 0.6 });
  assert.equal(sessions, 2);
  assert.equal(quotes, 2);
});

test("rate limiting is reported without retrying repeatedly or accepting empty data", async () => {
  let quotes = 0;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") return new Response(null, { status: 404, headers: { "Set-Cookie": "A3=session; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb");
    quotes++;
    return new Response(null, { status: 429 });
  };
  await assert.rejects(createYahooSectorFetcher(fetcher)("VOO"), /429/);
  assert.equal(quotes, 1);
});
