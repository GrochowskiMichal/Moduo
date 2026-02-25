import { useCallback, useEffect, useRef, useState } from "react";
import type { CryptoEntry, WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

type PriceData = {
  id: string;
  price: number;
  change24h: number;
};

type SearchResult = {
  id: string;
  symbol: string;
  name: string;
};

const DEFAULT_COINS: CryptoEntry[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin" },
  { id: "ethereum", symbol: "ETH", name: "Ethereum" },
];

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function CryptoWidget({ config, isLocked, onUpdateConfig }: Props) {
  const tracked = config.cryptos ?? DEFAULT_COINS;
  const [prices, setPrices] = useState<Map<string, PriceData>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchPrices = useCallback(async () => {
    if (tracked.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const ids = tracked.map((c) => c.id).join(",");
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const next = new Map<string, PriceData>();
      for (const coin of tracked) {
        const entry = data[coin.id];
        if (entry) {
          next.set(coin.id, {
            id: coin.id,
            price: entry.usd ?? 0,
            change24h: entry.usd_24h_change ?? 0,
          });
        }
      }
      setPrices(next);
    } catch {
      setError("Could not load prices");
    } finally {
      setLoading(false);
    }
  }, [tracked]);

  useEffect(() => {
    void fetchPrices();
    const interval = window.setInterval(fetchPrices, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [fetchPrices]);

  const searchCoins = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const results: SearchResult[] = (data.coins ?? []).slice(0, 8).map((c: any) => ({
        id: c.id,
        symbol: c.symbol?.toUpperCase() ?? "",
        name: c.name ?? "",
      }));
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setSearchOpen(true);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        void searchCoins(value);
      }, 350);
    },
    [searchCoins]
  );

  const addCoin = useCallback(
    (result: SearchResult) => {
      if (tracked.some((c) => c.id === result.id)) return;
      const entry: CryptoEntry = { id: result.id, symbol: result.symbol, name: result.name };
      onUpdateConfig({ cryptos: [...tracked, entry] });
      setSearchQuery("");
      setSearchResults([]);
      setSearchOpen(false);
    },
    [onUpdateConfig, tracked]
  );

  const removeCoin = useCallback(
    (coinId: string) => {
      onUpdateConfig({ cryptos: tracked.filter((c) => c.id !== coinId) });
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
      title="Crypto"
      controls={
        !isLocked ? (
          <div className="relative" ref={dropdownRef}>
            <input
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setSearchOpen(true)}
              placeholder="Search coin..."
              className="w-[110px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"
            />
            {searchOpen && searchResults.length > 0 ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-[200px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50">
                {searchResults.map((result) => {
                  const alreadyTracked = tracked.some((c) => c.id === result.id);
                  return (
                    <button
                      key={result.id}
                      onClick={() => !alreadyTracked && addCoin(result)}
                      disabled={alreadyTracked}
                      className={`w-full px-3 py-1.5 text-left text-[11px] transition-colors ${
                        alreadyTracked
                          ? "text-[#555] cursor-default"
                          : "text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0]"
                      }`}
                    >
                      <span className="font-semibold">{result.symbol}</span>
                      <span className="text-[#666] ml-1.5">{result.name}</span>
                      {alreadyTracked ? <span className="text-[#444] ml-1">added</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null
      }
    >

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && prices.size === 0 ? (
          <p className="text-[12px] text-[#707070]">Loading prices...</p>
        ) : error && prices.size === 0 ? (
          <div>
            <p className="text-[12px] text-[#a06060]">{error}</p>
            <button
              onClick={() => void fetchPrices()}
              className="mt-1 text-[11px] text-[#8a8a8a] hover:text-[#cfcfcf]"
            >
              Retry
            </button>
          </div>
        ) : tracked.length === 0 ? (
          <p className="text-[12px] text-[#707070]">No coins tracked.</p>
        ) : (
          tracked.map((coin) => {
            const data = prices.get(coin.id);
            const change = data?.change24h ?? 0;
            const isPositive = change >= 0;
            return (
              <div
                key={coin.id}
                className="mb-1.5 flex items-center justify-between rounded-lg border border-[#252525] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-[#e8e8e8]">
                      {coin.symbol}
                    </span>
                    <span className="text-[10px] text-[#6a6a6a]">{coin.name}</span>
                  </div>
                  {data ? (
                    <p className="text-[13px] text-[#cfcfcf] mt-0.5">
                      {formatPrice(data.price)}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[#555]">--</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {data ? (
                    <span
                      className={`text-[11px] font-semibold ${
                        isPositive ? "text-[#4ade80]" : "text-[#f87171]"
                      }`}
                    >
                      {isPositive ? "+" : ""}
                      {change.toFixed(2)}%
                    </span>
                  ) : null}
                  {!isLocked ? (
                    <button
                      className="text-[11px] text-[#8c8c8c] hover:text-[#e9a4a4]"
                      onClick={() => removeCoin(coin.id)}
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
