import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@paperclipai/db";
import {
  documentRevisions,
  documents,
  foundationDocuments,
  foundationSections,
} from "@paperclipai/db";
import type {
  FoundationIndexResult,
  FoundationSearchResult,
  FoundationSearchScope,
} from "@paperclipai/shared";
import { notFound, unprocessable } from "../../errors.js";

export interface ExtractedFoundationSection {
  headingPath: string[];
  ordinal: number;
  body: string;
  contentHash: string;
  tokenCount: number;
}

function normalizedMarkdown(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n");
}

function estimateRetrievalTokens(text: string) {
  if (text.length === 0) return 0;
  // Stable provider-neutral budgeting estimate. This is intentionally not
  // represented as an exact model tokenizer count.
  return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function hashSection(headingPath: string[], body: string) {
  return createHash("sha256")
    .update(JSON.stringify({ headingPath, body }))
    .digest("hex");
}

function trimAtxHeading(raw: string) {
  return raw.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

export function extractFoundationSections(markdown: string): ExtractedFoundationSection[] {
  const lines = normalizedMarkdown(markdown).split("\n");
  const sections: ExtractedFoundationSection[] = [];
  const headingStack: string[] = [];
  let currentHeadingPath: string[] = [];
  let bodyLines: string[] = [];
  let fence: { char: "`" | "~"; length: number } | null = null;

  function flush() {
    const body = bodyLines.join("\n").trim();
    if (body.length === 0 && currentHeadingPath.length === 0) {
      bodyLines = [];
      return;
    }
    const headingPath = [...currentHeadingPath];
    const budgetText = [...headingPath, body].filter(Boolean).join("\n");
    sections.push({
      headingPath,
      ordinal: sections.length,
      body,
      contentHash: hashSection(headingPath, body),
      tokenCount: estimateRetrievalTokens(budgetText),
    });
    bodyLines = [];
  }

  function setHeading(level: number, heading: string) {
    flush();
    headingStack.length = Math.max(0, level - 1);
    while (headingStack.length < level - 1) headingStack.push("");
    headingStack[level - 1] = heading;
    currentHeadingPath = headingStack.filter((part) => part.length > 0);
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      const char = marker[0] as "`" | "~";
      if (!fence) {
        fence = { char, length: marker.length };
      } else if (fence.char === char && marker.length >= fence.length) {
        fence = null;
      }
      bodyLines.push(line);
      continue;
    }

    if (!fence) {
      const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
      if (atx) {
        setHeading(atx[1]!.length, trimAtxHeading(atx[2]!));
        continue;
      }

      const next = lines[i + 1];
      const setext = next ? /^ {0,3}(=+|-+)\s*$/.exec(next) : null;
      if (line.trim().length > 0 && setext) {
        setHeading(setext[1]![0] === "=" ? 1 : 2, line.trim());
        i += 1;
        continue;
      }
    }

    bodyLines.push(line);
  }

  flush();
  return sections;
}

function countHashOverlap(previousHashes: string[], nextHashes: string[]) {
  const counts = new Map<string, number>();
  for (const hash of previousHashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  let overlap = 0;
  for (const hash of nextHashes) {
    const available = counts.get(hash) ?? 0;
    if (available <= 0) continue;
    overlap += 1;
    counts.set(hash, available - 1);
  }
  return overlap;
}

type FoundationIndexDb = Db;

export async function replaceFoundationRevisionSections(
  db: FoundationIndexDb,
  input: {
    companyId: string;
    foundationDocumentId: string;
    documentRevisionId: string;
  },
): Promise<FoundationIndexResult> {
  const revision = await db
    .select({
      revisionId: documentRevisions.id,
      revisionNumber: documentRevisions.revisionNumber,
      documentId: documentRevisions.documentId,
      body: documentRevisions.body,
    })
    .from(documentRevisions)
    .innerJoin(
      foundationDocuments,
      and(
        eq(foundationDocuments.companyId, input.companyId),
        eq(foundationDocuments.id, input.foundationDocumentId),
        eq(foundationDocuments.documentId, documentRevisions.documentId),
      ),
    )
    .where(
      and(
        eq(documentRevisions.companyId, input.companyId),
        eq(documentRevisions.id, input.documentRevisionId),
      ),
    )
    .then((rows) => rows[0] ?? null);

  if (!revision) {
    throw notFound("Foundation revision not found");
  }

  const sections = extractFoundationSections(revision.body);
  const currentRows = await db
    .select({
      ordinal: foundationSections.ordinal,
      contentHash: foundationSections.contentHash,
      headingPath: foundationSections.headingPath,
      body: foundationSections.body,
      tokenCount: foundationSections.tokenCount,
    })
    .from(foundationSections)
    .where(
      and(
        eq(foundationSections.companyId, input.companyId),
        eq(foundationSections.foundationDocumentId, input.foundationDocumentId),
        eq(foundationSections.documentRevisionId, input.documentRevisionId),
      ),
    )
    .orderBy(asc(foundationSections.ordinal));

  const unchangedCurrent =
    currentRows.length === sections.length &&
    currentRows.every((row, index) => {
      const next = sections[index]!;
      return (
        row.ordinal === next.ordinal &&
        row.contentHash === next.contentHash &&
        row.body === next.body &&
        row.tokenCount === next.tokenCount &&
        JSON.stringify(row.headingPath) === JSON.stringify(next.headingPath)
      );
    });

  const previousRevision = await db
    .select({ id: documentRevisions.id })
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.companyId, input.companyId),
        eq(documentRevisions.documentId, revision.documentId),
        lt(documentRevisions.revisionNumber, revision.revisionNumber),
      ),
    )
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  const previousHashes = previousRevision
    ? await db
        .select({ contentHash: foundationSections.contentHash })
        .from(foundationSections)
        .where(
          and(
            eq(foundationSections.companyId, input.companyId),
            eq(foundationSections.foundationDocumentId, input.foundationDocumentId),
            eq(foundationSections.documentRevisionId, previousRevision.id),
          ),
        )
        .orderBy(asc(foundationSections.ordinal))
        .then((rows) => rows.map((row) => row.contentHash))
    : [];

  const nextHashes = sections.map((section) => section.contentHash);
  const unchangedFromPreviousCount = countHashOverlap(previousHashes, nextHashes);

  if (!unchangedCurrent) {
    await db
      .delete(foundationSections)
      .where(
        and(
          eq(foundationSections.companyId, input.companyId),
          eq(foundationSections.foundationDocumentId, input.foundationDocumentId),
          eq(foundationSections.documentRevisionId, input.documentRevisionId),
        ),
      );
    if (sections.length > 0) {
      await db.insert(foundationSections).values(
        sections.map((section) => ({
          companyId: input.companyId,
          foundationDocumentId: input.foundationDocumentId,
          documentRevisionId: input.documentRevisionId,
          headingPath: section.headingPath,
          ordinal: section.ordinal,
          body: section.body,
          contentHash: section.contentHash,
          tokenCount: section.tokenCount,
        })),
      );
    }
  }

  return {
    companyId: input.companyId,
    foundationDocumentId: input.foundationDocumentId,
    documentRevisionId: input.documentRevisionId,
    revisionNumber: revision.revisionNumber,
    indexedSectionCount: sections.length,
    writtenSectionCount: unchangedCurrent ? 0 : sections.length,
    unchangedFromPreviousCount,
    changedSectionCount: sections.length - unchangedFromPreviousCount,
    removedSectionCount: Math.max(0, previousHashes.length - unchangedFromPreviousCount),
  };
}

function escapeLike(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function excerpt(body: string, query: string, maxLength = 420) {
  if (body.length <= maxLength) return body;
  const lower = body.toLocaleLowerCase();
  const index = lower.indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, (index >= 0 ? index : 0) - Math.floor(maxLength / 3));
  const end = Math.min(body.length, start + maxLength);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
}

export function foundationIndexService(db: Db) {
  const searchRevision = alias(documentRevisions, "foundation_search_revision");

  return {
    reindexRevision: async (
      companyId: string,
      foundationDocumentId: string,
      documentRevisionId: string,
    ) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`
          select id
          from ${foundationDocuments}
          where ${foundationDocuments.companyId} = ${companyId}
            and ${foundationDocuments.id} = ${foundationDocumentId}
          for update
        `);
        return replaceFoundationRevisionSections(tx as unknown as Db, {
          companyId,
          foundationDocumentId,
          documentRevisionId,
        });
      }),

    search: async (
      companyId: string,
      input: { query: string; limit: number; scope: FoundationSearchScope },
    ): Promise<FoundationSearchResult[]> => {
      const query = input.query.trim();
      if (!query) throw unprocessable("Foundation search query is required");
      const pattern = `%${escapeLike(query)}%`;
      const headingText = sql<string>`array_to_string(${foundationSections.headingPath}, ' > ')`;
      const revisionCondition =
        input.scope === "working"
          ? eq(foundationSections.documentRevisionId, documents.latestRevisionId)
          : eq(foundationSections.documentRevisionId, foundationDocuments.approvedRevisionId);
      const rank = sql<number>`
        case
          when lower(${foundationDocuments.foundationKey}) = lower(${query}) then 100
          when lower(coalesce(${searchRevision.title}, '')) = lower(${query}) then 90
          when ${headingText} ilike ${pattern} then 60
          when ${foundationSections.body} ilike ${pattern} then 40
          when ${foundationDocuments.foundationKey} ilike ${pattern} then 30
          when coalesce(${searchRevision.title}, '') ilike ${pattern} then 20
          else 0
        end
      `;

      const rows = await db
        .select({
          foundationDocumentId: foundationDocuments.id,
          foundationKey: foundationDocuments.foundationKey,
          category: foundationDocuments.category,
          documentType: foundationDocuments.documentType,
          authorityLevel: foundationDocuments.authorityLevel,
          sensitivity: foundationDocuments.sensitivity,
          status: foundationDocuments.status,
          documentRevisionId: foundationSections.documentRevisionId,
          revisionNumber: searchRevision.revisionNumber,
          title: searchRevision.title,
          headingPath: foundationSections.headingPath,
          ordinal: foundationSections.ordinal,
          body: foundationSections.body,
          contentHash: foundationSections.contentHash,
          tokenCount: foundationSections.tokenCount,
          rank,
        })
        .from(foundationSections)
        .innerJoin(
          foundationDocuments,
          and(
            eq(foundationDocuments.companyId, companyId),
            eq(foundationDocuments.id, foundationSections.foundationDocumentId),
          ),
        )
        .innerJoin(
          documents,
          and(
            eq(documents.id, foundationDocuments.documentId),
            eq(documents.companyId, companyId),
          ),
        )
        .innerJoin(
          searchRevision,
          and(
            eq(searchRevision.id, foundationSections.documentRevisionId),
            eq(searchRevision.companyId, companyId),
            eq(searchRevision.documentId, foundationDocuments.documentId),
          ),
        )
        .where(
          and(
            eq(foundationSections.companyId, companyId),
            notInArray(foundationDocuments.status, ["archived", "superseded"]),
            revisionCondition,
            or(
              ilike(foundationSections.body, pattern),
              sql`${headingText} ilike ${pattern}`,
              ilike(foundationDocuments.foundationKey, pattern),
              ilike(searchRevision.title, pattern),
            ),
          ),
        )
        .orderBy(
          desc(rank),
          asc(foundationDocuments.category),
          asc(foundationDocuments.foundationKey),
          asc(foundationSections.ordinal),
        )
        .limit(input.limit);

      return rows.map((row) => ({
        foundationDocumentId: row.foundationDocumentId,
        foundationKey: row.foundationKey,
        category: row.category as FoundationSearchResult["category"],
        documentType: row.documentType,
        authorityLevel: row.authorityLevel as FoundationSearchResult["authorityLevel"],
        sensitivity: row.sensitivity as FoundationSearchResult["sensitivity"],
        status: row.status as FoundationSearchResult["status"],
        documentRevisionId: row.documentRevisionId,
        revisionNumber: row.revisionNumber,
        title: row.title,
        headingPath: row.headingPath,
        ordinal: row.ordinal,
        excerpt: excerpt(row.body, query),
        contentHash: row.contentHash,
        tokenCount: row.tokenCount,
        rank: Number(row.rank),
      }));
    },
  };
}
