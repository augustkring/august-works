import { useLayoutEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorRecoverySurface } from "@/components/ErrorRecoverySurface";

function RecoveryPreview({ locale, scope }: { locale: "en" | "da"; scope: "app" | "page" }) {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = locale;
    setReady(true);
    return () => { document.documentElement.lang = previous; };
  }, [locale]);
  return ready ? <ErrorRecoverySurface scope={scope} onBack={scope === "page" ? () => undefined : undefined} /> : null;
}

const meta: Meta<typeof RecoveryPreview> = {
  title: "August Works/V9/Error recovery",
  component: RecoveryPreview,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <main><Story /></main>],
};
export default meta;
type Story = StoryObj<typeof RecoveryPreview>;
export const EnglishApp: Story = { args: { locale: "en", scope: "app" } };
export const DanishApp: Story = { args: { locale: "da", scope: "app" } };
export const EnglishPage: Story = { args: { locale: "en", scope: "page" } };
export const DanishPage: Story = { args: { locale: "da", scope: "page" } };
