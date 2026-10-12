# V9 CI reproduction checkpoint

Full V9 and PR #38 remain incomplete. This checkpoint closes only the local
reproductions described below.

The pause head's remote CI failed browser shard 2/8 and the routes-4 partition.
The aggregate browser gate reported the shard failure. Storage refused the remote
log downloads, so the exact configured partitions were reproduced locally.

At knowledge parent `66e2578c7245216dfbbfa881fa5689973d0fcffd`, all 717 cases in
the 42-file routes-4 partition pass. The seven-file browser shard passes 16 of
17 cases. The remaining case rejects the task-owned temporary directory because
its safety check hardcodes `/tmp`.

The repaired Memory-history case uses the operating system's configured temporary
root. It still requires the exact throwaway instance path and database directory.
It therefore supports the owned TMPDIR without admitting a developer or production
database. That actual native index-worker, original-source erasure, EN/DA and
built-UI browser case passes after the repair. No production behavior changes.

The local reproductions do not establish the cause of the earlier remote routes
failure or waive current CI. Current remote CI, full integrated checks, remaining
V9 implementation and review remain required.

At Memory head `35903c4088d0b203d9bd45219253349352a259f8`, remote browser
shard 7 fails the inherited artifact keyboard case. The GitHub log and report
show that the candidate disclosure remains closed after a page-level Enter.
All other 19 cases pass; the Runner-only case has its existing conditional skip.
The exact same shard passes 20 cases locally, so this is timing-sensitive.

The repaired case locates the visible native summary and sends Enter through
that locator. It also checks focus. It retains the keyboard interaction and the
visible-field assertion. The retention and maintenance disclosures use the same
targeted keyboard action. All three built-app artifact/Memory browser cases
pass locally after this repair. Current remote CI is still required.

The next head `fc68a6bf585b3eb1e6b6f77fb8426be41fff3ea8` passes all 35
workspace type checks locally and in the remote contracts job. That remote job
then stops before the SaaS tests because Public ECR rejects its PostgreSQL image
download with `toomanyrequests: Data limit exceeded`. Docker Hub supplies the
same image successfully in the recovered environment. Its reported digest is
exactly `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`.
The workflow now uses that reference with the same immutable digest. It retains
the actual database dump/restore tests and every contract gate.
