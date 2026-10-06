import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  SECURITY_EVENT_ACTIONS,
  securityEventExportConfigurationSchema,
} from "@paperclipai/shared";
import { enterpriseApi } from "@/api/enterprise";
import { secretsApi } from "@/api/secrets";
import { useAccountIdentity } from "@/api/companies-query";
import { useCompany } from "@/context/CompanyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/lib/router";
export function SecurityEvents() {
  const { selectedCompanyId: companyId } = useCompany(),
    { userId } = useAccountIdentity();
  const scope = useRef({ companyId, userId });
  scope.current = { companyId, userId };
  const [endpoint, setEndpoint] = useState(""),
    [secretId, setSecretId] = useState(""),
    [reason, setReason] = useState(""),
    [enabled, setEnabled] = useState(false),
    [actions, setActions] = useState<(typeof SECURITY_EVENT_ACTIONS)[number][]>(
      [...SECURITY_EVENT_ACTIONS],
    );
  const ready = Boolean(companyId && userId);
  const configuration = useQuery({
    queryKey: ["security-event-export", userId, companyId],
    queryFn: () => enterpriseApi.securityEvents(companyId!, userId!),
    enabled: ready,
    retry: false,
  });
  const secrets = useQuery({
    queryKey: ["security-event-keys", userId, companyId],
    queryFn: () => secretsApi.list(companyId!),
    enabled: ready,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const captured = { ...scope.current },
        old = configuration.data;
      const input = securityEventExportConfigurationSchema.parse({
        expectedVersion: old?.version ?? 0,
        endpoint,
        signingSecretId: secretId,
        signingSecretVersion:
          !enabled && old?.signingSecretId === secretId
            ? old.signingSecretVersion
            : secrets.data?.find((s) => s.id === secretId)?.latestVersion,
        actions,
        enabled,
        reason,
      });
      await enterpriseApi.configureSecurityEvents(
        captured.companyId!,
        captured.userId!,
        input,
      );
      return captured;
    },
    onSuccess: (captured) => {
      if (
        captured.companyId === scope.current.companyId &&
        captured.userId === scope.current.userId
      ) {
        setReason("");
        void configuration.refetch();
      }
    },
  });
  useEffect(() => {
    setEndpoint("");
    setSecretId("");
    setReason("");
    setEnabled(false);
    setActions([...SECURITY_EVENT_ACTIONS]);
    mutation.reset();
  }, [companyId, userId]);
  useEffect(() => {
    const c = configuration.data;
    if (c) {
      setEndpoint(c.endpoint);
      setSecretId(c.signingSecretId);
      setEnabled(c.enabled);
      setActions(
        c.actions.filter((a): a is (typeof SECURITY_EVENT_ACTIONS)[number] =>
          (SECURITY_EVENT_ACTIONS as readonly string[]).includes(a),
        ),
      );
    }
  }, [configuration.data]);
  if (!ready)
    return <p>Select a company and sign in to configure security events.</p>;
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Security event export</h1>
        <p className="text-muted-foreground">
          Send selected company security events to your approved SIEM webhook.
          Deliveries include an event ID, timestamp and HMAC signature.
        </p>
      </div>
      <p>
        Only event identity, company, action and time are exported. Event
        details, source content and credentials stay out of the payload.
        Delivery retries stop after five attempts; delivery metadata expires
        after 24 hours.
      </p>
      {configuration.data ? (
        <p>
          {configuration.data.enabled ? "Export enabled" : "Export paused"} ·{" "}
          {configuration.data.droppedEvents} events omitted because the queue
          was full
        </p>
      ) : null}
      {configuration.data?.delivery ? (
        <p>
          Last 24 hours: {configuration.data.delivery.pending} pending ·{" "}
          {configuration.data.delivery.delivered} delivered ·{" "}
          {configuration.data.delivery.failed} failed ·{" "}
          {configuration.data.delivery.cancelled} cancelled.{" "}
          {configuration.data.delivery.lastDeliveredAt
            ? `Last delivered ${new Date(configuration.data.delivery.lastDeliveredAt).toLocaleString()}.`
            : "No confirmed delivery yet."}
        </p>
      ) : null}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <label className="block">
          Approved HTTPS webhook
          <Input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            required
          />
        </label>
        <label className="block">
          Signing secret
          <select
            className="saas-input"
            value={secretId}
            onChange={(e) => setSecretId(e.target.value)}
            required
          >
            <option value="">Choose a company secret</option>
            {secrets.data
              ?.filter(
                (s) =>
                  s.scope === "company" &&
                  s.provider === "local_encrypted" &&
                  s.status === "active",
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <p className="text-muted-foreground">
          Use a dedicated random signing secret of at least 32 bytes and
          configure the same value in your receiver. Rotating the secret
          requires saving this export policy again.
        </p>
        <fieldset className="space-y-2">
          <legend>Events</legend>
          {SECURITY_EVENT_ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={actions.includes(action)}
                onChange={(e) =>
                  setActions(
                    e.target.checked
                      ? [...actions, action]
                      : actions.filter((a) => a !== action),
                  )
                }
              />
              {action.replaceAll("_", " ")}
            </label>
          ))}
        </fieldset>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enable outbound delivery to this endpoint
        </label>
        <label className="block">
          Reason
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </label>
        <div className="flex items-center justify-between">
          <Link to="/company/settings">Back to settings</Link>
          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              Boolean(configuration.error) ||
              actions.length === 0
            }
          >
            Save export policy
          </Button>
        </div>
      </form>
      {configuration.error || secrets.error || mutation.error ? (
        <p role="alert">
          {String(configuration.error ?? secrets.error ?? mutation.error)}
        </p>
      ) : null}
    </div>
  );
}
