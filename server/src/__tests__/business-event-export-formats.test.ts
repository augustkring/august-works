import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { BUSINESS_EVENT_PROJECTOR_VERSION, type BusinessEvent } from "@paperclipai/shared";
import { businessEventsToJsonl, businessEventsToOcel2, businessEventsToOcel2Sqlite } from "../services/business-event-export-formats.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function event(n: number, project = 8): BusinessEvent {
  return { id: id(n), companyId: id(1), eventType: "issue.updated", activity: "issue.updated", lifecycle: "updated",
    occurredAt: `2026-01-01T00:00:00.12345${n}Z`, observedAt: "2026-01-02T00:00:00Z", sourceUpdatedAt: null, receivedAt: null,
    source: { class: "aw_native", provider: "activity_log", ref: id(n), version: BUSINESS_EVENT_PROJECTOR_VERSION, contentHash: "a".repeat(64) },
    revision: 1, objects: [{ objectType: "issue", objectId: id(7), qualifier: "primary" }, { objectType: "project", objectId: id(project), qualifier: "related" }],
    attributes: { status: n === 2 ? "done" : "in_progress" }, purpose: "process_intelligence", sensitivity: "internal", trustLevel: "observed",
    supersedesEventId: null, tombstonedAt: null, governanceObligationRefs: [id(10)], retentionDays: 30, expiresAt: "2099-01-01T00:00:00Z" };
}
describe("pinned OCEL 2.0 and native JSONL interchange", () => {
  it("preserves multiple typed objects, recorded qualifiers and exact event time without inventing object relationships", () => {
    const events = [event(2),event(3,9)]; const log = businessEventsToOcel2(events);
    expect(log.objects.map(object => object.id)).toEqual([`issue:${id(7)}`,`project:${id(8)}`,`project:${id(9)}`]);
    expect(log.objects.every(object => object.attributes.length === 0 && object.relationships.length === 0)).toBe(true);
    expect(log.events[0].time).toBe("2026-01-01T00:00:00.123452Z");
    expect(log.events[0].relationships).toEqual([{ objectId: `issue:${id(7)}`, qualifier: "primary" },{ objectId: `project:${id(8)}`, qualifier: "related" }]);
    expect(businessEventsToJsonl(events).toString().trim().split("\n").map(line => JSON.parse(line))).toEqual(events);
    expect(() => businessEventsToOcel2([events[0],events[0]])).toThrow("unique identities");
    expect(() => businessEventsToOcel2([events[0],{ ...events[1], companyId: id(11) }])).toThrow("one bounded company");
  });
  it("round-trips a real SQLite artifact with foreign-key integrity, exact time, sparse attributes and OCEL mappings", async () => {
    const directory = await mkdtemp(join(tmpdir(),"aw-ocel-roundtrip-")); let database: DatabaseSync | undefined;
    try {
      const payload = await businessEventsToOcel2Sqlite([event(2),event(3,9)]);
      const path = join(directory,"events.sqlite"); await writeFile(path,payload); database = new DatabaseSync(path,{ readOnly: true });
      expect(database.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      expect(database.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
      expect(database.prepare("SELECT * FROM event_map_type").all()).toEqual([{ ocel_type: "issue.updated", ocel_type_map: "issue_updated" }]);
      expect(database.prepare("SELECT ocel_time,status,priority FROM event_issue_updated WHERE ocel_id=?").get(id(2))).toEqual({ ocel_time: "2026-01-01T00:00:00.123452Z", status: "done", priority: null });
      expect(database.prepare("SELECT * FROM event_object").all()).toHaveLength(4);
      expect(database.prepare("SELECT * FROM object_object").all()).toHaveLength(0);
      expect(database.prepare("SELECT * FROM object_issue").all()).toEqual([{ ocel_id: `issue:${id(7)}`, ocel_time: null, ocel_changed_field: null }]);
    } finally { database?.close(); await rm(directory,{ recursive: true, force: true }); }
  });
});
