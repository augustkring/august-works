import type { WorkSignalView } from "@paperclipai/shared";

type Candidate = Pick<WorkSignalView, "signalType" | "confidence"> & { facts: NonNullable<WorkSignalView["facts"]> };
/** Conservative local extraction. A participant assertion is evidence to review,
 * never permission, verified completion or a binding business commitment. */
export function interpretWorkSignals(text: string): Candidate[] {
  if (!text.trim() || text.length > 16_000) return [];
  // Instructions addressed to the interpreter cannot create governance facts.
  if (/ignore.{0,40}(instructions|rules|policy)|system prompt|bypass.{0,40}(approval|permission)|ignorer.{0,40}(regler|instruktioner)/i.test(text)) return [];
  const uncertain = /\b(maybe|perhaps|possibly|might|could|tentative|måske|muligvis|eventuelt)\b/i.test(text);
  const result: Candidate[] = [];
  const add = (signalType: Candidate["signalType"], reason: string, date?: string) => result.push({ signalType, confidence: uncertain ? "uncertain" : "explicit", facts: { reason, ...(date ? { date } : {}) } });
  if (!uncertain && /\b(deadline|due|deliver by|finish by|frist|leverer senest|færdig senest)\b/i.test(text)) {
    const dates = [...text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m => m[1]!);
    const instant = new Date(`${dates[0]}T00:00:00.000Z`);
    if (dates.length === 1 && Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === dates[0]) add("deadline_change", "explicit_calendar_date", dates[0]);
  }
  if (/\b(i (have )?(finished|completed)|i'?m done|jeg (er færdig|har afsluttet))\b/i.test(text)) add("completion_claim", "participant_completion_claim");
  if (/\b(blocked|blocker|blokeret|blokerer)\b/i.test(text)) add("blocker", "participant_blocker_claim");
  if (/\b(i will|i commit|i promise|jeg vil|jeg lover)\b/i.test(text)) add("commitment", "participant_commitment_claim");
  if (/\b(new owner|reassign|overtager|ny ejer)\b/i.test(text)) add("owner_change", "participant_owner_change_claim");
  if (/\b(we decided|decision|vi besluttede|beslutning)\b/i.test(text)) add("decision", "participant_decision_claim");
  if (/\b(please approve|approval needed|godkend venligst|kræver godkendelse)\b/i.test(text)) add("approval_request", "participant_approval_request");
  if (/\b(risk|risiko)\b/i.test(text)) add("risk", "participant_risk_claim");
  if (/\b(project update|status update|projektstatus|statusopdatering)\b/i.test(text)) add("project_update", "participant_project_update");
  if (/\b(new task|create a task|ny opgave|opret en opgave)\b/i.test(text)) add("new_task", "participant_task_request");
  if (/\b(correction|correcting|rettelse|retter)\b/i.test(text)) add("correction", "participant_correction_claim");
  return result.slice(0, 8);
}
