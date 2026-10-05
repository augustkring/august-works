import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { saasApi } from "@/api/saas";
import { useAccountIdentity } from "@/api/companies-query";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
export function SaasModelProviderForm({
  companyId,
  cellId,
  onConfigured,
}: {
  companyId: string;
  cellId: string;
  onConfigured: () => void;
}) {
  const identity = useAccountIdentity(),
    [provider, setProvider] = useState<"openai" | "anthropic" | "openrouter">(
      "openai",
    ),
    [modelId, setModelId] = useState(""),
    [secretId, setSecretId] = useState("");
  const secrets = useQuery({
    queryKey: ["saas-model-vault", identity.userId, companyId],
    queryFn: () =>
      api.get<{ id: string; name: string; ownerUserId?: string | null }[]>(
        "/companies/" +
          companyId +
          "/secrets?expectedUserId=" +
          encodeURIComponent(identity.userId!),
      ),
    enabled: Boolean(identity.userId),
  });
  const mutation = useMutation({
    mutationFn: () =>
      saasApi.configureRuntimeModel(companyId, identity.userId!, cellId, {
        provider,
        modelId,
        secretId,
      }),
    onSuccess: onConfigured,
  });
  return (
    <form
      className="saas-section"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h3 className="saas-subtitle">Your model provider</h3>
      <p className="saas-muted">
        Choose a credential from your organization vault. The provider bills you
        directly.
      </p>
      {(secrets.error || mutation.error) && (
        <p role="alert" className="saas-error">
          {(secrets.error ?? mutation.error)?.message}
        </p>
      )}
      <label className="saas-label">
        Provider
        <select
          className="saas-input"
          value={provider}
          onChange={(event) =>
            setProvider(event.target.value as typeof provider)
          }
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </label>
      <label className="saas-label">
        Model ID
        <input
          className="saas-input"
          required
          maxLength={160}
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        />
      </label>
      <label className="saas-label">
        Vault credential
        <select
          className="saas-input"
          required
          value={secretId}
          onChange={(event) => setSecretId(event.target.value)}
        >
          <option value="">Choose a credential</option>
          {secrets.data
            ?.filter(
              (secret) =>
                !secret.ownerUserId || secret.ownerUserId === identity.userId,
            )
            .map((secret) => (
              <option key={secret.id} value={secret.id}>
                {secret.name}
              </option>
            ))}
        </select>
      </label>
      <div className="saas-footer">
        <Link className="saas-link" to="/company/settings/secrets">
          Manage vault credentials
        </Link>
        <Button
          type="submit"
          disabled={mutation.isPending || !secretId || !modelId.trim()}
        >
          Save model provider
        </Button>
      </div>
      {mutation.isSuccess && (
        <p role="status">
          Model provider saved. Start the runtime when you are ready.
        </p>
      )}
    </form>
  );
}
