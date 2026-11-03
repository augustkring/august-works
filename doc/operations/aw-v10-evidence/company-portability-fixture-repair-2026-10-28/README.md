Complete route suite passes 48/48 in r2. The full portability r2 run passed 136/148; after repairing the 12 stale fixture/transaction expectations, r3 passed those 12 selected cases. These distinct source snapshots are not one final complete 148-case pass. Successful secret effects remain in their durable journal for reconciliation after a later import failure.

Large failed-attempt raw logs are preserved losslessly as test.log.gz. compressed-log-receipts.json records original byte counts and SHA-256; decompress to inspect them. Per-attempt source pins and exit receipts are unchanged.
