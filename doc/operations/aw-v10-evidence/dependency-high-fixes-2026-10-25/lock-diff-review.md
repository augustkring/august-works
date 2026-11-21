# Lockfile diff review

The 323-line diff consists of the security floors and their resolver closure:

- MCP SDK importers move from 1.31.0 to 1.32.0.
- Server Multer moves from 2.4.0 to 2.5.0.
- Teams' nested MSAL Node moves from 5.6.0 to 7.1.0; its MSAL Common dependency changes from 16.13.0 to 16.14.2.
- Cursor SDK's Zod resolution moves from 3.25.76 to 4.6.6.
- Undici resolves to 6.29.1 and 8.12.3.
- Vite resolves to 8.3.5 across the affected workspace/peer graph. Its resolver closure consequently advances Rolldown from 1.2.5 to 1.2.15 and OXC types from 0.146.0 to 0.155.0, adds its PostCSS/nanoid closure, and refreshes Vite peer snapshots.

The direct importer specifier edits are limited to the MCP SDK, Multer, and Vite dependency ranges above. No unrelated direct importer or package-version changes were found. The Vite peer snapshot churn is a transitive consequence of upgrading the vulnerable Vite resolution.
