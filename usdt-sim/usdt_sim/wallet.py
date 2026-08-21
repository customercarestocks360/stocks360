"""The USDT wallet: balances, deposits, withdrawals.

`available` is spendable, `locked` is committed to a resting order or an in-flight
withdrawal. Nothing moves between them except through the four primitives below, which
is what makes "where did my balance go" answerable from the audit trail alone.

Deposits and withdrawals are state machines, not booleans, because that is what a chain
gives you: a deposit is seen before it is spendable, and a broadcast can fail after the
funds are already committed. Crediting is idempotent -- double-crediting a confirmed
deposit is the single most expensive bug an exchange can ship.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from random import Random

from . import chain as chain_module
from .config import (
    DEFAULT_CHAIN,
    MIN_DEPOSIT_USDT,
    MIN_WITHDRAWAL_USDT,
    REQUIRED_CONFIRMATIONS,
    WITHDRAWAL_FAILURE_RATE,
    WITHDRAWAL_FEE_USDT,
)
from .ledger import Ledger
from .models import (
    Balance,
    Deposit,
    DepositStatus,
    InsufficientFunds,
    NotFound,
    SimError,
    Withdrawal,
    WithdrawalStatus,
)
from .money import ZERO, usdt

_FAILURE_REASONS = (
    "destination address rejected by the node",
    "chain congestion: broadcast timed out",
    "compliance hold on the destination address",
)


class Wallet:
    def __init__(self, ledger: Ledger, clock: Callable[[], datetime], rng: Random):
        self._ledger = ledger
        self._clock = clock
        self._rng = rng
        self.available_usdt = ZERO
        self.locked_usdt = ZERO
        self.total_deposited_usdt = ZERO
        self.total_withdrawn_usdt = ZERO
        self.withdrawal_fees_usdt = ZERO
        self.addresses: dict[str, str] = {}
        self.deposits: dict[str, Deposit] = {}
        self.withdrawals: dict[str, Withdrawal] = {}

    # --- balance primitives -------------------------------------------------
    @property
    def total_usdt(self) -> Decimal:
        return self.available_usdt + self.locked_usdt

    @property
    def net_deposited_usdt(self) -> Decimal:
        """Capital still in the account: what came in, less what left the chain.

        This is the baseline P/L measures against, so a withdrawal does not read as a
        loss and a deposit does not read as a gain.
        """
        return self.total_deposited_usdt - self.total_withdrawn_usdt - self.withdrawal_fees_usdt

    def debit(self, amount: Decimal) -> None:
        amount = usdt(amount)
        if amount > self.available_usdt:
            raise InsufficientFunds(f"need {amount} USDT, available {self.available_usdt} USDT")
        self.available_usdt = usdt(self.available_usdt - amount)

    def credit(self, amount: Decimal) -> None:
        self.available_usdt = usdt(self.available_usdt + usdt(amount))

    def lock(self, amount: Decimal) -> Decimal:
        amount = usdt(amount)
        self.debit(amount)
        self.locked_usdt = usdt(self.locked_usdt + amount)
        return amount

    def unlock(self, amount: Decimal) -> None:
        amount = min(usdt(amount), self.locked_usdt)
        self.locked_usdt = usdt(self.locked_usdt - amount)
        self.credit(amount)

    def spend_locked(self, amount: Decimal) -> None:
        """Settle committed funds: they leave `locked` without passing through `available`."""
        amount = usdt(amount)
        if amount > self.locked_usdt:
            raise InsufficientFunds(f"locked {self.locked_usdt} USDT, tried to settle {amount}")
        self.locked_usdt = usdt(self.locked_usdt - amount)

    def balance(self, chain: str = DEFAULT_CHAIN) -> Balance:
        return Balance(
            available_balance_usdt=self.available_usdt,
            locked_balance_usdt=self.locked_usdt,
            total_balance_usdt=self.total_usdt,
            total_deposited_usdt=self.total_deposited_usdt,
            total_withdrawn_usdt=self.total_withdrawn_usdt,
            withdrawal_fees_usdt=self.withdrawal_fees_usdt,
            net_deposited_usdt=self.net_deposited_usdt,
            deposit_address=self.deposit_address(chain),
            chain=chain_module.normalise_chain(chain),
        )

    # --- deposits -----------------------------------------------------------
    def deposit_address(self, chain: str = DEFAULT_CHAIN, rotate: bool = False) -> str:
        """One sticky address per chain, the way a real exchange assigns them."""
        chain = chain_module.normalise_chain(chain)
        if rotate or chain not in self.addresses:
            self.addresses[chain] = chain_module.new_address(chain, self._rng)
            self._ledger.record(
                "deposit.address_issued", chain=chain, address=self.addresses[chain]
            )
        return self.addresses[chain]

    def deposit_qr(self, chain: str = DEFAULT_CHAIN) -> dict:
        """Everything a deposit screen needs: the address, the QR, and the rules."""
        address = self.deposit_address(chain)
        chain = chain_module.normalise_chain(chain)
        return {
            "address": address,
            "chain": chain,
            "asset": "USDT",
            "min_deposit_usdt": MIN_DEPOSIT_USDT,
            "required_confirmations": REQUIRED_CONFIRMATIONS[chain],
            "qr_payload": address,
            "qr_svg_data_uri": chain_module.qr_svg_data_uri(address),
        }

    def receive(
        self, amount: Decimal, chain: str = DEFAULT_CHAIN, confirmations: int = 0
    ) -> Deposit:
        """Simulate an inbound on-chain transfer landing on our deposit address."""
        amount = usdt(amount)
        chain = chain_module.normalise_chain(chain)
        if amount < MIN_DEPOSIT_USDT:
            raise SimError(f"minimum deposit is {MIN_DEPOSIT_USDT} USDT")
        required = REQUIRED_CONFIRMATIONS[chain]
        deposit = Deposit(
            tx_hash=chain_module.new_tx_hash(chain, self._rng),
            address=self.deposit_address(chain),
            chain=chain,
            amount_usdt=amount,
            confirmations=0,
            required_confirmations=required,
            status=DepositStatus.PENDING,
            created_at=self._clock(),
        )
        self.deposits[deposit.tx_hash] = deposit
        self._ledger.record(
            "deposit.detected",
            tx_hash=deposit.tx_hash,
            chain=chain,
            amount_usdt=amount,
            required_confirmations=required,
        )
        if confirmations:
            self.confirm(deposit.tx_hash, confirmations)
        return deposit

    def confirm(self, tx_hash: str, blocks: int = 1) -> Deposit:
        """Add confirmations; credit the balance the moment the threshold is crossed."""
        deposit = self.deposits.get(tx_hash)
        if deposit is None:
            raise NotFound(f"no deposit with tx hash {tx_hash}")
        if deposit.status is DepositStatus.CREDITED:
            return deposit
        deposit.confirmations = min(
            deposit.required_confirmations, deposit.confirmations + max(0, blocks)
        )
        if deposit.confirmations < deposit.required_confirmations:
            self._ledger.record(
                "deposit.confirmed",
                tx_hash=tx_hash,
                confirmations=deposit.confirmations,
                required_confirmations=deposit.required_confirmations,
            )
            return deposit

        deposit.status = DepositStatus.CREDITED
        deposit.credited_at = self._clock()
        self.credit(deposit.amount_usdt)
        self.total_deposited_usdt = usdt(self.total_deposited_usdt + deposit.amount_usdt)
        self._ledger.record(
            "deposit.credited",
            tx_hash=tx_hash,
            amount_usdt=deposit.amount_usdt,
            available_balance_usdt=self.available_usdt,
        )
        return deposit

    # --- withdrawals --------------------------------------------------------
    def request_withdrawal(
        self, address: str, amount: Decimal, chain: str | None = None
    ) -> Withdrawal:
        """Validate the destination, lock amount + fee, and queue the withdrawal."""
        resolved_chain, canonical = chain_module.validate_address(address, chain)
        amount = usdt(amount)
        if amount < MIN_WITHDRAWAL_USDT:
            raise SimError(f"minimum withdrawal is {MIN_WITHDRAWAL_USDT} USDT")
        fee = usdt(WITHDRAWAL_FEE_USDT[resolved_chain])
        self.lock(amount + fee)
        withdrawal = Withdrawal(
            id=f"wd_{chain_module.new_tx_hash(resolved_chain, self._rng)[-12:]}",
            address=canonical,
            chain=resolved_chain,
            amount_usdt=amount,
            fee_usdt=fee,
            status=WithdrawalStatus.PENDING,
            created_at=self._clock(),
        )
        self.withdrawals[withdrawal.id] = withdrawal
        self._ledger.record(
            "withdrawal.requested",
            withdrawal_id=withdrawal.id,
            address=canonical,
            chain=resolved_chain,
            amount_usdt=amount,
            fee_usdt=fee,
            locked_balance_usdt=self.locked_usdt,
        )
        return withdrawal

    def process_withdrawals(self, withdrawal_id: str | None = None) -> list[Withdrawal]:
        """Advance queued withdrawals by one stage: pending -> processing -> settled.

        One stage per call, so the in-flight state is observable instead of a detail
        that flashes past inside a single function. Call it twice to drain the queue.
        """
        if withdrawal_id is not None:
            if withdrawal_id not in self.withdrawals:
                raise NotFound(f"no withdrawal with id {withdrawal_id}")
            candidates = [self.withdrawals[withdrawal_id]]
        else:
            candidates = list(self.withdrawals.values())

        touched = []
        for withdrawal in candidates:
            if withdrawal.status is WithdrawalStatus.PENDING:
                withdrawal.status = WithdrawalStatus.PROCESSING
                self._ledger.record("withdrawal.processing", withdrawal_id=withdrawal.id)
                touched.append(withdrawal)
            elif withdrawal.status is WithdrawalStatus.PROCESSING:
                self._settle(withdrawal)
                touched.append(withdrawal)
        return touched

    def _settle(self, withdrawal: Withdrawal) -> None:
        total = withdrawal.amount_usdt + withdrawal.fee_usdt
        if self._rng.random() < WITHDRAWAL_FAILURE_RATE:
            withdrawal.status = WithdrawalStatus.FAILED
            withdrawal.failure_reason = self._rng.choice(_FAILURE_REASONS)
            withdrawal.completed_at = self._clock()
            self.unlock(total)
            self._ledger.record(
                "withdrawal.failed",
                withdrawal_id=withdrawal.id,
                reason=withdrawal.failure_reason,
                refunded_usdt=total,
                available_balance_usdt=self.available_usdt,
            )
            return
        withdrawal.status = WithdrawalStatus.COMPLETED
        withdrawal.tx_hash = chain_module.new_tx_hash(withdrawal.chain, self._rng)
        withdrawal.completed_at = self._clock()
        self.spend_locked(total)
        self.total_withdrawn_usdt = usdt(self.total_withdrawn_usdt + withdrawal.amount_usdt)
        self.withdrawal_fees_usdt = usdt(self.withdrawal_fees_usdt + withdrawal.fee_usdt)
        self._ledger.record(
            "withdrawal.completed",
            withdrawal_id=withdrawal.id,
            tx_hash=withdrawal.tx_hash,
            address=withdrawal.address,
            amount_usdt=withdrawal.amount_usdt,
            fee_usdt=withdrawal.fee_usdt,
            available_balance_usdt=self.available_usdt,
        )
