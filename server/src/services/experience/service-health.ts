import { z } from "zod";
import { PRODUCT_IDENTITY, SERVICE_COMPONENT_NAMES, serviceHealthProjectionSchema, type ServiceHealthProjection } from "@paperclipai/shared";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";
import { readAnnouncementBytes as readBoundedResponseBytes } from "../announcement-feed.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const date = z.iso.datetime({ offset: true });
const component = z.object({ id, name: z.enum(SERVICE_COMPONENT_NAMES),
  status: z.enum(["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"]) });
const communication = z.object({ id, name: z.string().min(1).max(300),
  status: z.enum(["investigating", "identified", "monitoring", "resolved", "postmortem", "scheduled", "in_progress", "verifying", "completed"]),
  updated_at: date, components: z.array(z.object({ id })).max(128),
  scheduled_for: date.nullable().optional(), scheduled_until: date.nullable().optional(),
});
const summary = z.object({ page: z.object({ url: z.url(), updated_at: date }),
  status: z.object({ indicator: z.enum(["none", "minor", "major", "critical", "maintenance"]) }),
  components: z.array(component).min(1).max(128), incidents: z.array(communication).max(64),
  scheduled_maintenances: z.array(communication).max(64),
});

/** Read-only projection of the managed provider's public communication owner.
 * No tenant input, provider credential, subscriber address or local incident
 * authority enters this adapter. The independent status page remains usable
 * when this application/auth path is down. */
export function managedServiceHealth(options: {
  enabled: boolean;
  fetch?: (url: URL, init: RequestInit) => Promise<Response>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const statusUrl = PRODUCT_IDENTITY.statusOrigin;
  const fetchRemote = options.fetch ?? ((url, init) => guardedRemoteHttpFetch(url, init, {
    error: () => new Error("Service status unavailable"), dnsTimeoutMs: 3000, connectTimeoutMs: 3000, responseTimeoutMs: 3000,
  }));
  let cached: ServiceHealthProjection = { state: "unavailable", statusUrl };
  let expires = 0;
  let pending: Promise<ServiceHealthProjection> | null = null;
  async function refresh(): Promise<ServiceHealthProjection> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetchRemote(new URL("/api/v2/summary.json", statusUrl), {
            method: "GET", headers: { accept: "application/json" }, redirect: "error", credentials: "omit", signal: controller.signal,
          });
          if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
            await response.body?.cancel(); throw new Error();
          }
          const source = summary.parse(JSON.parse((await readBoundedResponseBytes(response, 256 * 1024)).toString("utf8")));
          const page = new URL(source.page.url);
          if (page.origin !== statusUrl || page.username || page.password || page.search || page.hash) throw new Error();
          if (Date.parse(source.page.updated_at) > now() + 5 * 60_000) throw new Error();
          const componentIds = new Set(source.components.map(value => value.id));
          if (componentIds.size !== source.components.length) throw new Error();
          function project(item: z.infer<typeof communication>) {
            if (item.components.some(value => !componentIds.has(value.id))) throw new Error();
            if (Date.parse(item.updated_at) > now() + 5 * 60_000 ||
                item.scheduled_for && item.scheduled_until && Date.parse(item.scheduled_until) < Date.parse(item.scheduled_for)) throw new Error();
            return { id: item.id, name: item.name, status: item.status, updatedAt: item.updated_at,
              href: new URL(`/incidents/${item.id}`, statusUrl).href, componentIds: item.components.map(value => value.id),
              scheduledFor: item.scheduled_for ?? null, scheduledUntil: item.scheduled_until ?? null };
          }
          if (new Set([...source.incidents, ...source.scheduled_maintenances].map(item => item.id)).size !== source.incidents.length + source.scheduled_maintenances.length ||
              source.incidents.some(item => !["investigating", "identified", "monitoring", "resolved", "postmortem"].includes(item.status)) ||
              source.scheduled_maintenances.some(item => !["scheduled", "in_progress", "verifying", "completed"].includes(item.status))) throw new Error();
          return serviceHealthProjectionSchema.parse({ state: "current", statusUrl, source: "statuspage_public_v2",
            observedAt: new Date(now()).toISOString(), providerUpdatedAt: source.page.updated_at,
            indicator: source.status.indicator, components: source.components,
            incidents: source.incidents.map(project), scheduledMaintenance: source.scheduled_maintenances.map(project),
          });
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error()); }, 3000); }),
      ]);
      return result;
    } catch {
      // Never turn missing, invalid, timed-out or stale provider data into an
      // all-clear. No raw provider body or diagnostic is published/logged.
      return { state: "unavailable", statusUrl };
    } finally { clearTimeout(timer!); controller.abort(); }
  }
  return { async read(): Promise<ServiceHealthProjection> {
    if (!options.enabled) return { state: "unconfigured", statusUrl };
    if (pending) return pending;
    if (now() < expires) return cached;
    pending = refresh().then(result => { cached = result; expires = now() + 30_000; return result; }).finally(() => { pending = null; });
    return pending;
  } };
}

export function managedServiceHealthFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  const setting = env.BLENTERA_STATUSPAGE_ENABLED;
  if (setting !== undefined && setting !== "true" && setting !== "false")
    throw new Error("BLENTERA_STATUSPAGE_ENABLED must be true or false");
  return managedServiceHealth({ enabled: setting === "true" });
}
