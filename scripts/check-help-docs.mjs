import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = [
  "help_article_id",
  "title",
  "audience",
  "product_capability_refs",
  "screen_contract_refs",
  "owner",
  "maturity",
  "applicable_product_versions",
  "locale",
  "last_verified_at",
  "review_trigger",
  "security_or_privacy_sensitive",
  "linked_source_files",
];
const MATURITIES = new Set(["internal", "experimental", "preview", "ga", "deprecated", "retired"]);

function parseAtom(raw) {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    if (value.length < 2 || !value.endsWith(quote) || value.slice(1, -1).includes(quote) || value.includes("\\"))
      throw new Error("Unsupported quoted frontmatter scalar");
    return value.slice(1, -1);
  }
  if (/^[!&*{|>]/.test(value)) throw new Error("Unsupported frontmatter scalar syntax");
  return value;
}

/**
 * Parse only this repository's restricted frontmatter subset: one `key: scalar`
 * per line or one-line `key: [scalar, scalar]`; quoted or unquoted scalar
 * items and literal true/false booleans. Nested maps, block scalars, multiline
 * lists, anchors, tags, and general YAML escaping are intentionally unsupported.
 */
export function parseRestrictedFrontmatter(markdown, filename = "<article>") {
  const source = markdown.replaceAll("\r\n", "\n");
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error(`${filename}: expected opening and closing --- frontmatter delimiters`);
  const result = {};
  for (const [index, line] of match[1].split("\n").entries()) {
    if (!line.trim()) continue;
    const field = line.match(/^([a-z][a-z0-9_]*):\s*(.*?)\s*$/);
    if (!field) throw new Error(`${filename}:${index + 2}: unsupported frontmatter syntax; use flat key: value lines`);
    const [, key, raw] = field;
    if (Object.hasOwn(result, key)) throw new Error(`${filename}: duplicate frontmatter field ${key}`);
    if (raw.startsWith("[")) {
      if (!raw.endsWith("]")) throw new Error(`${filename}:${index + 2}: malformed inline list for ${key}`);
      const inner = raw.slice(1, -1).trim();
      result[key] = inner ? inner.split(",").map(parseAtom) : [];
    } else {
      result[key] = raw === "true" ? true : raw === "false" ? false : parseAtom(raw);
    }
  }
  return { metadata: result, body: source.slice(match[0].length) };
}

function readScreenIds(root) {
  const ids = new Set();
  const coverageFile = path.join(root, "doc/experience/v9/coverage.json");
  if (fs.existsSync(coverageFile)) {
    const coverage = JSON.parse(fs.readFileSync(coverageFile, "utf8"));
    for (const screen of coverage.screens ?? []) if (typeof screen.screenId === "string") ids.add(screen.screenId);
  }
  const contractsDir = path.join(root, "doc/experience/v9/contracts");
  if (fs.existsSync(contractsDir)) {
    for (const name of fs.readdirSync(contractsDir).filter(file => file.endsWith(".json"))) {
      const contract = JSON.parse(fs.readFileSync(path.join(contractsDir, name), "utf8"));
      if (typeof contract.screenId === "string") ids.add(contract.screenId);
    }
  }
  // These Help contract refs are specified in the V10 brief; CompanyImport is
  // an existing native screen when its source page is present. Do not synthesize
  // broader screen IDs from article text.
  const briefPath = path.join(root, "doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md");
  if (fs.existsSync(briefPath)) {
    const brief = fs.readFileSync(briefPath, "utf8").replace(/\b(HELP-)(\d{2})\/(\d{2})\b/g, "$1$2 $1$3");
    for (const match of brief.matchAll(/\bHELP-\d{2}\b/g)) ids.add(match[0]);
  }
  if (fs.existsSync(path.join(root, "ui/src/pages/CompanyImport.tsx"))) ids.add("CompanyImport");
  return ids;
}

function readCapabilityIds(root) {
  const ids = new Set();
  const briefPath = path.join(root, "doc/reference/blentera-v10/Blentera_Master_Build_Brief_V10_FINAL_v4.0_2026-10-18.md");
  if (fs.existsSync(briefPath)) {
    const brief = fs.readFileSync(briefPath, "utf8").replace(/\b(HELP-)(\d{2})\/(\d{2})\b/g, "$1$2 $1$3");
    for (const match of brief.matchAll(/\b(?:HELP-\d{2}|V10-\d{3})\b/g)) ids.add(match[0]);
  }
  return ids;
}

function docsForHelpTab(root) {
  const docsFile = path.join(root, "docs/docs.json");
  const docsConfig = JSON.parse(fs.readFileSync(docsFile, "utf8"));
  const tabs = docsConfig.navigation?.tabs?.filter(tab => tab.tab === "Help Center") ?? [];
  if (tabs.length !== 1) throw new Error("docs/docs.json: expected exactly one Help Center tab");
  const pages = tabs[0].groups?.flatMap(group => group.pages ?? []) ?? [];
  if (!pages.length) throw new Error("docs/docs.json: Help Center tab must list at least one article");
  return pages.map(page => {
    if (typeof page !== "string" || page.startsWith("/") || page.includes("..")) {
      throw new Error(`docs/docs.json: invalid local Help Center page ${String(page)}`);
    }
    const candidates = [path.join(root, "docs", `${page}.md`), path.join(root, "docs", page, "index.md")];
    const filename = candidates.find(candidate => fs.existsSync(candidate));
    if (!filename) throw new Error(`docs/docs.json: Help Center page does not exist: ${page}`);
    return { page, filename };
  });
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validateMetadata(metadata, filename, { today, screenIds, capabilityIds }) {
  const errors = [];
  for (const key of REQUIRED) if (!Object.hasOwn(metadata, key)) errors.push(`${filename}: missing required field ${key}`);
  for (const key of ["help_article_id", "title", "audience", "owner", "review_trigger"]) {
    if (Object.hasOwn(metadata, key) && (typeof metadata[key] !== "string" || !metadata[key].trim())) {
      errors.push(`${filename}: ${key} must be a non-empty scalar string`);
    }
  }
  if (typeof metadata.help_article_id === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.help_article_id)) {
    errors.push(`${filename}: help_article_id must be a lowercase hyphenated identifier`);
  }
  for (const key of ["product_capability_refs", "screen_contract_refs", "applicable_product_versions"]) {
    if (!Array.isArray(metadata[key]) || metadata[key].some(value => typeof value !== "string" || !value.trim())) {
      errors.push(`${filename}: ${key} must be an inline list of non-empty strings`);
      continue;
    }
    if (key === "screen_contract_refs" && screenIds.size) {
      for (const id of metadata[key]) if (!screenIds.has(id)) errors.push(`${filename}: unknown screen_contract_ref ${id}`);
    }
    if (key === "product_capability_refs" && capabilityIds.size) {
      for (const id of metadata[key]) if (!capabilityIds.has(id)) errors.push(`${filename}: unknown product_capability_ref ${id}`);
    }
  }
  if (!Array.isArray(metadata.linked_source_files) || metadata.linked_source_files.some(value =>
    typeof value !== "string" || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/.test(value))) {
    errors.push(`${filename}: linked_source_files must be an inline list of repository-relative source paths`);
  }
  if (Object.hasOwn(metadata, "maturity") && !MATURITIES.has(metadata.maturity)) {
    errors.push(`${filename}: maturity must be one of ${[...MATURITIES].join(", ")}`);
  }
  if (Object.hasOwn(metadata, "locale") && (typeof metadata.locale !== "string" || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(metadata.locale))) {
    errors.push(`${filename}: locale must use a language or language-region tag`);
  }
  if (!validIsoDate(metadata.last_verified_at)) errors.push(`${filename}: last_verified_at must be a real ISO date (YYYY-MM-DD)`);
  else if (metadata.last_verified_at > today) errors.push(`${filename}: last_verified_at cannot be in the future`);
  if (typeof metadata.security_or_privacy_sensitive !== "boolean") {
    errors.push(`${filename}: security_or_privacy_sensitive must be true or false`);
  }
  return errors;
}

function markdownLinks(body) {
  const withoutCode = body.replace(/^```[\s\S]*?^```\s*$/gm, "");
  const matches = [];
  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) matches.push(match[1]);
  return matches;
}

function resolveLocalMarkdownTarget(root, sourceFile, rawTarget) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(rawTarget)) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]); }
  catch { return `invalid encoded target ${rawTarget}`; }
  if (!decoded) return null;
  const docsRoot = path.resolve(root, "docs");
  const resolved = path.resolve(rawTarget.startsWith("/") ? docsRoot : path.dirname(sourceFile), decoded.replace(/^\//, ""));
  if (resolved !== docsRoot && !resolved.startsWith(`${docsRoot}${path.sep}`)) return `target escapes docs root: ${rawTarget}`;
  const candidates = path.extname(resolved) ? [resolved] : [`${resolved}.md`, path.join(resolved, "index.md")];
  return candidates.some(candidate => fs.existsSync(candidate)) ? null : `missing local link target ${rawTarget}`;
}

export function validateHelpDocs({ root = process.cwd(), now = new Date() } = {}) {
  const errors = [];
  const pages = docsForHelpTab(root);
  const today = now.toISOString().slice(0, 10);
  const screenIds = readScreenIds(root);
  const capabilityIds = readCapabilityIds(root);
  const seenIds = new Map();
  for (const { page, filename } of pages) {
    const relative = path.relative(root, filename);
    let parsed;
    try { parsed = parseRestrictedFrontmatter(fs.readFileSync(filename, "utf8"), relative); }
    catch (error) { errors.push(error.message); continue; }
    errors.push(...validateMetadata(parsed.metadata, relative, { today, screenIds, capabilityIds }));
    if (Array.isArray(parsed.metadata.linked_source_files)) {
      const seenSources = new Set();
      for (const source of parsed.metadata.linked_source_files) {
        if (seenSources.has(source)) errors.push(`${relative}: duplicate linked source file ${source}`);
        seenSources.add(source);
        const filename = path.resolve(root, source);
        if (!filename.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
          errors.push(`${relative}: linked source file does not exist: ${source}`);
        }
      }
    }
    const prior = seenIds.get(parsed.metadata.help_article_id);
    if (prior) errors.push(`${relative}: duplicate help_article_id ${parsed.metadata.help_article_id} (also ${prior})`);
    else if (typeof parsed.metadata.help_article_id === "string") seenIds.set(parsed.metadata.help_article_id, relative);
    for (const target of markdownLinks(parsed.body)) {
      const error = resolveLocalMarkdownTarget(root, filename, target);
      if (error) errors.push(`${relative}: ${error}`);
    }
    if (!page) errors.push(`${relative}: navigation page is empty`);
  }
  return errors;
}

export function readHelpArticleSources(root = process.cwd()) {
  return docsForHelpTab(root).map(({ filename }) => {
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const { metadata } = parseRestrictedFrontmatter(fs.readFileSync(filename, "utf8"), relative);
    return { articleId: metadata.help_article_id, filename: relative, sourceFiles: metadata.linked_source_files };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = validateHelpDocs();
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
    } else {
      console.log("Help Center docs metadata, registry references, navigation, and local links are valid.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
