"""Equity watchlists. The storage shape is shared — see streaming/watchlists.py.

A separate collection from the crypto and forex watchlists, for the same reason those are
separate from each other: the symbol universes come from different providers, so a ticker
being delisted must not be able to invalidate a watchlist in another market.
"""

from app.streaming.watchlists import WatchlistStore

WATCHLISTS = "stock_watchlists"

store = WatchlistStore(WATCHLISTS)

count_for_user = store.count_for_user
create = store.create
list_for_user = store.list_for_user
get = store.get
update = store.update
add_symbols = store.add_symbols
remove_symbol = store.remove_symbol
delete = store.delete
