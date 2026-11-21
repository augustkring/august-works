#!/usr/bin/env node
// Existing installations retain this public package/command during migration.
// Both commands execute the same built canonical implementation.
console.error('paperclipai is deprecated; use blentera. Compatibility window ends 2027-04-27. Migration: https://docs.blentera.com/cli/migration');
await import('../dist/index.js');
