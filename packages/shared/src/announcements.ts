import { z } from "zod";
import { AW_DEPLOYMENT_PROFILES } from "./aw-deployment.js";

export const ANNOUNCEMENT_MANIFEST_MAX_BYTES = 64 * 1024;
export const ANNOUNCEMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const ANNOUNCEMENT_ANIMATION_MAX_BYTES = 128 * 1024;
// Used both in the isolated srcdoc and on the asset endpoint. The HTTP
// response additionally applies CSP sandbox (not supported in a meta tag).
export const ANNOUNCEMENT_ANIMATION_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

// Only stable, company-relative board pages. Never API paths, entity IDs, or
// routes that depend on an experimental feature being enabled.
export const ANNOUNCEMENT_APP_ROUTES = [
  "/dashboard", "/issues", "/projects", "/agents", "/skills", "/apps",
  "/routines", "/artifacts", "/company/settings",
] as const;

export const announcementIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/);
const label = z.string().trim().min(1).max(48);
const httpsUrl = z.string().max(2048).url().refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}, "Use an HTTPS URL without credentials");

export const announcementActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("external"), label, url: httpsUrl }).strict(),
  z.object({ kind: z.literal("route"), label, path: z.enum(ANNOUNCEMENT_APP_ROUTES) }).strict(),
]);

export const productNoticeCategorySchema = z.enum([
  "whats_new", "improvement", "action_required", "deprecation", "security_account", "planned_maintenance", "policy_legal",
]);
const productNoticeResolutionSchema = z.strictObject({
  owner: z.enum(["trust_document_notice_read", "trust_document_acceptance", "trust_document_admin_acknowledgment"]),
  registryEntryId: z.string().uuid(),
  documentRevisionId: z.string().uuid(),
  version: z.string().trim().min(1).max(128),
});
const noticeAudienceSchema = z.strictObject({
  affectedCapabilities: z.array(z.string().trim().min(1).max(128)).max(64).default([]),
  affectedCompanyIds: z.array(z.string().uuid()).max(500).optional(),
  affectedProfiles: z.array(z.enum(AW_DEPLOYMENT_PROFILES)).max(AW_DEPLOYMENT_PROFILES.length).optional(),
  effectiveAt: z.string().datetime({ offset: true }),
  customerImpact: z.string().trim().min(1).max(600),
  actionRequired: z.boolean().default(false),
  actionDeadline: z.string().datetime({ offset: true }).optional(),
  migrationRef: z.string().trim().min(1).max(2048).optional(),
  replacementRef: z.string().trim().min(1).max(2048).optional(),
  resolution: productNoticeResolutionSchema.optional(),
}).superRefine((notice, context) => {
  if (notice.actionRequired && (!notice.resolution || !notice.affectedCompanyIds?.length)) {
    context.addIssue({ code: "custom", message: "Action-required notices need a canonical owner and explicit company scope" });
  }
  if (!notice.actionRequired && notice.resolution) {
    context.addIssue({ code: "custom", message: "A completion owner is only valid for an action-required notice" });
  }
});

export const announcementSchema = z.object({
  id: announcementIdSchema,
  /** Optional classification for search/history; legacy feeds remain general announcements. */
  kind: z.enum(["announcement", "release", "deprecation"]).optional(),
  /** Action-required metadata is a publisher hint. The server projects it as
   * mandatory only while its canonical owner confirms the current state. */
  noticeCategory: productNoticeCategorySchema.optional(),
  notice: noticeAudienceSchema.optional(),
  eyebrow: z.string().trim().min(1).max(48),
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(400),
  publishedAt: z.string().datetime({ offset: true }).optional(),
  image: z.object({
    // Immutable, content-addressed raster assets beneath the feed directory.
    path: z.string().regex(/^assets\/[a-f0-9]{64}\.(png|jpg|webp)$/),
    alt: z.string().max(200),
  }).strict().optional(),
  animation: z.object({
    path: z.string().regex(/^assets\/[a-f0-9]{64}\.html$/),
    alt: z.string().trim().min(1).max(200),
  }).strict().optional(),
  secondaryLink: announcementActionSchema.optional(),
  primaryAction: announcementActionSchema,
  expiresAt: z.string().datetime({ offset: true }).optional(),
  minimumPaperclipVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
}).strict().refine((value) => !value.animation || Boolean(value.image), {
  message: "An animation requires a static fallback image", path: ["image"],
}).superRefine((value, context) => {
  if (value.noticeCategory && !value.notice) {
    context.addIssue({ code: "custom", path: ["notice"], message: "Typed notice categories need customer impact and effective date metadata" });
  }
  if (value.noticeCategory === "action_required" && value.notice?.actionRequired !== true) {
    context.addIssue({ code: "custom", path: ["notice", "actionRequired"], message: "Action-required category must require an action" });
  }
  if (value.notice?.actionRequired === true && value.noticeCategory !== "action_required") {
    context.addIssue({ code: "custom", path: ["noticeCategory"], message: "Action-required metadata needs the action-required category" });
  }
  if (value.noticeCategory === "deprecation" && (!value.notice?.migrationRef || !value.notice?.replacementRef)) {
    context.addIssue({ code: "custom", path: ["notice"], message: "Deprecation notices need migration and replacement references" });
  }
});

export const announcementManifestSchema = z.object({
  schemaVersion: z.literal(1),
  announcement: announcementSchema.nullable(),
  /** Bounded operator-published history; older current-only feeds stay valid. */
  history: z.array(announcementSchema).max(32).optional(),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  for (const item of [manifest.announcement, ...(manifest.history ?? [])]) {
    if (!item) continue;
    if (ids.has(item.id)) context.addIssue({ code: "custom", message: "Announcement IDs must be unique within a manifest", path: ["history"] });
    ids.add(item.id);
  }
});
export const dismissAnnouncementSchema = z.object({ companyId: z.string().uuid() }).strict();
/** Returned only after the matching canonical trust owner confirms this exact
 * current, reviewed acceptance requirement for the requesting company/user. */
export const actionRequiredNoticeProjectionSchema = z.strictObject({
  announcement: announcementSchema,
  mandatoryVisibility: z.literal(true),
  completion: productNoticeResolutionSchema,
});
/** A mandatory policy notice projected from the canonical Trust Document
 * acceptance owner. Its acceptance and content endpoints are company scoped. */
export const trustAcceptanceNoticeProjectionSchema = z.strictObject({
  id: z.string().uuid(),
  category: z.literal("policy_legal"),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(600),
  affectedCompanyId: z.string().uuid(),
  effectiveAt: z.string().datetime({ offset: true }),
  customerImpact: z.string().trim().min(1).max(600),
  actionRequired: z.literal(true),
  actionDeadline: z.null(),
  mandatoryVisibility: z.literal(true),
  canComplete: z.boolean(),
  completion: productNoticeResolutionSchema,
  contentPath: z.string(),
  completionPath: z.string(),
}).superRefine((notice, context) => {
  const prefix = `/companies/${notice.affectedCompanyId}/trust`;
  const completionPath = notice.completion.owner === "trust_document_acceptance" ? `${prefix}/acceptances`
    : notice.completion.owner === "trust_document_notice_read" ? `${prefix}/notices/read`
      : `${prefix}/admin-acknowledgments`;
  if (notice.contentPath !== `${prefix}/documents/${notice.completion.registryEntryId}/content` || notice.completionPath !== completionPath)
    context.addIssue({ code: "custom", message: "Trust notice actions must bind the exact company and canonical owner record" });
  if (notice.completion.owner === "trust_document_admin_acknowledgment" && !notice.canComplete)
    return;
});
export const trustAcceptanceNoticeListSchema = z.strictObject({
  configured: z.boolean(),
  notices: z.array(trustAcceptanceNoticeProjectionSchema).max(100),
});
export type AnnouncementAction = z.infer<typeof announcementActionSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementManifest = z.infer<typeof announcementManifestSchema>;
export type ActionRequiredNoticeProjection = z.infer<typeof actionRequiredNoticeProjectionSchema>;
export type TrustAcceptanceNoticeProjection = z.infer<typeof trustAcceptanceNoticeProjectionSchema>;

export function isAnnouncementTargetedTo(announcement: Announcement, companyId: string, profile: string): boolean {
  const scope = announcement.notice;
  if (!scope) return false;
  if (scope.affectedCompanyIds && !scope.affectedCompanyIds.includes(companyId)) return false;
  if (scope.affectedProfiles && !scope.affectedProfiles.includes(profile as (typeof AW_DEPLOYMENT_PROFILES)[number])) return false;
  return true;
}

export function isAnnouncementEligible(announcement: Announcement, version: string, now = Date.now()): boolean {
  if (announcement.expiresAt && Date.parse(announcement.expiresAt) <= now) return false;
  if (!announcement.minimumPaperclipVersion) return true;
  const installed = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!installed) return false;
  const minimum = announcement.minimumPaperclipVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = Number(installed[i + 1]) - minimum[i]!;
    if (difference !== 0) return difference > 0;
  }
  return !installed[4]; // A prerelease of the minimum is not that release yet.
}
