import pc from "picocolors";

const TAGLINE = "The app people use to manage AI agents for work";

export function printPaperclipCliBanner(): void {
  const lines = [
    "",
    pc.bold(pc.cyan("  BLENTERA")),
    pc.blue("  ───────────────────────────────────────────────────────"),
    pc.bold(pc.white(`  ${TAGLINE}`)),
    "",
  ];

  console.log(lines.join("\n"));
}
