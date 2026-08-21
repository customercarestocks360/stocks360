"""The audit trail: one append-only list, every event that moved money or tried to.

Details are flattened to JSON-safe primitives on the way in. An audit line that still
holds live `Decimal` objects is a line whose meaning depends on how it is later
serialised, which is exactly the property an audit trail must not have.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime
from decimal import Decimal
from enum import Enum

from .models import Event


def _plain(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    return value


class Ledger:
    def __init__(self, clock: Callable[[], datetime]):
        self._clock = clock
        self.events: list[Event] = []

    def record(self, event_type: str, **details) -> Event:
        event = Event(
            seq=len(self.events) + 1,
            timestamp=self._clock(),
            type=event_type,
            details=_plain(details),
        )
        self.events.append(event)
        return event

    def history(self, kind: str | None = None, limit: int | None = None) -> list[Event]:
        """Newest last. `kind` matches a full type or its dotted prefix (`deposit`)."""
        events: Iterable[Event] = self.events
        if kind:
            wanted = kind.lower()
            events = [e for e in events if e.type == wanted or e.type.startswith(wanted + ".")]
        events = list(events)
        return events[-limit:] if limit else events
