import {
  notificationPolicySchema,
  type NotificationPolicy,
} from "@paperclipai/shared";
export type NotificationDelivery =
  | { channel: "in_app_only" }
  | {
      channel: "email";
      notBefore: Date;
      groupKey: string | null;
      mandatory: boolean;
    };
/** Delivery scheduling only. It cannot approve work or manufacture a business deadline.
 * UTC minute iteration follows actual local time through DST folds/gaps. */
export function routeNotification(input: {
  category: string;
  emailEnabled: boolean;
  policy?: NotificationPolicy | null;
  now: Date;
}): NotificationDelivery {
  if (input.category === "security")
    return {
      channel: "email",
      notBefore: input.now,
      groupKey: null,
      mandatory: true,
    };
  if (!input.emailEnabled) return { channel: "in_app_only" };
  if (!input.policy)
    return {
      channel: "email",
      notBefore: input.now,
      groupKey: null,
      mandatory: false,
    };
  const parsed = notificationPolicySchema.safeParse(input.policy);
  // Invalid persisted policy must never silently turn into a new interruption.
  if (!parsed.success) return { channel: "in_app_only" };
  const policy = parsed.data;
  if (policy.cadence === "in_app_only") return { channel: "in_app_only" };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: policy.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
  const quiet = (minute: number) =>
    !!policy.quietHours &&
    (policy.quietHours.startMinute < policy.quietHours.endMinute
      ? minute >= policy.quietHours.startMinute &&
        minute < policy.quietHours.endMinute
      : minute >= policy.quietHours.startMinute ||
        minute < policy.quietHours.endMinute);
  let candidate =
    policy.cadence === "digest"
      ? new Date(Math.ceil(input.now.getTime() / 60000) * 60000)
      : new Date(input.now);
  const startDate = parts(candidate),
    startMinute = Number(startDate.hour) * 60 + Number(startDate.minute);
  let digestReached = policy.cadence !== "digest";
  for (
    let n = 0;
    n <= 27 * 60;
    n++,
      candidate = new Date(
        Math.floor(candidate.getTime() / 60000) * 60000 + 60000,
      )
  ) {
    const local = parts(candidate),
      minute = Number(local.hour) * 60 + Number(local.minute);
    // A nonexistent spring-forward digest time resolves at the first later local minute;
    // the grouping date keeps the repeated autumn hour from sending a second digest.
    const sameDay =
      local.year === startDate.year &&
      local.month === startDate.month &&
      local.day === startDate.day;
    if (
      !digestReached &&
      minute >= policy.digestMinute &&
      (!sameDay || startMinute <= policy.digestMinute)
    )
      digestReached = true;
    if (digestReached && !quiet(minute))
      return {
        channel: "email",
        notBefore: candidate,
        groupKey:
          policy.cadence === "digest"
            ? `digest:${policy.timezone}:${local.year}-${local.month}-${local.day}`
            : null,
        mandatory: false,
      };
  }
  return { channel: "in_app_only" };
}
