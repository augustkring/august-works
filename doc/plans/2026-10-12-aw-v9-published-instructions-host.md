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
preserves the full behavior assertion. Token gates passed. Integrated type and
built-browser qualification remain pending.
