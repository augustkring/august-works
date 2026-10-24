import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRestrictedFrontmatter, validateHelpDocs } from "../../scripts/check-help-docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checkOnly = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check") || process.argv.slice(2).length > 1) {
  throw new Error("Usage: node server/scripts/generate-company-search-help.mjs [--check]");
}
const MAX_ARTICLE_BODY_CHARS = 20_000;
const errors = validateHelpDocs({ root });
if (errors.length) throw new Error(errors.join("\n"));
const config = JSON.parse(fs.readFileSync(path.join(root, "docs/docs.json"), "utf8"));
const pages = config.navigation.tabs.find((tab) => tab.tab === "Help Center").groups.flatMap((group) => group.pages);
const entries = pages.flatMap((slug) => {
  const filename = [path.join(root, "docs", `${slug}.md`), path.join(root, "docs", slug, "index.md")].find(fs.existsSync);
  if (!filename) return [];
  const parsed = parseRestrictedFrontmatter(fs.readFileSync(filename, "utf8"), slug);
  const metadata = parsed.metadata;
  if (!metadata.applicable_product_versions.includes("V10") || !["preview", "ga"].includes(metadata.maturity)) return [];
  const body = parsed.body
    .replace(/^```[^\n]*\n|^```\s*$/gm, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/[*_~`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (body.length > MAX_ARTICLE_BODY_CHARS) {
    throw new Error(`${slug}: normalized Help article body exceeds ${MAX_ARTICLE_BODY_CHARS} characters`);
  }
  return [{
    articleId: metadata.help_article_id,
    slug,
    title: metadata.title,
    summary: (typeof metadata.summary === "string" ? metadata.summary : body.slice(0, 400)).slice(0, 400),
    body,
    audience: metadata.audience,
    maturity: metadata.maturity,
    applicableProductVersions: metadata.applicable_product_versions,
    locale: metadata.locale,
    lastVerifiedAt: metadata.last_verified_at,
  }];
});
if (entries.length > 100) throw new Error("Help search projection is bounded to 100 V10 preview/GA articles");
const output = `// Generated from the checked Help Center navigation and article frontmatter.\nexport type CompanySearchHelpArticle = {\n  articleId: string; slug: string; title: string; summary: string; body: string; audience: string;\n  maturity: "preview" | "ga"; applicableProductVersions: string[]; locale: string; lastVerifiedAt: string;\n};\nexport const COMPANY_SEARCH_HELP_ARTICLES: readonly CompanySearchHelpArticle[] = ${JSON.stringify(entries, null, 2)};\n`;
const target = path.join(root, "server/src/services/company-search-help.generated.ts");
if (checkOnly) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== output) {
    throw new Error("Generated Help search catalog is stale; run `pnpm --filter @paperclipai/server generate:company-search-help`");
  }
} else {
  fs.writeFileSync(target, output);
}
