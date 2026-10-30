import { z } from "zod";
import { PRODUCT_IDENTITY } from "./product-identity.js";

export const SERVICE_COMPONENT_NAMES = ["Blentera app", "Agent work / managed runtime", "Apps & connections", "Notifications", "Authentication"] as const;
const text = z.string().min(1).max(300).regex(/^[^\u0000-\u001f\u007f\uD800-\uDFFF]+$/u);
const date = z.iso.datetime({ offset: true });
const component = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.enum(SERVICE_COMPONENT_NAMES), status: z.enum(["operational", "degraded_performance", "partial_outage", "major_outage", "under_maintenance"]) });
const communication = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: text,
  status: z.enum(["investigating", "identified", "monitoring", "resolved", "postmortem", "scheduled", "in_progress", "verifying", "completed"]),
  updatedAt: date, href: z.url().refine(value => {
    const url = new URL(value);
    return url.origin === PRODUCT_IDENTITY.statusOrigin && !url.username && !url.password && !url.search && !url.hash && /^\/incidents\/[a-zA-Z0-9_-]{1,100}$/.test(url.pathname);
  }), componentIds: z.array(z.string()).max(128),
  scheduledFor: date.nullable(), scheduledUntil: date.nullable(),
});
export const serviceHealthProjectionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.enum(["unconfigured", "unavailable"]), statusUrl: z.literal(PRODUCT_IDENTITY.statusOrigin) }),
  z.strictObject({ state: z.literal("current"), statusUrl: z.literal(PRODUCT_IDENTITY.statusOrigin), source: z.literal("statuspage_public_v2"),
    customerImpact: z.literal("unknown"),
    observedAt: date, providerUpdatedAt: date, indicator: z.enum(["none", "minor", "major", "critical", "maintenance"]),
    components: z.array(component).max(128), incidents: z.array(communication).max(64), scheduledMaintenance: z.array(communication).max(64),
  }),
]);
export type ServiceHealthProjection = z.infer<typeof serviceHealthProjectionSchema>;
