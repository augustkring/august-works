#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript-compiler-api');
const legacyProduct = /\b(?:Paperclip(?: Labs)?|August Works)\b/;
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

export function checkCustomerBrand(root) {
  const allow = JSON.parse(fs.readFileSync(path.join(root, 'scripts/customer-brand-compatibility.json'), 'utf8'));
  const findings = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !/(?:\.test\.|__tests__|__fixtures__)/.test(full))
        findings.push(...inspectSource(fs.readFileSync(full, 'utf8'), path.relative(root, full).split(path.sep).join('/')));
      else if (/\.json$/.test(full) && full.includes(`${path.sep}i18n${path.sep}`) && legacyProduct.test(fs.readFileSync(full, 'utf8')))
        findings.push({file: path.relative(root, full), line: 1, sha256: 'unapproved-message-catalog-copy'});
    }
  }
  walk(path.join(root, 'ui/src'));
  const key = value => `${value.file}:${value.sha256}`;
  const exceptions = new Set(allow.filter(value => typeof value.reason === 'string' && value.reason.trim()).map(key));
  const actual = new Set(findings.map(key));
  return {
    findings,
    violations: findings.filter(value => !exceptions.has(key(value))),
    staleExceptions: allow.filter(value => !actual.has(key(value))),
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkCustomerBrand(path.resolve(fileURLToPath(new URL('..', import.meta.url))));
  for (const item of result.violations) console.error(`${item.file}:${item.line}: legacy customer product copy`);
  for (const item of result.staleExceptions) console.error(`${item.file}: stale compatibility exception ${item.sha256}`);
  console.log(`Customer brand: ${result.violations.length} leaks; ${result.findings.length} exact compatibility literals; ${result.staleExceptions.length} stale exceptions.`);
  process.exitCode = result.violations.length || result.staleExceptions.length ? 1 : 0;
}
