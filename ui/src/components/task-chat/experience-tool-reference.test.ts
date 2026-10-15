import { EXPERIENCE_CARD_TOOL_NAMES } from "@paperclipai/shared";
import { expect, it } from "vitest";
import { transcriptToTaskChatItems } from "./transcript-adapter";
const companyId = "10000000-0000-4000-8000-000000000001";
const wire = {
  schemaVersion: 1,
  component: "TaskCard",
  companyId,
  cardId: "card",
  source: { companyId, domain: "task", resourceId: "AW-1", version: "1" },
};
const options = {
  runId: "display-fixture",
  agentName: "Agent",
  running: false,
};
it.each(EXPERIENCE_CARD_TOOL_NAMES)("preserves only the validated %s reference and cannot replace it through a streamed tool update", (toolName) => {
  const items = transcriptToTaskChatItems(
    [
      {
        kind: "tool_call",
        ts: "2026-10-10T10:00:00.000Z",
        toolUseId: "display",
        name: toolName,
        input: wire,
      },
      {
        kind: "tool_call",
        ts: "2026-10-10T10:00:01.000Z",
        toolUseId: "display",
        name: toolName,
        input: { ...wire, cardId: "another" },
      },
      {
        kind: "tool_result",
        ts: "2026-10-10T10:00:02.000Z",
        toolUseId: "display",
        content: "PRIVATE INVENTED HTML",
        isError: false,
      },
    ],
    options,
  );
  expect(items[0]).toMatchObject({
    kind: "tool",
    rawName: toolName,
    experienceCardRequest: wire,
  });
  expect(items[0]).toHaveProperty("target", undefined);
  expect(JSON.stringify(items)).not.toContain("PRIVATE INVENTED HTML");
});
it.each(EXPERIENCE_CARD_TOOL_NAMES)("never retains model-supplied UI/control content as a %s renderer reference", (toolName) => {
  const items = transcriptToTaskChatItems(
    [
      {
        kind: "tool_call",
        ts: "2026-10-10T10:00:00.000Z",
        toolUseId: "display",
        name: toolName,
        input: { ...wire, html: "<script>sendSecrets()</script>" },
      },
    ],
    options,
  );
  expect(items[0]).toMatchObject({
    kind: "tool",
    rawName: toolName,
  });
  expect(items[0]).not.toHaveProperty("experienceCardRequest", wire);
  expect(items[0]).toHaveProperty("target", undefined);
  expect(JSON.stringify(items)).not.toContain("sendSecrets");
});
