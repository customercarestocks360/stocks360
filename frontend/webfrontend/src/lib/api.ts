/**
 * The one place that knows where the backend lives, how to call it, and what its failures
 * look like.
 *
 * The API is bearer-token authenticated and never reads a cookie, so every request sets
 * `credentials: "omit"`. An ambient cookie riding along on a cross-origin call is the
 * exact shape CSRF needs, and omitting it costs nothing here.
 */

import { API_BASE_URL } from "@/lib/config";

export { API_BASE_URL };

/**
 * Long enough for a cold Firebase + Atlas round-trip (the backend pays ~400ms to Google on
 * a revocation-cache miss), short enough that an unreachable backend releases the submit
 * button instead of spinning forever.
 */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `status: 0` means the request never got an HTTP answer at all — backend down, DNS, or a
 * CORS rejection, which the browser reports as an indistinguishable opaque `TypeError`.
 * Worth its own status so callers can say "cannot reach the API" instead of "failed".
 */
export const NETWORK_ERROR_STATUS = 0;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  /** Firebase ID token, sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Caller-owned cancellation, composed with the internal timeout. */
  signal?: AbortSignal;
};

/**
 * Shown when the response carries no usable `detail`. Deliberately generic: the backend
 * decides how much to say, and these are the "something went wrong at this layer" cases.
 */
const FALLBACK_MESSAGES: Record<number, string> = {
  400: "The request was rejected. Please check the details and try again.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have access to that.",
  404: "Not found.",
  409: "That conflicts with something that already exists.",
  422: "Some of those details are invalid.",
  429: "Too many attempts. Please wait a moment and try again.",
  500: "Something went wrong on our end. Please try again.",
  503: "The service is temporarily unavailable. Please try again shortly.",
};

/**
 * FastAPI answers `{"detail": "…"}` for a handled error but `{"detail": [{loc, msg, …}]}`
 * for a 422, so `detail` is not always a string — rendering it straight into JSX would
 * throw "Objects are not valid as a React child". Every error message funnels through
 * here so it comes out as one displayable line.
 */
function messageFrom(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== "object") return fallback;

  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item && typeof item === "object" ? (item as { msg?: unknown }).msg : null))
      .filter((msg): msg is string => typeof msg === "string" && msg.trim().length > 0);
    if (messages.length > 0) return messages.join(" · ");
  }
  return fallback;
}

/** Tolerates a non-JSON body (a proxy's HTML error page, an empty 204) without throwing. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: "omit",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    // A deliberate cancellation is not a failure to report — let it propagate as-is.
    if (signal?.aborted) throw error;
    throw new ApiError(
      NETWORK_ERROR_STATUS,
      `Could not reach the Stocks360 API at ${API_BASE_URL}. Check that the backend is running and that this origin is listed in CORS_ALLOW_ORIGINS.`,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }

  if (response.status === 204) return undefined as T;

  const payload = await readBody(response);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(
        payload,
        FALLBACK_MESSAGES[response.status] ?? `Request failed (${response.status}).`,
      ),
    );
  }
  return payload as T;
}
