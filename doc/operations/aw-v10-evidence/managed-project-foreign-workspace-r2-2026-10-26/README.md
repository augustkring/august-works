# Project foreign workspace source check, attempt 2

Fresh locked snapshot/syntax preflight passed. The valid foreign workspace and the missing/forged parent checks passed, but the post-wait mutation setup attempted to update the Project body directly. The database owner trigger correctly rejected the direct write because it left the old payload snapshot attached. No post-wait result is claimed from this attempt.

The test now mutates the original parent workspace through `projectService.updateWorkspace`, which changes the actual joined source row through its owner service. The test will rerun with a new source snapshot.
