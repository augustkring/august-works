import type {
  PackageCatalogView,
  PackageInstallationView,
  PackageInstallOptions,
  PackagePreview,
  PackageInstallInput,
  PackageUpdateDraftInput,
  SpecialistEvaluationInput,
  SpecialistEvaluationReport,
} from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";
import { packageInstallationRequestReceiptSchema } from "@paperclipai/shared";
const scope = (path: string, userId: string) =>
  `${path}?expectedUserId=${encodeURIComponent(userId)}`;
function currentRead<T>(path: string, userId: string, signal?: AbortSignal) {
  const url = scope(path, userId);
  // A new private reader must not join a request begun before its session check.
  detachInflightGet(url);
  return api.get<T>(url, { signal, cache: "no-store" });
}
export const agentPackagesApi = {
  async installationRequest(companyId: string, userId: string, requestId: string, signal?: AbortSignal) {
    const receipt = packageInstallationRequestReceiptSchema.parse(await currentRead(
      `/companies/${encodeURIComponent(companyId)}/agent-package-installations/requests/${encodeURIComponent(requestId)}`, userId, signal));
    signal?.throwIfAborted();
    if (receipt.companyId !== companyId || receipt.requestId !== requestId) throw new Error("Original installation request context changed");
    return receipt;
  },
  evaluate: (
    companyId: string,
    userId: string,
    input: SpecialistEvaluationInput,
  ) =>
    api.post<SpecialistEvaluationReport>(
      scope(`/companies/${companyId}/agent-package-evaluations`, userId),
      input,
    ),
  catalog: (userId: string) =>
    currentRead<PackageCatalogView[]>("/agent-packages", userId),
  options: (companyId: string, userId: string) =>
    currentRead<PackageInstallOptions>(
      `/companies/${companyId}/agent-package-options`, userId,
    ),
  list: (companyId: string, userId: string) =>
    currentRead<PackageInstallationView[]>(
      `/companies/${companyId}/agent-package-installations`, userId,
    ),
  preview: (
    companyId: string,
    userId: string,
    key: string,
    input: PackageInstallInput,
  ) =>
    api.post<PackagePreview>(
      scope(`/companies/${companyId}/agent-packages/${key}/preview`, userId),
      input,
    ),
  install: (
    companyId: string,
    userId: string,
    key: string,
    input: PackageInstallInput,
  ) =>
    api.post<PackageInstallationView>(
      scope(`/companies/${companyId}/agent-packages/${key}/install`, userId),
      input,
    ),
  decide: (
    companyId: string,
    userId: string,
    id: string,
    action: "activate" | "suspend" | "uninstall",
    input: { expectedVersion: number; reason: string },
  ) =>
    action === "uninstall"
      ? api.deleteWithBody<PackageInstallationView>(
          scope(
            `/companies/${companyId}/agent-package-installations/${id}`,
            userId,
          ),
          input,
        )
      : api.post<PackageInstallationView>(
          scope(
            `/companies/${companyId}/agent-package-installations/${id}/${action}`,
            userId,
          ),
          input,
        ),
  update: (
    companyId: string,
    userId: string,
    id: string,
    input: PackageUpdateDraftInput,
  ) =>
    api.post<PackageInstallationView>(
      scope(
        `/companies/${companyId}/agent-package-installations/${id}/update`,
        userId,
      ),
      input,
    ),
};
export interface PackageUpdateProposalView {
  id: string;
  installationId: string;
  proposal: PackageUpdateDraftInput | null;
  reason: string;
  status: string;
  beforeManifest?: PackageCatalogView["manifest"];
  afterManifest?: PackageCatalogView["manifest"] | null;
  material?: boolean;
}
export const packageProposalsApi = {
  list: (companyId: string, userId: string) =>
    currentRead<PackageUpdateProposalView[]>(
      `/companies/${companyId}/agent-package-update-proposals`, userId,
    ),
  review: (
    companyId: string,
    userId: string,
    id: string,
    decision: "accept" | "reject",
  ) =>
    api.post<PackageUpdateProposalView>(
      scope(
        `/companies/${companyId}/agent-package-update-proposals/${id}/review`,
        userId,
      ),
      { decision },
    ),
};
