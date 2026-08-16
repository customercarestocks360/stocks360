"""Forex watchlists. The storage shape is shared — see streaming/watchlists.py.

A separate collection from the crypto watchlists on purpose: the two symbol universes are
validated against different providers, so a pair that stops being supported must not be
able to invalidate a crypto watchlist, or vice versa.
"""

from app.streaming.watchlists import WatchlistStore

WATCHLISTS = "forex_watchlists"

store = WatchlistStore(WATCHLISTS)

count_for_user = store.count_for_user
create = store.create
list_for_user = store.list_for_user
get = store.get
update = store.update
add_symbols = store.add_symbols
remove_symbol = store.remove_symbol
delete = store.delete
