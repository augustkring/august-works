import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  EXPERIENCE_CARD_KINDS,
  experienceCardSchema,
  encodeExperienceA2Ui,
  type ExperienceCard as CardModel,
} from "@paperclipai/shared";
import { ExperienceCard } from "@/components/ExperienceCard";
import { ExperienceReadError } from "@/components/ExperienceReadError";
import { ReadonlyA2UiExperienceCard } from "@/components/ReadonlyA2UiExperienceCard";
import { I18nextProvider } from "react-i18next";
import { i18n } from "@/i18n";

// Presentation fixtures only. No Native work, approval, provider qualification,
// current authority or business outcome is established by these stories.
const source = {
  domain: "task" as const,
  companyId: "00000000-0000-4000-8000-000000000001",
  resourceId: "00000000-0000-4000-8000-000000000002",
  version: "1",
  observedAt: "2026-10-10T06:00:00.000Z",
};
function fixture(overrides: Partial<CardModel> = {}): CardModel {
  return experienceCardSchema.parse({
    id: "storybook-card",
    kind: "decision",
    title: "A decision needs your review",
    whyYou: "The original task is waiting for its responsible reviewer.",
    consequence: "Open the original decision to inspect the current request.",
    source,
    freshness: "fresh",
    evidence: ["blocked"],
    actions: [
      {
        id: "view-original",
        label: "View task",
        labelKey: "view_task",
        operation: "open",
        href: `/issues/${source.resourceId}`,
        criticality: "C0",
        source,
        requiresCurrentAuthorization: true,
      },
    ],
    ...overrides,
  });
}
const meta: Meta<typeof ExperienceCard> = {
  title: "August Works/V9/Experience cards",
  component: ExperienceCard,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Actual V9 presentation components with strict software fixtures. These stories do not qualify Native execution or launch acceptance. Use the global light/dark and viewport controls to inspect the same component.",
      },
    },
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Experience card states</h1>
        <h2 className="sr-only">Card preview</h2>
        <Story />
      </main>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof ExperienceCard>;

export const NeedsReview: Story = {
  args: { card: fixture() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("article")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "View task" })).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /approve|reject|publish|retry/i }),
    ).toBeNull();
  },
};
export const OptionalReadonlyA2Ui: Story = {
  render: () => {
    const card = fixture();
    return (
      <ReadonlyA2UiExperienceCard
        wire={encodeExperienceA2Ui(card, source.companyId, "storybook-card")}
        currentNative={card}
        companyId={source.companyId}
        surfaceId="storybook-card"
      />
    );
  },
};
export const RecordedResult: Story = {
  args: {
    card: fixture({
      kind: "result",
      title: "A task has a recorded result",
      whyYou: null,
      consequence:
        "Inspect the original result before relying on it. Recorded completion does not establish independent business verification.",
      evidence: ["done"],
    }),
  },
};
export const Stale: Story = { args: { card: fixture({ freshness: "stale" }) } };
export const Partial: Story = {
  args: { card: fixture({ freshness: "partial" }) },
};
export const Unavailable: Story = {
  args: { card: fixture({ freshness: "unavailable" }) },
};

function maintenance(evidence: string): CardModel {
  const nativeSource = {
    ...source,
    domain: "agent_package_installation" as const,
  };
  return fixture({
    kind: "maintenance",
    source: nativeSource,
    title: "Maintenance needs review",
    whyYou: "Original source needs a human review",
    consequence: "Review original Native state",
    evidence: [evidence],
    actions: [
      {
        id: "review-maintenance",
        label: "Review",
        labelKey: "review",
        operation: "open",
        href: `/agents/packages/installations/${source.resourceId}/maintenance`,
        source: nativeSource,
        criticality: "C0",
        requiresCurrentAuthorization: true,
      },
    ],
  });
}
export const MaintenanceUnknown: Story = {
  args: { card: maintenance("unknown_outcome") },
};
export const MaintenanceBudget: Story = {
  args: { card: maintenance("attempt_budget") },
};
export const LongContent: Story = {
  args: {
    card: fixture({
      title:
        "Review the proposed change to the recurring customer research task before work can continue",
      whyYou:
        "You are the responsible reviewer for this request. The people involved need your decision before they can continue with the proposed next step.",
      consequence:
        "The task remains blocked until its original owner records a current decision. Review the current scope, effects and evidence on the original decision page.",
    }),
  },
};
export const DeniedCurrentRead: Story = {
  render: () => (
    <ExperienceReadError
      message="The current private view is unavailable. Check your access and reload."
      retry={() => undefined}
    />
  ),
};
export const RegisteredKinds: Story = {
  render: () => (
    <div className="grid gap-3">
      {EXPERIENCE_CARD_KINDS.map((kind) => (
        <ExperienceCard
          key={kind}
          card={fixture({
            id: `fixture-${kind}`,
            kind,
            title: `Presentation fixture: ${kind}`,
          })}
        />
      ))}
    </div>
  ),
};

const danish = i18n.cloneInstance({ lng: "da", initAsync: false });
export const DanishMaintenanceReview: Story = {
  render: () => (
    <I18nextProvider i18n={danish}>
      <ExperienceCard card={maintenance("unknown_outcome")} />
    </I18nextProvider>
  ),
};
