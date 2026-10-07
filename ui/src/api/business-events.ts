import type { BusinessEvent, BusinessEventBackfill, BusinessEventBackfillResult, BusinessEventList } from "@paperclipai/shared";
import { api } from "./client";
type Cursor = NonNullable<BusinessEventBackfill["cursor"]>;
export const businessEventsApi = {
  list: (companyId: string, input: BusinessEventList, expectedUserId?: string) => {
    const query = new URLSearchParams({ from: input.from, until: input.until, limit: String(input.limit) });
    if (input.cursor) { query.set("cursorAt", input.cursor.at); query.set("cursorId", input.cursor.id); }
    if (expectedUserId) query.set("expectedUserId",expectedUserId);
    return api.get<{ items: BusinessEvent[]; nextCursor: Cursor | null }>(`/companies/${encodeURIComponent(companyId)}/business-events?${query}`, { cache: "no-store" });
  },
  backfill: (companyId: string, input: BusinessEventBackfill, expectedUserId?: string) =>
    api.post<BusinessEventBackfillResult>(`/companies/${encodeURIComponent(companyId)}/business-events/backfill${expectedUserId ? `?${new URLSearchParams({ expectedUserId })}` : ""}`, input),
  suppressSource: (companyId: string, sourceRef: string, expectedUserId?: string) =>
    api.delete<{ suppressed: true }>(`/companies/${encodeURIComponent(companyId)}/business-events/sources/${encodeURIComponent(sourceRef)}${expectedUserId ? `?${new URLSearchParams({ expectedUserId })}` : ""}`),
};
