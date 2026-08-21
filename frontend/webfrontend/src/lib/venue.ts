/**
 * The venue's own rules, mirrored from `backend/app/core/config.py`.
 *
 * These are fixed deployment-wide settings, not per-order choices and not values any
 * endpoint returns, so plain constants are the honest representation. The server is still
 * the authority on every one of them — these exist so the ticket can catch the commonest
 * rejection before a request goes out, and so `order-rules.ts` can be checked without a
 * network or a bundler.
 *
 * **Leaf module by design: it imports nothing.** `trading-api.ts` re-exports all of it for
 * compatibility, but the constants live here so `order-rules.check.ts` can run under plain
 * `node` — importing them from `trading-api.ts` would drag in `apiFetch` and the whole
 * `@/`-aliased module graph, which only a bundler can resolve.
 *
 * Keep the values in step with the backend. A drift here does not corrupt anything — the
 * server re-checks all of it — but it does mean the ticket blocks an order the venue would
 * have taken, or takes one it will refuse.
 */

/**
 * **The one currency an account holds.** Every asset class settles into it: an instrument
 * priced in USD or INR has its notional converted at placement (`app/trading/fx.py`) rather
 * than getting a wallet of its own.
 *
 * This is the constant the trading UI got wrong. Checking an order's cost against a wallet
 * named after the *instrument's* quote currency always finds nothing, because no such wallet
 * exists — which is how a funded account came to be told it had no funds for every market
 * except USDT-quoted crypto.
 *
 * `Portfolio.account_currency` is the server's own answer and wins wherever it is loaded;
 * this is what to fall back on before the first read lands.
 */
export const TRADING_ACCOUNT_CURRENCY = "USDT";

/**
 * Venue-wide leverage. A position only has to post `notional / TRADING_LEVERAGE` in cash,
 * which is why the ticket's funds check is against margin and not against the notional.
 */
export const TRADING_LEVERAGE = 200;

/** Commission in basis points of notional. The server rounds it **up**. */
export const TRADING_FEE_BPS = 10;

/** The smallest order the venue accepts, in the instrument's own units. */
export const TRADING_MIN_QUANTITY = 0.1;

/** Notional bounds per order, applied to the figure *after* conversion to account currency. */
export const TRADING_MIN_ORDER_NOTIONAL = 1;
export const TRADING_MAX_ORDER_NOTIONAL = 1_000_000;

/**
 * Currencies the venue converts 1:1 against each other, because they all track the dollar
 * and it has no licensed source for the deviation. **Both** halves of a pair have to be in
 * the set for the peg to hold — see `fx._pegged`: USD is 1:1 with USDT, and neither would be
 * if the account currency were EUR.
 */
export const TRADING_PEGGED_CURRENCIES = ["USDT", "USDC", "USD"] as const;

/**
 * Asset classes where a sell with nothing behind it opens a short instead of being refused.
 * Equities are excluded: shorting a listed share is a stock loan needing a borrow, a locate
 * and a recall process this venue has none of.
 */
export const TRADING_SHORT_SELLING_CLASSES = ["crypto", "forex"] as const;
