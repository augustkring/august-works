---
title: "CLI command migration"
description: "Use the canonical Blentera command while retaining existing installation state."
---

The canonical command is `blentera`. The distributed CLI exposes this command alongside the temporary `paperclipai` compatibility command. Both invoke the same implementation and accept the same arguments. The public npm package name remains `paperclipai` during this migration; no new package namespace is claimed or published by this change.

Update scripts from `paperclipai <arguments>` to `blentera <arguments>`. After installing a release containing both command entries, verify `blentera --version` and `blentera --help` before changing automation. The legacy command prints one deprecation message on stderr and preserves stdout, arguments and exit status. Its compatibility window ends on **27 April 2027**; removal is a separately reviewed release change, not an automatic clock-triggered failure in an installed version.

Existing `PAPERCLIP_*` environment variables, API paths, credentials, local state and `~/.paperclip` remain compatible. A command rename does not move data, change authentication or grant permissions. Use the existing explicit data-directory option to select another instance; do not copy credentials or rename state directories merely to change product branding.

This repository change prepares the command and guide. Package publication, ownership of a future public namespace, deployment of the guide and public-origin validation require their own release evidence.
