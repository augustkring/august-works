#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript-compiler-api');
const legacyProduct = /\b(?:Paperclip(?: Labs)?|August Works)\b/;
const textSurfaceExtensions = new Set(['.md', '.mdx', '.html', '.svg', '.txt', '.webmanifest', '.json']);
const digest = text => createHash('sha256').update(text).digest('hex');

// Inspect rendered copy and strings, not identifiers, comments, package names or
// historical source documents. Exact exceptions name real compatibility contracts.
export function inspectSource(source, file) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  function visit(node) {
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ||
         ts.isTemplateTail(node) || ts.isJsxText(node)) && legacyProduct.test(node.text)) {
      const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
      findings.push({ file, line: position.line + 1, sha256: digest(node.getText(tree)) });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return findings;
}

function inspectTextSurface(source, file) {
  const findings = [];
  // Front matter and HTML comments carry authoring/provenance metadata rather
  // than rendered copy. Markdown code examples remain in scope because they
  // are customer instructions and can encode a legacy command or URL.
  const rendered = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/<!--([\s\S]*?)-->/g, (block) => block.replace(/[^\n]/g, ' '));
  const sourceLine = index => {
    const start = rendered.lastIndexOf('\n', index - 1) + 1;
    const next = rendered.indexOf('\n', index);
    const end = next < 0 ? rendered.length : next;
    return { line: rendered.slice(0, index).split('\n').length, context: rendered.slice(start, end).replace(/\r$/, '') };
  };
  const pattern = new RegExp(legacyProduct.source, 'g');
  for (const match of rendered.matchAll(pattern)) {
    const position = sourceLine(match.index);
    findings.push({ file, line: position.line, sha256: digest(position.context) });
  }
  return findings;
}

function inspectSvgWordmark(source, file) {
  const findings = [];
  const textNodes = /<text\b[^>]*>([\s\S]*?)<\/text\s*>/gi;
  for (const node of source.matchAll(textNodes)) {
    const content = node[1].replace(/<[^>]+>/g, '').trim();
    const pattern = /\b(?:paperclip|august works)\b/g;
    const match = pattern.exec(content);
    if (match) {
      const before = source.slice(0, node.index + node[0].indexOf(node[1]) + match.index);
      findings.push({ file, line: before.split('\n').length, sha256: digest(content) });
    }
  }
  return findings;
}

function inspectPublicText(source, file) {
  const findings = inspectTextSurface(source, file);
  if (path.extname(file).toLowerCase() === '.svg') findings.push(...inspectSvgWordmark(source, file));
  return findings;
}

function walkPublishedDocs(docsRoot, root, findings, inventory) {
  const configPath = path.join(docsRoot, 'docs.json');
  if (!fs.existsSync(configPath)) return;
  const configText = fs.readFileSync(configPath, 'utf8');
  inventory.push({ category: 'public_docs_config', file: path.relative(root, configPath).split(path.sep).join('/') });
  findings.push(...inspectTextSurface(configText, path.relative(root, configPath).split(path.sep).join('/')));
  const config = JSON.parse(configText);
  const resolveDocsFile = value => {
    if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || value.split('/').includes('..')) return null;
    const full = path.resolve(docsRoot, value);
    return full.startsWith(`${path.resolve(docsRoot)}${path.sep}`) ? full : null;
  };
  const languages = config.navigation?.languages ?? [];
  const pagesFor = (value, pages = new Set()) => {
    if (!value || typeof value !== 'object') return pages;
    if (Array.isArray(value.pages)) for (const page of value.pages) if (typeof page === 'string') pages.add(page);
    for (const child of Object.values(value)) pagesFor(child, pages);
    return pages;
  };
  const files = new Set();
  const publicAssets = new Set([config.favicon, config.logo?.dark, config.logo?.light].filter(value => typeof value === 'string'));
  for (const asset of publicAssets) {
    const full = resolveDocsFile(asset.replace(/^\//, ''));
    if (full && fs.existsSync(full)) {
      const file = path.relative(root, full).split(path.sep).join('/');
      inventory.push({ category: 'public_docs_asset', file });
      findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), file));
    }
  }
  for (const language of languages) {
    if (typeof language.language !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language.language)) continue;
    for (const page of pagesFor(language)) {
      if (typeof page !== 'string' || !/^[a-z0-9_/-]+$/i.test(page) || page.split('/').includes('..')) continue;
      const canonical = resolveDocsFile(`${page}.md`);
      if (canonical && fs.existsSync(canonical)) files.add(canonical);
      const localized = resolveDocsFile(`${language.language}/${page}.md`);
      if (localized && fs.existsSync(localized)) files.add(localized);
    }
  }
  for (const full of files) {
    const file = path.relative(root, full).split(path.sep).join('/');
    inventory.push({ category: 'public_docs_page', file });
    findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), file));
  }
}

function walkAppHelpArticles(docsRoot, root, findings, inventory) {
  // The Help/API content loader can publish bundled articles that are not in
  // Mintlify navigation. Bound this extra inventory to canonical app Help
  // content roots; never sweep docs history, references, or playbooks.
  const alreadyScanned = new Set(inventory.filter(item => item.category === 'public_docs_page').map(item => item.file));
  const localeRoots = [path.join(docsRoot, 'help')];
  if (fs.existsSync(docsRoot)) {
    for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(entry.name))
        localeRoots.push(path.join(docsRoot, entry.name, 'help'));
    }
  }
  for (const localeRoot of localeRoots) {
    if (!fs.existsSync(localeRoot)) continue;
    const visit = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
          const file = path.relative(root, full).split(path.sep).join('/');
          if (alreadyScanned.has(file)) continue;
          alreadyScanned.add(file);
          inventory.push({ category: 'app_help_article', file });
          findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), file));
        }
      }
    };
    visit(localeRoot);
  }
}

function workspacePackageDirs(root) {
  const manifest = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const lines = manifest.split(/\r?\n/);
  let inPackages = false;
  const includes = [];
  const excludes = [];
  for (const line of lines) {
    if (!inPackages) { if (/^packages:\s*$/.test(line)) inPackages = true; continue; }
    if (line && !/^\s/.test(line)) break;
    const match = line.match(/^\s*-\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    const pattern = match[1].replace(/^['"]|['"]$/g, '');
    const excluded = pattern.startsWith('!');
    const packagePattern = excluded ? pattern.slice(1) : pattern;
    if (!packagePattern.startsWith('packages/')) continue;
    if (excluded) excludes.push(packagePattern);
    else includes.push(packagePattern);
  }
  const dirs = new Set();
  const blockedSegments = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo', '.cache', '.next']);
  for (const pattern of includes) {
    const wildcard = pattern.indexOf('*');
    if (wildcard < 0) {
      dirs.add(path.resolve(root, pattern));
      continue;
    }
    if (pattern.indexOf('*', wildcard + 1) !== -1 || pattern.slice(wildcard) !== '*')
      throw new Error(`unsupported_workspace_package_glob:${pattern}`);
    const parent = path.resolve(root, pattern.slice(0, wildcard).replace(/\/$/, ''));
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.name.startsWith('.') && !blockedSegments.has(entry.name)) dirs.add(path.join(parent, entry.name));
  }
  return [...dirs].filter(dir => {
    const relative = path.relative(root, dir).split(path.sep).join('/');
    if (relative.split('/').some(segment => blockedSegments.has(segment))) return false;
    return !excludes.some(pattern => pattern.endsWith('/**')
      ? relative === pattern.slice(0, -3) || relative.startsWith(pattern.slice(0, -2))
      : relative === pattern);
  }).sort();
}

function walkPublishedPackageReadmes(root, findings, inventory) {
  for (const dir of workspacePackageDirs(root)) {
    const manifestPath = path.join(dir, 'package.json');
    const readmePath = path.join(dir, 'README.md');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(readmePath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.publishConfig?.access !== 'public') continue;
    const file = path.relative(root, readmePath).split(path.sep).join('/');
    inventory.push({ category: 'public_package_readme', file });
    findings.push(...inspectTextSurface(fs.readFileSync(readmePath, 'utf8'), file));
  }
}

export function checkCustomerBrand(root) {
  const allow = JSON.parse(fs.readFileSync(path.join(root, 'scripts/customer-brand-compatibility.json'), 'utf8'));
  const findings = [];
  const inventory = [];
  const addInventory = (category, full) => inventory.push({ category, file: path.relative(root, full).split(path.sep).join('/') });
  const relative = full => path.relative(root, full).split(path.sep).join('/');
  const isTestOrFixture = full => /(?:\.test\.|__tests__|__fixtures__)/.test(full);
  function walkSource(dir, category) {
    if (!fs.existsSync(dir)) return;
    if (fs.statSync(dir).isFile()) {
      if (/\.[cm]?[jt]sx?$/.test(dir) && !isTestOrFixture(dir)) {
        addInventory(category, dir);
        findings.push(...inspectSource(fs.readFileSync(dir, 'utf8'), relative(dir)));
      }
      else if (/\.json$/.test(dir) && dir.includes(`${path.sep}i18n${path.sep}`)) {
        addInventory(category, dir);
        if (legacyProduct.test(fs.readFileSync(dir, 'utf8'))) findings.push({file: relative(dir), line: 1, sha256: 'unapproved-message-catalog-copy'});
      }
      return;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkSource(full, category);
      else if (/\.[cm]?[jt]sx?$/.test(full) && !isTestOrFixture(full)) {
        addInventory(category, full);
        findings.push(...inspectSource(fs.readFileSync(full, 'utf8'), relative(full)));
      } else if (/\.json$/.test(full) && full.includes(`${path.sep}i18n${path.sep}`)) {
        addInventory(category, full);
        if (legacyProduct.test(fs.readFileSync(full, 'utf8'))) findings.push({file: relative(full), line: 1, sha256: 'unapproved-message-catalog-copy'});
      }
    }
  }
  function walkText(dir, category, allowedExtensions = textSurfaceExtensions) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkText(full, category, allowedExtensions);
      else if (allowedExtensions.has(path.extname(full).toLowerCase())) {
        addInventory(category, full);
        findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), relative(full)));
      }
    }
  }
  walkSource(path.join(root, 'ui/src'), 'ui_source');
  for (const file of ['ui/index.html']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) { addInventory('app_public_html', full); findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), file)); }
  }
  // Keep this scope explicit: customer/public product surfaces only. The repo's
  // reference corpus, upstream protocol identifiers, licenses and source history
  // are not recursively swept into the product-copy gate.
  walkSource(path.join(root, 'cli/src'), 'cli_source');
  // This shared warning is emitted to CLI users on startup; keep this exact
  // customer-copy source in scope without sweeping the shared package.
  walkSource(path.join(root, 'packages/shared/src/node-version.ts'), 'cli_runtime_notice');
  for (const file of ['README.md', 'cli/README.md']) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) { addInventory('public_readme', full); findings.push(...inspectPublicText(fs.readFileSync(full, 'utf8'), file)); }
  }
  walkPublishedDocs(path.join(root, 'docs'), root, findings, inventory);
  walkAppHelpArticles(path.join(root, 'docs'), root, findings, inventory);
  walkText(path.join(root, 'announcements'), 'announcements', new Set(['.json']));
  walkText(path.join(root, 'ui/public'), 'app_public_assets', new Set(['.html', '.svg', '.txt', '.webmanifest', '.json']));
  walkSource(path.join(root, 'ui/public'), 'app_public_assets_source');
  walkSource(path.join(root, 'server/src/routes/email.ts'), 'email_route');
  walkSource(path.join(root, 'server/src/services/notifications'), 'outbound_notifications');
  walkSource(path.join(root, 'server/src/services/experience/product-notices.ts'), 'product_notices');
  // Public package READMEs are developer-facing contracts; don't scan package
  // identifiers, source names or internal protocol corpora as customer copy.
  walkPublishedPackageReadmes(root, findings, inventory);
  const key = value => `${value.file}:${value.line}:${value.sha256}`;
  const exceptions = new Set(allow.filter(value => typeof value.reason === 'string' && value.reason.trim()).map(key));
  const actual = new Set(findings.map(key));
  return {
    findings,
    violations: findings.filter(value => !exceptions.has(key(value))),
    staleExceptions: allow.filter(value => !actual.has(key(value))),
    inventory: inventory.sort((a, b) => a.category.localeCompare(b.category) || a.file.localeCompare(b.file)),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkCustomerBrand(path.resolve(fileURLToPath(new URL('..', import.meta.url))));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const item of result.violations) console.error(`${item.file}:${item.line}: legacy customer product copy`);
    for (const item of result.staleExceptions) console.error(`${item.file}: stale compatibility exception ${item.sha256}`);
    console.log(`Customer brand: ${result.violations.length} leaks; ${result.findings.length} exact compatibility literals; ${result.staleExceptions.length} stale exceptions.`);
  }
  process.exitCode = result.violations.length || result.staleExceptions.length ? 1 : 0;
}
