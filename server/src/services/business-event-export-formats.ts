import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUSINESS_EVENT_PROJECTOR_VERSION, businessEventAttributesSchema, businessEventObjectSchema, type BusinessEvent } from "@paperclipai/shared";

export const BUSINESS_EVENT_EXPORTER_VERSION = "aw-business-event-export-v1";
export const OCEL_VERSION = "OCEL 2.0";
// Pinned OCEL 2.0 JSON/SQLite mappings; no broker, case flattening, current-state
// enrichment, person attributes or invented object-to-object relationship.
const eventTypes = ["issue.created", "issue.updated", "issue.checked_out", "issue.released", "project.created", "project.updated"];
const attributeTypes = ["status", "previousStatus", "priority", "sourceRef", "sourceVersion", "sourceHash"]
  .map(name => ({ name, type: "string" as const }));
const attributes = [...attributeTypes, { name: "observedAt", type: "time" as const }];
type Attribute = { name: string; value: string };
export interface Ocel2Log {
  eventTypes: { name: string; attributes: { name: string; type: "string" | "time" }[] }[];
  objectTypes: { name: "issue" | "project"; attributes: [] }[];
  events: { id: string; type: string; time: string; attributes: Attribute[]; relationships: { objectId: string; qualifier: string }[] }[];
  objects: { id: string; type: "issue" | "project"; attributes: []; relationships: [] }[];
}
export function businessEventsToOcel2(events: readonly BusinessEvent[]): Ocel2Log {
  if (events.length > 200 || new Set(events.map(event => event.id)).size !== events.length
    || new Set(events.map(event => event.companyId)).size > 1) throw new Error("Export requires one bounded company event page with unique identities");
  const objects = new Map<string, Ocel2Log["objects"][number]>();
  const mapped = events.map(event => {
    if (!eventTypes.includes(event.activity) || event.eventType !== event.activity || event.source.version !== BUSINESS_EVENT_PROJECTOR_VERSION
      || event.tombstonedAt || event.objects.length === 0) throw new Error("Export requires current supported native Business Events");
    const relationships = event.objects.map(value => {
      const object = businessEventObjectSchema.parse(value);
      const objectId = `${object.objectType}:${object.objectId}`;
      objects.set(objectId, { id: objectId, type: object.objectType, attributes: [], relationships: [] });
      return { objectId, qualifier: object.qualifier };
    });
    return { id: event.id, type: event.activity, time: event.occurredAt, relationships,
      attributes: [
        ...Object.entries(businessEventAttributesSchema.parse(event.attributes)).map(([name,value]) => ({ name, value })),
        { name: "observedAt", value: event.observedAt }, { name: "sourceRef", value: event.source.ref },
        { name: "sourceVersion", value: event.source.version }, { name: "sourceHash", value: event.source.contentHash },
      ] };
  });
  const presentTypes = new Set(mapped.map(event => event.type));
  const presentObjectTypes = new Set([...objects.values()].map(object => object.type));
  return {
    eventTypes: eventTypes.filter(type => presentTypes.has(type)).map(name => ({ name, attributes })),
    objectTypes: (["issue", "project"] as const).filter(type => presentObjectTypes.has(type)).map(name => ({ name, attributes: [] })),
    events: mapped, objects: [...objects.values()].sort((a,b) => a.id.localeCompare(b.id)),
  };
}
export function businessEventsToJsonl(events: readonly BusinessEvent[]) {
  businessEventsToOcel2(events); // Apply the same bounded native identity contract.
  return Buffer.from(events.map(event => JSON.stringify(event)).join("\n")+(events.length ? "\n" : ""), "utf8");
}
export async function businessEventsToOcel2Sqlite(events: readonly BusinessEvent[]) {
  const log = businessEventsToOcel2(events);
  const directory = await mkdtemp(join(tmpdir(), "aw-ocel-export-"));
  let database: DatabaseSync | undefined;
  try {
    const path = join(directory, "events.sqlite"); database = new DatabaseSync(path);
    database.exec(`PRAGMA foreign_keys=ON; BEGIN;
      CREATE TABLE event(ocel_id TEXT PRIMARY KEY, ocel_type TEXT NOT NULL);
      CREATE TABLE object(ocel_id TEXT PRIMARY KEY, ocel_type TEXT NOT NULL);
      CREATE TABLE event_object(ocel_event_id TEXT NOT NULL REFERENCES event(ocel_id), ocel_object_id TEXT NOT NULL REFERENCES object(ocel_id), ocel_qualifier TEXT NOT NULL, PRIMARY KEY(ocel_event_id,ocel_object_id,ocel_qualifier));
      CREATE TABLE object_object(ocel_source_id TEXT REFERENCES object(ocel_id),ocel_target_id TEXT REFERENCES object(ocel_id),ocel_qualifier TEXT);
      CREATE TABLE event_map_type(ocel_type TEXT PRIMARY KEY,ocel_type_map TEXT NOT NULL UNIQUE);
      CREATE TABLE object_map_type(ocel_type TEXT PRIMARY KEY,ocel_type_map TEXT NOT NULL UNIQUE);`);
    for (const type of log.objectTypes) {
      // Identifiers are the two fixed native object types, never user SQL.
      database.prepare("INSERT INTO object_map_type VALUES(?,?)").run(type.name,type.name);
      database.exec(`CREATE TABLE object_${type.name}(ocel_id TEXT PRIMARY KEY REFERENCES object(ocel_id),ocel_time TIMESTAMP,ocel_changed_field TEXT)`);
    }
    for (const object of log.objects) {
      database.prepare("INSERT INTO object VALUES(?,?)").run(object.id,object.type);
      // No object attribute values or historical change times are inferred.
      database.prepare(`INSERT INTO object_${object.type}(ocel_id) VALUES(?)`).run(object.id);
    }
    const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
    for (const type of log.eventTypes) {
      const mapped = type.name.replaceAll(".","_");
      database.prepare("INSERT INTO event_map_type VALUES(?,?)").run(type.name,mapped);
      database.exec(`CREATE TABLE event_${mapped}(ocel_id TEXT PRIMARY KEY REFERENCES event(ocel_id),ocel_time TIMESTAMP NOT NULL,status TEXT,previousStatus TEXT,priority TEXT,sourceRef TEXT NOT NULL,sourceVersion TEXT NOT NULL,sourceHash TEXT NOT NULL,observedAt TIMESTAMP NOT NULL)`);
      statements.set(type.name,database.prepare(`INSERT INTO event_${mapped} VALUES(?,?,?,?,?,?,?,?,?)`));
    }
    for (const event of log.events) {
      const values = Object.fromEntries(event.attributes.map(attribute => [attribute.name,attribute.value]));
      database.prepare("INSERT INTO event VALUES(?,?)").run(event.id,event.type);
      statements.get(event.type)!.run(event.id,event.time,values.status ?? null,values.previousStatus ?? null,values.priority ?? null,values.sourceRef,values.sourceVersion,values.sourceHash,values.observedAt);
      for (const relation of event.relationships) database.prepare("INSERT INTO event_object VALUES(?,?,?)").run(event.id,relation.objectId,relation.qualifier);
    }
    database.exec("COMMIT"); database.close(); database = undefined;
    return await readFile(path);
  } finally { database?.close(); await rm(directory,{ recursive: true, force: true }); }
}
