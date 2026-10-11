import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { agentRetirementApi } from "../api/agent-retirement";
import { useV9PrivateReadAuthority } from "../hooks/useV9PrivateReadAuthority";
import { Link } from "../lib/router";

/** Discovery is the current Native owner's read, never a profile-based grant. */
export function AgentRetirementLink({ company, principal, agentId }: { company: string; principal: string; agentId: string }) {
  const { t } = useTranslation("experience"), authority = useV9PrivateReadAuthority(principal);
  const query = useQuery({ queryKey: ["agent-retirement-admission", company, principal, agentId, authority.epoch],
    queryFn: ({ signal }) => authority.read(() => agentRetirementApi.get(company, agentId, principal, signal)),
    enabled: authority.readReady, gcTime: 0, staleTime: 0, retry: false });
  if (!authority.readReady || !query.isSuccess || query.isFetching) return null;
  return <Link className="inline-flex min-h-11 items-center underline" to={`/agents/${agentId}/retire`}>{t("retirement.review")}</Link>;
}
