import { useQuery } from "@tanstack/react-query";
import type { SandboxPosture } from "@paperclipai/shared";
import { api } from "@/api/client";

export function SaasRuntimeExecutionPosture({ companyId, cellId, userId }: { companyId: string; cellId: string; userId: string }) {
  const posture = useQuery({ queryKey: ["runtime-execution-posture", userId, companyId, cellId], queryFn: () => api.get<SandboxPosture>(`/companies/${companyId}/runtime-cells/${cellId}/execution-posture?expectedUserId=${encodeURIComponent(userId)}`), refetchInterval: 10000 });
  if (posture.error) return <p role="alert" className="saas-error">Execution boundary status could not be loaded.</p>;
  if (!posture.data) return <p role="status" className="saas-muted">Checking execution boundary…</p>;
  const text = posture.data.state === "legacy_boundary" ? "Existing runtime boundary" : posture.data.state === "quarantined" ? "Execution boundary requires attention" : "Awaiting execution boundary verification";
  return <p className="saas-muted">{text}</p>;
}
