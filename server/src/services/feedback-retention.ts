import {
  FEEDBACK_RETENTION_DEFAULTS,
  feedbackRetentionConfigurationSchema,
  type FeedbackRetentionConfiguration,
} from "@paperclipai/shared";

export function loadFeedbackRetentionConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<FeedbackRetentionConfiguration> {
  const raw = env.AW_FEEDBACK_RETENTION_JSON;
  if (raw === undefined) return FEEDBACK_RETENTION_DEFAULTS;
  try {
    if (Buffer.byteLength(raw, "utf8") > 1024) throw new Error();
    return Object.freeze(feedbackRetentionConfigurationSchema.parse(JSON.parse(raw)));
  } catch {
    throw new Error("Invalid feedback retention configuration");
  }
}

const DAY = 86_400_000;
function time(value: Date) {
  const result = value.getTime();
  if (!Number.isFinite(result)) throw new Error("Invalid feedback retention clock");
  return result;
}
function addMonths(value: Date, months: number) {
  const next = new Date(time(value));
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(next.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  next.setUTCDate(Math.min(day, last.getUTCDate()));
  return next.getTime();
}

/** A planning decision only. The native executor must load current dates,
 * operator-approved extension and incident/legal hold from their original
 * owner under locks, and confirm physical object removal before deletion.
 * Follow-up messages use the feedback case deadline to avoid orphan content.
 * No scheduler or customer-data deletion is enabled by this function. */
export function evaluateFeedbackRetention(input: {
  now: Date;
  createdAt: Date;
  closedAt: Date | null;
  imageCreatedAt?: Date;
  extendedUntil: Date | null;
  legalHold: { releaseAt: Date | null } | null;
}, config: Readonly<FeedbackRetentionConfiguration>) {
  const now = time(input.now), created = time(input.createdAt);
  feedbackRetentionConfigurationSchema.parse(config);
  if (created > now || (input.closedAt && (time(input.closedAt) < created || time(input.closedAt) > now)))
    throw new Error("Invalid feedback retention lifecycle");
  const held = input.legalHold !== null &&
    (input.legalHold.releaseAt === null || time(input.legalHold.releaseAt) > now);
  let deadline = input.closedAt
    ? time(input.closedAt) + config.closedFeedbackDays * DAY
    : addMonths(input.createdAt, config.openFeedbackMonths);
  if (input.extendedUntil) deadline = Math.max(deadline, time(input.extendedUntil));
  const imageDeadline = input.imageCreatedAt
    ? time(input.imageCreatedAt) + config.imageDays * DAY : null;
  if (input.imageCreatedAt && time(input.imageCreatedAt) > now)
    throw new Error("Invalid feedback retention lifecycle");
  return Object.freeze({
    held,
    caseDueAt: new Date(deadline).toISOString(),
    imageDueAt: imageDeadline === null ? null : new Date(imageDeadline).toISOString(),
    caseEligible: !held && deadline <= now,
    imageEligible: !held && imageDeadline !== null && imageDeadline <= now,
  });
}
