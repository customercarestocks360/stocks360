"""Funding requests: money in and money out, with a human in the loop.

`POST /trading/deposits` moves book money the instant it is called. That is the right
shape for exercising the venue and the wrong shape for a real rail: nobody has confirmed
that a USDT transfer actually landed, or that an INR payout was actually sent. This is the
reviewed path. A request is *recorded* first; a balance moves only when an admin resolves
it, and the two sides are deliberately asymmetric:

* A **deposit** locks nothing. The money is not here yet — that is the whole thing being
  verified — so nothing is credited until it is confirmed.
* A **withdrawal** locks the cash immediately, into the same `reserved` bucket an open buy
  order uses. It still shows in the balance and cannot be spent or withdrawn twice, which
  is the only honest way to hold a payout that has been promised but not sent.

Three states, and no more, because those are the three a user can act on: `pending` is
waiting on review, `completed` is settled, `cancelled` covers both the user withdrawing
their own request and an admin declining it. Which of the two happened is recorded in
`resolved_by` and `resolution_note` rather than in a fourth status that nothing would
render any differently.
"""

from datetime import datetime
from enum import Enum
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from app.schemas.common import ErrorResponse
from app.schemas.trading import Amount, IdempotencyKey, Money, SettlementCurrency, Settles

# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #


class FundingKind(str, Enum):
    deposit = "deposit"
    withdrawal = "withdrawal"


class FundingStatus(str, Enum):
    pending = "pending"
    completed = "completed"
    cancelled = "cancelled"


class FundingNetwork(str, Enum):
    """The settlement rails this venue accepts, bank and chain.

    Closed rather than free text, because the network is the one field a reviewer checks a
    transfer against. "BEP-20", "bep20" and "BSC" all naming the same chain is how a
    verification queue turns into guesswork, and a payout sent on the wrong rail is gone.
    """

    # Bank rails
    UPI = "UPI"
    IMPS = "IMPS"
    NEFT = "NEFT"
    RTGS = "RTGS"
    SEPA = "SEPA"
    SWIFT = "SWIFT"
    # Chains
    TRC20 = "TRC20"
    BEP20 = "BEP20"
    ERC20 = "ERC20"
    SOL = "SOL"
    POLYGON = "POLYGON"
    ARBITRUM = "ARBITRUM"


_CHAINS = frozenset(
    {
        FundingNetwork.TRC20,
        FundingNetwork.BEP20,
        FundingNetwork.ERC20,
        FundingNetwork.SOL,
        FundingNetwork.POLYGON,
        FundingNetwork.ARBITRUM,
    }
)
_INDIA = frozenset(
    {FundingNetwork.UPI, FundingNetwork.IMPS, FundingNetwork.NEFT, FundingNetwork.RTGS}
)
_WIRE = frozenset({FundingNetwork.SWIFT})


def _rails_for(currency: str) -> frozenset[FundingNetwork]:
    """Which rails can actually carry this currency.

    A stablecoin moves on a chain and a fiat balance moves through a bank, and the two
    sets do not overlap. Refusing `INR` on `TRC20` up front is worth more than it looks:
    it is a `422` the client can show next to the field, instead of a request that sits in
    the review queue until someone reads it closely enough to notice.
    """
    if currency in ("USDT", "USDC"):
        return _CHAINS
    if currency == "INR":
        return _INDIA | _WIRE
    if currency == "EUR":
        return _WIRE | {FundingNetwork.SEPA}
    return _WIRE


NETWORKS_FOR: dict[str, frozenset[FundingNetwork]] = {
    c.value: _rails_for(c.value) for c in SettlementCurrency
}


# --------------------------------------------------------------------------- #
# Constrained types
# --------------------------------------------------------------------------- #


def _upper(value: Any) -> Any:
    return value.strip().upper() if isinstance(value, str) else value


# Normalise before the enum is matched, the same courtesy `currency` gets.
NetworkCode = Annotated[FundingNetwork, BeforeValidator(_upper)]

# A UPI id, an IBAN, an account number or a wallet address. Deliberately one bounded
# string rather than a per-rail shape: this venue does not send the payout, it records
# where the user says to send it, and inventing a validator per chain would reject valid
# addresses on formats it has not heard of yet.
Destination = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=4, max_length=128),
    Field(examples=["0x8cfa8b2fff6d4cec11dd6b53b68793fb4f81ffe3"]),
]

Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]


class _Strict(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


# --------------------------------------------------------------------------- #
# Requests
# --------------------------------------------------------------------------- #


class _FundingBase(_Strict):
    currency: Settles
    amount: Money
    network: NetworkCode
    idempotency_key: IdempotencyKey
    reference: str | None = Field(
        default=None,
        max_length=128,
        description="The transaction id, UTR or hash a reviewer can check this against",
    )

    def _assert_rail_carries_currency(self) -> None:
        allowed = NETWORKS_FOR.get(self.currency.value, frozenset())
        if self.network not in allowed:
            raise ValueError(
                f"{self.network.value} does not carry {self.currency.value}. "
                f"Accepted: {', '.join(sorted(n.value for n in allowed))}"
            )

    def model_post_init(self, _context: Any) -> None:
        self._assert_rail_carries_currency()


class DepositRequest(_FundingBase):
    """A claim that money was sent to the venue. It credits nothing on its own."""


class WithdrawalRequest(_FundingBase):
    """A request to send money out. Placing it locks the amount immediately."""

    destination: Destination = Field(description="Where to send it — your own account or wallet")


class ReviewDecision(_Strict):
    """What a reviewer records alongside approving or declining a request."""

    note: Note | None = Field(
        default=None, description="Shown to the user — say why, especially when declining"
    )


# --------------------------------------------------------------------------- #
# Responses
# --------------------------------------------------------------------------- #


class FundingRequest(BaseModel):
    id: str
    uid: str
    email: str | None = Field(
        default=None,
        description="Denormalised at creation so a review queue spanning users needs no "
        "second lookup per row",
    )
    kind: FundingKind
    status: FundingStatus
    currency: str
    amount: Amount
    network: FundingNetwork
    destination: str | None = Field(default=None, description="Withdrawals only")
    reference: str | None = None
    funded: bool = Field(
        description="Withdrawals only: whether the amount is actually locked. False means "
        "the lock never completed and the request cannot be approved — cancel it."
    )
    resolution_note: str | None = None
    resolved_by: str | None = Field(
        default=None, description="`user` for a self-cancellation, otherwise the reviewer's uid"
    )
    resolved_at: datetime | None = None
    ledger_entry_id: str | None = Field(
        default=None, description="The balance movement this produced, once completed"
    )
    created_at: datetime
    updated_at: datetime


class CurrencyTotal(BaseModel):
    currency: str
    available: Amount
    reserved: Amount
    total: Amount
    wallets: int = Field(description="Accounts holding this currency")


class FundingSummary(BaseModel):
    """The review queue at a glance.

    Totals are per currency and there is no grand total, for the same reason the portfolio
    has none: adding INR to USDT needs an FX rate this API has no licensed source for, and
    a made-up total on an operations dashboard is worse than no total at all.
    """

    pending_deposits: int
    pending_withdrawals: int
    balances: list[CurrencyTotal]
    at: datetime


# Reusable OpenAPI blocks for this feature's failure modes.
NOT_ADMIN = {
    403: {
        "model": ErrorResponse,
        "description": "The caller is not on the admin allowlist for this deployment",
    }
}
FUNDING_REJECTED = {
    409: {
        "model": ErrorResponse,
        "description": "Insufficient available cash, too many pending requests, the "
        "idempotency key is in flight, or the request is no longer pending",
    }
}
