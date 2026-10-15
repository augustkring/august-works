import { expect, it } from "vitest";
import { experienceActionSchema } from "./experience.js";
const source = { companyId: "10000000-0000-4000-8000-000000000001", domain: "task", resourceId: "AW-1", version: "1", observedAt: "2026-10-10T11:00:00.000Z" };
function action(href: string) { return { id: "open", label: "View task", operation: "open", href, criticality: "C0", source, requiresCurrentAuthorization: true }; }
it.each(["/\t/attacker.example", "/\t\t/attacker.example"])("rejects a path whose tab removal changes browser origin: %j", href => {
 expect(new URL(href, "https://aw.example").origin).toBe("https://attacker.example");
 expect(experienceActionSchema.safeParse(action(href)).success).toBe(false);
});
it.each(["//attacker.example", "/\\attacker.example", "/\n/attacker.example", "/\r/attacker.example", "/ /attacker.example", "/tasks/\u0000secret", "/tasks/\u007fsecret", "https://attacker.example", "javascript:alert(1)"])("refuses ambiguous, control-containing or non-root navigation %j", href => {
 expect(experienceActionSchema.safeParse(action(href)).success).toBe(false);
});
it.each(["/issues/AW-1", "/projects/10000000-0000-4000-8000-000000000002", "/search?q=customer%20research", "/needs-you"])("preserves ordinary encoded Native navigation %j", href => {
 const parsed = experienceActionSchema.parse(action(href));expect(parsed.href).toBe(href);expect(new URL(parsed.href, "https://aw.example").origin).toBe("https://aw.example");
});
