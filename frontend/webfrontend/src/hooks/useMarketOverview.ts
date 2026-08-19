import { useSyncExternalStore } from "react";
import {
  EMPTY_OVERVIEW_STATE,
  getMarketOverviewSnapshot,
  subscribeToMarketOverview,
  type OverviewState,
} from "@/lib/market-overview";

/** Empty until the client subscribes — these routes are server-rendered, and the socket is browser-only. */
const SERVER_SNAPSHOT: OverviewState = EMPTY_OVERVIEW_STATE;

/** Live headline prices from `WS /market/overview/stream`, shared across every caller on the page. */
export function useMarketOverview(): OverviewState {
  return useSyncExternalStore(
    subscribeToMarketOverview,
    getMarketOverviewSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
