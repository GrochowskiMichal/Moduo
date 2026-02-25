import { useCallback, useEffect, useRef, useState } from "react";
import type { StockEntry, WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

type QuoteData = {
  symbol: string;
  name: string;
  price: number;
  changeAmount: number;
  changePct: number;
  fetchedAt: number;
};

const COMMON_TICKERS: StockEntry[] = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "META", name: "Meta Platforms Inc." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "BRK.B", name: "Berkshire Hathaway" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "PG", name: "Procter & Gamble" },
  { symbol: "HD", name: "Home Depot Inc." },
  { symbol: "DIS", name: "Walt Disney Co." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "AMD", name: "AMD Inc." },
  { symbol: "INTC", name: "Intel Corp." },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "ADBE", name: "Adobe Inc." },
  { symbol: "PYPL", name: "PayPal Holdings" },
  { symbol: "BA", name: "Boeing Co." },
  { symbol: "CSCO", name: "Cisco Systems" },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "KO", name: "Coca-Cola Co." },
  { symbol: "UBER", name: "Uber Technologies" },
  { symbol: "SPOT", name: "Spotify Technology" },
  { symbol: "SQ", name: "Block Inc." },
  { symbol: "SNAP", name: "Snap Inc." },
  { symbol: "SHOP", name: "Shopify Inc." },
  { symbol: "COIN", name: "Coinbase Global" },
  { symbol: "PLTR", name: "Palantir Technologies" },
  { symbol: "ABNB", name: "Airbnb Inc." },
  { symbol: "RIVN", name: "Rivian Automotive" },
  { symbol: "NKE", name: "Nike Inc." },
  { symbol: "SBUX", name: "Starbucks Corp." },
  { symbol: "XOM", name: "Exxon Mobil Corp." },
  { symbol: "CVX", name: "Chevron Corp." },
  { symbol: "GS", name: "Goldman Sachs" },
];

const DEFAULT_STOCKS: StockEntry[] = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
];

const ALPHA_VANTAGE_API_KEY =
  ((globalThis as unknown as { __PUBLIC_ALPHA_VANTAGE_API_KEY__?: string }).__PUBLIC_ALPHA_VANTAGE_API_KEY__ ??
    "") ||
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_ALPHA_VANTAGE_API_KEY) ||
  "";
const FINNHUB_API_KEY =
  ((globalThis as unknown as { __PUBLIC_FINNHUB_API_KEY__?: string }).__PUBLIC_FINNHUB_API_KEY__ ?? "") ||
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_FINNHUB_API_KEY) ||
  "";
const MARKETSTACK_API_KEY =
  ((globalThis as unknown as { __PUBLIC_MARKETSTACK_API_KEY__?: string }).__PUBLIC_MARKETSTACK_API_KEY__ ?? "") ||
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.PUBLIC_MARKETSTACK_API_KEY) ||
  "";

const QUOTE_FRESH_MS = 90_000;
const MARKETSTACK_COUNTER_KEY = "moduo:stock:marketstack:v1";

async function fetchAlphaQuote(symbol: string, apiKey: string): Promise<QuoteData | null> {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const payload = await res.json();
    const quote = payload?.["Global Quote"];
    if (!quote || typeof quote !== "object") return null;
    const rawSymbol = String(quote["01. symbol"] ?? symbol).toUpperCase();
    const price = Number(quote["05. price"] ?? 0);
    const changeAmount = Number(quote["09. change"] ?? 0);
    const changePctRaw = String(quote["10. change percent"] ?? "0");
    const changePct = Number(changePctRaw.replace("%", "")) || 0;
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      symbol: rawSymbol,
      name: rawSymbol,
      price,
      changeAmount: Number.isFinite(changeAmount) ? changeAmount : 0,
      changePct,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

function fromYahooSymbol(symbol: string): string {
  return symbol.replace(/-/g, ".");
}

async function fetchYahooQuotes(symbols: string[]): Promise<Map<string, QuoteData>> {
  const map = new Map<string, QuoteData>();
  if (symbols.length === 0) return map;
  const joined = symbols.map(toYahooSymbol).join(",");
  const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}`);
  if (!res.ok) return map;
  const payload = await res.json();
  const rows = payload?.quoteResponse?.result;
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    const providerSymbol = String(row?.symbol ?? "").toUpperCase();
    if (!providerSymbol) continue;
    const symbol = fromYahooSymbol(providerSymbol);
    map.set(symbol, {
      symbol,
      name: String(row?.longName ?? row?.shortName ?? symbol),
      price: Number(row?.regularMarketPrice ?? 0),
      changeAmount: Number(row?.regularMarketChange ?? 0),
      changePct: Number(row?.regularMarketChangePercent ?? 0),
      fetchedAt: Date.now(),
    });
  }
  return map;
}

function readMarketstackUsage(): { month: string; count: number; lastCallAt: number } {
  if (typeof window === "undefined") return { month: "", count: 0, lastCallAt: 0 };
  try {
    const raw = window.localStorage.getItem(MARKETSTACK_COUNTER_KEY);
    if (!raw) return { month: "", count: 0, lastCallAt: 0 };
    const parsed = JSON.parse(raw) as { month?: string; count?: number; lastCallAt?: number };
    return {
      month: parsed.month ?? "",
      count: Number(parsed.count ?? 0),
      lastCallAt: Number(parsed.lastCallAt ?? 0),
    };
  } catch {
    return { month: "", count: 0, lastCallAt: 0 };
  }
}

function writeMarketstackUsage(next: { month: string; count: number; lastCallAt: number }) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MARKETSTACK_COUNTER_KEY, JSON.stringify(next));
}

async function fetchMarketstackBatch(symbols: string[], apiKey: string): Promise<Map<string, QuoteData>> {
  const map = new Map<string, QuoteData>();
  if (!apiKey || symbols.length === 0) return map;
  const symbolsParam = symbols.join(",");
  const url = `https://api.marketstack.com/v1/eod/latest?access_key=${encodeURIComponent(apiKey)}&symbols=${encodeURIComponent(symbolsParam)}&limit=100`;
  const res = await fetch(url);
  if (!res.ok) return map;
  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const now = Date.now();
  for (const row of rows) {
    const symbol = String(row?.symbol ?? "").toUpperCase();
    const close = Number(row?.close ?? 0);
    const open = Number(row?.open ?? close);
    if (!symbol || !Number.isFinite(close) || close <= 0) continue;
    const changeAmount = Number.isFinite(open) ? close - open : 0;
    const changePct = open > 0 ? (changeAmount / open) * 100 : 0;
    map.set(symbol, {
      symbol,
      name: symbol,
      price: close,
      changeAmount,
      changePct,
      fetchedAt: now,
    });
  }
  return map;
}

async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<QuoteData | null> {
  if (!apiKey) return null;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const row = await res.json();
    const price = Number(row?.c ?? 0);
    if (!Number.isFinite(price) || price <= 0) return null;
    const changeAmount = Number(row?.d ?? 0);
    const changePct = Number(row?.dp ?? 0);
    return {
      symbol,
      name: symbol,
      price,
      changeAmount: Number.isFinite(changeAmount) ? changeAmount : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function fetchAllQuotes(
  symbols: string[],
  alphaKey: string,
  finnhubKey: string,
  marketstackKey: string,
  opts?: { forceMarketstack?: boolean; alphaLimit?: number; finnhubLimit?: number }
): Promise<Map<string, QuoteData>> {
  const map = new Map<string, QuoteData>();
  if (symbols.length === 0) return map;

  const monthKey = new Date().toISOString().slice(0, 7);
  const usage = readMarketstackUsage();
  const normalizedUsage = usage.month === monthKey ? usage : { month: monthKey, count: 0, lastCallAt: 0 };
  const shouldUseMarketstack =
    !!marketstackKey &&
    normalizedUsage.count < 95 &&
    (opts?.forceMarketstack || Date.now() - normalizedUsage.lastCallAt > 8 * 60 * 60 * 1000);

  if (shouldUseMarketstack) {
    try {
      const marketstack = await fetchMarketstackBatch(symbols, marketstackKey);
      marketstack.forEach((q, symbol) => map.set(symbol, q));
      if (marketstack.size > 0) {
        writeMarketstackUsage({ month: monthKey, count: normalizedUsage.count + 1, lastCallAt: Date.now() });
      }
    } catch {
      // Continue with other providers.
    }
  }

  let missing = symbols.filter((s) => !map.has(s));

  if (alphaKey && missing.length > 0) {
    const alphaLimit = Math.max(0, opts?.alphaLimit ?? 4);
    const alphaTargets = missing.slice(0, alphaLimit);
    const alphaResults = await Promise.all(alphaTargets.map((symbol) => fetchAlphaQuote(symbol, alphaKey)));
    for (const row of alphaResults) {
      if (row) map.set(row.symbol, row);
    }
    missing = symbols.filter((s) => !map.has(s));
  }

  if (finnhubKey && missing.length > 0) {
    const finnhubLimit = Math.max(0, opts?.finnhubLimit ?? 20);
    const finnhubTargets = missing.slice(0, finnhubLimit);
    const finnhubResults = await Promise.all(finnhubTargets.map((symbol) => fetchFinnhubQuote(symbol, finnhubKey)));
    for (const row of finnhubResults) {
      if (row) map.set(row.symbol, row);
    }
    missing = symbols.filter((s) => !map.has(s));
  }

  if (missing.length > 0) {
    try {
      const yahoo = await fetchYahooQuotes(missing);
      yahoo.forEach((quote, symbol) => map.set(symbol, quote));
    } catch {
      // keep partial result
    }
  }
  return map;
}

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toFixed(2)}`;
}

export function StockWidget({ config, isLocked, onUpdateConfig }: Props) {
  const tracked = config.stocks ?? DEFAULT_STOCKS;
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const alphaCursorRef = useRef(0);

  const loadQuotes = useCallback(async (manual = false) => {
    if (tracked.length === 0) return;
    const hasAnyProvider = !!(ALPHA_VANTAGE_API_KEY || FINNHUB_API_KEY || MARKETSTACK_API_KEY);
    if (!hasAnyProvider) {
      setError("Missing API key (PUBLIC_ALPHA_VANTAGE_API_KEY / PUBLIC_FINNHUB_API_KEY / PUBLIC_MARKETSTACK_API_KEY)");
      return;
    }

    const now = Date.now();
    const staleSymbols = tracked
      .map((s) => s.symbol)
      .filter((symbol) => {
        const cached = quotes.get(symbol);
        return !cached || now - (cached.fetchedAt ?? 0) > QUOTE_FRESH_MS;
      });
    if (!manual && staleSymbols.length === 0) return;

    setLoading(true);
    setError(null);
    try {
      const rotate = alphaCursorRef.current % Math.max(1, staleSymbols.length || 1);
      const rotatedTargets = staleSymbols.length > 0 ? [...staleSymbols.slice(rotate), ...staleSymbols.slice(0, rotate)] : [];
      alphaCursorRef.current += 1;

      const result = await fetchAllQuotes(
        rotatedTargets,
        ALPHA_VANTAGE_API_KEY,
        FINNHUB_API_KEY,
        MARKETSTACK_API_KEY,
        { forceMarketstack: manual, alphaLimit: 4, finnhubLimit: 20 }
      );

      setQuotes((prev) => {
        const next = new Map<string, QuoteData>();
        for (const stock of tracked) {
          const fresh = result.get(stock.symbol);
          if (fresh) {
            next.set(stock.symbol, fresh);
            continue;
          }
          const cached = prev.get(stock.symbol);
          if (cached) next.set(stock.symbol, cached);
        }
        return next;
      });
      if (result.size === 0) setError("Could not load quotes");
      else if (result.size < rotatedTargets.length) setError("Some quotes unavailable");
    } catch {
      setError("Could not load quotes");
    } finally {
      setLoading(false);
    }
  }, [quotes, tracked]);

  useEffect(() => {
    void loadQuotes();
    const interval = window.setInterval(loadQuotes, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [loadQuotes, retryCount]);

  const searchResults = searchQuery.trim().length > 0
    ? COMMON_TICKERS.filter((t) => {
        const q = searchQuery.toUpperCase();
        return (
          !tracked.some((s) => s.symbol === t.symbol) &&
          (t.symbol.includes(q) || t.name.toUpperCase().includes(q))
        );
      }).slice(0, 6)
    : [];

  const addStock = useCallback(
    (entry: StockEntry) => {
      if (tracked.some((s) => s.symbol === entry.symbol)) return;
      onUpdateConfig({ stocks: [...tracked, entry] });
      setSearchQuery("");
      setSearchOpen(false);
    },
    [onUpdateConfig, tracked]
  );

  const addCustomTicker = useCallback(() => {
    const symbol = searchQuery.trim().toUpperCase();
    if (!symbol || tracked.some((s) => s.symbol === symbol)) return;
    onUpdateConfig({ stocks: [...tracked, { symbol, name: symbol }] });
    setSearchQuery("");
    setSearchOpen(false);
  }, [onUpdateConfig, searchQuery, tracked]);

  const removeStock = useCallback(
    (symbol: string) => {
      onUpdateConfig({ stocks: tracked.filter((s) => s.symbol !== symbol) });
    },
    [onUpdateConfig, tracked]
  );

  useEffect(() => {
    if (!searchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchOpen]);

  return (
    <WidgetShell
      config={config}
      title="Stocks"
      className="flex h-full flex-col overflow-hidden bg-[#111111]"
      controls={
        !isLocked ? (
          <div className="relative" ref={dropdownRef}>
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => searchQuery.length > 0 && setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (searchResults.length > 0) {
                    addStock(searchResults[0]);
                  } else if (searchQuery.trim()) {
                    addCustomTicker();
                  }
                }
              }}
              placeholder="Search ticker..."
              className="w-[110px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"
            />
            {searchOpen && searchQuery.trim().length > 0 ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-[220px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50">
                {searchResults.map((hit) => (
                  <button
                    key={hit.symbol}
                    onClick={() => addStock(hit)}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors"
                  >
                    <span className="font-semibold">{hit.symbol}</span>
                    <span className="text-[#666] ml-1.5">{hit.name}</span>
                  </button>
                ))}
                {searchResults.length === 0 ? (
                  <button
                    onClick={addCustomTicker}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors"
                  >
                    Add <span className="font-semibold">{searchQuery.trim().toUpperCase()}</span> as custom ticker
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null
      }
    >

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading && quotes.size === 0 ? (
          <p className="text-[12px] text-[#707070]">Loading quotes...</p>
        ) : error && quotes.size === 0 ? (
          <div>
            <p className="text-[12px] text-[#a06060]">{error}</p>
            {error.includes("PUBLIC_ALPHA_VANTAGE_API_KEY") ? (
              <p className="mt-1 text-[10px] text-[#7a7a7a]">Add it to `.env.local`, then restart app.</p>
            ) : null}
            <button
              onClick={() => {
                setRetryCount((v) => v + 1);
                void loadQuotes(true);
              }}
              disabled={loading}
              className={`mt-1 text-[11px] ${loading ? "text-[#666666] cursor-not-allowed" : "text-[#8a8a8a] hover:text-[#cfcfcf]"}`}
            >
              {loading ? "Retrying..." : "Retry"}
            </button>
          </div>
        ) : tracked.length === 0 ? (
          <p className="text-[12px] text-[#707070]">No stocks tracked.</p>
        ) : (
          tracked.map((stock) => {
            const q = quotes.get(stock.symbol);
            const isPositive = (q?.changePct ?? 0) >= 0;
            return (
              <div
                key={stock.symbol}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-[#252525] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-[#e8e8e8]">
                      {stock.symbol}
                    </span>
                    <span className="text-[10px] text-[#6a6a6a] truncate max-w-[80px]">
                      {q?.name ?? stock.name}
                    </span>
                  </div>
                  {q ? (
                    <p className="text-[13px] text-[#cfcfcf] mt-0.5">
                      {formatPrice(q.price)}
                    </p>
                  ) : loading ? (
                    <p className="text-[11px] text-[#555] mt-0.5">loading...</p>
                  ) : (
                    <p className="text-[11px] text-[#8a6262] mt-0.5">unavailable</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {q ? (
                    <span
                      className={`text-[11px] font-semibold ${
                        isPositive ? "text-[#4ade80]" : "text-[#f87171]"
                      }`}
                    >
                      {isPositive ? "+" : ""}
                      {q.changePct.toFixed(2)}%
                    </span>
                  ) : null}
                  {!isLocked ? (
                    <button
                      className="text-[11px] text-[#8c8c8c] hover:text-[#e9a4a4]"
                      onClick={() => removeStock(stock.symbol)}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </WidgetShell>
  );
}
