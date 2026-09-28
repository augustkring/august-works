import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  WorkflowDataSelectorField,
  WorkflowDataSelectorSource,
  WorkflowGraphV1,
  WorkflowJsonSchema,
} from "@paperclipai/shared";
import { Search } from "lucide-react";
import { workflowsApi } from "@/api/workflows";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function matchesField(field: WorkflowDataSelectorField, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [
    field.label,
    field.path,
    field.expression,
    field.valueType,
  ].some((value) => value.toLocaleLowerCase().includes(normalized)) ||
    field.children.some((child) => matchesField(child, normalized));
}

function DataFields({
  fields,
  query,
  onInsert,
  depth = 0,
}: {
  fields: WorkflowDataSelectorField[];
  query: string;
  onInsert: (expression: string) => void;
  depth?: number;
}) {
  return (
    <div role={depth === 0 ? "tree" : "group"}>
      {fields.filter((field) => matchesField(field, query)).map((field) => (
        <div key={field.expression}>
          <button
            type="button"
            role="treeitem"
            aria-label={`Insert ${field.label}, ${field.valueType}`}
            onClick={() => onInsert(field.expression)}
            className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <span className="min-w-0 truncate">
              {field.label}
              {field.required ? (
                <span className="ml-1 text-[10px] text-muted-foreground">required</span>
              ) : null}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {field.valueType}
              {field.sampleValue !== null
                ? ` · ${JSON.stringify(field.sampleValue).slice(0, 32)}`
                : ""}
            </span>
          </button>
          {field.children.length > 0 ? (
            <DataFields
              fields={field.children}
              query={query}
              onInsert={onInsert}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Source({
  source,
  query,
  onInsert,
}: {
  source: WorkflowDataSelectorSource;
  query: string;
  onInsert: (expression: string) => void;
}) {
  const normalized = query.trim().toLocaleLowerCase();
  const sourceMatch = !normalized || [
    source.label,
    source.kind,
    source.nodeType ?? "",
    source.expression,
  ].some((value) => value.toLocaleLowerCase().includes(normalized));
  const fieldMatch = source.fields.some((field) => matchesField(field, normalized));
  if (!sourceMatch && !fieldMatch) return null;

  return (
    <section className="border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{source.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {source.kind}{source.nodeType ? ` · ${source.nodeType}` : ""}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() => onInsert(source.expression)}
        >
          Insert object
        </Button>
      </div>
      {source.fields.length > 0 ? (
        <DataFields fields={source.fields} query={query} onInsert={onInsert} />
      ) : (
        <p className="px-2 py-2 text-[11px] text-muted-foreground">
          No typed child fields are available yet. The whole value can still be inserted.
        </p>
      )}
    </section>
  );
}

export function WorkflowDataSelector({
  companyId,
  graph,
  targetNodeId,
  inputSchema,
  onInsert,
}: {
  companyId: string;
  graph: WorkflowGraphV1;
  targetNodeId: string;
  inputSchema: WorkflowJsonSchema | null;
  onInsert: (expression: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"friendly" | "raw">("friendly");
  const [query, setQuery] = useState("");
  const [raw, setRaw] = useState("");
  const graphKey = useMemo(() => JSON.stringify(graph), [graph]);

  const dataQuery = useQuery({
    queryKey: queryKeys.workflows.dataSelector(companyId, targetNodeId, graphKey),
    queryFn: () => workflowsApi.dataSelector(companyId, {
      graph,
      targetNodeId,
      inputSchema,
    }),
    enabled: open,
    staleTime: 30_000,
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        Browse data
      </Button>
    );
  }

  const visibleSources = (dataQuery.data?.sources ?? []).filter((source) => {
    if (!query.trim()) return true;
    return source.fields.some((field) => matchesField(field, query)) ||
      source.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  });

  return (
    <section aria-label="Data selector" className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
        <div>
          <p className="text-xs font-medium">Data</p>
          <p className="text-[10px] text-muted-foreground">
            Variables and upstream step outputs only.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded border border-border p-0.5" aria-label="Data selector mode">
            {(["friendly", "raw"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === value ? "bg-accent" : "text-muted-foreground",
                )}
              >
                {value === "friendly" ? "Browse" : "Raw"}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>

      {mode === "raw" ? (
        <div className="space-y-2 p-2">
          <Input
            aria-label="Raw workflow expression"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder='{{steps["step-id"].field}}'
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={!raw.trim()}
            onClick={() => onInsert(raw.trim())}
          >
            Insert expression
          </Button>
        </div>
      ) : (
        <>
          <div className="relative p-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-4 top-4 h-3.5 w-3.5 text-muted-foreground"
            />
            <Input
              aria-label="Search workflow data"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search fields"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto px-2 pb-2">
            {dataQuery.isLoading ? (
              <p aria-live="polite" className="px-2 py-4 text-xs text-muted-foreground">
                Loading typed data…
              </p>
            ) : dataQuery.error ? (
              <div className="px-2 py-3">
                <p className="text-xs text-destructive">
                  Data sources could not be resolved.
                </p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => dataQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : visibleSources.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                {query.trim()
                  ? "No matching fields."
                  : "Connect an earlier step or add workflow variables to expose data here."}
              </p>
            ) : (
              visibleSources.map((source) => (
                <Source
                  key={source.id}
                  source={source}
                  query={query}
                  onInsert={onInsert}
                />
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
