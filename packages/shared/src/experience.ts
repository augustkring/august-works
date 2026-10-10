import { z } from "zod";

export const EXPERIENCE_PROFILES = [
  "member",
  "manager",
  "admin",
  "security_admin",
] as const;
export const experienceProfileSchema = z.enum(EXPERIENCE_PROFILES);
export type ExperienceProfile = z.infer<typeof experienceProfileSchema>;
/** Stable expert destinations. Arbitrary agent-generated routes are forbidden. */
export const EXPERIENCE_ADVANCED_DESTINATIONS = {
  custom_agent: "/agents/custom",
  foundation: "/foundation",
  workflows: "/workflows",
  runtime: "/company/settings/runtime",
  tool_gateway: "/apps/gateways",
  audit: "/activity",
  role_packs: "/role-packs",
  skills: "/skills/studio",
  playbooks: "/playbooks",
  agent_identities: "/runtime",
  organization: "/org-units",
  relationships: "/relationships",
  portfolio: "/portfolio",
  shared_capabilities: "/portfolio-capabilities",
  memory: "/memory",
  derived_intelligence: "/memory/intelligence",
  learning: "/memory/learning",
  cognitive_providers: "/memory/cognitive",
  readiness: "/readiness",
  orchestration: "/orchestration",
  security_events: "/company/settings/security-events",
  experimental: "/company/settings/instance/experimental",
} as const;
type AdvancedId = keyof typeof EXPERIENCE_ADVANCED_DESTINATIONS;
const advancedIds = Object.keys(EXPERIENCE_ADVANCED_DESTINATIONS) as [
  AdvancedId,
  ...AdvancedId[],
];
export const experienceAdvancedLinkSchema = z
  .strictObject({
    id: z.enum(advancedIds),
    href: z.string().max(200),
  })
  .superRefine((link, ctx) => {
    if (EXPERIENCE_ADVANCED_DESTINATIONS[link.id] !== link.href)
      ctx.addIssue({
        code: "custom",
        message: "Advanced destination must match its stable ID",
        path: ["href"],
      });
  });
export const experienceCriticalitySchema = z.enum([
  "C0",
  "C1",
  "C2",
  "C3",
  "C4",
]);
export const experienceFreshnessSchema = z.enum([
  "fresh",
  "stale",
  "partial",
  "unavailable",
]);
const boundedText = z.string().trim().min(1).max(2000);
export const canonicalExperienceSourceSchema = z
  .object({
    domain: z.enum([
      "task",
      "attention",
      "agent",
      "approval",
      "workflow",
      "readiness",
      "connection",
      "insight",
      "feedback",
    ]),
    companyId: z.uuid(),
    resourceId: boundedText,
    version: boundedText,
    observedAt: z.iso.datetime(),
  })
  .strict();

/** Navigation only. Effectful operations always use their canonical API and authorization. */
export const experienceActionSchema = z
  .object({
    id: boundedText,
    label: boundedText,
    labelKey: z.enum(["review", "view_result", "view_task"]).optional(),
    operation: z.enum([
      "open",
      "approve",
      "reject",
      "answer",
      "reconnect",
      "retry",
      "snooze",
      "dismiss",
      "stop",
      "publish",
    ]),
    href: z
      .string()
      .max(1000)
      .regex(/^\/(?!\/)[^\\\r\n]*$/),
    criticality: experienceCriticalitySchema,
    source: canonicalExperienceSourceSchema,
    requiresCurrentAuthorization: z.literal(true),
  })
  .strict();
export const EXPERIENCE_CARD_KINDS = [
  "approval",
  "decision",
  "question",
  "permission",
  "connection",
  "progress",
  "result",
  "recovery",
  "draft",
  "workflow",
  "agent",
  "insight",
  "warning",
  "receipt",
  "confirmation",
  "maintenance",
  "feedback",
  "status",
] as const;
export const experienceCardSchema = z
  .object({
    id: boundedText,
    kind: z.enum(EXPERIENCE_CARD_KINDS),
    title: boundedText,
    whyYou: boundedText.nullable(),
    consequence: boundedText.nullable(),
    source: canonicalExperienceSourceSchema,
    freshness: experienceFreshnessSchema,
    actions: z.array(experienceActionSchema).max(8),
    evidence: z.array(boundedText).max(8),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (
      card.freshness !== "fresh" &&
      card.actions.some((a) => a.operation !== "open")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Stale or unavailable cards cannot carry executable actions",
        path: ["actions"],
      });
    }
    if (
      card.actions.some((a) => a.source.companyId !== card.source.companyId)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Action and card must share company scope",
        path: ["actions"],
      });
    }
  });
export type ExperienceCard = z.infer<typeof experienceCardSchema>;
export type ExperienceAction = z.infer<typeof experienceActionSchema>;
export const experienceDependencySchema = z
  .object({
    domain: boundedText,
    state: experienceFreshnessSchema,
    observedAt: z.iso.datetime().nullable(),
    reason: z
      .enum([
        "timeout",
        "overload",
        "denied",
        "failure",
        "source_stale",
        "more_items_available",
      ])
      .nullable(),
  })
  .strict()
  .superRefine((dependency, ctx) => {
    if (
      dependency.reason === "more_items_available" &&
      (dependency.state !== "partial" || dependency.observedAt === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A native page boundary is observed partial coverage",
        path: ["state"],
      });
    }
  });
export const experienceModelSchema = z
  .object({
    companyId: z.uuid(),
    profile: experienceProfileSchema,
    availableProfiles: z
      .array(experienceProfileSchema)
      .min(1)
      .max(4)
      .optional(),
    advancedLinks: z.array(experienceAdvancedLinkSchema).max(22).optional(),
    generatedAt: z.iso.datetime(),
    dependencies: z.array(experienceDependencySchema).max(8),
    needsYou: z.array(experienceCardSchema).max(25),
    inProgress: z.array(experienceCardSchema).max(25),
    done: z.array(experienceCardSchema).max(25),
    watch: z.array(experienceCardSchema).max(25),
  })
  .strict()
  .superRefine((model, ctx) => {
    if (
      new Set(model.advancedLinks?.map((link) => link.id)).size !==
      (model.advancedLinks?.length ?? 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Advanced destinations must be unique",
        path: ["advancedLinks"],
      });
    for (const section of [
      "needsYou",
      "inProgress",
      "done",
      "watch",
    ] as const) {
      if (
        model[section].some((card) => card.source.companyId !== model.companyId)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Projection cannot cross company boundaries",
          path: [section],
        });
      }
    }
  });
export type ExperienceModel = z.infer<typeof experienceModelSchema>;
export type ExperienceDependency = z.infer<typeof experienceDependencySchema>;

export const EXPERIENCE_NAVIGATION = [
  {
    id: "home",
    label: "Home",
    href: "/dashboard",
    profiles: EXPERIENCE_PROFILES,
  },
  {
    id: "needs_you",
    label: "Needs You",
    href: "/needs-you",
    profiles: EXPERIENCE_PROFILES,
  },
  { id: "work", label: "Work", href: "/work", profiles: EXPERIENCE_PROFILES },
  {
    id: "agents",
    label: "Agents",
    href: "/agents",
    profiles: EXPERIENCE_PROFILES,
  },
  { id: "apps", label: "Apps", href: "/apps", profiles: EXPERIENCE_PROFILES },
  {
    id: "insights",
    label: "Insights",
    href: "/insights",
    profiles: ["manager", "admin", "security_admin"],
  },
  {
    id: "company",
    label: "Company",
    href: "/company/settings",
    profiles: ["admin", "security_admin"],
  },
] as const;
/** A preference can reduce depth. Increasing depth must already be authorized. */
type ProfileAuthority = {
  membershipRole: string | null;
  canManageCompany: boolean;
  canManageSecurity: boolean;
  preferred?: ExperienceProfile;
};
export function authorizedExperienceProfiles(
  input: ProfileAuthority,
): ExperienceProfile[] {
  const maximum: ExperienceProfile = input.canManageSecurity
    ? "security_admin"
    : input.canManageCompany
      ? "admin"
      : input.membershipRole === "owner"
        ? "manager"
        : "member";
  return EXPERIENCE_PROFILES.slice(0, EXPERIENCE_PROFILES.indexOf(maximum) + 1);
}
export function resolveExperienceProfile(
  input: ProfileAuthority,
): ExperienceProfile {
  const authorized = authorizedExperienceProfiles(input);
  const maximum = authorized.at(-1)!;
  const rank = EXPERIENCE_PROFILES.indexOf(maximum);
  if (input.preferred && EXPERIENCE_PROFILES.indexOf(input.preferred) <= rank)
    return input.preferred;
  return input.membershipRole === "owner" ? "manager" : maximum;
}

export const EXPERIENCE_SCREEN_STATES = [
  "loading",
  "empty",
  "partial",
  "stale",
  "validation_error",
  "system_error",
  "permission_denied",
  "recovering",
  "success",
] as const;
export const experienceScreenContractSchema = z
  .object({
    screenId: boundedText,
    journeyId: boundedText,
    routeOrSurface: boundedText,
    targetExperienceProfiles: z.array(experienceProfileSchema).min(1),
    customerOutcome: boundedText,
    entryConditions: z.array(boundedText).min(1),
    exitConditions: z.array(boundedText).min(1),
    content: z
      .object({
        h1: boundedText,
        supportingCopy: boundedText,
        customerTerms: z.array(boundedText),
        displayedState: z.array(boundedText),
      })
      .strict(),
    inputs: z.array(
      z
        .object({
          id: boundedText,
          label: boundedText,
          dataType: boundedText,
          required: z.boolean(),
          default: boundedText,
          help: boundedText,
          validation: boundedText,
          autofillOrPrefill: boundedText,
        })
        .strict(),
    ),
    actions: z
      .object({
        primary: z
          .object({ label: boundedText, operation: boundedText })
          .strict(),
        secondary: z.array(boundedText),
        destructiveOrIrreversible: z.array(boundedText),
      })
      .strict(),
    systemWork: z
      .object({
        canonicalReadDomains: z.array(boundedText).min(1),
        canonicalWriteOperation: boundedText,
        authorityEffect: boundedText,
        asyncWork: boundedText,
        receipt: boundedText,
      })
      .strict(),
    states: z
      .object(
        Object.fromEntries(
          EXPERIENCE_SCREEN_STATES.map((state) => [state, boundedText]),
        ) as Record<
          (typeof EXPERIENCE_SCREEN_STATES)[number],
          typeof boundedText
        >,
      )
      .strict(),
    navigation: z
      .object({
        back: boundedText,
        cancelOrSaveExit: boundedText,
        deepLink: boundedText,
        resume: boundedText,
      })
      .strict(),
    accessibility: z
      .object({
        initialFocus: boundedText,
        focusAfterError: boundedText,
        focusAfterSuccess: boundedText,
        keyboardModel: boundedText,
        statusAnnouncement: boundedText,
        targetSize: boundedText,
        zoomReflow: boundedText,
        reducedMotion: boundedText,
        screenReaderNotes: boundedText,
      })
      .strict(),
    responsive: z
      .object({ wide: boundedText, narrow: boundedText, mobile: boundedText })
      .strict(),
    privacySecurity: z
      .object({
        dataShown: z.array(boundedText),
        dataCollected: z.array(boundedText),
        sensitiveFields: z.array(boundedText),
        loggingConstraints: boundedText,
      })
      .strict(),
    analytics: z
      .object({
        allowedEvents: z.array(boundedText),
        prohibitedPayloads: z.array(boundedText).min(1),
      })
      .strict(),
    acceptance: z
      .object({
        functional: z.array(boundedText).min(1),
        accessibility: z.array(boundedText).min(1),
        securityPrivacy: z.array(boundedText).min(1),
        usability: z.array(boundedText).min(1),
      })
      .strict(),
  })
  .strict();
export type ExperienceScreenContract = z.infer<
  typeof experienceScreenContractSchema
>;
