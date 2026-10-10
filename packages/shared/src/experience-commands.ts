import { z } from "zod";
import { experienceProfileSchema } from "./experience.js";

/** Commands open native surfaces or typed drafts; they never commit an effect. */
export const EXPERIENCE_COMMAND_DESTINATIONS = {
  home: "/dashboard",
  needs_you: "/needs-you",
  work: "/work",
  agents: "/agents",
  projects: "/projects",
  apps: "/apps",
  company: "/company/settings",
  insights: "/insights",
  advanced: "/advanced",
  search: "/search",
  connect_app: "/apps",
  run_workflow: "/workflows",
  create_task: null,
} as const;
export type ExperienceCommandId = keyof typeof EXPERIENCE_COMMAND_DESTINATIONS;
const commandIds = Object.keys(EXPERIENCE_COMMAND_DESTINATIONS) as [
  ExperienceCommandId,
  ...ExperienceCommandId[],
];
export const experienceCommandSchema = z
  .strictObject({
    id: z.enum(commandIds),
    href: z.string().nullable(),
    group: z.enum(["navigate", "create", "run", "ask"]),
    canonicalAuthorizationRequired: z.literal(true),
  })
  .superRefine((value, ctx) => {
    if (value.href !== EXPERIENCE_COMMAND_DESTINATIONS[value.id])
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: "Command destination must match its stable ID",
      });
  });
export const experienceCommandResourceSchema = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["agent", "project", "task"]),
    title: z.string().min(1).max(2000),
    companyId: z.uuid(),
    href: z.string(),
    version: z.iso.datetime(),
  })
  .superRefine((value, ctx) => {
    const root = { agent: "agents", project: "projects", task: "issues" }[
      value.kind
    ];
    if (value.href !== `/${root}/${value.id}`)
      ctx.addIssue({
        code: "custom",
        path: ["href"],
        message: "Resource destination must match its canonical ID",
      });
  });
export const experienceCommandsSchema = z
  .strictObject({
    companyId: z.uuid(),
    profile: experienceProfileSchema,
    observedAt: z.iso.datetime(),
    commands: z.array(experienceCommandSchema).max(commandIds.length),
    resources: z.array(experienceCommandResourceSchema).max(18),
    semanticDrafting: z.literal("unqualified"),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.commands.map((command) => command.id)).size !==
      value.commands.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["commands"],
        message: "Commands must be unique",
      });
    if (
      value.resources.some((resource) => resource.companyId !== value.companyId)
    )
      ctx.addIssue({
        code: "custom",
        path: ["resources"],
        message: "Resource must share the command company",
      });
  });
export type ExperienceCommands = z.infer<typeof experienceCommandsSchema>;
export const experienceCommandQuerySchema = z.string().trim().max(180);
export type ExperienceCommandIntent =
  | { kind: "command"; id: ExperienceCommandId; text: string }
  | {
      kind: "resources";
      resourceKind: "agent" | "project" | "task" | "all";
      text: string;
    }
  | { kind: "semantic"; text: string };
/** Explicit English/Danish grammar. Unrecognized text stays ordinary search. */
export function parseExperienceCommand(raw: string): ExperienceCommandIntent {
  const text = experienceCommandQuerySchema.parse(raw),
    normalized = text.toLocaleLowerCase("en");
  const aliases: Record<string, ExperienceCommandId> = {
    home: "home",
    hjem: "home",
    "needs you": "needs_you",
    "kræver dig": "needs_you",
    work: "work",
    arbejde: "work",
    agents: "agents",
    agenter: "agents",
    projects: "projects",
    projekter: "projects",
    apps: "apps",
    company: "company",
    virksomhed: "company",
    insights: "insights",
    indsigter: "insights",
    advanced: "advanced",
    avanceret: "advanced",
    "connect app": "connect_app",
    "forbind app": "connect_app",
    "run workflow": "run_workflow",
    "kør workflow": "run_workflow",
  };
  if (Object.hasOwn(aliases, normalized))
    return { kind: "command", id: aliases[normalized]!, text: "" };
  const task =
    /^(?:create task|new task|opret opgave|ny opgave)(?:\s+(.+))?$/i.exec(text);
  if (task) return { kind: "command", id: "create_task", text: task[1] ?? "" };
  const agent = /^(?:open agent|åbn agent|agent)(?:\s+(.+))?$/i.exec(text);
  if (agent)
    return { kind: "resources", resourceKind: "agent", text: agent[1] ?? "" };
  const project =
    /^(?:open project|åbn projekt|project|projekt)(?:\s+(.+))?$/i.exec(text);
  if (project)
    return {
      kind: "resources",
      resourceKind: "project",
      text: project[1] ?? "",
    };
  if (
    /^(?:ask august|spørg august|create workflow|opret workflow|draft foundation|foreslå virksomhedsviden|recommend agent|anbefal agent|explain blocker|forklar blokering|summarize project|opsummér projekt)(?:\s+|$)/i.test(
      text,
    )
  )
    return { kind: "semantic", text };
  const search = /^(?:search|find|søg)(?:\s+(.+))?$/i.exec(text);
  return {
    kind: "resources",
    resourceKind: "all",
    text: search ? (search[1] ?? "") : text,
  };
}
