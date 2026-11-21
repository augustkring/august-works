import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReferenceIndexes,
  parseHeadings,
  renderIndex,
} from "../build-reference-index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("parseHeadings ends each section before the next heading of the same or higher level", () => {
  const text = ["# A", "intro", "## A.1", "x", "### deep", "y", "## A.2", "z", "# B", "w"].join("\n");
  const { headings, lineCount } = parseHeadings(text);
  assert.equal(lineCount, 10);
  assert.deepEqual(
    headings.map((h) => [h.level, h.title, h.line, h.end]),
    [
      [1, "A", 1, 8],
      [2, "A.1", 3, 6],
      [3, "deep", 5, 6],
      [2, "A.2", 7, 8],
      [1, "B", 9, 10],
    ],
  );
});

test("parseHeadings ignores headings inside fenced code blocks", () => {
  const text = ["# Real", "```md", "# Not a heading", "```", "~~~", "## Also not", "~~~", "## Real two"].join("\n");
  const titles = parseHeadings(text).headings.map((h) => h.title);
  assert.deepEqual(titles, ["Real", "Real two"]);
});

test("renderIndex lists start-here and checklist sections and stays deterministic", () => {
  const text = [
    "# Playbook",
    "## Executive standard",
    "text",
    "# 1. Chapter",
    "### 1.1 hidden detail",
    "# 2. Review checklist",
    "- [ ] item",
  ].join("\n");
  const input = { relPath: "doc/x.md", title: "Playbook", text, maxLevel: 2 };
  const first = renderIndex(input).content;
  assert.equal(first, renderIndex(input).content);
  assert.match(first, /## Start here\n\n- L2-3 Executive standard/);
  assert.match(first, /## Checklists\n\n- L6-7 2\. Review checklist/);
  assert.doesNotMatch(first.split("## Sections")[1], /hidden detail/);
});

test("committed reference indexes match the generator output", () => {
  const outputs = buildReferenceIndexes();
  assert.ok(outputs.size >= 41, `expected at least 41 indexes, got ${outputs.size}`);
  const stale = [...outputs]
    .filter(([file, content]) => readFileSync(file, "utf8") !== content)
    .map(([file]) => path.relative(root, file));
  assert.deepEqual(stale, [], "run node scripts/build-reference-index.mjs");
});

test("--check exits non-zero only when an index is stale", () => {
  const result = spawnSync(process.execPath, ["scripts/build-reference-index.mjs", "--check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Checked \d+ reference indexes/);
});
