"""Crypto watchlists. The storage shape is shared — see streaming/watchlists.py."""

from app.streaming.watchlists import WatchlistStore

WATCHLISTS = "watchlists"

store = WatchlistStore(WATCHLISTS)

count_for_user = store.count_for_user
create = store.create
list_for_user = store.list_for_user
get = store.get
update = store.update
add_symbols = store.add_symbols
remove_symbol = store.remove_symbol
delete = store.delete
