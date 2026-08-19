/**
 * Every environment-driven value this app reads, resolved in one place.
 *
 * **Nothing here is secret, and nothing secret may be added.** Vite replaces
 * `import.meta.env.VITE_*` with literal strings at build time, so each of these ends up
 * verbatim inside the JavaScript served to every visitor. Anything you would not paste
 * into a public GitHub issue does not belong in a `VITE_` variable.
 *
 * That is why the config surface is this small. The two things that would normally live in
 * a frontend `.env` are deliberately elsewhere:
 *
 * - **Firebase Web SDK config** is fetched at runtime from `GET /auth/config`, so it tracks
 *   whatever project the backend is actually wired to instead of drifting in a second copy.
 * - **The Firebase service account** never leaves the backend. It is the one real secret in
 *   this system and it has no frontend representation at all.
 *
 * So the only thing this app needs told is where its backend is.
 */

/**
 * Used only in dev builds. 127.0.0.1 rather than localhost because on Windows `localhost`
 * can resolve to ::1 while uvicorn is bound to 127.0.0.1, which surfaces as an opaque
 * network error rather than a connection refused.
 */
const DEV_API_BASE_URL = "http://127.0.0.1:8000";

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  // Trailing slashes stripped so `${API_BASE_URL}/auth/me` cannot become `//auth/me`.
  if (configured) return configured.replace(/\/+$/, "");

  if (import.meta.env.PROD) {
    // `vite.config.ts` fails the production build when this is unset, so getting here means
    // that guard was bypassed. Failing loudly beats shipping a build that quietly points
    // every user's browser at a laptop on 127.0.0.1.
    throw new Error(
      "VITE_API_BASE_URL is not set. Add it to the hosting provider's environment variables and redeploy.",
    );
  }
  return DEV_API_BASE_URL;
}

/** Origin of the Stocks360 FastAPI backend, without a trailing slash. */
export const API_BASE_URL = resolveApiBaseUrl();

/** The same backend, as a WebSocket origin — http(s) and ws(s) share a host and a port. */
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, "ws");
