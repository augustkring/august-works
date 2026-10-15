import { makeAssistantToolUI } from "@assistant-ui/react";
import { EXPERIENCE_CARD_TOOL_NAMES } from "@paperclipai/shared";
import { ExperienceToolCard } from "./ExperienceToolCard";

/** Register a display renderer only; no tool implementation, approval bypass or result submission. */
const renderers = EXPERIENCE_CARD_TOOL_NAMES.map(toolName => makeAssistantToolUI<unknown, unknown>({
  toolName,
  render: ({ args, status }) => (
    <ExperienceToolCard
      wire={args}
      state={
        status.type === "running"
          ? "loading"
          : status.type === "complete"
            ? "ready"
            : "error"
      }
    />
  ),
}));

export function ExperienceToolUI() {
  return <>{renderers.map((Renderer, index) => <Renderer key={EXPERIENCE_CARD_TOOL_NAMES[index]} />)}</>;
}

export default ExperienceToolUI;
