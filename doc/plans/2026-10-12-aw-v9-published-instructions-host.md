# Published instructions and receipt identity

Both Agent detail variants honor the Original read-only instructions contract.
An identified version loads its virtual body under a revision-specific query
key, exposes no file/root/editor mutations and links to the existing private
draft builder for that exact Agent. The active version continues while a new
draft is edited and tested. Pending reads do not display a cached body as fresh.

The publication receipt host anchors a known Original request identity during
reload and refetch. A missing/erased receipt does not fall back to a later
publication. Pending or failed read-only receipt reads hide the retained body;
no publication command is automatically sent.

Fifteen focused host cases in two files passed, including both actual Agent
detail variants, private-draft navigation, no instruction mutation, current
account fences and missing-receipt identity retention. The first two new cases
asserted before the dependent file read resolved; waiting for the actual body
preserves the full behavior assertion. Token gates passed. Integrated Source `7b07ea3062262bfef86c00475c4c18991fbe3c66`, SHA-256
`0b8b5ca61ed48c4e4bae603d0791136d2ff70accc508de5479ad511677874b5b`,
passed its own shared/DB builds and UI typecheck. Five built browser suites
passed all ten cases, including actual English/Danish instruction routes,
read-only behavior, exact private-draft navigation and accessibility. The merged
instruction/receipt/preparation hosts passed all 21 focused cases in three files.
The entire server/shared/DB Source is byte-identical to the qualified Hire
checkpoint; its 251 Native cases and server typecheck are reused only for that
unchanged Source. Whole integrated tests/build and V9 release acceptance remain
open.
