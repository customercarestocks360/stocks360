/**
 * Self-check for the ticket rules in `order-rules.ts`.
 *
 *     node src/lib/order-rules.check.ts
 *
 * Plain `node:assert` and Node's own type stripping, same as `chart-window.check.ts` — there
 * is no test runner in this project and this file is not worth adding one for.
 *
 * The first block is the regression that motivated the file: an account funded with 1000 USDT
 * could not place a single non-USDT order, because the funds check looked up a wallet named
 * after the instrument's quote currency and the venue only ever holds one.
 */
import assert from "node:assert/strict";
import { checkTicket, conversionRate, marginFor, reservesUnits } from "./order-rules.ts";
import type { TicketInput } from "./order-rules.ts";

/** A funded account, flat, buying — the default case every assertion varies from. */
const ticket = (over: Partial<TicketInput> = {}): TicketInput => ({
  assetClass: "crypto",
  side: "buy",
  label: "BTC/USDT",
  quantity: 1,
  quoteCurrency: "USDT",
  reservePrice: 60_000,
  netQuantity: 0,
  freeQuantity: 0,
  accountCurrency: "USDT",
  freeMargin: 1000,
  ...over,
});

// ── The regression: one wallet funds every market ─────────────────────────────────────────
// 1000 USDT, and each of these is a market the old check declared unfunded because the
// venue holds no wallet called USD or INR.
assert.equal(
  checkTicket(ticket({ assetClass: "forex", label: "EUR/USD", quoteCurrency: "USD", reservePrice: 1.08 })).error,
  "",
  "an FX pair quoted in USD is funded by the USDT wallet",
);
assert.equal(
  checkTicket(ticket({ assetClass: "stocks", label: "AAPL", quoteCurrency: "USD", reservePrice: 230 })).error,
  "",
  "a US equity is funded by the USDT wallet",
);
assert.equal(
  checkTicket(ticket({ assetClass: "stocks", label: "RELIANCE", quoteCurrency: "INR", reservePrice: 3100 })).error,
  "",
  "an INR equity needs a rate this client lacks — the server decides, the ticket does not block",
);
// And the reason it must not block: the figure it would have compared is not in USDT.
const inr = checkTicket(ticket({ assetClass: "stocks", quoteCurrency: "INR", reservePrice: 3100 }));
assert.equal(inr.marginConverted, false);
assert.equal(inr.marginCurrency, "INR", "an unconverted figure keeps the instrument's own label");

// ── conversionRate: 1:1 inside the peg, unknown outside it, never a guess ──────────────────
assert.equal(conversionRate("USDT"), 1);
assert.equal(conversionRate("usdt"), 1, "case and whitespace are the caller's, not a difference");
assert.equal(conversionRate("USD"), 1, "USD and USDT both track the dollar");
assert.equal(conversionRate("USDC"), 1);
assert.equal(conversionRate("INR"), null);
assert.equal(conversionRate("JPY"), null);
assert.equal(conversionRate(null), null);
// The peg needs both halves: a EUR account is not 1:1 with anything in the set.
assert.equal(conversionRate("USD", "EUR"), null);
assert.equal(conversionRate("EUR", "EUR"), 1);

// ── Margin is leveraged, and carries its fee ──────────────────────────────────────────────
// 60000 notional at 1:200 is 300 of margin, plus 10 bps = 60 of fee.
assert.equal(marginFor(60_000), 360);
assert.ok(
  checkTicket(ticket({ freeMargin: 360 })).error === "",
  "exactly enough for margin plus fee is enough",
);
assert.ok(
  checkTicket(ticket({ freeMargin: 359 })).error !== "",
  "margin alone is not enough — the fee is reserved too",
);
assert.equal(checkTicket(ticket({ freeMargin: 359 })).needsFunds, true, "a shortfall is a funds problem");
// Anything that is not a shortfall must not offer "add funds" as the remedy.
assert.equal(checkTicket(ticket({ quantity: 0.01 })).needsFunds, false);

// ── What an order commits: cash, or units of a long ───────────────────────────────────────
assert.equal(reservesUnits("sell", 5), true, "a sell against a long reserves the units");
assert.equal(reservesUnits("sell", 0), false, "a sell with nothing behind it reserves cash");
assert.equal(reservesUnits("sell", -5), false, "extending a short reserves cash");
assert.equal(reservesUnits("buy", 5), false);
assert.equal(reservesUnits("buy", -5), false, "a buy closing a short still posts cash");
assert.equal(checkTicket(ticket({ side: "sell", netQuantity: 5, freeQuantity: 5, quantity: 2 })).reserves, "units");
assert.equal(checkTicket(ticket({ side: "buy", netQuantity: -5, quantity: 2 })).reserves, "cash");

// ── Selling: a short is a real order, not an oversell ─────────────────────────────────────
// Shortable classes: flat, sell — allowed, and it is the cash check that applies.
assert.equal(checkTicket(ticket({ side: "sell", quantity: 1 })).error, "", "crypto shorts are allowed");
assert.equal(
  checkTicket(ticket({ assetClass: "forex", label: "EUR/USD", quoteCurrency: "USD", reservePrice: 1.08, side: "sell" })).error,
  "",
  "FX shorts are allowed",
);
assert.equal(
  checkTicket(ticket({ side: "sell", quantity: 1, freeMargin: 1 })).needsFunds,
  true,
  "an unfunded short is refused for the funds, not for the direction",
);
// Equities are not shortable, and the refusal has to say why.
const equitySell = checkTicket(
  ticket({ assetClass: "stocks", label: "AAPL", quoteCurrency: "USD", reservePrice: 230, side: "sell" }),
);
assert.match(equitySell.error, /Short selling is not available on equities/);
assert.equal(equitySell.needsFunds, false, "a borrow this venue cannot arrange is not a funds problem");
// An equity oversell is refused as a short, not as a flip — the advice has to be actionable.
assert.match(
  checkTicket(ticket({ assetClass: "stocks", label: "AAPL", quoteCurrency: "USD", reservePrice: 230, side: "sell", quantity: 10, netQuantity: 5, freeQuantity: 5 })).error,
  /Short selling is not available/,
);

// ── Reserved units: the binding limit is what is unlocked, not what is held ───────────────
assert.equal(checkTicket(ticket({ side: "sell", quantity: 3, netQuantity: 5, freeQuantity: 5 })).error, "");
assert.match(
  checkTicket(ticket({ side: "sell", quantity: 3, netQuantity: 5, freeQuantity: 1 })).error,
  /1 BTC\/USDT free to sell/,
  "two units locked by a resting sell cannot be sold again",
);

// ── The flip gate, both directions ────────────────────────────────────────────────────────
assert.equal(checkTicket(ticket({ side: "sell", quantity: 5, netQuantity: 5, freeQuantity: 5 })).error, "", "selling exactly the long is a close, not a flip");
assert.match(
  checkTicket(ticket({ side: "sell", quantity: 10, netQuantity: 5, freeQuantity: 5 })).error,
  /flip the position through zero/,
);
assert.equal(checkTicket(ticket({ side: "buy", quantity: 5, netQuantity: -5 })).error, "", "buying exactly the short closes it");
assert.match(
  checkTicket(ticket({ side: "buy", quantity: 10, netQuantity: -5 })).error,
  /flip the position through zero/,
);
assert.equal(checkTicket(ticket({ side: "buy", quantity: 10, netQuantity: 5 })).error, "", "adding to a long is not a flip");
assert.equal(checkTicket(ticket({ side: "sell", quantity: 10, netQuantity: -5 })).error, "", "adding to a short is not a flip");

// ── Bounds and missing inputs ─────────────────────────────────────────────────────────────
assert.match(checkTicket(ticket({ quantity: 0.05 })).error, /Minimum order size is 0\.1/);
assert.match(checkTicket(ticket({ quantity: 0 })).error, /Enter a quantity/);
assert.match(checkTicket(ticket({ quantity: Number.NaN })).error, /Enter a quantity/);
assert.match(checkTicket(ticket({ reservePrice: null })).error, /No price for this instrument yet/);
// 0.1 units at 5 is 0.5 — under the 1-unit notional floor even though the quantity clears.
assert.match(checkTicket(ticket({ quantity: 0.1, reservePrice: 5 })).error, /below the 1 minimum/);
assert.match(checkTicket(ticket({ quantity: 1, reservePrice: 2_000_000, freeMargin: 1e9 })).error, /per-order limit/);

console.log("order-rules: all checks passed");
