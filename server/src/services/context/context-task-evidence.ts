import { createHash } from "node:crypto";

export function nativeContextTaskEvidence(task: {
  identifier?: string | null;
  title: string;
  status: string;
  priority: string;
  description?: string | null;
}) {
  return {
    title: task.identifier ? `${task.identifier}: ${task.title}` : task.title,
    excerpt: ([
      `Status: ${task.status}`,
      `Priority: ${task.priority}`,
      task.description?.trim() ? `Description: ${task.description.trim()}` : null,
    ].filter(Boolean).join("\n") || task.title).slice(0, 60_000),
  };
}

export function nativeContextTaskEvidenceHash(evidence: { title: string; excerpt: string }) {
  return createHash("sha256").update(JSON.stringify({ title: evidence.title, excerpt: evidence.excerpt })).digest("hex");
}
