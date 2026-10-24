import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readHelpArticleSources } from "./check-help-docs.mjs";

const REVIEW_FILE = "docs/help/change-review.json";
const COVERED_ARTICLES = new Set(["help-and-human-support", "company-import-export"]);
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function git(root, args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}

function blob(root, revision, filename) {
  return git(root, ["show", `${revision}:${filename}`], null);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readReviewFile(root) {
  const filename = path.join(root, REVIEW_FILE);
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

export function validateHelpChangeReview({ articles, reviews, changedPaths, hashFile }) {
  const errors = [];
  const expectedPairs = new Map();
  for (const article of articles) {
    if (!Array.isArray(article.sourceFiles)) {
      errors.push(`${article.filename}: linked_source_files must be a list`);
      continue;
    }
    for (const source of article.sourceFiles) {
      if (!expectedPairs.has(source)) expectedPairs.set(source, []);
      expectedPairs.get(source).push(article);
    }
  }
  if (!Array.isArray(reviews)) return [...errors, `${REVIEW_FILE}: reviews must be an array`];
  const byPair = new Map();
  for (const review of reviews) {
    if (!review || typeof review.source !== "string" || typeof review.articleId !== "string") {
      errors.push(`${REVIEW_FILE}: each review needs source and articleId`);
      continue;
    }
    const key = `${review.source}\0${review.articleId}`;
    if (byPair.has(key)) errors.push(`${REVIEW_FILE}: duplicate review for ${review.source} → ${review.articleId}`);
    byPair.set(key, review);
  }

  const changed = new Set(changedPaths);
  const evidence = [];
  for (const [source, linkedArticles] of expectedPairs) {
    const currentSourceHash = hashFile(source);
    if (!DIGEST.test(currentSourceHash)) {
      errors.push(`${source}: source digest is unavailable`);
      continue;
    }
    for (const article of linkedArticles) {
      const key = `${source}\0${article.articleId}`;
      const review = byPair.get(key);
      const currentArticleHash = hashFile(article.filename);
      if (!review) {
        errors.push(`${REVIEW_FILE}: missing review for ${source} → ${article.articleId}`);
        continue;
      }
      if (!DIGEST.test(review.sourceSha256 ?? "") || review.sourceSha256 !== currentSourceHash)
        errors.push(`${REVIEW_FILE}: stale source hash for ${source} → ${article.articleId}`);
      if (!DIGEST.test(review.articleSha256 ?? "") || review.articleSha256 !== currentArticleHash)
        errors.push(`${REVIEW_FILE}: stale article hash for ${source} → ${article.articleId}`);
      if (!new Set(["updated", "no_change"]).has(review.decision))
        errors.push(`${REVIEW_FILE}: invalid decision for ${source} → ${article.articleId}`);
      if (typeof review.rationale !== "string" || review.rationale.trim().length < 12)
        errors.push(`${REVIEW_FILE}: add a specific rationale for ${source} → ${article.articleId}`);
      if (changed.has(source) && review.decision === "updated" && !changed.has(article.filename))
        errors.push(`${REVIEW_FILE}: ${source} says ${article.articleId} was updated, but ${article.filename} is unchanged`);
      if (changed.has(source) && !changed.has(article.filename) && review.decision !== "no_change")
        errors.push(`${REVIEW_FILE}: ${source} changed but ${article.filename} did not; record an explicit no_change decision`);
      if (changed.has(source)) evidence.push({
        source, sourceSha256: currentSourceHash, articleId: article.articleId, article: article.filename,
        articleSha256: currentArticleHash, decision: review.decision, rationale: review.rationale,
      });
    }
  }
  for (const review of byPair.values()) {
    if (!expectedPairs.get(review.source)?.some(article => article.articleId === review.articleId))
      errors.push(`${REVIEW_FILE}: unmapped review ${review.source} → ${review.articleId}`);
  }
  return { errors, evidence: evidence.sort((a, b) => a.source.localeCompare(b.source) || a.articleId.localeCompare(b.articleId)) };
}

export function checkHelpChangeReview({ root = process.cwd(), base, head, evidenceOut } = {}) {
  if (!SHA.test(base ?? "") || !SHA.test(head ?? "")) throw new Error("--base and --head must be full 40-character commit SHAs");
  const changedPaths = git(root, ["diff", "--name-only", `${base}...${head}`]).split("\n").filter(Boolean);
  const snapshot = String(git(root, ["rev-parse", "HEAD"])).trim();
  if (!SHA.test(snapshot)) throw new Error("The checked out source snapshot is not a full commit SHA");
  const articles = readHelpArticleSources(root);
  const foundArticles = new Set(articles.map(article => article.articleId));
  for (const articleId of COVERED_ARTICLES) if (!foundArticles.has(articleId))
    throw new Error(`The bounded Help review map is missing current article ${articleId}`);
  for (const articleId of foundArticles) if (!COVERED_ARTICLES.has(articleId))
    throw new Error(`Help article ${articleId} is outside this bounded review map; add explicit source links before extending coverage`);
  const reviewFile = readReviewFile(root);
  if (reviewFile.schemaVersion !== 1) throw new Error(`${REVIEW_FILE}: expected schemaVersion 1`);
  if (typeof reviewFile.coverage !== "string" || reviewFile.coverage.trim().length < 20)
    throw new Error(`${REVIEW_FILE}: document the bounded coverage scope`);
  const changedArticleFiles = new Set(changedPaths.filter(filename => filename.startsWith("docs/") && filename.endsWith(".md")));
  const changedSourcePaths = new Set(changedPaths);
  const current = validateHelpChangeReview({
    articles,
    reviews: reviewFile.reviews,
    changedPaths: changedSourcePaths,
    hashFile: filename => digest(blob(root, snapshot, filename)),
  });
  const errors = current.errors;
  for (const entry of current.evidence) {
    if (changedArticleFiles.has(entry.article)) continue;
    if (entry.decision !== "no_change") errors.push(`${REVIEW_FILE}: ${entry.source} has no article change; ${entry.articleId} requires no_change`);
  }
  if (evidenceOut) fs.writeFileSync(evidenceOut, `${JSON.stringify({ schemaVersion: 1, base, head, snapshot, coverage: reviewFile.coverage, reviewed: current.evidence }, null, 2)}\n`);
  return { errors, evidence: current.evidence, changedPaths, snapshot };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--base", "--head", "--evidence-out"].includes(key) || !argv[index + 1]) throw new Error(`Unexpected or incomplete argument ${key}`);
    values[key === "--evidence-out" ? "evidenceOut" : key.slice(2)] = argv[++index];
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkHelpChangeReview(parseArgs(process.argv.slice(2)));
    if (result.errors.length) {
      for (const error of result.errors) console.error(error);
      process.exitCode = 1;
    } else {
      for (const entry of result.evidence) console.log(`${entry.source} → ${entry.articleId}: ${entry.decision} (${entry.rationale})`);
      if (!result.evidence.length) console.log("No linked Help source files changed in this PR.");
      console.log("Help source review evidence is current and covers every changed linked source.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
