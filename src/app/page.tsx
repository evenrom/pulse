"use client";

import { useState } from "react";
import { Lock, RefreshCw, DollarSign, Activity, TrendingUp, AlertCircle, ArrowRight } from "lucide-react";

type Asset = {
  ticker: string;
  name: string;
  quantity: number;
  current_price: number;
  value_usd: number;
  value_ils: number;
};

type Metrics = {
  totalMarketValue: number;
  netInvested: number;
  capitalProfit: number;
  totalDrip: number;
  netProfit: number;
};

type PortfolioData = {
  metrics: {
    usd: Metrics;
    ils: Metrics;
    exchangeRate: number;
  };
  assets: Asset[];
};

export default function Home() {
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"usd" | "ils">("usd");
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);

  const formatCurrency = (value: number, curr: "usd" | "ils") => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: curr === "usd" ? "USD" : "ILS",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const fetchPortfolio = async (currentPin: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/portfolio", {
        headers: {
          "x-pin": currentPin,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Incorrect PIN");
        }
        throw new Error("Failed to fetch portfolio data");
      }

      const data = await res.json();
      setPortfolioData(data);
      setIsAuthenticated(true);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.trim().length === 0) return;
    fetchPortfolio(pin);
  };

  const handleSync = async () => {
    if (!pin) return;
    try {
      setIsSyncing(true);
      setError(null);

      const res = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "x-pin": pin,
        },
      });

      if (!res.ok) {
        throw new Error("Failed to sync market prices");
      }

      // Re-fetch data after sync
      await fetchPortfolio(pin);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to sync");
      }
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-4rem)] p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden p-8">
          <div className="flex flex-col items-center justify-center mb-8">
            <div className="h-16 w-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-blue-500" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Access Terminal</h1>
            <p className="text-slate-400 mt-2 text-sm text-center">Enter your secure PIN to view your portfolio.</p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-center tracking-widest text-lg"
                autoFocus
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 bg-red-400/10 p-3 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || pin.length === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Unlock</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const currentMetrics = portfolioData?.metrics[currency];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-2">
            <Activity className="w-8 h-8 text-blue-500" />
            Pulse
          </h1>
          <p className="text-slate-400 mt-1">Terminal Dashboard</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-1 flex">
            <button
              onClick={() => setCurrency("usd")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "usd" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              USD
            </button>
            <button
              onClick={() => setCurrency("ils")}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                currency === "ils" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              ILS
            </button>
          </div>

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Update market prices (may take a minute)"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{isSyncing ? "Syncing..." : "Refresh Prices"}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 text-red-400 bg-red-400/10 p-4 rounded-xl text-sm border border-red-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {currentMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Total Market Value</h3>
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <DollarSign className="w-5 h-5 text-blue-500" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {formatCurrency(currentMetrics.totalMarketValue, currency)}
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Net Invested</h3>
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Activity className="w-5 h-5 text-purple-500" />
              </div>
            </div>
            <div>
              <p className="text-3xl font-bold text-white tracking-tight">
                {formatCurrency(currentMetrics.netInvested, currency)}
              </p>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-400 font-medium">Capital Profit</h3>
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
            </div>
            <div>
              <p className={`text-3xl font-bold tracking-tight ${currentMetrics.capitalProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {currentMetrics.capitalProfit >= 0 ? "+" : ""}{formatCurrency(currentMetrics.capitalProfit, currency)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white">Holdings</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-950/50 text-slate-400">
              <tr>
                <th className="px-6 py-4 font-medium">Ticker</th>
                <th className="px-6 py-4 font-medium text-right">Quantity</th>
                <th className="px-6 py-4 font-medium text-right">Current Price</th>
                <th className="px-6 py-4 font-medium text-right">Value ({currency.toUpperCase()})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {portfolioData?.assets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    No holdings found.
                  </td>
                </tr>
              ) : (
                portfolioData?.assets.filter(a => a.quantity > 0).map((asset) => (
                  <tr key={asset.ticker} className="hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{asset.ticker}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{asset.name || "Unknown Asset"}</div>
                    </td>
                    <td className="px-6 py-4 text-right text-slate-300">{asset.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td className="px-6 py-4 text-right text-slate-300">
                      {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(asset.current_price || 0)}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-white">
                      {formatCurrency(currency === "usd" ? asset.value_usd : asset.value_ils, currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}