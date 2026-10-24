import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validateHelpChangeReview } from "./check-help-change-review.mjs";

const source = "ui/src/Help.tsx";
const article = { articleId: "help", filename: "docs/help/index.md", sourceFiles: [source] };
const bytes = new Map([[source, "source-v1"], [article.filename, "article-v1"]]);
const hash = value => createHash("sha256").update(value).digest("hex");
const review = (decision, rationale = "Reviewed the linked behavior against this article.") => ({
  source, articleId: article.articleId, sourceSha256: hash(bytes.get(source)),
  articleSha256: hash(bytes.get(article.filename)), decision, rationale,
});
const check = (decision, changedPaths, rationale) => validateHelpChangeReview({
  articles: [article], reviews: [review(decision, rationale)], changedPaths,
  hashFile: filename => hash(bytes.get(filename)),
});
const baselineNoChange = review("no_change");

test("a changed linked source cannot claim an article update when the article bytes did not change", () => {
  const result = check("updated", [source]);
  assert.ok(result.errors.some(error => error.includes("says help was updated")));
});

test("a linked source and its updated article pass with hashes for the exact current bytes", () => {
  const result = check("updated", [source, article.filename]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.evidence[0].decision, "updated");
});

test("a linked source can retain an explicit per-article no-change determination", () => {
  const result = check("no_change", [source], "Article already describes this unchanged recovery behavior.");
  assert.deepEqual(result.errors, []);
  assert.match(result.evidence[0].rationale, /already describes/);
});

test("unrelated changes do not block or create Help review evidence", () => {
  const result = check("no_change", ["server/src/services/unrelated.ts"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.evidence, []);
});

test("a no-change determination cannot be reused after linked source bytes change", () => {
  bytes.set(source, "source-v2");
  const result = validateHelpChangeReview({ articles: [article], reviews: [baselineNoChange], changedPaths: [source],
    hashFile: filename => hash(bytes.get(filename)) });
  assert.ok(result.errors.some(error => error.includes("stale source hash")));
  bytes.set(source, "source-v1");
});
