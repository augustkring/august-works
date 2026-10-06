import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { sso } from "@better-auth/sso";
import { scim } from "@better-auth/scim";
import {
  ssoProvider,
  scimConnectionBinding,
  scimIdentityTombstone,
  scimSubject,
  scimUser,
  scimProjectionGrant,
  scimGroup,
  scimGroupMember,
} from "@paperclipai/db";
const native = {
  ssoProvider,
  scimConnectionBinding,
  scimIdentityTombstone,
  scimSubject,
  scimUser,
  scimProjectionGrant,
  scimGroup,
  scimGroupMember,
};
describe("pinned enterprise framework native schema parity", () => {
  it("stores every public SDK field in its matching native column", () => {
    const schemas = {
      ...sso({ providersLimit: 0 }).schema,
      ...scim({
        connections: [],
        authentication: { verifyBearerToken: async () => null },
      }).schema,
    };
    for (const [name, model] of Object.entries(schemas)) {
      expect(name in native, `Missing native model ${name}`).toBe(true);
      const columns = getTableColumns(native[name as keyof typeof native]);
      expect(columns.id.primary).toBe(true);
      for (const [field, definition] of Object.entries(model.fields)) {
        const column = columns[field as keyof typeof columns];
        expect(column, `${name}.${field}`).toBeDefined();
        expect(column!.dataType, `${name}.${field} type`).toBe(definition.type);
        if (definition.required)
          expect(column!.notNull, `${name}.${field} required`).toBe(true);
      }
    }
  });
});
