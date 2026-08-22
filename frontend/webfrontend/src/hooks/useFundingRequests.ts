/**
 * The signed-in user's own deposit/withdrawal history from `GET /funding/requests` —
 * shared by `/wallet`, `/deposit` and `/withdraw` so each does not poll its own copy.
 *
 * Polled rather than pushed, like the rest of `/trading/*`: there is no socket for a
 * review decision landing, so `refresh()` is exposed for callers that just placed a
 * request and want the list to reflect it immediately instead of waiting for the next
 * tick.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ApiError } from "@/lib/api";
import { currentIdToken } from "@/lib/firebase";
import {
  cancelFundingRequest,
  listFundingRequests,
  type FundingKind,
  type FundingRequest,
} from "@/lib/funding-api";

const POLL_INTERVAL_MS = 15_000;

export function useFundingRequests(kind?: FundingKind) {
  const { isLoggedIn, authReady } = useAuth();
  const [requests, setRequests] = useState<FundingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const token = await currentIdToken();
      return listFundingRequests(token, { ...(kind ? { kind } : {}), limit: 100 }, signal);
    },
    [kind],
  );

  const refresh = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const result = await load();
      if (aliveRef.current) {
        setRequests(result);
        setError("");
      }
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err instanceof ApiError ? err.message : "Could not load your funding requests.");
    }
  }, [isLoggedIn, load]);

  const cancelRequest = useCallback(
    async (requestId: string) => {
      if (!isLoggedIn || cancellingId) return false;
      setCancellingId(requestId);
      try {
        const token = await currentIdToken();
        await cancelFundingRequest(requestId, token);
        await refresh();
        return true;
      } catch (err) {
        if (aliveRef.current) {
          setError(err instanceof ApiError ? err.message : "Could not cancel the funding request.");
        }
        return false;
      } finally {
        if (aliveRef.current) setCancellingId(null);
      }
    },
    [cancellingId, isLoggedIn, refresh],
  );

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn) {
      setRequests([]);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async (first: boolean) => {
      if (first) setLoading(true);
      try {
        const result = await load(controller.signal);
        if (!cancelled) {
          setRequests(result);
          setError("");
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof ApiError ? err.message : "Could not load your funding requests.");
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    };

    void run(true);
    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        void run(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [authReady, isLoggedIn, load]);

  return { requests, loading, error, cancellingId, cancelRequest, refresh };
}
