import { describe, expect, it } from "vitest";
import { RECENT_AUTHENTICATION_SECONDS } from "../../auth/authenticator-assurance.js";
import {
  nativeConformanceGroupAuthenticationAdmits,
  type NativeConformanceGroupAuthenticationFacts,
} from "./native-conformance-authentication.js";

const groupId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const userId = "human-1";
const startedAt = new Date("2026-11-16T12:00:00.000Z");

function facts(overrides: Partial<NativeConformanceGroupAuthenticationFacts> = {}): NativeConformanceGroupAuthenticationFacts {
  return {
    groupId, planId, actorUserId: userId,
    // Authenticated four minutes before the group started; the probe opens
    // four minutes into the group: eight minutes after authentication.
    authenticatedAt: new Date(startedAt.getTime() - 240_000),
    now: new Date(startedAt.getTime() + 240_000),
    run: { status: "running", responsibleUserId: userId, groupId, planId, triggerDetail: "provider_conformance" },
    plan: { id: planId, status: "paused", erasedAt: null, startedAt, createdBy: userId,
      executionPrincipal: { type: "user", userId }, maxWallClockSeconds: 300 },
    task: { status: "in_progress", hiddenAt: new Date(startedAt), harnessKind: "provider_conformance" },
    ...overrides,
  };
}

describe("nativeConformanceGroupAuthenticationAdmits (CONF15-P4)", () => {
  it("admits a later probe whose session was recently authenticated when its group started", () => {
    const value = facts();
    // The per-probe recent check alone would refuse this probe.
    expect(value.now.getTime() - value.authenticatedAt.getTime()).toBeGreaterThan(RECENT_AUTHENTICATION_SECONDS * 1000);
    expect(nativeConformanceGroupAuthenticationAdmits(value)).toBe(true);
    // Exactly at the start of the recent window.
    expect(nativeConformanceGroupAuthenticationAdmits(facts({
      authenticatedAt: new Date(startedAt.getTime() - RECENT_AUTHENTICATION_SECONDS * 1000) }))).toBe(true);
    // A step-up of the same session during the group stays admitted.
    expect(nativeConformanceGroupAuthenticationAdmits(facts({
      authenticatedAt: new Date(startedAt.getTime() + 10_000) }))).toBe(true);
  });

  it("refuses another group or another plan", () => {
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ groupId: "33333333-3333-4333-8333-333333333333" }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, groupId: "other" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, groupId: undefined } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ planId: "44444444-4444-4444-8444-444444444444" }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, planId: "other" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, id: "other" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: null }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: null }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ task: null }))).toBe(false);
  });

  it("refuses a Run that is not a running provider-conformance probe", () => {
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, status: "succeeded" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, triggerDetail: "system" } }))).toBe(false);
  });

  it("refuses another Human on the actor, Run, plan creator or plan principal", () => {
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ actorUserId: "human-2" }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ actorUserId: "" }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ run: { ...facts().run!, responsibleUserId: "human-2" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, createdBy: "human-2" } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!,
      executionPrincipal: { type: "user", userId: "human-2" } } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!,
      executionPrincipal: { type: "system", service: "conformance" } } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, executionPrincipal: null } }))).toBe(false);
  });

  it("refuses a cancelled, failed, finished, started or erased group", () => {
    for (const status of ["cancelled", "failed", "completed", "running", "draft"])
      expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, status } })), status).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, erasedAt: new Date() } }))).toBe(false);
    for (const status of ["done", "cancelled", "blocked", "todo"])
      expect(nativeConformanceGroupAuthenticationAdmits(facts({ task: { ...facts().task!, status } })), status).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ task: { ...facts().task!, hiddenAt: null } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ task: { ...facts().task!, harnessKind: "agent_safe_test" } }))).toBe(false);
  });

  it("refuses a session whose authentication was not recent when the group started", () => {
    expect(nativeConformanceGroupAuthenticationAdmits(facts({
      authenticatedAt: new Date(startedAt.getTime() - RECENT_AUTHENTICATION_SECONDS * 1000 - 1) }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({
      authenticatedAt: new Date(startedAt.getTime() - 3_600_000) }))).toBe(false);
    // An authentication time after the check is invalid.
    expect(nativeConformanceGroupAuthenticationAdmits(facts({
      authenticatedAt: new Date(facts().now.getTime() + 1) }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ authenticatedAt: new Date(Number.NaN) }))).toBe(false);
  });

  it("refuses a group outside its own bounded window", () => {
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ now: new Date(startedAt.getTime() + 300_000) }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ now: new Date(startedAt.getTime() + 299_999) }))).toBe(true);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, maxWallClockSeconds: 60 } }))).toBe(false);
    for (const maxWallClockSeconds of [0, -1, Number.NaN, 1.5, 1e300])
      expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, maxWallClockSeconds } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, startedAt: null } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ plan: { ...facts().plan!, startedAt: new Date(Number.NaN) } }))).toBe(false);
    // A group recorded as starting in the future is not current, even with a
    // session authenticated within its recent window.
    const now = facts().now;
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ authenticatedAt: new Date(now.getTime() - 10_000),
      plan: { ...facts().plan!, startedAt: new Date(now.getTime() + 1) } }))).toBe(false);
    expect(nativeConformanceGroupAuthenticationAdmits(facts({ authenticatedAt: new Date(now.getTime() - 10_000),
      plan: { ...facts().plan!, startedAt: new Date(now.getTime()) } }))).toBe(true);
  });
});
