# V7 portability retry r3

- Result: the targeted source-erasure test failed only because its string-level export assertion considered an erased Memory UUID in the surviving related-record metadata to be an exported record. The actual row was absent. The fixture now asserts absence by record identity, while retaining the dependent-observation absence assertion.
- Exact pins and raw log are retained. Retry r4 validates this final fixture assertion.
