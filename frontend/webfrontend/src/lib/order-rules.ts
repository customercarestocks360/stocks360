/**
 * What the order ticket is allowed to submit, as pure arithmetic.
 *
 * This used to live inline in `order-ticket.tsx` and it was wrong in the one way that
 * matters: it compared an order's cash requirement against **a wallet named after the
 * instrument's quote currency**. The venue holds exactly one wallet per account, in
 * `TRADING_ACCOUNT_CURRENCY`, and converts every notional into it at placement — so that
 * lookup found nothing for `EUR-USD` (USD), `AAPL` (USD) or `RELIANCE.NS` (INR), and a
 * funded account was told to deposit a currency the venue will never hold. Only USDT-quoted
 * crypto could be traded at all.
 *
 * Two rules follow from that and are the whole point of this file:
 *
 * * **Cash is always checked in the account currency.** The notional is converted first, and
 *   where the rate is not knowable client-side the check is *skipped* rather than guessed —
 *   see `conversionRate`. A pre-check that cannot be right must not be the thing that blocks
 *   the order; the server's own 409 names the exact figures.
 * * **A sell is not automatically a sale.** Positions are signed. A sell against a long
 *   reserves units; a sell with nothing behind it opens a short, which reserves cash and is
 *   allowed on the classes in `TRADING_SHORT_SELLING_CLASSES`. The old rule refused every
 *   sell beyond the units held as "long-only spot", which the venue stopped being.
 *
 * The order of the checks mirrors `service.place_order` deliberately, including the subtle
 * bit: the short-selling gate is asked *before* the flip gate, so an equity oversell is
 * refused for the reason the caller can act on rather than for flipping through zero.
 *
 * Floats here against the server's `Decimal`: this decides whether to send a request, never
 * what anything costs. The server's fee rounds *up* at 8dp, so an order sitting exactly on
 * the funds boundary can still come back a 409 — which is the correct authority answering.
 */
import {
  TRADING_ACCOUNT_CURRENCY,
  TRADING_FEE_BPS,
  TRADING_LEVERAGE,
  TRADING_MAX_ORDER_NOTIONAL,
  TRADING_MIN_ORDER_NOTIONAL,
  TRADING_MIN_QUANTITY,
  TRADING_PEGGED_CURRENCIES,
  TRADING_SHORT_SELLING_CLASSES,
  type AssetClass,
  type OrderSide,
} from "@/lib/trading-api";

/** `null` when the rate is not knowable without a network call — never a guess. */
export function conversionRate(from: string | null, to = TRADING_ACCOUNT_CURRENCY): number | null {
  if (!from) return null;
  const a = from.trim().toUpperCase();
  const b = to.trim().toUpperCase();
  if (a === b) return 1;
  // Both halves have to be inside the peg, same as `fx._pegged`: USD is 1:1 with USDT
  // because both track the dollar, and neither would be if the account were in EUR.
  const pegged = TRADING_PEGGED_CURRENCIES as readonly string[];
  if (pegged.includes(a) && pegged.includes(b)) return 1;
  return null;
}

export function shortSellingAllowed(assetClass: AssetClass): boolean {
  return (TRADING_SHORT_SELLING_CLASSES as readonly string[]).includes(assetClass);
}

/**
 * Whether this order locks units rather than cash — exactly one case does, and it is the
 * same predicate as `service._reserves_units`: a sell against an existing long. A buy either
 * way, and a sell that opens or extends a short, all commit cash.
 */
export function reservesUnits(side: OrderSide, net: number): boolean {
  return side === "sell" && net > 0;
}

/** The cash an opening order actually locks: `notional / leverage + fee`, both in one currency. */
export function marginFor(notional: number): number {
  return notional / TRADING_LEVERAGE + (notional * TRADING_FEE_BPS) / 10_000;
}

export type TicketInput = {
  assetClass: AssetClass;
  side: OrderSide;
  /** Display name for the instrument's units, e.g. "BTC/USDT". */
  label: string;
  quantity: number;
  /** The instrument's quote currency. `null` before the first quote resolves. */
  quoteCurrency: string | null;
  /** The price the venue will reserve against — the limit, the stop, or the mark. */
  reservePrice: number | null;
  /** Signed net position: positive long, negative short, zero flat. */
  netQuantity: number;
  /** Unlocked units of a long. Meaningless for a short, which reserves cash instead. */
  freeQuantity: number;
  /** The one wallet currency, from `Portfolio.account_currency` where it has loaded. */
  accountCurrency: string;
  /** Free cash in `accountCurrency`. */
  freeMargin: number;
};

export type TicketCheck = {
  /** Non-empty blocks submission. */
  error: string;
  /** True only when the block is a cash shortfall, so "add funds" is the honest remedy. */
  needsFunds: boolean;
  /** What this order commits, decided the same way the server decides it. */
  reserves: "cash" | "units";
  /** Cash requirement, in `marginCurrency`. `null` when there is no price yet. */
  margin: number | null;
  /** Currency `margin` is expressed in — the account currency once converted, else the quote. */
  marginCurrency: string | null;
  /** False when the quote currency needs a rate this client does not have. */
  marginConverted: boolean;
};

function fmt(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const sign = (value: number): number => (value === 0 ? 0 : value > 0 ? 1 : -1);

export function checkTicket(input: TicketInput): TicketCheck {
  const {
    assetClass,
    side,
    label,
    quantity,
    quoteCurrency,
    reservePrice,
    netQuantity: net,
    freeQuantity,
    accountCurrency,
    freeMargin,
  } = input;

  const rate = conversionRate(quoteCurrency, accountCurrency);
  const notionalQuote = reservePrice === null ? null : quantity * reservePrice;
  const notional = notionalQuote === null || rate === null ? null : notionalQuote * rate;

  // Cash is only ever quoted in a currency we can name. Where the rate is unknown the figure
  // stays in the instrument's own currency and is labelled as such, rather than carrying an
  // account-currency label it has not earned.
  const margin =
    notional !== null
      ? marginFor(notional)
      : notionalQuote !== null
        ? marginFor(notionalQuote)
        : null;
  const base: TicketCheck = {
    error: "",
    needsFunds: false,
    reserves: reservesUnits(side, net) ? "units" : "cash",
    margin,
    marginCurrency: notional !== null ? accountCurrency : quoteCurrency,
    marginConverted: notional !== null,
  };

  const fail = (error: string, needsFunds = false): TicketCheck => ({ ...base, error, needsFunds });

  if (!Number.isFinite(quantity) || quantity <= 0) return fail("Enter a quantity.");
  if (quantity < TRADING_MIN_QUANTITY)
    return fail(`Minimum order size is ${TRADING_MIN_QUANTITY} ${label}.`);

  if (reservePrice === null)
    return fail("No price for this instrument yet — waiting for the feed.");

  // Notional bounds are the venue's, and the venue applies them to the *converted* figure.
  // Unconvertible quote currencies are left to the server for the same reason the funds
  // check is.
  if (notional !== null) {
    if (notional < TRADING_MIN_ORDER_NOTIONAL)
      return fail(
        `Order value ${fmt(notional)} ${accountCurrency} is below the ${TRADING_MIN_ORDER_NOTIONAL} minimum.`,
      );
    if (notional > TRADING_MAX_ORDER_NOTIONAL)
      return fail(
        `Order value ${fmt(notional)} ${accountCurrency} is over the ${fmt(TRADING_MAX_ORDER_NOTIONAL)} per-order limit.`,
      );
  }

  // ── Short selling, then the flip. This order matters — see the file docstring. ─────────
  if (side === "sell" && quantity > Math.max(net, 0) && !shortSellingAllowed(assetClass)) {
    const held = net > 0 ? `you hold ${net}` : "you hold none";
    return fail(
      `Selling ${label} needs units you already own and ${held}. Short selling is not available on ${assetClass === "stocks" ? "equities" : assetClass}.`,
    );
  }

  const sideSign = side === "buy" ? 1 : -1;
  if (sign(net) !== 0 && sign(net) !== sideSign && quantity > Math.abs(net)) {
    return fail(
      `You are ${net > 0 ? "long" : "short"} ${Math.abs(net)} and this order is for ${quantity}, which would flip the position through zero. Close the ${Math.abs(net)} you hold first, then open the other side.`,
    );
  }

  // ── What it actually commits ───────────────────────────────────────────────────────────
  if (base.reserves === "units") {
    if (quantity > freeQuantity)
      return fail(
        `You hold ${freeQuantity} ${label} free to sell. Cancel a resting sell to release more.`,
      );
    return base;
  }

  // Unknown rate: the server's check is the only correct one, so let the request through.
  if (margin === null || !base.marginConverted) return base;
  if (margin > freeMargin)
    return fail(
      `This order needs ${fmt(margin)} ${accountCurrency} margin (1:${TRADING_LEVERAGE}) and you have ${fmt(freeMargin)} available.`,
      true,
    );

  return base;
}
