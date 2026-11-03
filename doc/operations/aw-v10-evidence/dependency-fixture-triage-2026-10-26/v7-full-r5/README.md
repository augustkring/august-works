# V7 portability full regression

- Result: 3/3 tests passed, exit 0; full test duration ~107s.
- Fresh qualification snapshot and exact source pins are retained.
- The fixture creates two canonical Human-reviewed Memory records from actual Task sources and 101 observations through the original service. The source-erasure case forgets the actual Memory record ID, verifies no exported row for it, and verifies its dependent observations are absent.
- The two export test bodies and 101-row setup use bounded 120-second test budgets; production limits are unchanged.
