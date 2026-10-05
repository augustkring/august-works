import { z } from "zod";
import type { SaasPlatformConfig } from "../../saas-platform-config.js";
const id = z.string().uuid();
const serverSchema = z.object({
  storage_devices: z
    .object({
      storage_device: z.array(
        z.object({ storage: id, storage_title: z.string() }),
      ),
    })
    .optional(),
  uuid: id,
  zone: z.string(),
  state: z.string(),
  labels: z
    .object({
      label: z.array(z.object({ key: z.string(), value: z.string() })),
    })
    .optional(),
  networking: z
    .object({
      interfaces: z.object({
        interface: z.array(
          z.object({
            type: z.string(),
            network: z.string().optional(),
            ip_addresses: z
              .object({
                ip_address: z.array(
                  z.object({
                    address: z.string().optional(),
                    family: z.string(),
                  }),
                ),
              })
              .optional(),
          }),
        ),
      }),
    })
    .optional(),
});
export type UpCloudServer = z.infer<typeof serverSchema>;
export class RuntimeProviderError extends Error {
  constructor(
    readonly code: string,
    readonly unknownOutcome = false,
  ) {
    super(code);
  }
}
export type RuntimeProvider = {
  create(hostId: string, userData: string): Promise<UpCloudServer>;
  get(providerId: string): Promise<UpCloudServer>;
  find(hostId: string): Promise<UpCloudServer[]>;
  stop(providerId: string): Promise<void>;
  delete(providerId: string): Promise<void>;
  storageAbsent?(storageId: string): Promise<boolean>;
  inventory?(): Promise<UpCloudServer[]>;
};
export function upcloudRuntimeProvider(
  config: SaasPlatformConfig,
  fetcher: typeof fetch = fetch,
): RuntimeProvider {
  if (!config.upcloud)
    throw new RuntimeProviderError("upcloud_credentials_missing");
  const authorization =
    "Basic " +
    Buffer.from(
      config.upcloud.username + ":" + config.upcloud.password,
    ).toString("base64");
  async function request(path: string, method = "GET", body?: unknown) {
    let response: Response;
    try {
      response = await fetcher("https://api.upcloud.com/1.3" + path, {
        method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
    } catch {
      throw new RuntimeProviderError(
        "upcloud_request_unknown",
        method !== "GET",
      );
    }
    if (!response.ok)
      throw new RuntimeProviderError(
        "upcloud_http_" + response.status,
        method !== "GET" && (response.status >= 500 || response.status === 429),
      );
    if (response.status === 204) return null;
    const raw = await response.text();
    if (raw.length > 1024 * 1024)
      throw new RuntimeProviderError(
        "upcloud_response_limit",
        method !== "GET",
      );
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new RuntimeProviderError(
        "upcloud_invalid_response",
        method !== "GET",
      );
    }
  }
  function owned(server: UpCloudServer, hostId: string) {
    const labels = new Map(server.labels?.label.map((v) => [v.key, v.value]));
    if (
      server.zone !== config.runtime.region ||
      labels.get("aw-host-id") !== hostId ||
      labels.get("environment") !== config.environment ||
      labels.get("managed-by") !== "august-works-v6"
    )
      throw new RuntimeProviderError("upcloud_ownership_mismatch");
    if (
      server.networking?.interfaces.interface.some((v) => v.type === "public")
    )
      throw new RuntimeProviderError("upcloud_public_runtime_network");
    return server;
  }
  async function get(providerId: string) {
    id.parse(providerId);
    return z
      .object({ server: serverSchema })
      .parse(await request("/server/" + providerId)).server;
  }
  return {
    async create(hostId, userData) {
      id.parse(hostId);
      const raw = await request("/server", "POST", {
        server: {
          hostname: "aw-runtime-" + hostId,
          title: "August Works runtime " + hostId,
          zone: config.runtime.region,
          plan: config.runtime.hostPlan,
          metadata: "yes",
          remote_access_enabled: "no",
          password_delivery: "none",
          login_user: { username: "root", create_password: "no" },
          nic_model: "virtio",
          labels: {
            label: [
              { key: "aw-host-id", value: hostId },
              { key: "environment", value: config.environment },
              { key: "managed-by", value: "august-works-v6" },
            ],
          },
          networking: {
            interfaces: {
              interface: [
                {
                  type: "private",
                  network: config.runtime.networkId,
                  ip_addresses: { ip_address: [{ family: "IPv4" }] },
                  source_ip_filtering: "yes",
                },
              ],
            },
          },
          storage_devices: {
            storage_device: [
              {
                action: "clone",
                storage: config.runtime.osTemplate,
                size: config.runtime.hostDiskGib ?? 50,
                title: "aw-os-" + hostId,
                tier: "maxiops",
              },
              {
                action: "create",
                size: config.runtime.stateDiskGib ?? 100,
                title: "aw-state-" + hostId,
                tier: "maxiops",
              },
            ],
          },
          user_data: userData,
        },
      });
      const server = z.object({ server: serverSchema }).parse(raw).server;
      // Creation responses may omit labels. Read the authoritative resource before admitting it.
      return owned(await get(server.uuid), hostId);
    },
    get,
    async inventory() {
      const raw = z
        .object({
          servers: z.object({
            server: z.array(z.object({ uuid: id })).max(50),
          }),
        })
        .parse(
          await request(
            "/server/?label=" +
              encodeURIComponent("managed-by=august-works-v6"),
          ),
        );
      const resources: UpCloudServer[] = [];
      for (const item of raw.servers.server) {
        const resource = await get(item.uuid),
          labels = new Map(
            resource.labels?.label.map((label) => [label.key, label.value]),
          );
        if (
          labels.get("managed-by") === "august-works-v6" &&
          labels.get("environment") === config.environment
        )
          resources.push(resource);
      }
      return resources;
    },
    async find(hostId) {
      id.parse(hostId);
      const raw = z
        .object({
          servers: z.object({ server: z.array(z.object({ uuid: id })) }),
        })
        .parse(
          await request(
            "/server/?label=" + encodeURIComponent("aw-host-id=" + hostId),
          ),
        );
      if (raw.servers.server.length > 2)
        throw new RuntimeProviderError("upcloud_duplicate_owned_resources");
      const result: UpCloudServer[] = [];
      for (const item of raw.servers.server)
        result.push(owned(await get(item.uuid), hostId));
      return result;
    },
    async stop(providerId) {
      id.parse(providerId);
      await request("/server/" + providerId + "/stop", "POST", {
        stop_server: { stop_type: "hard", timeout: "30" },
      });
    },
    async storageAbsent(storageId) {
      id.parse(storageId);
      try {
        await request("/storage/" + storageId);
        return false;
      } catch (error) {
        if (
          error instanceof RuntimeProviderError &&
          error.code === "upcloud_http_404"
        )
          return true;
        throw error;
      }
    },
    async delete(providerId) {
      id.parse(providerId);
      await request(
        "/server/" + providerId + "/?storages=1&backups=delete",
        "DELETE",
      );
    },
  };
}
