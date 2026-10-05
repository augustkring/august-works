import type {
  EnterpriseIdentityPolicyView,
  SecurityEventExportConfigurationView,
  SecurityEventExportConfigurationInput,
  EnterpriseSubjectBindingView,
} from "@paperclipai/shared";
import type {
  EnterpriseIdentityPolicyInput,
  EnterpriseSubjectBindingInput,
} from "@paperclipai/shared";
import { api } from "./client";
const path = (companyId: string, userId: string, suffix = "") =>
  `/companies/${companyId}/enterprise/identity${suffix}?expectedUserId=${encodeURIComponent(userId)}`;
export const enterpriseApi = {
  securityEvents: (companyId: string, userId: string) =>
    api.get<SecurityEventExportConfigurationView | null>(
      `/companies/${companyId}/enterprise/security-events?expectedUserId=${encodeURIComponent(userId)}`,
    ),
  configureSecurityEvents: (
    companyId: string,
    userId: string,
    input: SecurityEventExportConfigurationInput,
  ) =>
    api.put<SecurityEventExportConfigurationView>(
      `/companies/${companyId}/enterprise/security-events?expectedUserId=${encodeURIComponent(userId)}`,
      input,
    ),
  identity: (companyId: string, userId: string) =>
    api.get<EnterpriseIdentityPolicyView>(path(companyId, userId)),
  configure: (
    companyId: string,
    userId: string,
    input: EnterpriseIdentityPolicyInput,
  ) => api.put<EnterpriseIdentityPolicyView>(path(companyId, userId), input),
  bind: (
    companyId: string,
    userId: string,
    input: EnterpriseSubjectBindingInput,
  ) =>
    api.post<EnterpriseSubjectBindingView>(
      path(companyId, userId, "/subjects"),
      input,
    ),
  bindings: (companyId: string, userId: string) =>
    api.get<EnterpriseSubjectBindingView[]>(
      path(companyId, userId, "/subjects"),
    ),
  revokeBinding: (companyId: string, userId: string, bindingId: string) =>
    api.delete<EnterpriseSubjectBindingView>(
      path(companyId, userId, `/subjects/${bindingId}`),
    ),
  decommissionScim: (
    companyId: string,
    userId: string,
    expectedVersion: number,
  ) =>
    api.post<EnterpriseIdentityPolicyView>(
      path(companyId, userId, "/scim-decommission"),
      { expectedVersion },
    ),
  suspend: (companyId: string, userId: string, expectedVersion: number) =>
    api.post<EnterpriseIdentityPolicyView>(
      path(companyId, userId, "/suspend"),
      { expectedVersion },
    ),
  rotateScim: (
    companyId: string,
    userId: string,
    expectedVersion: number,
    expectedCredentialId: string | null,
  ) =>
    api.post<{ credentialId: string; token: string; expiresAt: string }>(
      path(companyId, userId, "/scim-credential"),
      { expectedVersion, expectedCredentialId },
    ),
};
