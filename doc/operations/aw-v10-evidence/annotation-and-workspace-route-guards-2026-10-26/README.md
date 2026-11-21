# annotation-and-workspace-route-guards-2026-10-26

Both files pass: 12/12, exit 0. Annotation-inclusive document reads check complete current Task/Context admission before fetching document/annotation bodies and retain after-read checks. Body-only source-bound reads keep the selected revision path. Workspace command route fixtures explicitly mock only source admission because their DB stub has no source graph; the actual host-command rejection guard is exercised and mutation services remain uncalled. These unit route fixtures do not qualify real source authorization; actual managed authenticated source tests provide separate evidence.

Source pins, exit codes and exact compressed log bytes are retained. The archive receipt records both raw and compressed hashes.
