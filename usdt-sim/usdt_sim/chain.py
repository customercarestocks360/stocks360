"""Chain-side plumbing: deposit addresses, transaction hashes, and QR codes.

Addresses are shaped like the real thing rather than "ADDR-123", because the point of
a simulation is that the code you write against it survives contact with a real chain.
A generated TRC-20 address is a genuine base58check string, so `validate_address`
rejects a typo'd one exactly the way TRON would -- a withdrawal is the one place in
this package where a bad string means money gone, so it gets a real checksum instead
of a length check.
"""

from __future__ import annotations

import hashlib
import io
import re
from random import Random

from .config import CHAINS, DEFAULT_CHAIN
from .models import InvalidAddress

_B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_B58_INDEX = {char: index for index, char in enumerate(_B58_ALPHABET)}
_TRON_MAINNET_PREFIX = b"\x41"
_HEX_ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")


# --- base58check ------------------------------------------------------------
def _b58_encode(raw: bytes) -> str:
    number = int.from_bytes(raw, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = _B58_ALPHABET[remainder] + encoded
    leading_zeros = len(raw) - len(raw.lstrip(b"\x00"))
    return "1" * leading_zeros + encoded


def _b58_decode(text: str) -> bytes:
    number = 0
    for char in text:
        if char not in _B58_INDEX:
            raise InvalidAddress(f"'{char}' is not a base58 character")
        number = number * 58 + _B58_INDEX[char]
    body = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    leading_ones = len(text) - len(text.lstrip("1"))
    return b"\x00" * leading_ones + body


def _checksum(payload: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]


def _b58check_encode(payload: bytes) -> str:
    return _b58_encode(payload + _checksum(payload))


# --- addresses --------------------------------------------------------------
def new_address(chain: str = DEFAULT_CHAIN, rng: Random | None = None) -> str:
    """Mint a deposit address for `chain`.

    Real addresses are derived from a keypair; these are random bodies wearing the
    right encoding. Swapping in real derivation means replacing this function only.
    """
    chain = normalise_chain(chain)
    rng = rng or Random()
    body = rng.randbytes(20)
    if chain == "TRC20":
        return _b58check_encode(_TRON_MAINNET_PREFIX + body)
    return "0x" + body.hex()


def normalise_chain(chain: str) -> str:
    upper = (chain or "").upper()
    if upper not in CHAINS:
        raise InvalidAddress(f"unsupported chain '{chain}', expected one of {', '.join(CHAINS)}")
    return upper


def detect_chain(address: str) -> str:
    if address.startswith("0x"):
        return "ERC20"
    if address.startswith("T"):
        return "TRC20"
    raise InvalidAddress("address is neither a TRC-20 (T...) nor an ERC-20 (0x...) address")


def validate_address(address: str, chain: str | None = None) -> tuple[str, str]:
    """Return `(chain, canonical_address)` or raise `InvalidAddress`.

    ponytail: ERC-20 addresses are checked for shape only -- EIP-55 checksum casing
    needs keccak256, which hashlib does not ship (sha3_256 is the NIST variant, not
    Keccak). Add `eth-utils` and verify here if mixed-case typos must be caught.
    """
    address = (address or "").strip()
    if not address:
        raise InvalidAddress("address is required")
    detected = detect_chain(address)
    if chain is not None and normalise_chain(chain) != detected:
        raise InvalidAddress(f"address is a {detected} address, not {normalise_chain(chain)}")

    if detected == "ERC20":
        if not _HEX_ADDRESS.match(address):
            raise InvalidAddress("ERC-20 address must be 0x followed by 40 hex characters")
        return detected, address.lower()

    if len(address) != 34:
        raise InvalidAddress("TRC-20 address must be 34 characters")
    decoded = _b58_decode(address)
    if len(decoded) != 25 or decoded[:1] != _TRON_MAINNET_PREFIX:
        raise InvalidAddress("TRC-20 address has the wrong prefix or length")
    if _checksum(decoded[:-4]) != decoded[-4:]:
        raise InvalidAddress("TRC-20 address checksum does not match -- check for a typo")
    return detected, address


def new_tx_hash(chain: str = DEFAULT_CHAIN, rng: Random | None = None) -> str:
    rng = rng or Random()
    digest = rng.randbytes(32).hex()
    return digest if normalise_chain(chain) == "TRC20" else "0x" + digest


# --- QR ---------------------------------------------------------------------
def _segno():
    try:
        import segno
    except ModuleNotFoundError as exc:  # pragma: no cover - dependency guard
        raise RuntimeError("QR rendering needs segno: pip install segno") from exc
    return segno


def qr_terminal(payload: str, border: int = 2) -> str:
    """A scannable QR for a terminal, using ANSI colours so the contrast is real."""
    buffer = io.StringIO()
    _segno().make(payload, error="m").terminal(out=buffer, border=border)
    return buffer.getvalue()


def qr_svg_data_uri(payload: str, scale: int = 5) -> str:
    """`data:image/svg+xml;...` -- drop straight into an <img src> or a JSON response."""
    return _segno().make(payload, error="m").svg_data_uri(scale=scale, border=2)
