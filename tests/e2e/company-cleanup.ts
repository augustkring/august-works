import type { APIRequestContext, APIResponse } from "@playwright/test";

// The disposable bootstrap owner created by fixtures/bootstrap-browser-owner.ts.
export const BOOTSTRAP_OWNER = {
  email: "browser-product-owner@test.invalid",
  password: "Disposable browser product passphrase 2026!",
};

/**
 * Delete a company through the real route (EXIT-AUTH1): the request carries the
 * organization's current name, and when the server asks for a recent sign-in
 * the bootstrap owner signs in again in the same request context and retries.
 * Other principals are never re-authenticated here; their refusal is returned.
 */
export async function deleteCompany(api: APIRequestContext, companyId: string, base = ""): Promise<APIResponse> {
  const current = await api.get(`${base}/api/companies/${companyId}`);
  const confirmName = current.ok() ? String((await current.json())?.name ?? "") : "";
  const attempt = () => api.delete(`${base}/api/companies/${companyId}`, { data: { confirmName } });
  const first = await attempt();
  if (first.status() !== 403) return first;
  const refusal = await first.json().catch(() => null);
  if (refusal?.details?.code !== "recent_authentication_required") return first;
  const session = await api.get(`${base}/api/auth/get-session`);
  const email = session.ok() ? (await session.json().catch(() => null))?.user?.email : null;
  if (email !== BOOTSTRAP_OWNER.email) return first;
  const signIn = await api.post(`${base}/api/auth/sign-in/email`, { data: BOOTSTRAP_OWNER });
  if (!signIn.ok()) return first;
  return attempt();
}
