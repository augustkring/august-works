import { readFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const root = '/tmp/blentera-auth-family-177';
const packages = [
  'better-auth',
  '@better-auth/core',
  '@better-auth/passkey',
  '@better-auth/scim',
  '@better-auth/sso',
  '@better-auth/drizzle-adapter',
  '@better-auth/kysely-adapter',
  '@better-auth/memory-adapter',
  '@better-auth/mongo-adapter',
  '@better-auth/prisma-adapter',
  '@better-auth/telemetry',
  '@better-fetch/fetch',
];
const metadata = new Map(packages.map(name => [name, {
  root: `${root}/${name}/package`,
  exports: JSON.parse(readFileSync(`${root}/${name}/package/package.json`, 'utf8')).exports,
}]));
function targetFor(target, conditions) {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') return null;
  for (const condition of conditions) {
    if (Object.hasOwn(target, condition)) {
      const result = targetFor(target[condition], conditions);
      if (result) return result;
    }
  }
  return Object.hasOwn(target, 'default') ? targetFor(target.default, conditions) : null;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    for (const [name, meta] of metadata) {
      if (specifier === name || specifier.startsWith(`${name}/`)) {
        const key = specifier === name ? '.' : `.${specifier.slice(name.length)}`;
        let mapping = meta.exports?.[key];
        let wildcard;
        if (!mapping) {
          const pattern = Object.keys(meta.exports ?? {}).filter(value => value.includes('*') &&
            key.startsWith(value.slice(0, value.indexOf('*'))) && key.endsWith(value.slice(value.indexOf('*') + 1)))
            .sort((a, b) => b.length - a.length)[0];
          if (pattern) {
            const before = pattern.slice(0, pattern.indexOf('*'));
            const after = pattern.slice(pattern.indexOf('*') + 1);
            wildcard = key.slice(before.length, key.length - after.length);
            mapping = meta.exports[pattern];
          }
        }
        const target = targetFor(mapping, context.conditions);
        if (!target) throw new Error(`No export for ${specifier} in isolated Better Auth tarball`);
        const resolvedTarget = wildcard === undefined ? target : target.replaceAll('*', wildcard);
        const url = pathToFileURL(`${meta.root}/${resolvedTarget.replace(/^\.\//, '')}`).href;
        if (process.env.BLENTERA_AUTH_FAMILY_TRACE === '1') appendFileSync('/tmp/blentera-auth-family-loader.trace', `${specifier} ${url}\n`);
        return { url, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
