import { createHash } from "node:crypto";
import type {
  WorkflowRevision,
  WorkflowExperienceRevision,
  WorkflowExperience,
} from "@paperclipai/shared";

/** Private values are compared in-process; only bounded structural indicators leave this owner. */
export function workflowComparison(
  active: WorkflowRevision | null,
  draft: WorkflowRevision | null,
  activeView: WorkflowExperienceRevision | null,
  draftView: WorkflowExperienceRevision | null,
  draftNodeOrder: string[],
): WorkflowExperience["comparison"] {
  if (!active || !draft) return null;
  if (activeView?.coverage !== "complete" || draftView?.coverage !== "complete")
    return { state: "unavailable" };
  // Aggregate budgets include both revisions, preventing a large private config
  // from escaping the projection's bounded-work contract. Failure exposes no values.
  let entries = 0,
    characters = 0;
  const signature = (input: unknown) => {
    const hash = createHash("sha256");
    const emit = (value: string) => {
      characters += value.length;
      if (characters > 262144) throw new Error("Comparison budget exceeded");
      hash.update(value);
    };
    const visit = (value: unknown, depth: number) => {
      if (++entries > 20000 || depth > 32)
        throw new Error("Comparison budget exceeded");
      if (value === null) {
        emit("null");
        return;
      }
      if (typeof value === "string") {
        if (value.length > 262144)
          throw new Error("Comparison budget exceeded");
        emit(JSON.stringify(value));
        return;
      }
      if (
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        emit(JSON.stringify(value));
        return;
      }
      if (Array.isArray(value)) {
        if (value.length > 20000) throw new Error("Comparison budget exceeded");
        emit("[");
        for (const item of value) {
          visit(item ?? null, depth + 1);
          emit(",");
        }
        emit("]");
        return;
      }
      if (
        typeof value !== "object" ||
        !value ||
        Object.getPrototypeOf(value) !== Object.prototype
      )
        throw new Error("Unsupported comparison value");
      const keys = Object.keys(value);
      if (keys.length > 20000) throw new Error("Comparison budget exceeded");
      emit("{");
      for (const key of keys.sort()) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined) continue;
        if (key.length > 262144) throw new Error("Comparison budget exceeded");
        emit(JSON.stringify(key));
        emit(":");
        visit(item, depth + 1);
        emit(",");
      }
      emit("}");
    };
    visit(input, 0);
    return hash.digest("hex");
  };
  try {
    const oldNodes = new Map(active.graph.nodes.map((node) => [node.id, node]));
    const newIds = new Set(draft.graph.nodes.map((node) => node.id));
    const nodeSignature = (node: (typeof draft.graph.nodes)[number]) => {
      const { position: _position, ...material } = node;
      return signature(material);
    };
    // Match native IDs, never array position or display name. Layout is presentation only.
    const changed = new Map<string, "added" | "changed">();
    for (const node of draft.graph.nodes) {
      const previous = oldNodes.get(node.id);
      if (!previous) changed.set(node.id, "added");
      else if (nodeSignature(previous) !== nodeSignature(node))
        changed.set(node.id, "changed");
    }
    const sortedEdges = (revision: WorkflowRevision) =>
      [...revision.graph.edges].sort((a, b) => a.id.localeCompare(b.id));
    // Reuse the validated native dependency order used by the visible review.
    const numbers = new Map(draftNodeOrder.map((id, index) => [id, index + 1]));
    if (
      numbers.size !== newIds.size ||
      [...newIds].some((id) => !numbers.has(id))
    )
      return { state: "unavailable" };
    return {
      state: "available",
      steps: [...changed]
        .map(([id, change]) => ({ number: numbers.get(id)!, change }))
        .sort((a, b) => a.number - b.number),
      removedSteps: active.graph.nodes.filter((node) => !newIds.has(node.id))
        .length,
      connectionsChanged:
        signature(sortedEdges(active)) !== signature(sortedEdges(draft)),
      dataDefinitionChanged:
        signature({
          variables: active.graph.variables,
          input: active.inputSchema,
          output: active.outputSchema,
        }) !==
        signature({
          variables: draft.graph.variables,
          input: draft.inputSchema,
          output: draft.outputSchema,
        }),
      settingsChanged:
        signature(active.graph.settings) !== signature(draft.graph.settings),
    };
  } catch {
    return { state: "unavailable" };
  }
}
