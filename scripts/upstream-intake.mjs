#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN = "5623304586c04092d2a44c25b3850301a909989d";
const BASE = "81d3445b98b1cd80ff400ede6bd44ea71d88d735";
const LEDGER = path.join(ROOT, "doc/operations/upstream-intake.json");
const classes = new Set(["SECURITY / VULNERABILITY", "BUG / CORRECTNESS", "DEPENDENCY / BUILD", "PROTOCOL / COMPATIBILITY", "UX / ACCESSIBILITY", "FEATURE", "ARCHITECTURE", "BRAND / COMMUNITY"]);
const states = new Set(["decision_recorded", "review", "security_fast_path", "regression", "admitted", "deferred", "rejected"]);

function fail(message) { console.error(message); process.exitCode = 1; }
function git(args) { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function sha(value, label) { if (!/^[0-9a-f]{40}$/.test(value ?? "")) throw new Error(`${label} must be a full 40-character Git SHA`); }
function argsMap(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`); out[argv[i].slice(2)] = argv[++i]; } return out; }
function loadLedger() { return JSON.parse(readFileSync(LEDGER, "utf8")); }

export function validateLedger(ledger) {
  const errors = [];
  if (ledger.schemaVersion !== 1 || ledger.upstream?.repository !== "paperclipai/paperclip" || ledger.upstream?.pinnedSha !== PIN || ledger.fork?.baseSha !== BASE) errors.push("repository pins differ from the V10 brief");
  if (ledger.policy?.automaticMerge !== false || ledger.policy?.featureAdoptionFromMovingRef !== false) errors.push("automatic upstream merge/moving-ref adoption must remain disabled");
  if (!Array.isArray(ledger.changes)) errors.push("changes must be an array");
  if (ledger.inventory?.report && ledger.inventory?.reportSha256) {
    const reportPath = path.resolve(ROOT, ledger.inventory.report);
    if (!existsSync(reportPath)) errors.push("pinned inventory report is missing");
    else {
      const bytes = readFileSync(reportPath);
      if (createHash("sha256").update(bytes).digest("hex") !== ledger.inventory.reportSha256) errors.push("pinned inventory report SHA-256 mismatch");
      try {
        const report = JSON.parse(bytes);
        if (report.source?.upstreamSha !== PIN || report.source?.forkBaseSha !== BASE || report.source?.forkHeadSha !== ledger.fork?.currentSha || report.source?.treeSha !== ledger.inventory?.upstreamTreeSha) errors.push("pinned inventory report source identities differ from the ledger");
      } catch { errors.push("pinned inventory report is invalid JSON"); }
    }
  }
  const seen = new Set();
  for (const item of ledger.changes ?? []) {
    if (!item.pr || !/^#[0-9]+$/.test(item.pr)) errors.push("each change needs a PR number");
    try { sha(item.sourceSha, `${item.pr ?? "change"} sourceSha`); } catch (e) { errors.push(e.message); }
    if (seen.has(item.sourceSha)) errors.push(`duplicate source SHA ${item.sourceSha}`);
    seen.add(item.sourceSha);
    if (!classes.has(item.classification)) errors.push(`${item.pr}: invalid classification`);
    if (!states.has(item.state)) errors.push(`${item.pr}: invalid state`);
    if (!item.decision || !item.specRef || !Array.isArray(item.readRefs)) errors.push(`${item.pr}: missing decision/specRef/readRefs`);
    if (item.provenanceRef && !existsSync(path.resolve(ROOT, item.provenanceRef))) errors.push(`${item.pr}: provenanceRef does not resolve to a local artifact`);
    if (!item.readRefs?.includes(`https://github.com/paperclipai/paperclip/commit/${item.sourceSha}`) || !item.readRefs?.includes(`https://github.com/paperclipai/paperclip/pull/${item.pr?.slice(1)}`)) errors.push(`${item.pr}: source refs must bind the exact commit and PR`);
    if (!/^doc\/reference\/blentera-v10\/Blentera_Master_Build_Brief_V10_FINAL_v4\.0_2026-10-18\.md#7\.(3|4|5|6|7|8|9|10|11|12|13|14|15|17|19|20)$/.test(item.specRef)) errors.push(`${item.pr}: decision must cite a pinned V10 §7 package or incremental disposition`);
    if (item.state === "admitted") {
      if (!item.owner || !item.invariantImpact || !Array.isArray(item.affectedTests) || !item.affectedTests.length || !item.forkCommit || !Array.isArray(item.regressionEvidence) || !item.regressionEvidence.length || !item.provenanceRef) errors.push(`${item.pr}: admission requires owner, invariantImpact, affectedTests, exact forkCommit, regressionEvidence, and provenanceRef`);
      else { try { sha(item.forkCommit, `${item.pr} forkCommit`); } catch (e) { errors.push(e.message); } }
      if (!item.sourceRead?.reviewedRefs?.some((ref) => ref.includes(`/blob/${item.sourceSha}/`))) errors.push(`${item.pr}: admission requires path-specific reviewed source refs pinned to its full source SHA`);
      for (const evidence of item.regressionEvidence ?? []) {
        if (!evidence?.path || !/^[0-9a-f]{64}$/.test(evidence.sha256 ?? "") || evidence.exitCode !== 0) errors.push(`${item.pr}: regression evidence needs a local path, SHA-256, and exit code 0`);
        else {
          const evidencePath = path.resolve(ROOT, evidence.path);
          if (!existsSync(evidencePath)) errors.push(`${item.pr}: regression evidence file is missing: ${evidence.path}`);
          else if (createHash("sha256").update(readFileSync(evidencePath)).digest("hex") !== evidence.sha256) errors.push(`${item.pr}: regression evidence SHA-256 mismatch: ${evidence.path}`);
        }
      }
      try { if (git(["rev-parse", "--verify", `${item.forkCommit}^{commit}`]) !== item.forkCommit) errors.push(`${item.pr}: forkCommit does not resolve exactly`); } catch { errors.push(`${item.pr}: forkCommit is not available as a local Git commit`); }
    }
    if (item.classification === "SECURITY / VULNERABILITY" && !["security_fast_path", "regression", "admitted", "rejected", "deferred"].includes(item.state)) errors.push(`${item.pr}: security item must enter prioritized fast path`);
    if (item.state === "security_fast_path" && item.priority !== "P0") errors.push(`${item.pr}: security fast path must be P0`);
    if (item.state === "admitted" && item.mergeUpstream === true) errors.push(`${item.pr}: wholesale upstream merge is prohibited`);
    if (item.readRefs?.some((ref) => typeof ref !== "string" || !ref.startsWith("https://github.com/paperclipai/paperclip/"))) errors.push(`${item.pr}: readRefs must be pinned upstream GitHub URLs`);
  }
  if (seen.size < 86) errors.push(`expected the 86 unique source commits pinned by §§7.3–7.20, found ${seen.size}`);
  try {
    const brief = readFileSync(path.join(ROOT, "doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md"), "utf8");
    const expected = new Set();
    for (const [start, end] of [["## 7.3", "## 7.16"], ["## 7.17", "## 7.18"], ["## 7.19", "## 7.20"], ["## 7.20", "## 7.P"]]) {
      const section = brief.slice(brief.indexOf(start), brief.indexOf(end));
      for (const line of section.split("\n")) {
        for (const match of line.matchAll(/\b([0-9a-f]{40})\b/g)) {
          const prs = [...line.slice(0, match.index).matchAll(/#(\d+)/g)];
          if (prs.length) expected.add(`#${prs.at(-1)[1]}:${match[1]}`);
        }
      }
    }
    const actual = new Set((ledger.changes ?? []).map((item) => `${item.pr}:${item.sourceSha}`));
    if (expected.size !== 86 || expected.size !== actual.size || [...expected].some((item) => !actual.has(item))) errors.push("source change set differs from exact PR/SHA records in §§7.3–7.20");
  } catch (error) { errors.push(`cannot verify pinned brief source set: ${error.message}`); }
  return errors;
}

function treeFromApi(file) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  if (payload.sha !== PIN || payload.truncated === true || !Array.isArray(payload.tree)) throw new Error(`upstream tree must be complete and pinned to ${PIN}`);
  const entries = payload.tree.filter((x) => x.type === "blob").map(({ path: p, mode, sha: objectSha, size }) => ({ path: p, mode, sha: objectSha, ...(size === undefined ? {} : { size }) }));
  if (entries.some((x) => !x.path || !/^[0-9a-f]{40}$/.test(x.sha ?? "") || !/^[0-7]{6}$/.test(x.mode ?? "")) || new Set(entries.map((x) => x.path)).size !== entries.length) throw new Error("upstream tree contains invalid or duplicate blob metadata");
  return entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
function treeFromGit(rev) {
  const raw = execFileSync("git", ["ls-tree", "-r", "-z", "--full-tree", rev], { cwd: ROOT, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  return raw.toString("utf8").split("\0").filter(Boolean).map((line) => {
    const [meta, p] = line.split("\t"); const [mode, type, objectSha] = meta.split(" ");
    if (type !== "blob") return null;
    return { path: p, mode, sha: objectSha };
  }).filter(Boolean).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}
function treeDigest(entries) { return createHash("sha256").update(entries.map(({ path: p, mode, sha }) => `${p}\0${mode}\0${sha}\n`).join("")).digest("hex"); }
function missingBlobCount(entries) {
  const result = execFileSync("git", ["cat-file", "--batch-check"], { cwd: ROOT, encoding: "utf8", input: entries.map((x) => `${x.sha}^{blob}\n`).join(""), maxBuffer: 64 * 1024 * 1024 });
  return result.split("\n").filter((line) => line.endsWith(" missing")).length;
}
export function compareTrees(left, right) {
  const a = new Map(left.map((x) => [x.path, x])); const b = new Map(right.map((x) => [x.path, x]));
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).flatMap((p) => !a.has(p) ? [{ path: p, change: "added", upstream: b.get(p) }] : !b.has(p) ? [{ path: p, change: "removed", fork: a.get(p) }] : a.get(p).sha !== b.get(p).sha || a.get(p).mode !== b.get(p).mode ? [{ path: p, change: "changed", fork: a.get(p), upstream: b.get(p) }] : []);
}

function inventory(options) {
  if (options.base !== BASE) throw new Error(`base must be the pinned fork baseline ${BASE}`);
  const base = git(["rev-parse", `${BASE}^{commit}`]);
  const fork = git(["rev-parse", `${options.fork ?? "HEAD"}^{commit}`]);
  const upstreamSha = options.upstream ?? PIN;
  if (upstreamSha !== PIN) throw new Error(`upstream must be the pinned brief SHA ${PIN}; no latest-branch lookup or adoption is supported`);
  const upstream = options.tree ? treeFromApi(options.tree) : treeFromGit(upstreamSha);
  let upstreamTreeSha;
  if (options.tree) {
    if (!options.commit) throw new Error("--commit is required with --tree to preserve the pinned commit's root tree identity");
    const commit = JSON.parse(readFileSync(options.commit, "utf8"));
    if (commit.sha !== PIN || !/^[0-9a-f]{40}$/.test(commit.commit?.tree?.sha ?? "")) throw new Error("commit metadata must identify the pinned upstream SHA and a full root tree SHA");
    upstreamTreeSha = commit.commit.tree.sha;
  } else upstreamTreeSha = git(["rev-parse", `${upstreamSha}^{tree}`]);
  const forkBase = treeFromGit(base); const currentFork = treeFromGit(fork);
  const blobAvailability = missingBlobCount(upstream);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { upstreamRepository: "paperclipai/paperclip", upstreamSha, treeSha: upstreamTreeSha, forkRepository: (() => { try { return git(["config", "--get", "remote.origin.url"]); } catch { return "local checkout"; } })(), forkBaseSha: base, forkHeadSha: fork },
    inventory: {
      forkBase: { blobCount: forkBase.length, treeDigest: treeDigest(forkBase) },
      pinnedUpstream: { blobCount: upstream.length, treeDigest: treeDigest(upstream), blobContentsUnavailable: blobAvailability },
      forkHead: { blobCount: currentFork.length, treeDigest: treeDigest(currentFork) },
      forkBaseToPinnedUpstream: { counts: countChanges(compareTrees(forkBase, upstream)), changes: compareTrees(forkBase, upstream) },
      forkBaseToForkHead: { counts: countChanges(compareTrees(forkBase, currentFork)), changes: compareTrees(forkBase, currentFork) },
    },
    boundary: "Tree/path/blob-SHA inventory only. Missing blob contents are explicitly unavailable; no semantic source review, merge, adoption, or runtime qualification is inferred.",
  };
  const out = options.out ?? "-";
  const contents = `${JSON.stringify(report, null, 2)}\n`;
  if (out === "-") process.stdout.write(contents); else { const destination = path.resolve(ROOT, out); mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, contents); }
}
function countChanges(changes) { return changes.reduce((acc, item) => { acc[item.change]++; return acc; }, { added: 0, removed: 0, changed: 0 }); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    if (command === "validate") {
      const errors = validateLedger(loadLedger());
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("upstream intake ledger valid");
    } else if (command === "inventory") inventory(argsMap(argv));
    else throw new Error("usage: node scripts/upstream-intake.mjs validate | inventory --base <pinned-fork-sha> --upstream <pinned-upstream-sha> [--tree <GitHub-tree.json> --commit <GitHub-commit.json>] [--fork <sha>] [--out <path>]");
  } catch (error) { fail(error.message); }
}
