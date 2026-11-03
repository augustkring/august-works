# Superseded Server/CLI typecheck attempt

This attempt is retained because it exposed a TSC error, but it is **not current-source validation**. Its snapshot pinned `native-execution-input.ts` at SHA-256 `67bf8ef847f3676c12047c188ff2fdddb947a15b6d36feb59373f67ccd6c2761`, before the `node:util` `isDeepStrictEqual` import. At capture time the file lacked that import and both Server and CLI TSC failed on the same unresolved name. Current source has the import and SHA-256 `8c48d37e77e412897fb1d875d9b03d5e39325498fee9a161ca9ae834907e94de`.

The follow-up will use a new source snapshot and separate artifact paths.
