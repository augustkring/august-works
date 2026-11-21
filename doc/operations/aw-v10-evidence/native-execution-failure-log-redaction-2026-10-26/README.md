# Native execution failure log redaction

The focused regression verifies that a native execution failure log retains safe failure metadata and a bounded PostgreSQL lock graph while excluding marker strings from the exception message, nested cause/query/parameters, and SQL-bearing deadlock detail lines.

The qualification snapshot and exact Vitest output are retained in this directory. Snapshot verification exited 0, and the test exited 0 with 1 test passed. Source pins SHA-256: `1ca411fde8a83fa5bfd08ed7e0d0ad1b6085dee043886cd3d4a3b54cb523f9cd`. Test log SHA-256: `229caa315d7df1d6a59553f672b4b5e6114046927756b7fc69dd6cac4b9896ac`.
