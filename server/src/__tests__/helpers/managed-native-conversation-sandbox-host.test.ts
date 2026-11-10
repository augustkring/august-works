import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureFixtureNamespaceSymlink } from "./managed-native-conversation-sandbox-host.js";

describe("synthetic Host proc namespace links", () => {
  it("reuses only exact existing symlinks and rejects conflicting entries", () => {
    const root = mkdtempSync(join(tmpdir(), "native-host-proc-links-"));
    try {
      const matching = join(root, "proc/1/ns/mnt");
      mkdirSync(dirname(matching), { recursive: true });
      ensureFixtureNamespaceSymlink(matching, "mnt:[4026531840]");
      ensureFixtureNamespaceSymlink(matching, "mnt:[4026531840]");
      expect(lstatSync(matching).isSymbolicLink()).toBe(true);
      expect(readlinkSync(matching)).toBe("mnt:[4026531840]");

      const wrongTarget = join(root, "proc/100/ns/mnt");
      mkdirSync(dirname(wrongTarget), { recursive: true });
      symlinkSync("mnt:[4026531999]", wrongTarget);
      expect(() => ensureFixtureNamespaceSymlink(wrongTarget, "mnt:[4026531840]"))
        .toThrow("native_fixture_proc_namespace_link_conflict");

      const regularFile = join(root, "proc/101/ns/mnt");
      mkdirSync(dirname(regularFile), { recursive: true });
      writeFileSync(regularFile, "not a namespace link");
      expect(() => ensureFixtureNamespaceSymlink(regularFile, "mnt:[4026531999]"))
        .toThrow("native_fixture_proc_namespace_link_conflict");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
