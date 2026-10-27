import { authorizationService, issueReadSqlCondition, projectReadSqlCondition, type AuthorizationActor } from "./authorization.js";
import { externalConversationStateSql } from "./slack-conversation-state.js";
import { and, desc, eq, gte, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  assets,
  companies,
  documents,
  issueAttachments,
  issueDocuments,
  issueWorkProducts,
  issues,
  projects,
} from "@paperclipai/db";
import {
  COMPANY_SEARCH_MAX_LIMIT,
  COMPANY_SEARCH_MAX_OFFSET,
  COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS,
  COMPANY_ARTIFACTS_MAX_LIMIT,
  COMPANY_ARTIFACTS_MAX_QUERY_LENGTH,
  APP_STORE_DEFINITIONS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  SYSTEM_ISSUE_DOCUMENT_KEYS,
  type CompanyArtifact,
  type CompanySearchArtifactSummary,
  type CompanySearchCountType,
  type CompanySearchFederatedDomain,
  type CompanySearchFederatedResult,
  type CompanySearchFederation,
  type CompanySearchFilterOptionCounts,
  type CompanySearchIssueFilterKey,
  type CompanySearchIssueSummary,
  type CompanySearchQuery,
  type CompanySearchResponse,
  type CompanySearchResult,
  type CompanySearchScope,
  type CompanySearchSnippet,
  type CompanySearchSort,
  type CompanySearchUpdatedWithinOption,
  PRODUCT_IDENTITY,
  isMemoryConnectorId,
} from "@paperclipai/shared";
import { companyArtifactsService } from "./company-artifacts.js";
import { companySearchExtractService } from "./company-search-extract.js";
import { routineService } from "./routines.js";
import { workflowService } from "./workflows/workflow-service.js";
import { pipelineService } from "./pipelines.js";
import { companySkillService } from "./company-skills.js";
import { foundationService } from "./foundation/foundation-service.js";
import { agentPackageService } from "./agent-packages/package-service.js";
import { accessService } from "./access.js";
import { decisionSearchService } from "./decisions.js";
import { processFindingService } from "./process-findings.js";
import { businessMetricService } from "./business-metrics/service.js";
import { businessForecastService } from "./business-forecasting/service.js";
import { businessScenarioService } from "./business-scenarios/service.js";
import { businessExperimentService } from "./business-experiments/service.js";
import { managementReviewService } from "./management-reviews/service.js";
import { aiConnectionService } from "./ai-connections.js";
import { instanceSettingsService } from "./instance-settings.js";
import { v7FeatureEnabled, v8FeatureEnabled } from "@paperclipai/shared";
import { visibleIssueCondition } from "./issue-visibility.js";
import { parseTaskSearch, taskSearchCtes, taskSearchScore, taskSearchFieldMatch, taskSearchTermMatch } from "./task-search.js";
import { COMPANY_SEARCH_HELP_ARTICLES } from "./company-search-help.generated.js";

const SNIPPET_MAX_CHARS = 240;
export const COMPANY_SEARCH_BRANCH_FETCH_LIMIT = COMPANY_SEARCH_MAX_OFFSET + COMPANY_SEARCH_MAX_LIMIT + 1;

type IssueSearchRow = {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
  score: number | string;
  matchedFields: string[] | null;
  commentSnippet: string | null;
  commentId: string | null;
  documentSnippet: string | null;
  documentTitle: string | null;
  documentKey: string | null;
};

type SimpleSearchRow = {
  id: string;
  title: string;
  description: string | null;
  role?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SearchResultWithSort = CompanySearchResult & {
  sortCreatedAt: string | null;
  sortPriorityRank: number;
};

type SearchAggregateRow = {
  kind: string;
  value: string | null;
  count: number | string;
};

function sqlTextArray(values: string[]) {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function sqlUuidArray(values: string[]) {
  if (values.length === 0) return sql`ARRAY[]::uuid[]`;
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::uuid[]`;
}

function noMatchSql() {
  return sql<boolean>`false`;
}

function plainText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\s)[#>*_~|]+|[#>*_~|]+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/;

function extractFirstImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = MARKDOWN_IMAGE_PATTERN.exec(value);
  return match ? match[1] : null;
}

function findFirstMatchIndex(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  let best = -1;
  for (const term of terms) {
    if (term.length === 0) continue;
    const index = lower.indexOf(term.toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function highlightRanges(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (normalized.length === 0) continue;
    let index = lower.indexOf(normalized);
    while (index >= 0) {
      const next = { start: index, end: index + normalized.length };
      const overlaps = ranges.some((range) => next.start < range.end && next.end > range.start);
      if (!overlaps) ranges.push(next);
      index = lower.indexOf(normalized, index + normalized.length);
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

function createSnippet(field: string, label: string, source: string | null | undefined, terms: string[]): CompanySearchSnippet | null {
  const text = plainText(source);
  if (!text) return null;
  const firstMatch = findFirstMatchIndex(text, terms);
  const windowStart = firstMatch < 0 ? 0 : Math.max(0, firstMatch - 80);
  const windowEnd = Math.min(text.length, windowStart + SNIPPET_MAX_CHARS);
  const prefix = windowStart > 0 ? "..." : "";
  const suffix = windowEnd < text.length ? "..." : "";
  const slice = text.slice(windowStart, windowEnd).trim();
  const snippetText = `${prefix}${slice}${suffix}`;
  const offset = prefix.length - windowStart;
  return {
    field,
    label,
    text: snippetText,
    highlights: highlightRanges(text, terms)
      .filter((range) => range.end > windowStart && range.start < windowEnd)
      .map((range) => ({
        start: Math.max(0, range.start + offset),
        end: Math.min(snippetText.length, range.end + offset),
      })),
  };
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function routePrefix(issuePrefix: string | null | undefined) {
  return issuePrefix?.trim() || "company";
}

function issueHref(prefix: string, issue: { id: string; identifier: string | null }, suffix = "") {
  return `/${prefix}/issues/${encodeURIComponent(issue.identifier ?? issue.id)}${suffix}`;
}

function matchTerms(normalizedQuery: string, tokens: string[]) {
  return [normalizedQuery, ...tokens].filter((term, index, terms) => term.length > 0 && terms.indexOf(term) === index);
}

function emptySearchCounts(): Record<CompanySearchCountType, number> {
  return { issue: 0, comment: 0, document: 0, artifact: 0, agent: 0, project: 0, help: 0 };
}

export function companySearchHelpHref(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9/-]*$/.test(slug) || slug.split("/").some((part) => part === "." || part === "..")) return null;
  const url = new URL(`/${slug}`, PRODUCT_IDENTITY.docsOrigin);
  return url.origin === PRODUCT_IDENTITY.docsOrigin ? url.toString() : null;
}

function emptyFilterOptionCounts(): CompanySearchFilterOptionCounts {
  return {
    status: {},
    priority: {},
    assigneeAgentId: {},
    assigneeUserId: {},
    projectId: {},
    labelId: {},
    updatedWithin: {},
  };
}

function priorityRank(priority: string | null | undefined) {
  const index = (ISSUE_PRIORITIES as readonly string[]).indexOf(priority ?? "");
  return index >= 0 ? index : ISSUE_PRIORITIES.length;
}

function updatedWithinStart(value: string | undefined, now = new Date()): Date | null {
  if (!value) return null;
  const match = /^(\d+)(h|d|w|m)$/.exec(value);
  if (!match) return null;
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2];
  const hours = unit === "h" ? amount : unit === "d" ? amount * 24 : unit === "w" ? amount * 24 * 7 : amount * 24 * 30;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function issueOnlyFiltersActive(query: CompanySearchQuery) {
  return query.status.length > 0
    || query.priority.length > 0
    || query.assigneeAgentId !== undefined
    || Boolean(query.assigneeUserId)
    || Boolean(query.projectId)
    || Boolean(query.labelId)
    || Boolean(query.updatedWithin)
    || Boolean(query.updatedAfter);
}

function activeIssueFilters(query: CompanySearchQuery): Array<{ key: CompanySearchIssueFilterKey; values: string[] }> {
  const filters: Array<{ key: CompanySearchIssueFilterKey; values: string[] }> = [];
  if (query.status.length > 0) filters.push({ key: "status", values: query.status });
  if (query.assigneeAgentId !== undefined) filters.push({ key: "assigneeAgentId", values: [query.assigneeAgentId ?? "null"] });
  if (query.assigneeUserId) filters.push({ key: "assigneeUserId", values: [query.assigneeUserId] });
  if (query.projectId) filters.push({ key: "projectId", values: [query.projectId] });
  if (query.labelId) filters.push({ key: "labelId", values: [query.labelId] });
  if (query.priority.length > 0) filters.push({ key: "priority", values: query.priority });
  if (query.updatedWithin) filters.push({ key: "updatedWithin", values: [query.updatedWithin] });
  if (query.updatedAfter) filters.push({ key: "updatedAfter", values: [query.updatedAfter] });
  return filters;
}

function queryWithoutFilter(query: CompanySearchQuery, key: CompanySearchIssueFilterKey): CompanySearchQuery {
  return {
    ...query,
    status: key === "status" ? [] : query.status,
    priority: key === "priority" ? [] : query.priority,
    assigneeAgentId: key === "assigneeAgentId" ? undefined : query.assigneeAgentId,
    assigneeUserId: key === "assigneeUserId" ? undefined : query.assigneeUserId,
    projectId: key === "projectId" ? undefined : query.projectId,
    labelId: key === "labelId" ? undefined : query.labelId,
    updatedWithin: key === "updatedWithin" ? undefined : query.updatedWithin,
    updatedAfter: key === "updatedAfter" ? undefined : query.updatedAfter,
  };
}

function queryWithoutIssueFilters(query: CompanySearchQuery): CompanySearchQuery {
  return {
    ...query,
    status: [],
    priority: [],
    assigneeAgentId: undefined,
    assigneeUserId: undefined,
    projectId: undefined,
    labelId: undefined,
    updatedWithin: undefined,
    updatedAfter: undefined,
  };
}

function issueFilterConditions(companyId: string, query: CompanySearchQuery, omit?: CompanySearchIssueFilterKey): SQL[] {
  const conditions: SQL[] = [];
  if (omit !== "status" && query.status.length > 0) {
    conditions.push(query.status.length === 1 ? eq(issues.status, query.status[0]!) : inArray(issues.status, query.status));
  }
  if (omit !== "priority" && query.priority.length > 0) {
    conditions.push(query.priority.length === 1 ? eq(issues.priority, query.priority[0]!) : inArray(issues.priority, query.priority));
  }
  if (omit !== "assigneeAgentId" && query.assigneeAgentId !== undefined) {
    conditions.push(query.assigneeAgentId === null ? isNull(issues.assigneeAgentId) : eq(issues.assigneeAgentId, query.assigneeAgentId));
  }
  if (omit !== "assigneeUserId" && query.assigneeUserId) {
    conditions.push(eq(issues.assigneeUserId, query.assigneeUserId));
  }
  if (omit !== "projectId" && query.projectId) conditions.push(eq(issues.projectId, query.projectId));
  if (omit !== "labelId" && query.labelId) {
    conditions.push(sql<boolean>`
      EXISTS (
        SELECT 1
        FROM issue_labels search_filter_labels
        WHERE search_filter_labels.company_id = ${companyId}
          AND search_filter_labels.issue_id = ${issues.id}
          AND search_filter_labels.label_id = ${query.labelId}
      )
    `);
  }
  if (omit !== "updatedWithin") {
    const updatedWithin = updatedWithinStart(query.updatedWithin);
    if (updatedWithin) conditions.push(gte(issues.updatedAt, updatedWithin));
  }
  if (omit !== "updatedAfter" && query.updatedAfter) {
    conditions.push(gte(issues.updatedAt, new Date(query.updatedAfter)));
  }
  return conditions;
}

// Facet conditions expressed against the `m` alias of the aggregate
// matched-issues CTE (plain columns, no drizzle table references).
function matchedFacetConditions(companyId: string, query: CompanySearchQuery, omit?: CompanySearchIssueFilterKey): SQL[] {
  const conditions: SQL[] = [];
  if (omit !== "status" && query.status.length > 0) {
    conditions.push(sql`m.status = ANY(${sqlTextArray(query.status)})`);
  }
  if (omit !== "priority" && query.priority.length > 0) {
    conditions.push(sql`m.priority = ANY(${sqlTextArray(query.priority)})`);
  }
  if (omit !== "assigneeAgentId" && query.assigneeAgentId !== undefined) {
    conditions.push(query.assigneeAgentId === null
      ? sql`m.assignee_agent_id IS NULL`
      : sql`m.assignee_agent_id = ${query.assigneeAgentId}`);
  }
  if (omit !== "assigneeUserId" && query.assigneeUserId) {
    conditions.push(sql`m.assignee_user_id = ${query.assigneeUserId}`);
  }
  if (omit !== "projectId" && query.projectId) {
    conditions.push(sql`m.project_id = ${query.projectId}`);
  }
  if (omit !== "labelId" && query.labelId) {
    conditions.push(sql`
      EXISTS (
        SELECT 1
        FROM issue_labels facet_filter_labels
        WHERE facet_filter_labels.company_id = ${companyId}
          AND facet_filter_labels.issue_id = m.id
          AND facet_filter_labels.label_id = ${query.labelId}
      )
    `);
  }
  if (omit !== "updatedWithin") {
    const updatedWithin = updatedWithinStart(query.updatedWithin);
    // ISO strings: raw sql params bypass drizzle's column-level Date mapping.
    if (updatedWithin) conditions.push(sql`m.updated_at >= ${updatedWithin.toISOString()}::timestamptz`);
  }
  if (omit !== "updatedAfter" && query.updatedAfter) {
    conditions.push(sql`m.updated_at >= ${new Date(query.updatedAfter).toISOString()}::timestamptz`);
  }
  return conditions;
}

function stripInternalSortFields(result: SearchResultWithSort): CompanySearchResult {
  const { sortCreatedAt: _sortCreatedAt, sortPriorityRank: _sortPriorityRank, ...publicResult } = result;
  return publicResult;
}

function compareSearchResults(sort: CompanySearchSort) {
  return (left: SearchResultWithSort, right: SearchResultWithSort) => {
    if (sort === "updated") {
      const updated = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      if (updated !== 0) return updated;
      if (right.score !== left.score) return right.score - left.score;
    } else if (sort === "created") {
      const created = (right.sortCreatedAt ?? "").localeCompare(left.sortCreatedAt ?? "");
      if (created !== 0) return created;
      const updated = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      if (updated !== 0) return updated;
    } else if (sort === "priority") {
      const priority = left.sortPriorityRank - right.sortPriorityRank;
      if (priority !== 0) return priority;
      const updated = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      if (updated !== 0) return updated;
      if (right.score !== left.score) return right.score - left.score;
    } else {
      if (right.score !== left.score) return right.score - left.score;
      const updated = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
      if (updated !== 0) return updated;
    }
    return right.id.localeCompare(left.id);
  };
}

function scopeIncludesIssues(scope: CompanySearchScope) {
  return scope === "all" || scope === "issues" || scope === "comments" || scope === "documents";
}

function scopeIncludesAgents(scope: CompanySearchScope) {
  return scope === "all" || scope === "agents";
}

function scopeIncludesArtifacts(scope: CompanySearchScope) {
  return scope === "all" || scope === "artifacts";
}

function scopeIncludesProjects(scope: CompanySearchScope) {
  return scope === "all" || scope === "projects";
}

function scopeIncludesHelp(scope: CompanySearchScope) {
  return scope === "all" || scope === "help";
}

function selectPrimarySnippets(row: IssueSearchRow, normalizedQuery: string, tokens: string[]) {
  const terms = matchTerms(normalizedQuery, tokens);
  const identifierQuery = parseTaskSearch(normalizedQuery).identifierQuery;
  if (!terms.includes(identifierQuery)) terms.push(identifierQuery);
  const matchedFields = new Set(row.matchedFields ?? []);
  const candidates: Array<CompanySearchSnippet | null> = [];
  if (matchedFields.has("identifier")) {
    candidates.push(createSnippet("identifier", "Identifier", row.identifier, terms));
  }
  if (matchedFields.has("title")) {
    candidates.push(createSnippet("title", "Title", row.title, terms));
  }
  const description = matchedFields.has("description")
    ? createSnippet("description", "Description", row.description, terms) : null;
  const directMatch = Number(row.score) >= 3000 || Number(row.score) < 2000;
  if (directMatch) candidates.push(description);
  const context = [
    { field: "comment", label: "Comment", text: row.commentSnippet },
    { field: "document", label: row.documentTitle || "Document", text: [row.documentTitle, row.documentSnippet].filter(Boolean).join(" ") },
  ].filter((source) => matchedFields.has(source.field));
  const coverage = (text: string | null) => tokens.filter((term) => (text ?? "").toLowerCase().includes(term)).length;
  context.sort((left, right) => coverage(right.text) - coverage(left.text));
  const contextSnippets = context.map((source) => createSnippet(source.field, source.label, source.text, terms));
  // The title and identifier are already visible in the row. For thread-only
  // coverage, preserve the evidence before applying the two-snippet limit.
  if (directMatch) candidates.push(...contextSnippets);
  else candidates.unshift(...contextSnippets);
  if (!directMatch) candidates.push(description);
  return candidates.filter((snippet): snippet is CompanySearchSnippet => Boolean(snippet)).slice(0, 2);
}

function issueResult(row: IssueSearchRow, prefix: string, normalizedQuery: string, tokens: string[]): CompanySearchResult {
  const snippets = selectPrimarySnippets(row, normalizedQuery, tokens);
  const sourceLabel = snippets[0]?.label ?? null;
  const documentSuffix = row.documentKey ? `#document-${encodeURIComponent(row.documentKey)}` : "";
  const commentSuffix = row.commentId ? `#comment-${encodeURIComponent(row.commentId)}` : "";
  // Direct task matches open the task; context matches open the evidence shown.
  const directMatch = Number(row.score) >= 3000 || Number(row.score) < 2000;
  const evidence = snippets.find((snippet) => snippet.field === "comment" || snippet.field === "document");
  const suffix = directMatch ? "" : evidence?.field === "comment" ? commentSuffix
    : evidence?.field === "document" ? documentSuffix : "";
  const issue: CompanySearchIssueSummary = {
    id: row.id,
    identifier: row.identifier,
    title: row.title,
    status: row.status as CompanySearchIssueSummary["status"],
    priority: row.priority as CompanySearchIssueSummary["priority"],
    assigneeAgentId: row.assigneeAgentId,
    assigneeUserId: row.assigneeUserId,
    projectId: row.projectId,
    updatedAt: iso(row.updatedAt)!,
  };
  const previewImageUrl =
    extractFirstImageUrl(row.description) ??
    extractFirstImageUrl(row.commentSnippet) ??
    extractFirstImageUrl(row.documentSnippet);
  return {
    id: row.id,
    type: "issue",
    score: Number(row.score),
    title: row.identifier ? `${row.identifier} ${row.title}` : row.title,
    href: issueHref(prefix, row, suffix),
    matchedFields: row.matchedFields ?? [],
    sourceLabel,
    snippet: snippets[0]?.text ?? null,
    snippets,
    issue,
    updatedAt: issue.updatedAt,
    previewImageUrl,
  };
}

function scoreSimpleRow(row: SimpleSearchRow, normalizedQuery: string, tokens: string[]) {
  const haystack = [row.title, row.description, row.role].filter(Boolean).join(" ").toLowerCase();
  let score = haystack.includes(normalizedQuery) ? 90 : 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 20;
  }
  if (row.title.toLowerCase().startsWith(normalizedQuery)) score += 80;
  // Keep other entity types on the same scale as the task relevance bands:
  // an exact agent/project name must still outrank a speculative task typo.
  return score * 10;
}

function matchesHelpArticleQuery(row: SimpleSearchRow, normalizedQuery: string, tokens: string[]) {
  const haystack = `${row.title} ${row.description ?? ""}`.toLowerCase();
  if (normalizedQuery.includes(" ") && haystack.includes(normalizedQuery)) return true;
  return tokens.length > 0 && tokens.every((token) => {
    const escaped = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = token.length >= 3 ? "[\\p{L}\\p{N}_]*" : "";
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}${suffix}(?=$|[^\\p{L}\\p{N}_])`, "u").test(haystack);
  });
}

function artifactResult(artifact: CompanyArtifact, normalizedQuery: string, tokens: string[]): CompanySearchResult {
  const terms = matchTerms(normalizedQuery, tokens);
  const snippet = createSnippet(
    "artifact",
    "Artifact",
    artifact.previewText ?? artifact.title,
    terms,
  );
  const summary: CompanySearchArtifactSummary = {
    id: artifact.id,
    source: artifact.source,
    mediaKind: artifact.mediaKind,
    issueId: artifact.issue.id,
    issueIdentifier: artifact.issue.identifier,
    issueTitle: artifact.issue.title,
    projectId: artifact.project?.id ?? null,
    projectName: artifact.project?.name ?? null,
    updatedAt: artifact.updatedAt,
  };
  const score = scoreSimpleRow({
    id: artifact.id,
    title: artifact.title,
    description: [artifact.previewText, artifact.issue.identifier, artifact.issue.title, artifact.project?.name]
      .filter(Boolean)
      .join(" "),
    createdAt: new Date(artifact.updatedAt),
    updatedAt: new Date(artifact.updatedAt),
  }, normalizedQuery, tokens);
  return {
    id: artifact.id,
    type: "artifact",
    score,
    title: artifact.title,
    href: artifact.href,
    matchedFields: ["artifact"],
    sourceLabel: snippet?.label ?? "Artifact",
    snippet: snippet?.text ?? artifact.previewText,
    snippets: snippet ? [snippet] : [],
    artifact: summary,
    updatedAt: artifact.updatedAt,
    previewImageUrl: artifact.mediaKind === "image" ? artifact.contentPath : null,
  };
}

function simpleTextCondition(fields: SQL[], containsPattern: string, tokenPatternArray: SQL) {
  const phraseConditions = fields.map((field) => sql<boolean>`coalesce(${field}, '') ILIKE ${containsPattern}`);
  const tokenConditions = fields.map((field) => sql<boolean>`coalesce(${field}, '') ILIKE ANY(${tokenPatternArray})`);
  return sql<boolean>`(${sql.join([...phraseConditions, ...tokenConditions], sql` OR `)})`;
}

export function companySearchBranchFetchLimit(limit: number, offset = 0) {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : COMPANY_SEARCH_MAX_LIMIT;
  const normalizedOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
  return Math.min(COMPANY_SEARCH_BRANCH_FETCH_LIMIT, normalizedOffset + normalizedLimit + 1);
}

const FEDERATED_RESULT_LIMIT = 8;
const FEDERATED_DOMAIN_ORDER: readonly CompanySearchFederatedDomain[] = [
  "routines", "workflows", "skills", "packages", "knowledge", "people", "apps", "insights", "settings", "navigation",
];

function federatedMatch(query: string, title: string, summary: string | null | undefined) {
  const normalized = query.trim().toLocaleLowerCase("en");
  if (!normalized) return null;
  const titleText = title.toLocaleLowerCase("en");
  const summaryText = (summary ?? "").toLocaleLowerCase("en");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const titleHit = titleText.includes(normalized) || tokens.every((token) => titleText.includes(token));
  const summaryHit = summaryText.includes(normalized) || tokens.every((token) => `${titleText} ${summaryText}`.includes(token));
  if (!titleHit && !summaryHit) return null;
  return {
    score: titleText.includes(normalized) ? 100 : titleHit ? 70 : 30,
    whyMatched: [titleHit ? "title" : null, summaryHit && !titleHit ? "summary" : null].filter((value): value is string => Boolean(value)),
  };
}

function makeFederatedResult(input: {
  companyId: string;
  domain: CompanySearchFederatedDomain;
  type: string;
  id: string;
  title: string;
  summary?: string | null;
  breadcrumb?: string | null;
  href: string;
  updatedAt?: Date | string | null;
  query: string;
}): CompanySearchFederatedResult | null {
  const match = federatedMatch(input.query, input.title, input.summary);
  if (!match) return null;
  const updatedAt = input.updatedAt ? iso(input.updatedAt) : null;
  const summary = input.summary?.trim() ?? "";
  let summaryExcerpt: string | null = null;
  if (summary) {
    if (summary.length <= 240) summaryExcerpt = summary;
    else {
      const lower = summary.toLocaleLowerCase("en");
      const firstMatch = input.query.trim().toLocaleLowerCase("en").split(/\s+/).filter(Boolean)
        .map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? 0;
      const start = Math.max(0, Math.min(firstMatch - 80, summary.length - 240));
      summaryExcerpt = `${start > 0 ? "…" : ""}${summary.slice(start, start + 240)}${start + 240 < summary.length ? "…" : ""}`;
    }
  }
  return {
    id: input.id,
    domain: input.domain,
    type: input.type,
    title: input.title.slice(0, 2000),
    summary: summaryExcerpt,
    breadcrumb: input.breadcrumb?.slice(0, 300) ?? null,
    canonicalRef: `${input.domain}:${input.companyId}:${input.type}:${input.id}`,
    href: input.href,
    updatedAt,
    score: match.score,
    whyMatched: match.whyMatched,
    action: { kind: "navigate", href: input.href },
  };
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const value = Number((error as { status?: unknown }).status);
  return Number.isInteger(value) ? value : null;
}

async function collectFederatedOwnerPages<T>(
  load: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
  project: (item: T) => CompanySearchFederatedResult | null,
) {
  const results: CompanySearchFederatedResult[] = [];
  let cursor: string | null | undefined;
  let partial = false;
  for (let pageNumber = 0; pageNumber < 5; pageNumber += 1) {
    const page = await load(cursor ?? undefined);
    results.push(...page.items.map(project).filter((item): item is CompanySearchFederatedResult => item !== null));
    cursor = page.nextCursor;
    if (results.length > FEDERATED_RESULT_LIMIT) {
      partial = true;
      break;
    }
    if (!cursor) break;
    if (pageNumber === 4) partial = true;
  }
  return { results: results.slice(0, FEDERATED_RESULT_LIMIT), partial };
}

async function federatedCompanySearch(db: Db, companyId: string, query: string, actor: AuthorizationActor): Promise<CompanySearchFederation> {
  const results: CompanySearchFederatedResult[] = [];
  const coverage: CompanySearchFederation["coverage"] = [];
  const countsByDomain: CompanySearchFederation["countsByDomain"] = {};
  const queryTokenCapped = query.trim().split(/\s+/).filter(Boolean).length > 8;
  type ExperimentalFlags = Awaited<ReturnType<ReturnType<typeof instanceSettingsService>["getExperimental"]>>;
  let flags: ExperimentalFlags | null = null;
  const flagsPromise = instanceSettingsService(db).getExperimental().then((value) => {
    flags = value;
  }).catch(() => {
    // Feature availability is part of search coverage. Keep other owners
    // searchable when settings itself is temporarily unavailable.
  });

  async function adapter(domain: CompanySearchFederatedDomain, run: () => Promise<{ results: Array<CompanySearchFederatedResult | null>; partial?: boolean }>) {
    try {
      const value = await run();
      const matched = value.results.filter((item): item is CompanySearchFederatedResult => item !== null);
      countsByDomain[domain] = Math.min(matched.length, FEDERATED_RESULT_LIMIT);
      results.push(...matched.slice(0, FEDERATED_RESULT_LIMIT));
      const partial = queryTokenCapped || value.partial === true || matched.length > FEDERATED_RESULT_LIMIT;
      coverage.push({
        domain,
        status: partial ? "partial" : "complete",
        message: partial ? `Some ${domain} results may be outside this bounded search page.` : null,
      });
    } catch (error) {
      // A domain the actor cannot read is not advertised as present. Operational
      // failures are visible to the caller so the UI cannot imply completeness.
      if ([401, 403, 404].includes(errorStatus(error) ?? 0)) return;
      coverage.push({ domain, status: "unavailable", message: `${domain} search is temporarily unavailable.` });
    }
  }

  const auth = authorizationService(db);
  const tasks: Array<Promise<void>> = [
    adapter("routines", async () => {
      const page = await routineService(db, { sourceActor: actor }).search(companyId, query, FEDERATED_RESULT_LIMIT + 1);
      return { partial: page.partial, results: page.items.map((item) => makeFederatedResult({
        companyId, domain: "routines", type: "routine", id: item.id, title: item.title,
        summary: item.description, breadcrumb: "Routines", href: `/routines/${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt, query,
      })) };
    }),
    adapter("skills", async () => {
      const page = await companySkillService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1);
      return { partial: page.partial, results: page.items.map((item) => makeFederatedResult({
        companyId, domain: "skills", type: "skill", id: item.id, title: item.name,
        summary: item.description ?? item.tagline, breadcrumb: "Skills and playbooks",
        href: `/skills/${encodeURIComponent(item.id)}`, updatedAt: item.updatedAt, query,
      })) };
    }),
  ];

  // Start independent owner searches while instance feature settings load.
  // Feature-gated adapters are appended after the settings result is known.
  await flagsPromise;
  const featureFlags = flags;
  tasks.push(
    adapter("workflows", async () => {
      if (!featureFlags) throw new Error("workflow feature settings unavailable");
      const pages = await Promise.all([
        featureFlags.enableWorkflowsV1 && featureFlags.enableWorkflowBuilderV1
          ? workflowService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1)
          : Promise.resolve({ items: [], partial: false }),
        featureFlags.enablePipelines
          ? pipelineService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1)
          : Promise.resolve({ items: [], partial: false }),
      ]);
      const [workflowPage, pipelinePage] = pages;
      return { partial: workflowPage.partial || pipelinePage.partial, results: [
        ...workflowPage.items.map((item) => makeFederatedResult({
          companyId, domain: "workflows", type: "workflow", id: item.id, title: item.name,
          summary: item.description, breadcrumb: "Workflows", href: `/workflows/${encodeURIComponent(item.id)}`,
          updatedAt: item.updatedAt, query,
        })),
        ...pipelinePage.items.map((item) => makeFederatedResult({
          companyId, domain: "workflows", type: "pipeline", id: item.id, title: item.name,
          summary: item.description, breadcrumb: "Pipelines", href: `/pipelines/${encodeURIComponent(item.id)}`,
          updatedAt: item.updatedAt, query,
        })),
      ] };
    }),
    adapter("knowledge", async () => {
      if (!featureFlags) throw new Error("Foundation feature settings unavailable");
      if (!featureFlags.enableFoundationV1) return { results: [] };
      const page = await foundationService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1);
      const matches = page.items.map((item) => makeFederatedResult({
        companyId, domain: "knowledge", type: "foundation", id: item.id,
        title: item.title || item.foundationKey, summary: item.canonicalRevision?.body ?? item.category,
        breadcrumb: `Company knowledge · ${item.category}`, href: `/foundation/${encodeURIComponent(item.id)}`,
        updatedAt: item.updatedAt, query,
      })).filter((item): item is CompanySearchFederatedResult => item !== null);
      return { partial: page.partial || matches.length > FEDERATED_RESULT_LIMIT, results: matches.slice(0, FEDERATED_RESULT_LIMIT + 1) };
    }),
  );
  if (actor.type === "board" && actor.source === "session" && actor.userId) {
    tasks.push(adapter("packages", async () => {
      if (!featureFlags) throw new Error("package feature settings unavailable");
      if (!v7FeatureEnabled(featureFlags, "agent_packages_v7")) return { results: [] };
      const items = await agentPackageService(db).catalog(actor, "customer");
      const matches = items.map((item) => makeFederatedResult({
        companyId, domain: "packages", type: "agent-package", id: item.id,
        title: item.name, summary: item.description, breadcrumb: "Agent packages",
        href: "/agents/packages", updatedAt: null, query,
      })).filter((item): item is CompanySearchFederatedResult => item !== null);
      return { partial: matches.length > FEDERATED_RESULT_LIMIT, results: matches.slice(0, FEDERATED_RESULT_LIMIT + 1) };
    }));
    tasks.push(adapter("people", async () => {
      const page = await accessService(db).searchMembers(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1);
      return { partial: page.partial, results: page.items.map((item) => makeFederatedResult({
        companyId, domain: "people", type: "person", id: item.id, title: item.name,
        summary: item.email, breadcrumb: "Company members", href: "/company/settings/members",
        updatedAt: item.updatedAt, query,
      })) };
    }));
  }

  const hasInsights = featureFlags !== null && ["business_metrics_v8", "business_forecasting_v8", "scenario_planning_v8", "business_experiments_v8", "management_reviews_v8", "process_intelligence_v8"]
    .some((feature) => v8FeatureEnabled(featureFlags, feature as Parameters<typeof v8FeatureEnabled>[1]));
  tasks.push(adapter("insights", async () => {
      const providers: Array<Promise<{ results: Array<CompanySearchFederatedResult | null>; partial?: boolean }>> = [
        decisionSearchService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1).then((decisionPage) => ({
          partial: decisionPage.partial,
          results: decisionPage.items.map((item) => makeFederatedResult({ companyId, domain: "insights", type: "decision", id: item.id,
            title: item.title, summary: item.body, breadcrumb: "Decisions", href: `/decisions?decisionId=${encodeURIComponent(item.id)}`,
            updatedAt: item.createdAt, query })),
        })),
      ];
      if (featureFlags && v8FeatureEnabled(featureFlags, "business_metrics_v8")) providers.push(collectFederatedOwnerPages(
        (cursor) => businessMetricService(db).list(companyId, actor, cursor),
        (item) => makeFederatedResult({ companyId, domain: "insights", type: "metric", id: item.id, title: item.key,
          breadcrumb: "Business metrics", href: `/business-metrics`, updatedAt: item.updatedAt, query }),
      ));
      if (featureFlags && v8FeatureEnabled(featureFlags, "business_forecasting_v8")) providers.push(collectFederatedOwnerPages(
        (cursor) => businessForecastService(db).list(companyId, actor, cursor),
        (item) => makeFederatedResult({ companyId, domain: "insights", type: "forecast", id: item.id, title: item.key,
          breadcrumb: "Forecasts", href: `/business-forecasts`, updatedAt: item.updatedAt, query }),
      ));
      if (featureFlags && v8FeatureEnabled(featureFlags, "scenario_planning_v8")) providers.push(collectFederatedOwnerPages(
        (cursor) => businessScenarioService(db).list(companyId, actor, cursor),
        ({ scenario }) => makeFederatedResult({ companyId, domain: "insights", type: "scenario", id: scenario.id, title: scenario.key,
          breadcrumb: "Scenarios", href: `/business-scenarios`, updatedAt: scenario.updatedAt, query }),
      ));
      if (featureFlags && v8FeatureEnabled(featureFlags, "business_experiments_v8")) providers.push(collectFederatedOwnerPages(
        (cursor) => businessExperimentService(db).list(companyId, actor, cursor),
        ({ experiment }) => makeFederatedResult({ companyId, domain: "insights", type: "experiment", id: experiment.id, title: experiment.key,
          breadcrumb: "Experiments", href: `/business-experiments`, updatedAt: experiment.updatedAt, query }),
      ));
      if (featureFlags && v8FeatureEnabled(featureFlags, "management_reviews_v8")) providers.push(collectFederatedOwnerPages(
        (cursor) => managementReviewService(db).controls(companyId, actor, cursor),
        (item) => makeFederatedResult({ companyId, domain: "insights", type: "review", id: item.id, title: `Management review ${item.status}`,
          breadcrumb: "Management reviews", href: `/management-reviews?reviewId=${encodeURIComponent(item.id)}&reviewCompanyId=${encodeURIComponent(companyId)}`,
          updatedAt: item.createdAt, query }),
      ));
      if (featureFlags && v8FeatureEnabled(featureFlags, "process_intelligence_v8")) providers.push(processFindingService(db).search(companyId, actor, query, FEDERATED_RESULT_LIMIT + 1).then((page) => ({
        partial: page.partial,
        results: page.items.map(({ finding, definitionId, runId }) => makeFederatedResult({ companyId, domain: "insights", type: "process-finding", id: finding.id,
          title: finding.findingType.replace(/_/g, " "), summary: `${finding.summary} ${finding.interpretation ?? ""}`, breadcrumb: "Process findings",
          href: `/process-intelligence?definitionId=${encodeURIComponent(definitionId)}&runId=${encodeURIComponent(runId)}`,
          updatedAt: finding.createdAt, query })),
      })));
      const settled = await Promise.allSettled(providers);
      const successful = settled.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
      const operationalFailure = settled.some((item) => item.status === "rejected" && ![401, 403, 404].includes(errorStatus(item.reason) ?? 0));
      if (!successful.length && operationalFailure) throw new Error("insight search failed");
      return {
        partial: !featureFlags || operationalFailure || successful.some((page) => page.partial),
        results: successful.flatMap((page) => page.results),
      };
    }));

  if (actor.type === "board" && actor.source === "session" && actor.userId) {
    tasks.push(adapter("apps", async () => {
      const decision = await auth.decide({ actor, action: "tools:use", resource: { type: "company", companyId } });
      if (!decision.allowed) throw Object.assign(new Error("Apps are unavailable"), { status: 403 });
      if (!featureFlags) throw new Error("app catalog feature settings unavailable");
      const [items, connections] = await Promise.all([
        Promise.resolve(APP_STORE_DEFINITIONS.filter((app) => featureFlags.enableMemoryConnectors || !isMemoryConnectorId(app.slug))),
        aiConnectionService(db).list(companyId, actor.userId!),
      ]);
      return { results: [
        ...items.map((item) => makeFederatedResult({
          companyId, domain: "apps", type: "app", id: item.slug, title: item.name,
          summary: item.description, breadcrumb: "App directory", href: "/apps", query,
        })),
        ...connections.map((item) => makeFederatedResult({
        companyId, domain: "apps", type: "connection", id: item.id, title: item.name,
        summary: item.accountLabel ?? null, breadcrumb: "Apps and connections", href: "/apps", query,
        })),
      ] };
    }));
  }

  const navigation: Array<{ domain: "settings" | "navigation"; type: string; id: string; title: string; href: string; action: Parameters<typeof auth.decide>[0]["action"]; flag?: boolean }> = [
    { domain: "settings", type: "setting", id: "company-settings", title: "Company settings", href: "/company/settings/general", action: "company_scope:read" },
    { domain: "settings", type: "setting", id: "people-access", title: "People and access", href: "/company/settings/members", action: "users:manage_permissions" },
    { domain: "navigation", type: "navigation", id: "apps", title: "Apps and connections", href: "/apps", action: "tools:use" },
    { domain: "navigation", type: "navigation", id: "workflows", title: "Workflows and pipelines", href: "/workflows", action: "workflows:read", flag: Boolean(featureFlags?.enableWorkflowsV1 && featureFlags.enableWorkflowBuilderV1) },
    { domain: "navigation", type: "navigation", id: "decisions", title: "Decisions", href: "/decisions", action: "decision_queue:read" },
    { domain: "navigation", type: "navigation", id: "insights", title: "Insights", href: "/insights", action: "decision_queue:read", flag: hasInsights },
    { domain: "navigation", type: "navigation", id: "process-intelligence", title: "Process intelligence", href: "/process-intelligence", action: "company_scope:read", flag: Boolean(featureFlags && v8FeatureEnabled(featureFlags, "process_intelligence_v8")) },
    { domain: "navigation", type: "navigation", id: "foundation", title: "Company knowledge", href: "/foundation", action: "company_scope:read", flag: Boolean(featureFlags?.enableFoundationV1) },
  ];
  for (const domain of ["settings", "navigation"] as const) {
    tasks.push(adapter(domain, async () => {
      if (domain === "navigation" && !featureFlags) throw new Error("navigation feature settings unavailable");
      const matched = await Promise.all(navigation.filter((item) => item.domain === domain && item.flag !== false).map(async (item) => {
        const decision = await auth.decide({ actor, action: item.action, resource: { type: "company", companyId } });
        return decision.allowed ? makeFederatedResult({
          companyId, domain: item.domain, type: item.type, id: item.id, title: item.title,
          breadcrumb: item.domain === "settings" ? "Settings" : "Navigation", href: item.href, query,
        }) : null;
      }));
      return { results: matched };
    }));
  }

  await Promise.all(tasks);
  results.sort((left, right) => right.score - left.score || (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || left.canonicalRef.localeCompare(right.canonicalRef));
  coverage.sort((left, right) => FEDERATED_DOMAIN_ORDER.indexOf(left.domain) - FEDERATED_DOMAIN_ORDER.indexOf(right.domain));
  return { results, countsByDomain, coverage, complete: coverage.every((item) => item.status === "complete") };
}

export function companySearchService(db: Db) {
  const extractService = companySearchExtractService(db);
  return {
    extract: extractService.extract,
    search: async (companyId: string, query: CompanySearchQuery,
      options: { issueReadCondition?: SQL<boolean>; projectReadCondition?: SQL<boolean>; actor?: AuthorizationActor } = {},
    ): Promise<CompanySearchResponse> => {
      const issueReadCondition = options.issueReadCondition ?? await issueReadSqlCondition(db, { type: "none" });
      const projectReadCondition = options.projectReadCondition ?? await projectReadSqlCondition(db, { type: "none" });
      const taskSearch = parseTaskSearch(query.q);
      const normalizedQuery = taskSearch.normalizedQuery;
      const hasSearchText = normalizedQuery.length > 0;
      const tokens = taskSearch.tokens;
      const scope = query.scope;
      const sort = query.sort;
      const limit = query.limit;
      const offset = query.offset;
      const hasIssueOnlyFilters = issueOnlyFiltersActive(query);
      const helpRows = hasSearchText && !hasIssueOnlyFilters && scopeIncludesHelp(scope)
        ? COMPANY_SEARCH_HELP_ARTICLES.flatMap((article) => {
          if (article.locale !== (query.locale ?? "en")) return [];
          const href = companySearchHelpHref(article.slug);
          if (!href) return [];
          const row: SimpleSearchRow = {
            id: article.articleId,
            title: article.title,
            description: `${article.summary} ${article.body}`,
            createdAt: new Date(`${article.lastVerifiedAt}T00:00:00.000Z`),
            updatedAt: new Date(`${article.lastVerifiedAt}T00:00:00.000Z`),
          };
          if (!matchesHelpArticleQuery(row, normalizedQuery, tokens)) return [];
          const score = scoreSimpleRow(row, normalizedQuery, tokens);
          if (score <= 0) return [];
          const terms = matchTerms(normalizedQuery, tokens);
          const snippet = createSnippet("help", "Help article", article.summary || article.body, terms);
          return [{
            ...row,
            href,
            score,
            snippet,
            article,
          }];
        })
        : [];
      if (!hasSearchText && !issueOnlyFiltersActive(query)) {
        return {
          query: query.q,
          normalizedQuery,
          scope,
          sort,
          limit,
          offset,
          results: [],
          countsByType: emptySearchCounts(),
          filterOptionCounts: emptyFilterOptionCounts(),
          zeroResults: null,
          hasMore: false,
        };
      }

      const fetchLimit = companySearchBranchFetchLimit(limit, offset);
      const tokenPatternArray = sqlTextArray(taskSearch.patterns);
      const containsPattern = hasSearchText && tokens.length > 0 ? taskSearch.containsPattern : "__paperclip_no_match__";
      const tokenCount = tokens.length;

      const issueFilters = issueFilterConditions(companyId, query);
      if (issueReadCondition) issueFilters.push(issueReadCondition);

      // Scope conditions over precomputed flag columns (alias-qualified).
      function flagTextMatch(alias: string) {
        return sql<boolean>`(${sql.raw(alias)}.issue_coverage = ${tokenCount}
          OR ${sql.raw(alias)}.ident_exact OR ${sql.raw(alias)}.ident_starts)`;
      }
      function flagFuzzyMatch(alias: string) {
        return sql<boolean>`${sql.raw(alias)}.fuzzy_title`;
      }
      function flagScopeCondition(alias: string, forScope: CompanySearchScope): SQL<boolean> {
        if (!hasSearchText) {
          return forScope === "comments" || forScope === "documents" ? noMatchSql() : sql<boolean>`true`;
        }
        if (forScope === "comments") return sql<boolean>`${sql.raw(alias)}.comment_match`;
        if (forScope === "documents") return sql<boolean>`${sql.raw(alias)}.document_match`;
        if (forScope === "issues") return sql<boolean>`(${flagTextMatch(alias)} OR ${flagFuzzyMatch(alias)})`;
        return sql<boolean>`true`;
      }

      // --- combined issue results + aggregates statement ---------------------
      // One statement computes everything issue-side: the comment/document
      // match sets and the matched-issues CTE (flags + per-token coverage) are
      // materialized once, then a UNION ALL fans out into the ranked result
      // page and every count (type counts, facet option counts, updated-within
      // buckets, and totals for zero-result recovery) as cheap aggregations.
      type IssueAggregates = {
        typeCounts: { issue: number; comment: number; document: number };
        filterOptionCounts: CompanySearchFilterOptionCounts;
        totals: { current: number; unfiltered: number; omit: Partial<Record<CompanySearchIssueFilterKey, number>> };
      };
      type IssueSearchData = { rows: IssueSearchRow[]; aggregates: IssueAggregates };

      async function fetchIssueSearchData(): Promise<IssueSearchData> {
        const filtersActive = activeIssueFilters(query);
        const scopeCond = flagScopeCondition("m", scope);
        const optionCond = scopeIncludesIssues(scope) ? scopeCond : flagScopeCondition("m", "all");
        const titleCond: SQL<boolean> = hasSearchText ? sql<boolean>`(${flagTextMatch("m")} OR ${flagFuzzyMatch("m")})` : sql<boolean>`true`;
        const facetsAll = matchedFacetConditions(companyId, query);
        const branchWhere = (conditions: SQL[]) =>
          conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
        // Count branches must match the result branch's column list; the
        // trailing NULLs pad the issue data columns.
        const countTail = sql`, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::double precision, NULL::text[]`;
        const branches: SQL[] = [];

        const wantResultRows = scopeIncludesIssues(scope)
          && !(!hasSearchText && (scope === "comments" || scope === "documents"));
        if (wantResultRows) {
          const scoreSql = taskSearchScore(taskSearch);
          const priorityOrderSql = sql`CASE m.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;
          const orderBySql = sort === "updated"
            ? sql`m.updated_at DESC, score DESC, m.id DESC`
            : sort === "created"
              ? sql`m.created_at DESC, m.updated_at DESC, m.id DESC`
              : sort === "priority"
                ? sql`${priorityOrderSql} ASC, m.updated_at DESC, score DESC, m.id DESC`
                : sql`score DESC, m.updated_at DESC, m.id DESC`;
          branches.push(sql`(
            SELECT
              'result'::text AS kind,
              NULL::text AS value,
              0 AS count,
              m.id,
              m.identifier,
              m.title,
              (SELECT issue_text.description FROM issues issue_text
                WHERE issue_text.id = m.id AND issue_text.company_id = ${companyId}) AS description,
              m.status,
              m.priority,
              m.assignee_agent_id AS "assigneeAgentId",
              m.assignee_user_id AS "assigneeUserId",
              m.project_id AS "projectId",
              m.created_at AS "createdAt",
              m.updated_at AS "updatedAt",
              ${scoreSql} AS score,
              array_remove(ARRAY[
                CASE WHEN m.ident_exact OR m.ident_starts OR m.ident_phrase OR m.ident_token THEN 'identifier' END,
                CASE WHEN m.title_token OR m.fuzzy_title THEN 'title' END,
                CASE WHEN m.desc_token THEN 'description' END,
                CASE WHEN m.comment_match THEN 'comment' END,
                CASE WHEN m.document_match THEN 'document' END
              ], NULL)::text[] AS "matchedFields"
            FROM matched m
            ${branchWhere([...facetsAll, scopeCond])}
            ORDER BY ${orderBySql}
            LIMIT ${fetchLimit}
          )`);
        }

        if (scope === "all" || scope === "issues") {
          branches.push(sql`SELECT 'type:issue' AS kind, NULL::text AS value, count(*)::int AS count ${countTail} FROM matched m ${branchWhere([...facetsAll, titleCond])}`);
        }
        if (hasSearchText && (scope === "all" || scope === "comments")) {
          branches.push(sql`SELECT 'type:comment' AS kind, NULL::text AS value, count(*)::int AS count ${countTail} FROM matched m ${branchWhere([...facetsAll, flagScopeCondition("m", "comments")])}`);
        }
        if (hasSearchText && (scope === "all" || scope === "documents")) {
          branches.push(sql`SELECT 'type:document' AS kind, NULL::text AS value, count(*)::int AS count ${countTail} FROM matched m ${branchWhere([...facetsAll, flagScopeCondition("m", "documents")])}`);
        }

        const facetBranch = (kind: string, valueSql: SQL, omit: CompanySearchIssueFilterKey, extra: SQL[] = []) => sql`
          SELECT ${kind}::text AS kind, ${valueSql}::text AS value, count(*)::int AS count ${countTail}
          FROM matched m
          ${branchWhere([optionCond, ...matchedFacetConditions(companyId, query, omit), ...extra])}
          GROUP BY 2
        `;
        branches.push(facetBranch("facet:status", sql`m.status`, "status"));
        branches.push(facetBranch("facet:priority", sql`m.priority`, "priority"));
        branches.push(facetBranch("facet:assigneeAgentId", sql`m.assignee_agent_id`, "assigneeAgentId", [sql`m.assignee_agent_id IS NOT NULL`]));
        branches.push(facetBranch("facet:assigneeUserId", sql`m.assignee_user_id`, "assigneeUserId", [sql`m.assignee_user_id IS NOT NULL`]));
        branches.push(facetBranch("facet:projectId", sql`m.project_id`, "projectId", [sql`m.project_id IS NOT NULL`]));
        branches.push(sql`
          SELECT 'facet:labelId' AS kind, matched_labels.label_id::text AS value, count(DISTINCT m.id)::int AS count ${countTail}
          FROM matched m
          INNER JOIN issue_labels matched_labels
            ON matched_labels.issue_id = m.id
            AND matched_labels.company_id = ${companyId}
          ${branchWhere([optionCond, ...matchedFacetConditions(companyId, query, "labelId")])}
          GROUP BY 2
        `);

        const updatedBaseQuery = { ...query, updatedWithin: undefined, updatedAfter: undefined };
        const updatedBaseFacets = matchedFacetConditions(companyId, updatedBaseQuery);
        for (const option of COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS) {
          const start = updatedWithinStart(option);
          if (!start) continue;
          branches.push(sql`
            SELECT 'facet:updatedWithin'::text AS kind, ${option}::text AS value, count(*)::int AS count ${countTail}
            FROM matched m
            ${branchWhere([optionCond, ...updatedBaseFacets, sql`m.updated_at >= ${start.toISOString()}::timestamptz`])}
          `);
        }

        if (scopeIncludesIssues(scope)) {
          branches.push(sql`SELECT 'total:current' AS kind, NULL::text AS value, count(*)::int AS count ${countTail} FROM matched m ${branchWhere([scopeCond, ...facetsAll])}`);
          if (filtersActive.length > 0) {
            branches.push(sql`SELECT 'total:unfiltered' AS kind, NULL::text AS value, count(*)::int AS count ${countTail} FROM matched m ${branchWhere([scopeCond])}`);
            for (const filter of filtersActive) {
              branches.push(sql`
                SELECT ${`total:omit:${filter.key}`}::text AS kind, NULL::text AS value, count(*)::int AS count ${countTail}
                FROM matched m
                ${branchWhere([scopeCond, ...matchedFacetConditions(companyId, query, filter.key)])}
              `);
            }
          }
        }

        const resultRows = await db.execute(sql`
          ${taskSearchCtes(companyId, taskSearch, scope !== "issues", and(...issueFilters), issueReadCondition)}
          ${sql.join(branches, sql` UNION ALL `)}
        `) as unknown as Array<SearchAggregateRow & Omit<IssueSearchRow, "commentSnippet" | "commentId" | "documentSnippet" | "documentTitle" | "documentKey">>;

        const aggregates: IssueAggregates = {
          typeCounts: { issue: 0, comment: 0, document: 0 },
          filterOptionCounts: emptyFilterOptionCounts(),
          totals: { current: 0, unfiltered: 0, omit: {} },
        };
        const issueRowsRaw: IssueSearchRow[] = [];
        for (const row of resultRows) {
          if (row.kind === "result") {
            issueRowsRaw.push({
              id: row.id,
              identifier: row.identifier,
              title: row.title,
              description: row.description,
              status: row.status,
              priority: row.priority,
              assigneeAgentId: row.assigneeAgentId,
              assigneeUserId: row.assigneeUserId,
              projectId: row.projectId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              score: row.score,
              matchedFields: row.matchedFields,
              commentSnippet: null,
              commentId: null,
              documentSnippet: null,
              documentTitle: null,
              documentKey: null,
            });
            continue;
          }
          const count = Number(row.count ?? 0);
          if (row.kind === "type:issue") aggregates.typeCounts.issue = count;
          else if (row.kind === "type:comment") aggregates.typeCounts.comment = count;
          else if (row.kind === "type:document") aggregates.typeCounts.document = count;
          else if (row.kind === "facet:status" && row.value && (ISSUE_STATUSES as readonly string[]).includes(row.value)) {
            aggregates.filterOptionCounts.status[row.value as keyof CompanySearchFilterOptionCounts["status"]] = count;
          } else if (row.kind === "facet:priority" && row.value && (ISSUE_PRIORITIES as readonly string[]).includes(row.value)) {
            aggregates.filterOptionCounts.priority[row.value as keyof CompanySearchFilterOptionCounts["priority"]] = count;
          } else if (row.kind === "facet:assigneeAgentId" && row.value) aggregates.filterOptionCounts.assigneeAgentId[row.value] = count;
          else if (row.kind === "facet:assigneeUserId" && row.value) aggregates.filterOptionCounts.assigneeUserId[row.value] = count;
          else if (row.kind === "facet:projectId" && row.value) aggregates.filterOptionCounts.projectId[row.value] = count;
          else if (row.kind === "facet:labelId" && row.value) aggregates.filterOptionCounts.labelId[row.value] = count;
          else if (row.kind === "facet:updatedWithin" && row.value) {
            aggregates.filterOptionCounts.updatedWithin[row.value as CompanySearchUpdatedWithinOption] = count;
          } else if (row.kind === "total:current") aggregates.totals.current = count;
          else if (row.kind === "total:unfiltered") aggregates.totals.unfiltered = count;
          else if (row.kind.startsWith("total:omit:")) {
            aggregates.totals.omit[row.kind.slice("total:omit:".length) as CompanySearchIssueFilterKey] = count;
          }
        }
        return { rows: await enrichIssueSnippets(issueRowsRaw), aggregates };
      }

      // Fetch best-matching comment/document snippets only for the fetched
      // page window (<= fetchLimit rows) instead of for every matching row.
      async function enrichIssueSnippets(rows: IssueSearchRow[]): Promise<IssueSearchRow[]> {
        if (!hasSearchText || rows.length === 0) return rows;
        const snippetIds = rows
          .filter((row) => {
            const fields = row.matchedFields ?? [];
            return fields.includes("comment") || fields.includes("document");
          })
          .map((row) => row.id);
        if (snippetIds.length === 0) return rows;
        const snippetRows = await db.execute(sql`
          SELECT
            target.id AS "issueId",
            best_comment.id AS "commentId",
            best_comment.body AS "commentSnippet",
            best_document.latest_body AS "documentSnippet",
            best_document.title AS "documentTitle",
            best_document.key AS "documentKey"
          FROM unnest(${sqlUuidArray(snippetIds)}) AS target(id)
          LEFT JOIN LATERAL (
            SELECT search_comments.id, search_comments.body
            FROM issue_comments search_comments
            WHERE search_comments.company_id = ${companyId}
              AND search_comments.issue_id = target.id
              AND search_comments.deleted_at IS NULL
              AND (
                ${taskSearchFieldMatch(sql`search_comments.body`, taskSearch)}
              )
            ORDER BY
              CASE WHEN search_comments.body ILIKE ${containsPattern} THEN 0 ELSE 1 END,
              ${sql.join(tokens.map((_, index) => sql`CASE WHEN ${taskSearchTermMatch(sql`search_comments.body`, taskSearch, index)} THEN 1 ELSE 0 END`), sql` + `)} DESC,
              search_comments.updated_at DESC,
              search_comments.id DESC
            LIMIT 1
          ) best_comment ON true
          LEFT JOIN LATERAL (
            SELECT search_issue_documents.key, search_documents.latest_body, search_documents.title
            FROM issue_documents search_issue_documents
            INNER JOIN documents search_documents
              ON search_documents.id = search_issue_documents.document_id
              AND search_documents.company_id = search_issue_documents.company_id
            WHERE search_issue_documents.company_id = ${companyId}
              AND search_issue_documents.issue_id = target.id
              AND (
                ${taskSearchFieldMatch(sql`search_documents.title`, taskSearch)}
                OR ${taskSearchFieldMatch(sql`search_documents.latest_body`, taskSearch)}
              )
            ORDER BY
              CASE
                WHEN coalesce(search_documents.title, '') ILIKE ${containsPattern} THEN 0
                WHEN search_documents.latest_body ILIKE ${containsPattern} THEN 1
                ELSE 2
              END,
              ${sql.join(tokens.map((_, index) => sql`CASE WHEN ${taskSearchTermMatch(sql`search_documents.title`, taskSearch, index)} OR ${taskSearchTermMatch(sql`search_documents.latest_body`, taskSearch, index)} THEN 1 ELSE 0 END`), sql` + `)} DESC,
              search_documents.updated_at DESC,
              search_documents.id DESC
            LIMIT 1
          ) best_document ON true
        `) as unknown as Array<{
          issueId: string;
          commentId: string | null;
          commentSnippet: string | null;
          documentSnippet: string | null;
          documentTitle: string | null;
          documentKey: string | null;
        }>;
        const byIssueId = new Map(snippetRows.map((row) => [row.issueId, row]));
        return rows.map((row) => {
          const snippet = byIssueId.get(row.id);
          if (!snippet) return row;
          return {
            ...row,
            commentSnippet: snippet.commentSnippet,
            commentId: snippet.commentId,
            documentSnippet: snippet.documentSnippet,
            documentTitle: snippet.documentTitle,
            documentKey: snippet.documentKey,
          };
        });
      }

      // --- agents / projects / artifacts ------------------------------------
      const simpleCondition = simpleTextCondition([
        sql`${agents.name}`,
        sql`${agents.role}`,
        sql`${agents.title}`,
        sql`${agents.capabilities}`,
      ], containsPattern, tokenPatternArray);
      const projectCondition = simpleTextCondition([
        sql`${projects.name}`,
        sql`${projects.description}`,
      ], containsPattern, tokenPatternArray);

      async function fetchAgentRows() {
        if (!hasSearchText || !scopeIncludesAgents(scope) || hasIssueOnlyFilters) return [];
        return db
          .select({
            id: agents.id,
            title: agents.name,
            description: agents.capabilities,
            role: agents.role,
            createdAt: agents.createdAt,
            updatedAt: agents.updatedAt,
          })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), simpleCondition))
          .orderBy(desc(agents.updatedAt), desc(agents.id))
          .limit(fetchLimit);
      }

      async function fetchProjectRows() {
        if (!hasSearchText || !scopeIncludesProjects(scope) || hasIssueOnlyFilters) return [];
        return db
          .select({
            id: projects.id,
            title: projects.name,
            description: projects.description,
            createdAt: projects.createdAt,
            updatedAt: projects.updatedAt,
          })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt), projectCondition, projectReadCondition))
          .orderBy(desc(projects.updatedAt), desc(projects.id))
          .limit(fetchLimit);
      }

      async function countArtifacts(filters: CompanySearchQuery = query) {
        if (!hasSearchText) return 0;
        const artifactIssueFilters = issueFilterConditions(companyId, filters);
        const artifactIssueConditions = [
          eq(issues.companyId, companyId),
          visibleIssueCondition(),
          ...(issueReadCondition ? [issueReadCondition] : []),
          ...artifactIssueFilters,
        ];
        const documentArtifactConditions = [
          eq(issueDocuments.companyId, companyId),
          eq(documents.companyId, companyId),
          or(isNotNull(documents.createdByAgentId), isNotNull(documents.updatedByAgentId))!,
          notInArray(issueDocuments.key, [...SYSTEM_ISSUE_DOCUMENT_KEYS]),
          sql<boolean>`(
            coalesce(${documents.title}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR ${documents.latestBody} ILIKE ${containsPattern} ESCAPE '\\'
            OR coalesce(${issues.identifier}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR ${issues.title} ILIKE ${containsPattern} ESCAPE '\\'
          )`,
          ...artifactIssueConditions,
        ];
        const workProductConditions = [
          eq(issueWorkProducts.companyId, companyId),
          eq(issueWorkProducts.type, "artifact"),
          eq(issueWorkProducts.provider, "paperclip"),
          sql<boolean>`(
            ${issueWorkProducts.title} ILIKE ${containsPattern} ESCAPE '\\'
            OR coalesce(${issueWorkProducts.summary}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR coalesce(${issues.identifier}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR ${issues.title} ILIKE ${containsPattern} ESCAPE '\\'
          )`,
          ...artifactIssueConditions,
        ];
        const attachmentConditions = [
          eq(issueAttachments.companyId, companyId),
          isNull(issueAttachments.issueCommentId),
          isNotNull(assets.createdByAgentId),
          sql<boolean>`(
            coalesce(${assets.originalFilename}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR coalesce(${issues.identifier}, '') ILIKE ${containsPattern} ESCAPE '\\'
            OR ${issues.title} ILIKE ${containsPattern} ESCAPE '\\'
          )`,
          ...artifactIssueConditions,
        ];
        const [documentRows, workProductRows, attachmentRows] = await Promise.all([
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(issueDocuments)
            .innerJoin(documents, and(eq(issueDocuments.documentId, documents.id), eq(documents.companyId, issueDocuments.companyId)))
            .innerJoin(issues, and(eq(issueDocuments.issueId, issues.id), eq(issues.companyId, issueDocuments.companyId)))
            .where(and(...documentArtifactConditions)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(issueWorkProducts)
            .innerJoin(issues, and(eq(issueWorkProducts.issueId, issues.id), eq(issues.companyId, issueWorkProducts.companyId)))
            .where(and(...workProductConditions)),
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(issueAttachments)
            .innerJoin(assets, and(eq(issueAttachments.assetId, assets.id), eq(assets.companyId, issueAttachments.companyId)))
            .innerJoin(issues, and(eq(issueAttachments.issueId, issues.id), eq(issues.companyId, issueAttachments.companyId)))
            .where(and(...attachmentConditions)),
        ]);
        return Number(documentRows[0]?.count ?? 0)
          + Number(workProductRows[0]?.count ?? 0)
          + Number(attachmentRows[0]?.count ?? 0);
      }

      async function countAgents(filters: CompanySearchQuery = query) {
        if (!hasSearchText || issueOnlyFiltersActive(filters)) return 0;
        const rows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(agents)
          .where(and(eq(agents.companyId, companyId), simpleCondition));
        return Number(rows[0]?.count ?? 0);
      }

      async function countProjects(filters: CompanySearchQuery = query) {
        if (!hasSearchText || issueOnlyFiltersActive(filters)) return 0;
        const rows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(projects)
          .where(and(eq(projects.companyId, companyId), isNull(projects.archivedAt), projectCondition, projectReadCondition));
        return Number(rows[0]?.count ?? 0);
      }

      async function fetchArtifactRows() {
        if (!hasSearchText || !scopeIncludesArtifacts(scope)) return [];
        const result = await companyArtifactsService(db).list(companyId, {
          q: normalizedQuery.slice(0, COMPANY_ARTIFACTS_MAX_QUERY_LENGTH),
          limit: Math.min(fetchLimit, COMPANY_ARTIFACTS_MAX_LIMIT),
        }, { issueConditions: issueFilters });
        return result.artifacts;
      }

      const [company, issueSearchData, artifactRows, agentRows, projectRows, artifactCount, agentCount, projectCount] = await Promise.all([
        db
          .select({ issuePrefix: companies.issuePrefix })
          .from(companies)
          .where(eq(companies.id, companyId))
          .then((rows) => rows[0] ?? null),
        fetchIssueSearchData(),
        fetchArtifactRows(),
        fetchAgentRows(),
        fetchProjectRows(),
        scopeIncludesArtifacts(scope) ? countArtifacts(query) : Promise.resolve(0),
        scopeIncludesAgents(scope) ? countAgents(query) : Promise.resolve(0),
        scopeIncludesProjects(scope) ? countProjects(query) : Promise.resolve(0),
      ]);
      const prefix = routePrefix(company?.issuePrefix);
      const { rows: issueRows, aggregates } = issueSearchData;

      const countsByType = emptySearchCounts();
      countsByType.issue = aggregates.typeCounts.issue;
      countsByType.comment = aggregates.typeCounts.comment;
      countsByType.document = aggregates.typeCounts.document;
      countsByType.artifact = artifactCount;
      countsByType.agent = agentCount;
      countsByType.project = projectCount;
      countsByType.help = helpRows.length;

      const currentTotalCount = (scopeIncludesIssues(scope) ? aggregates.totals.current : 0)
        + artifactCount
        + agentCount
        + projectCount
        + helpRows.length;

      const results: SearchResultWithSort[] = [
        ...issueRows.map((row) => {
          const result = issueResult(row, prefix, normalizedQuery, tokens);
          return {
            ...result,
            sortCreatedAt: iso(row.createdAt),
            sortPriorityRank: priorityRank(row.priority),
          };
        }),
        ...artifactRows.map((artifact) => ({
          ...artifactResult(artifact, normalizedQuery, tokens),
          sortCreatedAt: artifact.updatedAt,
          sortPriorityRank: ISSUE_PRIORITIES.length,
        })),
        ...(agentRows as SimpleSearchRow[]).map((row) => {
          const terms = matchTerms(normalizedQuery, tokens);
          const snippet = createSnippet("capabilities", "Agent", row.description ?? row.role ?? row.title, terms);
          return {
            id: row.id,
            type: "agent" as const,
            score: scoreSimpleRow(row, normalizedQuery, tokens),
            title: row.title,
            href: `/${prefix}/agents/${encodeURIComponent(row.id)}`,
            matchedFields: ["agent"],
            sourceLabel: snippet?.label ?? null,
            snippet: snippet?.text ?? null,
            snippets: snippet ? [snippet] : [],
            updatedAt: iso(row.updatedAt),
            previewImageUrl: null,
            sortCreatedAt: iso(row.createdAt),
            sortPriorityRank: ISSUE_PRIORITIES.length,
          };
        }),
        ...(projectRows as SimpleSearchRow[]).map((row) => {
          const terms = matchTerms(normalizedQuery, tokens);
          const snippet = createSnippet("description", "Project", row.description ?? row.title, terms);
          return {
            id: row.id,
            type: "project" as const,
            score: scoreSimpleRow(row, normalizedQuery, tokens),
            title: row.title,
            href: `/${prefix}/projects/${encodeURIComponent(row.id)}`,
            matchedFields: ["project"],
            sourceLabel: snippet?.label ?? null,
            snippet: snippet?.text ?? null,
            snippets: snippet ? [snippet] : [],
            updatedAt: iso(row.updatedAt),
            previewImageUrl: null,
            sortCreatedAt: iso(row.createdAt),
            sortPriorityRank: ISSUE_PRIORITIES.length,
          };
        }),
        ...helpRows.map(({ article, snippet, ...row }) => ({
          id: row.id,
          type: "help" as const,
          score: row.score,
          title: row.title,
          href: row.href,
          matchedFields: ["title", "summary", "body"],
          sourceLabel: `Help · ${article.maturity === "ga" ? "GA" : "Preview"}`,
          snippet: snippet?.text ?? article.summary,
          snippets: snippet ? [snippet] : [],
          helpArticle: {
            articleId: article.articleId,
            audience: article.audience,
            maturity: article.maturity,
            applicableProductVersions: [...article.applicableProductVersions],
            locale: article.locale,
            lastVerifiedAt: article.lastVerifiedAt,
            source: "mintlify" as const,
          },
          updatedAt: null,
          previewImageUrl: null,
          sortCreatedAt: null,
          sortPriorityRank: ISSUE_PRIORITIES.length,
        })),
      ].sort(compareSearchResults(sort));

      async function countTotalNonIssue(filters: CompanySearchQuery) {
        const [artifactTotal, agentTotal, projectTotal] = await Promise.all([
          scopeIncludesArtifacts(scope) ? countArtifacts(filters) : Promise.resolve(0),
          scopeIncludesAgents(scope) ? countAgents(filters) : Promise.resolve(0),
          scopeIncludesProjects(scope) ? countProjects(filters) : Promise.resolve(0),
        ]);
        return artifactTotal + agentTotal + projectTotal + (scopeIncludesHelp(scope) ? helpRows.length : 0);
      }

      const filtersActive = activeIssueFilters(query);
      const zeroResults = currentTotalCount === 0 && filtersActive.length > 0
        ? {
          unfilteredTotal: (scopeIncludesIssues(scope) ? aggregates.totals.unfiltered : 0)
            + await countTotalNonIssue(queryWithoutIssueFilters(query)),
          loosenSuggestions: (await Promise.all(filtersActive.map(async (filter) => {
            const resultCount = (scopeIncludesIssues(scope) ? aggregates.totals.omit[filter.key] ?? 0 : 0)
              + await countTotalNonIssue(queryWithoutFilter(query, filter.key));
            return {
              filter: filter.key,
              values: filter.values,
              resultCount,
              additionalCount: Math.max(0, resultCount - currentTotalCount),
            };
          }))).sort((left, right) => right.additionalCount - left.additionalCount),
        }
        : null;

      const paged = results.slice(offset, offset + limit).map(stripInternalSortFields);
      const issueIds = paged.flatMap((result) => result.issue ? [result.issue.id] : []);
      if (issueIds.length > 0) {
        const states = await db.select({ id: issues.id, state: externalConversationStateSql() }).from(issues)
          .where(and(eq(issues.companyId, companyId), inArray(issues.id, issueIds)));
        const byId = new Map(states.map((row) => [row.id, row.state]));
        for (const result of paged) {
          if (result.issue) result.issue.externalConversationState = byId.get(result.issue.id) ?? null;
        }
      }
      const federation = options.actor && scope === "all" && !hasIssueOnlyFilters
        ? await federatedCompanySearch(db, companyId, normalizedQuery, options.actor)
        : undefined;
      return {
        query: query.q,
        normalizedQuery,
        scope,
        sort,
        limit,
        offset,
        results: paged,
        ...(federation ? { federation } : {}),
        countsByType,
        filterOptionCounts: aggregates.filterOptionCounts,
        zeroResults,
        hasMore: results.length > offset + limit,
      };
    },
  };
}
