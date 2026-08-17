/// <reference types="vite/client" />

/**
 * Declared explicitly rather than read off `ImportMetaEnv`'s index signature, because
 * `noPropertyAccessFromIndexSignature` rejects dotted access to an unlisted key — and a
 * typo in a bracket-access string would silently fall back to the default instead.
 */
interface ImportMetaEnv {
  /** Origin of the Stocks360 FastAPI backend, e.g. `http://127.0.0.1:8000`. No trailing slash. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
