import { formatInfrastructureUsage, formatStorageBytes } from "@/lib/infrastructureUsage";
import { useEffect, useRef, useState } from "react";
import { useAccountIdentity } from "@/api/companies-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { saasApi } from "@/api/saas";
import { useCompany } from "@/context/CompanyContext";
import { useSaasCapabilities } from "@/hooks/useSaasCapabilities";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";

export function SaasBillingPage() {
  const { selectedCompanyId } = useCompany();
  const identity = useAccountIdentity();
  const capabilities = useSaasCapabilities();
  const scopeRef = useRef({
    userId: identity.userId,
    companyId: selectedCompanyId,
  });
  scopeRef.current = { userId: identity.userId, companyId: selectedCompanyId };
  const [intentId, setIntentId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<{
    priceKey: string;
    key: string;
  } | null>(null);
  useEffect(() => {
    setIntentId(null);
    setAttempt(null);
  }, [identity.userId, selectedCompanyId]);
  const billing = useQuery({
    queryKey: ["saas-billing", identity.userId, selectedCompanyId],
    queryFn: () => saasApi.billing(selectedCompanyId!, identity.userId!),
    enabled: Boolean(
      identity.userId && selectedCompanyId && capabilities.data?.billing,
    ),
    refetchInterval: 15000,
  });
  const usage = useQuery({
    queryKey: ["saas-usage", identity.userId, selectedCompanyId],
    queryFn: () => saasApi.usage(selectedCompanyId!, identity.userId!),
    enabled: Boolean(
      identity.userId && selectedCompanyId && capabilities.data?.usage,
    ),
  });
  const status = useQuery({
    queryKey: ["saas-checkout", identity.userId, selectedCompanyId, intentId],
    queryFn: () =>
      saasApi.checkoutStatus(selectedCompanyId!, intentId!, identity.userId!),
    enabled: Boolean(identity.userId && intentId && selectedCompanyId),
    refetchInterval: (query) =>
      ["requested", "creating"].includes(query.state.data?.status ?? "")
        ? 2000
        : false,
  });
  const checkout = useMutation({
    mutationFn: async (input: { productKey: string; priceKey: string }) => {
      const key =
        attempt?.priceKey === input.priceKey
          ? attempt.key
          : crypto.randomUUID();
      setAttempt({ priceKey: input.priceKey, key });
      const scope = { userId: identity.userId!, companyId: selectedCompanyId! };
      const result = await saasApi.checkout(scope.companyId, scope.userId, {
        ...input,
        idempotencyKey: key,
      });
      return { result, scope };
    },
    onSuccess: ({ result, scope }) => {
      if (
        scopeRef.current.userId === scope.userId &&
        scopeRef.current.companyId === scope.companyId
      )
        setIntentId(result.id);
    },
  });
  const portal = useMutation({
    mutationFn: async () => {
      const scope = { userId: identity.userId!, companyId: selectedCompanyId! };
      return {
        scope,
        result: await saasApi.portal(scope.companyId, scope.userId),
      };
    },
    onSuccess: ({ scope, result }) => {
      if (
        scopeRef.current.userId === scope.userId &&
        scopeRef.current.companyId === scope.companyId
      )
        window.location.assign(result.url);
    },
  });
  const error =
    billing.error ??
    usage.error ??
    status.error ??
    checkout.error ??
    portal.error;
  if (capabilities.isPending) return <p role="status">Loading billing…</p>;
  if (!capabilities.data?.billing)
    return <p>Billing is not available in this deployment.</p>;
  if (!selectedCompanyId) return <p>Select an organization to view billing.</p>;
  return (
    <main className="saas-page">
      <h1 className="saas-title">Billing and usage</h1>
      <p className="saas-muted">
        Your model provider bills your API usage separately. August Works
        charges cover the platform and managed infrastructure.
      </p>
      {error && (
        <p role="alert" className="saas-error">
          {error.message}
        </p>
      )}
      {billing.isPending && <p role="status">Loading your subscription…</p>}
      {billing.data && (
        <>
          <section className="saas-section" aria-label="Subscription status">
            <h2 className="saas-subtitle">
              Access: {billing.data.access.replace("_", " ")}
            </h2>
            {billing.data.access === "grace" && (
              <p>
                Resolve the payment issue to keep work running. New managed
                runtimes are paused during the grace period.
              </p>
            )}
            {billing.data.access === "read_only" && (
              <p>
                You can view and export your work. Restore your subscription to
                make changes.
              </p>
            )}
            {billing.data.subscriptions.map((subscription) => (
              <p key={subscription.id}>
                {subscription.productKeys.join(", ")} — {subscription.status}
                {subscription.cancelAtPeriodEnd
                  ? " · Cancels at the end of this period"
                  : ""}
              </p>
            ))}
            <Button
              variant="outline"
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
            >
              Manage payment and subscription
            </Button>
          </section>
          <section className="saas-section" aria-label="Plans and add-ons">
            <h2 className="saas-subtitle">Plans and add-ons</h2>
            {billing.data.prices.length === 0 && (
              <p>No plans are available yet. Contact support.</p>
            )}
            {billing.data.prices.map((price) => (
              <div key={price.priceKey} className="saas-row">
                <span>
                  {billing.data!.products.find(
                    (product) => product.key === price.productKey,
                  )?.label ?? price.productKey}
                </span>
                <Button
                  disabled={
                    !capabilities.data?.checkout ||
                    checkout.isPending ||
                    Boolean(intentId)
                  }
                  onClick={() => checkout.mutate(price)}
                >
                  View checkout
                </Button>
              </div>
            ))}
            <p className="saas-muted">
              Paddle shows the price, tax and renewal terms before you confirm
              payment.
            </p>
            {status.data && (
              <div role="status">
                {status.data.status === "ready" && status.data.checkoutUrl ? (
                  <a className="saas-link" href={status.data.checkoutUrl}>
                    Continue to secure checkout
                  </a>
                ) : (
                  <p>Checkout: {status.data.status.replaceAll("_", " ")}</p>
                )}
                {status.data.status === "needs_reconciliation" && (
                  <p>
                    The payment provider has not confirmed the result yet.
                    Contact support; your payment will be checked before another
                    checkout is created.
                  </p>
                )}
                {["completed", "expired", "failed"].includes(
                  status.data.status,
                ) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIntentId(null);
                      setAttempt(null);
                      billing.refetch();
                    }}
                  >
                    Refresh subscription
                  </Button>
                )}
              </div>
            )}
          </section>
        </>
      )}
      <section className="saas-section" aria-label="Infrastructure usage">
        <h2 className="saas-subtitle">This month’s infrastructure usage</h2>
        {usage.data?.storage && (
          <p>
            Account storage: {formatStorageBytes(usage.data.storage.usedBytes)} of{" "}
            {formatStorageBytes(usage.data.storage.includedBytes)}. Internal logs and safety
            backups are excluded. You can read and remove existing files when
            your allowance is exceeded.
          </p>
        )}
        {usage.data?.meters.length === 0 && (
          <p>No infrastructure consumption has been recorded yet.</p>
        )}
        {usage.data?.meters.map((meter) => {
          const display = formatInfrastructureUsage(
            meter,
            usage.data!.periodStart,
          );
          return (
            <div key={meter.meterKey} className="saas-row">
              <span>{display.label}</span>
              <span className="saas-machine">{display.value}</span>
            </div>
          );
        })}
        <Link className="saas-link" to="/company/export">
          Export your organization
        </Link>
      </section>
    </main>
  );
}
