/**
 * Instrument search across the three feeds, normalised to one hit shape.
 *
 * Each market answers a different question with a different route: equities are *searched*
 * (`GET /stocks/instruments`) because the universe spans every exchange and is far too large
 * to cache, while crypto and forex publish a full list the backend already caches and filters
 * (`GET /crypto/symbols`, `GET /forex/pairs`). All three are authenticated.
 *
 * Shared by the trading desk and the markets table so a symbol found on one is spelled the
 * same on the other — the `symbol` here is always feed-native (`BTCUSDT`, `EUR-USD`,
 * `RELIANCE.NS`), which is what every quote, candle and order endpoint validates against.
 */
import {
  searchCryptoSymbols,
  searchInstruments,
  searchPairs,
  type Instrument,
} from "@/lib/markets-api";
import type { AssetClass } from "@/lib/trading-api";

export type SearchHit = {
  /** Feed-native symbol, ready to pass to any endpoint. */
  symbol: string;
  name: string;
  /** Exchange / type / currency, whatever that feed publishes. Display only. */
  detail: string;
  assetClass: AssetClass;
};

export async function searchUniverse(
  assetClass: AssetClass,
  query: string,
  token: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  if (assetClass === "stocks") {
    const hits: Instrument[] = await searchInstruments(query, token, limit, signal);
    return hits.map((h) => ({
      symbol: h.symbol,
      name: h.name ?? h.symbol,
      detail: [h.full_exchange ?? h.exchange, h.type, h.currency].filter(Boolean).join(" · "),
      assetClass,
    }));
  }
  if (assetClass === "forex") {
    const hits = await searchPairs(query, token, limit, signal);
    return hits.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      detail: `${h.base} / ${h.quote}`,
      assetClass,
    }));
  }
  const hits = await searchCryptoSymbols(query, token, limit, signal);
  return hits.map((h) => ({
    symbol: h.symbol,
    name: `${h.base_asset}/${h.quote_asset}`,
    detail: h.quote_asset,
    assetClass,
  }));
}

/**
 * Searches all three feeds at once, for a view that is not scoped to one market.
 *
 * A market whose search fails is skipped rather than failing the whole thing — the three are
 * independent upstreams, and one provider being down should not hide the other two's results.
 */
export async function searchAllMarkets(
  query: string,
  token: string,
  perMarket = 5,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const settled = await Promise.allSettled([
    searchUniverse("crypto", query, token, perMarket, signal),
    searchUniverse("forex", query, token, perMarket, signal),
    searchUniverse("stocks", query, token, perMarket, signal),
  ]);
  return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
