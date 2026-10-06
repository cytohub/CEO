/**
 * Relationship mapping: typed, evidence-backed edges between a source item
 * and the entities it involves, plus durable facts it reveals (who works
 * where, corporate families, which investor is in which round).
 *
 * Edges are idempotent upserts keyed by (from, relation, to). Each edge keeps
 * the ids of the source items that evidenced it, so re-processing the same
 * item never inflates evidenceCount; new evidence bumps the count, moves
 * lastSeenAt forward and keeps the highest confidence.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType, RelationType } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import type { LoadedSourceItem, PipelineContext, ResolutionContext } from "../types";
import { knownForms, knownOrganizationByName, KNOWN_ORGANIZATIONS, type KnownOrganization } from "./known-organizations";
import { domainOf, normalizeCompanyName } from "./names";

export interface EdgeInput {
  fromType: EntityType;
  fromId: string;
  relation: RelationType;
  toType: EntityType;
  toId: string;
  /** 0–1 */
  confidence: number;
  sourceItemId: string | null;
  /** When the evidence was observed. */
  at: Date;
  metadata?: Record<string, unknown>;
}

const EVIDENCE_KEEP = 20;

type EdgeMeta = { sourceItemIds?: string[] } & Record<string, unknown>;

export async function upsertRelationship(tx: Tx, e: EdgeInput): Promise<{ id: string; created: boolean; bumped: boolean }> {
  if (e.fromType === e.toType && e.fromId === e.toId) return { id: "", created: false, bumped: false };
  const key = { fromType: e.fromType, fromId: e.fromId, relation: e.relation, toType: e.toType, toId: e.toId };
  const confidence = Math.max(0, Math.min(1, e.confidence));
  const existing = await tx.relationship.findUnique({ where: { fromType_fromId_relation_toType_toId: key } });
  if (!existing) {
    const meta: EdgeMeta = { ...(e.metadata ?? {}), sourceItemIds: e.sourceItemId ? [e.sourceItemId] : [] };
    const row = await tx.relationship.create({
      data: { ...key, confidence, evidenceCount: 1, sourceItemId: e.sourceItemId, firstSeenAt: e.at, lastSeenAt: e.at, metadata: meta as Prisma.InputJsonValue },
    });
    return { id: row.id, created: true, bumped: true };
  }
  const meta = ((existing.metadata as EdgeMeta | null) ?? {}) as EdgeMeta;
  const seen = Array.isArray(meta.sourceItemIds) ? meta.sourceItemIds : [];
  const isNewEvidence = !e.sourceItemId || !seen.includes(e.sourceItemId);
  const nextMeta: EdgeMeta = { ...meta, ...(e.metadata ?? {}), sourceItemIds: e.sourceItemId && isNewEvidence ? [...seen, e.sourceItemId].slice(-EVIDENCE_KEEP) : seen };
  await tx.relationship.update({
    where: { id: existing.id },
    data: {
      confidence: Math.max(existing.confidence, confidence),
      lastSeenAt: e.at > existing.lastSeenAt ? e.at : existing.lastSeenAt,
      ...(isNewEvidence ? { evidenceCount: { increment: 1 } } : {}),
      ...(e.sourceItemId && isNewEvidence ? { sourceItemId: e.sourceItemId } : {}),
      validTo: null,
      metadata: nextMeta as Prisma.InputJsonValue,
    },
  });
  return { id: existing.id, created: false, bumped: isNewEvidence };
}

// ─── Corporate families ──────────────────────────────────────────────────────

interface CompanyLite {
  id: string;
  name: string;
  parentId: string | null;
}

/** Map every known organization form to an existing company id (name or alias match). */
async function knownCompanyIndex(tx: Tx): Promise<{ companies: CompanyLite[]; byForm: Map<string, string> }> {
  const [companies, aliases] = await Promise.all([
    tx.company.findMany({ select: { id: true, name: true, parentId: true } }),
    tx.entityAlias.findMany({ where: { entityType: "COMPANY", kind: { in: ["NAME", "ABBREVIATION", "SUBSIDIARY", "FORMER_NAME", "NICKNAME"] } }, select: { entityId: true, normalized: true } }),
  ]);
  const byForm = new Map<string, string>();
  for (const c of companies) byForm.set(normalizeCompanyName(c.name), c.id);
  for (const a of aliases) if (!byForm.has(a.normalized)) byForm.set(a.normalized, a.entityId);
  return { companies, byForm };
}

function companyForOrg(org: KnownOrganization, byForm: Map<string, string>): string | null {
  for (const f of knownForms(org)) {
    const id = byForm.get(f);
    if (id) return id;
  }
  return null;
}

/**
 * Set Company.parentId and SUBSIDIARY_OF edges for known corporate families
 * when both companies exist ("Janssen" → "Johnson & Johnson"). Returns edges touched.
 */
export async function linkKnownFamilies(tx: Tx, companyIds: string[], opts: { sourceItemId: string | null; at: Date }): Promise<number> {
  if (!companyIds.length) return 0;
  const { companies, byForm } = await knownCompanyIndex(tx);
  const byId = new Map(companies.map((c) => [c.id, c]));
  let touched = 0;
  const link = async (childId: string, parentId: string) => {
    if (childId === parentId) return;
    const child = byId.get(childId);
    if (!child) return;
    if (!child.parentId) {
      await tx.company.update({ where: { id: childId }, data: { parentId } });
      child.parentId = parentId;
    }
    if (child.parentId === parentId) {
      await upsertRelationship(tx, { fromType: "COMPANY", fromId: childId, relation: "SUBSIDIARY_OF", toType: "COMPANY", toId: parentId, confidence: 0.95, sourceItemId: opts.sourceItemId, at: opts.at, metadata: { basis: "known-organizations" } });
      touched++;
    }
  };

  for (const id of new Set(companyIds)) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.parentId) {
      await upsertRelationship(tx, { fromType: "COMPANY", fromId: c.id, relation: "SUBSIDIARY_OF", toType: "COMPANY", toId: c.parentId, confidence: 1, sourceItemId: opts.sourceItemId, at: opts.at });
      touched++;
    }
    const org = knownOrganizationByName(c.name);
    if (!org) continue;
    // Up: this company's known parent exists → link.
    if (org.parent) {
      const parent = KNOWN_ORGANIZATIONS.find((o) => o.canonical === org.parent);
      const parentId = parent ? companyForOrg(parent, byForm) : null;
      if (parentId) await link(c.id, parentId);
    }
    // Down: known subsidiaries that exist → link them to this company.
    for (const sub of KNOWN_ORGANIZATIONS.filter((o) => o.parent === org.canonical)) {
      const subId = companyForOrg(sub, byForm);
      if (subId) await link(subId, c.id);
    }
  }
  return touched;
}

// ─── Source relationships ────────────────────────────────────────────────────

function evidenceTime(ctx: PipelineContext, item: LoadedSourceItem): Date {
  return item.occurredAt < ctx.now ? item.occurredAt : ctx.now;
}

/** Map the edges a resolved source item evidences. Returns the number of edges touched. */
export async function mapSourceRelationships(ctx: PipelineContext, item: LoadedSourceItem, resolution: ResolutionContext): Promise<number> {
  const at = evidenceTime(ctx, item);
  const src = item.id;
  return ctx.db.$transaction(
    async (tx) => {
      let n = 0;
      const edge = async (e: Omit<EdgeInput, "sourceItemId" | "at">) => {
        const r = await upsertRelationship(tx, { ...e, sourceItemId: src, at });
        if (r.id) n++;
        return r;
      };

      // The item mentions every entity resolution found in it.
      for (const p of resolution.people) await edge({ fromType: "SOURCE_ITEM", fromId: src, relation: "MENTIONS", toType: "PERSON", toId: p.id, confidence: p.confidence });
      for (const c of resolution.companies) await edge({ fromType: "SOURCE_ITEM", fromId: src, relation: "MENTIONS", toType: "COMPANY", toId: c.id, confidence: c.confidence });
      for (const p of resolution.projects) await edge({ fromType: "SOURCE_ITEM", fromId: src, relation: "MENTIONS", toType: "PROJECT", toId: p.id, confidence: p.confidence });

      // Employment, evidenced by the address domain matching the company's.
      const companyIds = [...new Set(resolution.people.map((p) => p.companyId).filter((x): x is string => !!x))];
      if (companyIds.length) {
        const [companies, domainAliases] = await Promise.all([
          tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, domain: true } }),
          tx.entityAlias.findMany({ where: { entityType: "COMPANY", entityId: { in: companyIds }, kind: "DOMAIN" }, select: { entityId: true, normalized: true } }),
        ]);
        const domains = new Map<string, Set<string>>();
        for (const c of companies) domains.set(c.id, new Set(c.domain ? [c.domain.toLowerCase()] : []));
        for (const a of domainAliases) domains.get(a.entityId)?.add(a.normalized);
        for (const p of resolution.people) {
          if (!p.companyId || !p.email || p.isCeo) continue;
          const d = domainOf(p.email);
          if (d && domains.get(p.companyId)?.has(d)) {
            await edge({ fromType: "PERSON", fromId: p.id, relation: "WORKS_AT", toType: "COMPANY", toId: p.companyId, confidence: 0.95 });
          }
        }
      }

      // Corporate families among the companies involved.
      n += await linkKnownFamilies(tx, resolution.companies.map((c) => c.id), { sourceItemId: src, at });

      const primary = resolution.primaryCompanyId;
      const deals = resolution.dealIds.length
        ? await tx.deal.findMany({ where: { id: { in: resolution.dealIds } }, select: { id: true, type: true, companyId: true } })
        : [];
      const investorish = item.category === "INVESTOR" || item.category === "FUNDRAISING";
      const preferredDeal = deals.find((d) => (investorish ? d.type === "FUNDRAISING" : d.type !== "FUNDRAISING")) ?? deals[0] ?? null;

      // Threads and documents are "about" their primary company.
      const msg = item.emailMessage;
      if (msg && primary) {
        await edge({ fromType: "EMAIL_THREAD", fromId: msg.threadId, relation: "ABOUT", toType: "COMPANY", toId: primary, confidence: 0.9 });
        const patch: Prisma.EmailThreadUncheckedUpdateInput = {};
        if (!msg.thread.companyId) patch.companyId = primary;
        if (!msg.thread.dealId && preferredDeal) patch.dealId = preferredDeal.id;
        if (Object.keys(patch).length) await tx.emailThread.update({ where: { id: msg.threadId }, data: patch });
        if (preferredDeal) await edge({ fromType: "EMAIL_THREAD", fromId: msg.threadId, relation: "ABOUT", toType: "DEAL", toId: preferredDeal.id, confidence: 0.85 });
      }

      const doc = item.document;
      if (doc) {
        if (primary) await edge({ fromType: "DOCUMENT", fromId: doc.id, relation: "ABOUT", toType: "COMPANY", toId: primary, confidence: 0.85 });
        const project = resolution.projects.find((p) => p.confidence >= 0.8) ?? null;
        if (project) await edge({ fromType: "DOCUMENT", fromId: doc.id, relation: "ABOUT", toType: "PROJECT", toId: project.id, confidence: project.confidence });
        const patch: Prisma.DocumentUncheckedUpdateInput = {};
        if (!doc.companyId && primary) patch.companyId = primary;
        if (!doc.projectId && project) patch.projectId = project.id;
        if (Object.keys(patch).length) await tx.document.update({ where: { id: doc.id }, data: patch });
        for (const p of resolution.people.filter((x) => x.role === "AUTHOR")) {
          await edge({ fromType: "PERSON", fromId: p.id, relation: "AUTHORED", toType: "DOCUMENT", toId: doc.id, confidence: p.confidence });
        }
      }

      // Investors in the item are associated with their open fundraising deal.
      const investors = resolution.companies.filter((c) => c.companyType === "INVESTOR").map((c) => c.id);
      if (investors.length) {
        const rounds = await tx.deal.findMany({ where: { companyId: { in: investors }, type: "FUNDRAISING", status: "OPEN" }, select: { id: true, companyId: true } });
        for (const d of rounds) await edge({ fromType: "COMPANY", fromId: d.companyId!, relation: "ASSOCIATED_WITH", toType: "DEAL", toId: d.id, confidence: 0.95 });
      }
      return n;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
