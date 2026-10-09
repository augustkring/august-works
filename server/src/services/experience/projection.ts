import type {
  ExperienceCard,
  ExperienceDependency,
  ExperienceModel,
  ExperienceProfile,
} from "@paperclipai/shared";
import { experienceModelSchema } from "@paperclipai/shared";

export type ExperienceSection = "needsYou" | "inProgress" | "done" | "watch";
export interface ExperienceReader {
  domain: string;
  read: (
    signal: AbortSignal,
  ) => Promise<Partial<Record<ExperienceSection, ExperienceCard[]>>>;
}
export class ExperienceOverloadError extends Error {}
/** Keep admission occupied until underlying work settles, including after timeout. */
let activeReads = 0;
const MAX_ACTIVE_READS = 8;
const MAX_DEPENDENCIES = 8;
export async function composeExperience(input: {
  companyId: string;
  profile: ExperienceProfile;
  readers: ExperienceReader[];
  signal?: AbortSignal;
  deadlineMs?: number;
  now?: () => Date;
}): Promise<ExperienceModel> {
  if (
    input.readers.length > MAX_DEPENDENCIES ||
    activeReads + input.readers.length > MAX_ACTIVE_READS
  ) {
    throw new ExperienceOverloadError(
      "Experience projection is busy; retry later",
    );
  }
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const controller = new AbortController();
  const deadline = Math.max(1, Math.min(1500, input.deadlineMs ?? 1500));
  const sections: Record<ExperienceSection, ExperienceCard[]> = {
    needsYou: [],
    inProgress: [],
    done: [],
    watch: [],
  };
  const dependencies: ExperienceDependency[] = [];
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), deadline);
  activeReads += input.readers.length;
  try {
    await Promise.all(
      input.readers.map(async (reader) => {
        let abortListener: (() => void) | undefined;
        const pending = Promise.resolve()
          .then(() => {
            if (controller.signal.aborted)
              throw new Error("Projection cancelled");
            return reader.read(controller.signal);
          })
          .finally(() => {
            activeReads--;
          });
        // Promise.race observes late rejections; timed-out readers cannot mutate the result.
        const timeout = new Promise<never>((_, reject) => {
          abortListener = () =>
            reject(new Error("Projection deadline exceeded"));
          if (controller.signal.aborted) abortListener();
          else
            controller.signal.addEventListener("abort", abortListener, {
              once: true,
            });
        });
        try {
          const result = await Promise.race([pending, timeout]);
          const validated = experienceModelSchema.parse({
            companyId: input.companyId,
            profile: input.profile,
            generatedAt,
            dependencies: [],
            needsYou: [],
            inProgress: [],
            done: [],
            watch: [],
            ...result,
          });
          for (const section of Object.keys(sections) as ExperienceSection[]) {
            if (result[section])
              sections[section].push(...validated[section].slice(0, 25));
          }
          dependencies.push({
            domain: reader.domain,
            state: "fresh",
            observedAt: now().toISOString(),
            reason: null,
          });
        } catch {
          dependencies.push({
            domain: reader.domain,
            state: "unavailable",
            observedAt: null,
            reason: controller.signal.aborted ? "timeout" : "failure",
          });
        } finally {
          if (abortListener)
            controller.signal.removeEventListener("abort", abortListener);
        }
      }),
    );
    for (const section of Object.keys(sections) as ExperienceSection[]) {
      sections[section] = [
        ...new Map(
          sections[section].map((card) => [
            `${card.source.domain}:${card.source.resourceId}`,
            card,
          ]),
        ).values(),
      ].slice(0, 25);
    }
    return experienceModelSchema.parse({
      companyId: input.companyId,
      profile: input.profile,
      generatedAt,
      dependencies,
      ...sections,
    });
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
