import { supportCaseDataPolicySchema, type SupportCaseDataPolicy } from "@paperclipai/shared";

/** One startup-owned policy for disclosure, local intake and delivery. */
export function readSupportCaseDataPolicy(env: Readonly<Record<string, string | undefined>>): SupportCaseDataPolicy | null {
  const raw = env.AW_SUPPORT_CASE_DATA_POLICY_JSON;
  if (raw === undefined) return null;
  try {
    if (Buffer.byteLength(raw, "utf8") > 16384) throw Error();
    return supportCaseDataPolicySchema.parse(JSON.parse(raw));
  } catch {
    throw Error("Invalid support case data policy configuration");
  }
}
