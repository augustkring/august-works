import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { SaasRuntimeCell, SaasRuntimeOptions } from "@paperclipai/shared";
import { saasApi } from "@/api/saas";
import { Button } from "@/components/ui/button";

export function SaasRuntimeRecovery({
  companyId,
  userId,
  cell,
  options,
  onChanged,
}: {
  companyId: string;
  userId: string;
  cell: SaasRuntimeCell;
  options?: SaasRuntimeOptions;
  onChanged(): void;
}) {
  const [backupId, setBackupId] = useState(""),
    [imageDigest, setImageDigest] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const backups = useQuery({
    queryKey: ["saas-runtime-backups", userId, companyId, cell.id],
    queryFn: () => saasApi.runtimeBackups(companyId, userId, cell.id),
    refetchInterval: 5000,
  });
  useEffect(() => {
    setBackupId("");
    setImageDigest("");
    setConfirmed(false);
    attempt.current = null;
  }, [companyId, userId, cell.id, cell.generation]);
  const action = useMutation({
    mutationFn: (kind: "restore" | "upgrade") => {
      const signature = JSON.stringify({
        kind,
        backupId,
        imageDigest,
        generation: cell.generation,
      });
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      return saasApi.runtimeOperation(companyId, userId, cell.id, {
        action: kind,
        backupId,
        ...(kind === "upgrade" ? { imageDigest } : {}),
        idempotencyKey: attempt.current.key,
      });
    },
    onSuccess: () => {
      attempt.current = null;
      setConfirmed(false);
      onChanged();
      void backups.refetch();
    },
  });
  const verified =
    backups.data?.filter((backup) => backup.status === "VERIFIED") ?? [];
  const selected = verified.find((backup) => backup.id === backupId);
  const error = backups.error ?? action.error;
  return (
    <section aria-label="Runtime backup and recovery" className="saas-section">
      <h3 className="saas-subtitle">Backups and recovery</h3>
      {error && (
        <p className="saas-error" role="alert">
          {error.message}
        </p>
      )}
      {backups.isPending && <p role="status">Loading backups…</p>}
      {backups.data?.length === 0 && <p>No backups have been created.</p>}
      {backups.data?.map((backup) => (
        <p key={backup.id}>
          {new Date(backup.createdAt).toLocaleString()} ·{" "}
          {backup.status.toLowerCase().replaceAll("_", " ")}
          {backup.verificationErrorCode && " · Verification needs attention"}
        </p>
      ))}
      {verified.length > 0 && (
        <>
          <label className="saas-label">
            Verified backup
            <select
              className="saas-input"
              value={backupId}
              onChange={(event) => {
                setBackupId(event.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">Choose a backup</option>
              {verified.map((backup) => (
                <option key={backup.id} value={backup.id}>
                  {new Date(backup.createdAt).toLocaleString()} · Generation{" "}
                  {backup.generation}
                </option>
              ))}
            </select>
          </label>
          <label className="saas-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            Replace the runtime’s current state with this backup
          </label>
          <div className="saas-footer">
            <span className="saas-muted">
              Restore leaves the runtime stopped. Configure model credentials
              before starting it.
            </span>
            <Button
              variant="outline"
              disabled={
                action.isPending ||
                !selected ||
                !confirmed ||
                !["STOPPED", "DEGRADED"].includes(cell.status)
              }
              onClick={() => action.mutate("restore")}
            >
              Restore backup
            </Button>
          </div>
          {cell.status === "STOPPED" && (
            <>
              <label className="saas-label">
                Upgrade version
                <select
                  className="saas-input"
                  value={imageDigest}
                  onChange={(event) => setImageDigest(event.target.value)}
                >
                  <option value="">Choose an approved version</option>
                  {options?.versions.map((version) => (
                    <option
                      key={version.imageDigest}
                      value={version.imageDigest}
                    >
                      {version.providerVersion}
                    </option>
                  ))}
                </select>
              </label>
              <div className="saas-footer">
                <span className="saas-muted">
                  An upgrade requires a verified backup from this generation and
                  a compatible state format.
                </span>
                <Button
                  disabled={
                    action.isPending ||
                    !selected ||
                    selected.generation !== cell.generation ||
                    selected.imageDigest !== cell.imageDigest ||
                    !imageDigest
                  }
                  onClick={() => action.mutate("upgrade")}
                >
                  Upgrade runtime
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
