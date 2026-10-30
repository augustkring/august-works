import { PRODUCT_IDENTITY, type CompanySearchResult } from "@paperclipai/shared";
import type { CompanySearchResponse, CompanySearchScope, CompanySearchSort, IssuePriority, IssueStatus } from "@paperclipai/shared";
import { api } from "./client";

export interface CompanySearchParams {
  q: string;
  locale?: "en" | "da";
  scope?: CompanySearchScope;
  limit?: number;
  offset?: number;
  status?: IssueStatus[];
  priority?: IssuePriority[];
  assigneeAgentId?: string | null;
  assigneeUserId?: string;
  projectId?: string;
  labelId?: string;
  updatedWithin?: string;
  updatedAfter?: string;
  sort?: CompanySearchSort;
}

function appendMulti(search: URLSearchParams, key: string, values: readonly string[] | undefined) {
  for (const value of values ?? []) search.append(key, value);
}

export const searchApi = {
  search: (companyId: string, params: CompanySearchParams, signal?: AbortSignal) => {
    const search = new URLSearchParams();
    search.set("q", params.q);
    if (params.locale) search.set("locale", params.locale);
    if (params.scope) search.set("scope", params.scope);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    appendMulti(search, "status", params.status);
    appendMulti(search, "priority", params.priority);
    if (params.assigneeAgentId !== undefined) search.set("assigneeAgentId", params.assigneeAgentId ?? "null");
    if (params.assigneeUserId !== undefined) search.set("assigneeUserId", params.assigneeUserId);
    if (params.projectId !== undefined) search.set("projectId", params.projectId);
    if (params.labelId !== undefined) search.set("labelId", params.labelId);
    if (params.updatedWithin !== undefined) search.set("updatedWithin", params.updatedWithin);
    if (params.updatedAfter !== undefined) search.set("updatedAfter", params.updatedAfter);
    if (params.sort !== undefined) search.set("sort", params.sort);
    const qs = search.toString();
    return api.get<CompanySearchResponse>(
      `/companies/${companyId}/search${qs ? `?${qs}` : ""}`, { signal },
    );
  },
};


/** One decoder for the original public Help source used by Help and Cmd+K. */
export function checkedCompanyHelpHref(result: CompanySearchResult): string {
  const article = result.helpArticle;
  if (result.type !== "help" || !article || result.id !== article.articleId || article.source !== "mintlify" ||
    !article.articleId.trim() || !article.applicableProductVersions.includes("V10") ||
    !["preview", "ga"].includes(article.maturity) || !article.locale || !article.lastVerifiedAt)
    throw new Error("Help search result is unavailable");
  const origin = new URL(PRODUCT_IDENTITY.docsOrigin), href = new URL(result.href), slug = href.pathname.slice(1);
  if (href.protocol !== "https:" || href.origin !== origin.origin || href.username || href.password ||
    href.search || href.hash || !/^[a-z0-9][a-z0-9/-]*$/.test(slug) || slug.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error("Help search destination is unavailable");
  return href.toString();
}

export function checkedCompanyHelpResults(response: CompanySearchResponse, limit: number, locale: "en" | "da"): CompanySearchResult[] {
  if (response.scope !== "help" || response.limit !== limit || response.results.length > limit)
    throw new Error("Help search response is unavailable");
  for (const result of response.results) {
    checkedCompanyHelpHref(result);
    if (result.helpArticle!.locale !== locale) throw new Error("Help search language is unavailable");
  }
  return response.results;
}
