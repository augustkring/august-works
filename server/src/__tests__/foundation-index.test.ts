import { describe, expect, it } from "vitest";
import { extractFoundationSections } from "../services/foundation/foundation-index.js";

describe("Foundation Markdown section extraction", () => {
  it("tracks nested ATX heading paths and preserves preamble", () => {
    const sections = extractFoundationSections(
      "Preamble\n\n# Company\nAlpha\n\n## Market\nBeta\n\n### ICP\nGamma",
    );
    expect(sections.map((section) => ({
      path: section.headingPath,
      body: section.body,
      ordinal: section.ordinal,
    }))).toEqual([
      { path: [], body: "Preamble", ordinal: 0 },
      { path: ["Company"], body: "Alpha", ordinal: 1 },
      { path: ["Company", "Market"], body: "Beta", ordinal: 2 },
      { path: ["Company", "Market", "ICP"], body: "Gamma", ordinal: 3 },
    ]);
  });

  it("supports setext headings and ignores heading-looking lines inside fenced code", () => {
    const sections = extractFoundationSections(
      "Company\n=======\nIntro\n\n```md\n# not a heading\n```\n\nMarket\n------\nCustomers",
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      headingPath: ["Company"],
      body: "Intro\n\n```md\n# not a heading\n```",
    });
    expect(sections[1]).toMatchObject({
      headingPath: ["Company", "Market"],
      body: "Customers",
    });
  });

  it("normalizes line endings and produces stable hashes for identical semantic sections", () => {
    const unix = extractFoundationSections("# A\nSame");
    const windows = extractFoundationSections("# A\r\nSame");
    expect(unix[0]?.contentHash).toBe(windows[0]?.contentHash);
    expect(unix[0]?.tokenCount).toBe(windows[0]?.tokenCount);
  });
});
