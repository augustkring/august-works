# V7 portability retry r2

- Result: 2/3 tests passed. Both exporter assertions now run with 120-second test budgets and complete. The source-erasure case exposed the fixture passing a source Task UUID to `memoryService.forget`, which requires a Memory record ID.
- Exact pins and raw log are retained.
