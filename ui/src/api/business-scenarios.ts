import type { BusinessScenarioView, BusinessScenarioVersionView, BusinessScenarioRunView, CreateBusinessScenario, ReviseBusinessScenario, PublishBusinessScenario, RunBusinessScenario, RetireBusinessScenario } from "@paperclipai/shared";
import { api } from "./client";
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/business-scenarios`;
const scenario = (companyId: string, id: string) => `${base(companyId)}/${encodeURIComponent(id)}`;
const account = (path: string, userId?: string | null) => userId ? `${path}${path.includes("?") ? "&" : "?"}expectedUserId=${encodeURIComponent(userId)}` : path;
export const businessScenariosApi = {
  list: (companyId: string, cursor?: string, userId?: string | null) => api.get<{ items: Array<{ scenario: BusinessScenarioView; version: BusinessScenarioVersionView }>; nextCursor: string | null; coverage: "bounded_current_authorized_page" }>(account(`${base(companyId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  detail: (companyId: string, id: string, userId?: string | null) => api.get<{ scenario: BusinessScenarioView; versions: BusinessScenarioVersionView[] }>(account(scenario(companyId, id), userId), { cache: "no-store" }),
  create: (companyId: string, input: CreateBusinessScenario, userId?: string | null) => api.post<{ scenario: BusinessScenarioView; version: BusinessScenarioVersionView }>(account(base(companyId), userId), input),
  revise: (companyId: string, id: string, input: ReviseBusinessScenario, userId?: string | null) => api.post<{ scenario: BusinessScenarioView; version: BusinessScenarioVersionView }>(account(`${scenario(companyId, id)}/versions`, userId), input),
  publish: (companyId: string, id: string, input: PublishBusinessScenario, userId?: string | null) => api.post<BusinessScenarioView>(account(`${scenario(companyId, id)}/publish`, userId), input),
  run: (companyId: string, id: string, input: RunBusinessScenario, userId?: string | null) => api.post<BusinessScenarioRunView>(account(`${scenario(companyId, id)}/runs`, userId), input),
  runs: (companyId: string, id: string, cursor?: string, userId?: string | null) => api.get<{ items: BusinessScenarioRunView[]; nextCursor: string | null; coverage: "bounded_current_authorized_page" }>(account(`${scenario(companyId, id)}/runs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, userId), { cache: "no-store" }),
  result: (companyId: string, id: string, runId: string, userId?: string | null) => api.get<BusinessScenarioRunView>(account(`${scenario(companyId, id)}/runs/${encodeURIComponent(runId)}`, userId), { cache: "no-store" }),
  retire: (companyId: string, id: string, input: RetireBusinessScenario, userId?: string | null) => api.post<BusinessScenarioView>(account(`${scenario(companyId, id)}/retire`, userId), input),
};
