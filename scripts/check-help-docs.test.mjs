import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseRestrictedFrontmatter, validateHelpDocs } from "./check-help-docs.mjs";

const NOW = new Date("2026-10-24T12:00:00Z");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "help-docs-check-"));
  fs.mkdirSync(path.join(root, "docs/help"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/docs.json"), JSON.stringify({
    navigation: { tabs: [{ tab: "Help Center", groups: [{ group: "Help", pages: ["help/article"] }] }] },
  }));
  fs.writeFileSync(path.join(root, "docs/guide.md"), "# Guide\n");
  fs.writeFileSync(path.join(root, "docs/help/article.md"), article("one", "See [the guide](/guide).") );
  return root;
}

function article(id, body = "Article text.") {
  return `---
help_article_id: ${id}
title: Example help
audience: company-members
product_capability_refs: []
screen_contract_refs: []
owner: help-team
maturity: preview
applicable_product_versions: [V10]
locale: en
last_verified_at: 2026-10-24
review_trigger: Relevant customer behavior changes
security_or_privacy_sensitive: false
linked_source_files: []
---

${body}
`;
}

test("accepts restricted metadata and existing local Help Center links", t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(validateHelpDocs({ root, now: NOW }), []);
});

test("rejects incomplete or invalid Help article metadata", t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, "docs/help/article.md");
  fs.writeFileSync(filename, article("one").replace("maturity: preview", "maturity: approved").replace("last_verified_at: 2026-10-24", "last_verified_at: 2027-01-01").replace("owner: help-team\n", ""));
  const errors = validateHelpDocs({ root, now: NOW });
  assert.ok(errors.some(error => error.includes("missing required field owner")));
  assert.ok(errors.some(error => error.includes("maturity must be one of")));
  assert.ok(errors.some(error => error.includes("cannot be in the future")));
});

test("rejects broken local Markdown link targets", t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "docs/help/article.md"), article("one", "See [missing](/not-here)."));
  assert.ok(validateHelpDocs({ root, now: NOW }).some(error => error.includes("missing local link target /not-here")));
});

test("rejects duplicate Help article IDs in the Help Center navigation", t => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "docs/help/second.md"), article("one"));
  const configFile = path.join(root, "docs/docs.json");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  config.navigation.tabs[0].groups[0].pages.push("help/second");
  fs.writeFileSync(configFile, JSON.stringify(config));
  assert.ok(validateHelpDocs({ root, now: NOW }).some(error => error.includes("duplicate help_article_id one")));
});

test("rejects YAML constructs outside the documented scalar subset", () => {
  for (const value of ["&owner", "*owner", "!custom value", "{ team: docs }", "\"unterminated", "'contains \\ escape'"]) {
    assert.throws(() => parseRestrictedFrontmatter(`---\nowner: ${value}\n---\n`), /Unsupported/);
  }
});
