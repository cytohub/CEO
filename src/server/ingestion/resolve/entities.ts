/**
 * Entity resolution: map the mentions found in a source item (EntityMention
 * rows written by the ENTITY_EXTRACTION stage) to canonical people, companies
 * and projects, creating only what is safe to create:
 *
 *   PERSON  email → Person.email / EMAIL alias (1.0). Unknown real participants
 *           of a non-noise item become new people (CREATED). Names alone
 *           resolve (exact 0.9, first name within a narrow scope 0.7) but
 *           never create anyone.
 *   COMPANY domain → Company.domain / DOMAIN alias (1.0). Unknown corporate
 *           domains of participants become companies when the item matters,
 *           except investors, which always go to review. Names resolve through
 *           aliases, the known pharma families and fuzzy matching (AMBIGUOUS).
 *   PROJECT exact or contained name / alias; never created.
 *
 * Also learns aliases for known people, moves lastContactAt / lastActivityAt
 * forward, and returns the item's ResolutionContext.
 */
import type { CompanyType, MentionResolution, MentionRole, PersonType, ProjectKind } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { RELEVANCE } from "@/lib/intelligence";
import { BRAIN_ACTOR, emptyCounters, emptySummary, snapshotOf, type WriteEnv } from "../write/env";
import { recordActivity } from "../write/history";
import { addAlias, personTypeForCompany } from "../write/records";
import { queueReview } from "../write/review";
import type { Classification, LoadedSourceItem, MentionDraft, PipelineContext, ResolutionContext, StageData } from "../types";
import { familyMembers, knownForms, knownOrganizationByName, knownParent } from "./known-organizations";
import {
  companyCoreName,
  domainLookupKeys,
  domainOf,
  firstNameKey,
  isFreeMailDomain,
  isFuzzyCompanyMatch,
  isNameLike,
  isRoleMailbox,
  jaroWinkler,
  looksLikeInvestor,
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonName,
  personDisplayName,
  prettifyDomain,
  registrableLabel,
} from "./names";

const PARTICIPANT_ROLES: ReadonlySet<MentionRole> = new Set(["SENDER", "RECIPIENT", "CC", "ORGANIZER", "ATTENDEE"]);
const ROLE_RANK: Record<MentionRole, number> = { SENDER: 7, ORGANIZER: 6, RECIPIENT: 5, CC: 4, ATTENDEE: 3, AUTHOR: 2, MENTIONED: 1 };

// ─── Directory ───────────────────────────────────────────────────────────────

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  companyId: string | null;
  type: PersonType;
  isCeo: boolean;
}

interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  type: CompanyType;
  parentId: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
  kind: ProjectKind;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

class Directory {
  peopleById = new Map<string, PersonRow>();
  peopleByEmail = new Map<string, PersonRow>();
  peopleByName = new Map<string, PersonRow[]>();
  peopleByFirst = new Map<string, PersonRow[]>();
  companiesById = new Map<string, CompanyRow>();
  companiesByDomain = new Map<string, CompanyRow>();
  companiesByName = new Map<string, CompanyRow[]>();
  companiesByAlias = new Map<string, CompanyRow[]>();
  companiesByCore = new Map<string, CompanyRow[]>();
  projects: { row: ProjectRow; forms: string[] }[] = [];

  addPerson(p: PersonRow) {
    this.peopleById.set(p.id, p);
    if (p.email) this.peopleByEmail.set(p.email.toLowerCase(), p);
    const n = normalizePersonName(p.name);
    if (n) {
      push(this.peopleByName, n, p);
      push(this.peopleByFirst, firstNameKey(n), p);
    }
  }

  addCompany(c: CompanyRow) {
    this.companiesById.set(c.id, c);
    if (c.domain) this.companiesByDomain.set(c.domain.toLowerCase(), c);
    const n = normalizeCompanyName(c.name);
    if (n) {
      push(this.companiesByName, n, c);
      push(this.companiesByCore, companyCoreName(n), c);
    }
  }
}

async function loadDirectory(tx: Tx): Promise<Directory> {
  const [people, companies, projects, aliases] = await Promise.all([
    tx.person.findMany({ select: { id: true, name: true, email: true, companyId: true, type: true, isCeo: true } }),
    tx.company.findMany({ select: { id: true, name: true, domain: true, type: true, parentId: true } }),
    tx.project.findMany({ select: { id: true, name: true, kind: true } }),
    tx.entityAlias.findMany({ where: { entityType: { in: ["PERSON", "COMPANY", "PROJECT"] } }, select: { entityType: true, entityId: true, normalized: true, kind: true } }),
  ]);
  const dir = new Directory();
  for (const p of people) dir.addPerson(p);
  for (const c of companies) dir.addCompany(c);
  const projectForms = new Map<string, string[]>();
  for (const p of projects) projectForms.set(p.id, [normalizeCompanyName(p.name)]);
  for (const a of aliases) {
    if (a.entityType === "PERSON") {
      const p = dir.peopleById.get(a.entityId);
      if (!p) continue;
      if (a.kind === "EMAIL") dir.peopleByEmail.set(a.normalized, p);
      else {
        push(dir.peopleByName, a.normalized, p);
        if (a.kind === "NICKNAME") push(dir.peopleByFirst, a.normalized, p);
      }
    } else if (a.entityType === "COMPANY") {
      const c = dir.companiesById.get(a.entityId);
      if (!c) continue;
      if (a.kind === "DOMAIN") dir.companiesByDomain.set(a.normalized, c);
      else push(dir.companiesByAlias, a.normalized, c);
    } else {
      projectForms.get(a.entityId)?.push(a.normalized);
    }
  }
  dir.projects = projects.map((row) => ({ row, forms: [...new Set(projectForms.get(row.id) ?? [])].filter(Boolean) }));
  return dir;
}

// ─── Resolution state ────────────────────────────────────────────────────────

interface Outcome {
  entityId: string | null;
  resolution: MentionResolution;
  confidence: number;
  candidates?: { entityId: string; label: string; score: number }[];
  reason?: string;
}

interface MentionWork {
  rowId: string;
  draft: MentionDraft;
  outcome?: Outcome;
}

interface DomainOutcome {
  company: CompanyRow | null;
  resolution: MentionResolution;
  confidence: number;
  reason?: string;
}

const COMMERCIAL: ReadonlySet<string> = new Set(["COMMERCIAL_OPPORTUNITY", "CUSTOMER"]);

/** True when a "company name" is just the domain label spelled out ("Orbitventures" for orbitventures.example). */
function isDomainDerived(name: string, domain: string): boolean {
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squash(name) === squash(registrableLabel(domain));
}

class Resolver {
  private domainCache = new Map<string, DomainOutcome>();
  /** Best organization name seen in the item for each domain (signature / body text beats the domain label). */
  readonly domainHints = new Map<string, string>();
  readonly env: WriteEnv;
  /** People resolved from participant addresses (scope for first-name matching). */
  readonly participants = new Set<string>();

  constructor(
    readonly ctx: PipelineContext,
    readonly tx: Tx,
    readonly item: LoadedSourceItem,
    readonly classification: Classification | null,
    readonly dir: Directory,
    readonly ownDomain: string,
  ) {
    this.env = {
      tx,
      now: ctx.now,
      today: ctx.ceo.today,
      timezone: ctx.ceo.timezone,
      ceo: { personId: ctx.ceo.personId, userId: ctx.ceo.userId, name: ctx.ceo.name, email: ctx.ceo.email },
      actor: BRAIN_ACTOR,
      source: snapshotOf(item),
      engine: null,
      relevance: classification?.relevance ?? item.relevance ?? null,
      summary: emptySummary(),
      counters: emptyCounters(),
    };
  }

  get isNoise(): boolean {
    return Boolean(this.classification?.isNoise || this.item.emailMessage?.isAutomated);
  }

  get relevantEnough(): boolean {
    const rel = this.classification?.relevance ?? this.item.relevance ?? "NORMAL";
    return RELEVANCE[rel].rank >= RELEVANCE.NORMAL.rank;
  }

  get investorContext(): boolean {
    const cat = this.classification?.category ?? this.item.category;
    return cat === "INVESTOR" || cat === "FUNDRAISING";
  }

  // ── Companies by domain ──

  async companyForDomain(rawDomain: string, opts: { participant: boolean; nameHint?: string | null }): Promise<DomainOutcome> {
    const domain = rawDomain.toLowerCase();
    const cached = this.domainCache.get(domain);
    if (cached) return cached;
    const out = await this.resolveDomain(domain, opts);
    this.domainCache.set(domain, out);
    return out;
  }

  private async resolveDomain(domain: string, opts: { participant: boolean; nameHint?: string | null }): Promise<DomainOutcome> {
    for (const key of domainLookupKeys(domain)) {
      const hit = this.dir.companiesByDomain.get(key);
      if (hit) return { company: hit, resolution: "RESOLVED", confidence: 1 };
    }
    if (domain === this.ownDomain || domainLookupKeys(domain).includes(this.ownDomain)) return { company: null, resolution: "IGNORED", confidence: 1, reason: "own domain" };
    if (isFreeMailDomain(domain)) return { company: null, resolution: "IGNORED", confidence: 1, reason: "free-mail domain" };
    if (!opts.participant || this.isNoise) return { company: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown domain" };

    const candidates = [this.domainHints.get(domain), opts.nameHint].map((h) => h?.trim()).filter((h): h is string => !!h && h.length >= 2 && !h.includes("@"));
    const hint = candidates.find((h) => !isDomainDerived(h, domain)) ?? null;
    const name = hint ?? prettifyDomain(domain);
    const normalized = normalizeCompanyName(name);

    // Same name, new domain: the company exists — learn the domain instead of creating a twin.
    const sameName = this.dir.companiesByName.get(normalized) ?? this.dir.companiesByAlias.get(normalized);
    if (sameName?.length === 1) {
      await addAlias(this.tx, "COMPANY", sameName[0].id, domain, "DOMAIN", "LEARNED", 0.85, this.ctx.now);
      this.dir.companiesByDomain.set(domain, sameName[0]);
      return { company: sameName[0], resolution: "RESOLVED", confidence: 0.85, reason: "name match; domain learned" };
    }

    if (this.investorContext || looksLikeInvestor(name, domain)) {
      // New investors are protected: a human confirms them before they enter the pipeline.
      await queueReview(this.env, {
        kind: "NEW_INVESTOR",
        title: `Possible new investor: ${name}`,
        reason: `${domain} is not in CytoHub Brain and this ${this.investorContext ? "fundraising conversation" : "organization name"} suggests an investor. New investors are only added after review.`,
        impact: 4,
        confidenceScore: 0.7,
        proposal: { name, domain, website: `https://${domain}`, personIds: [], createDeal: false, dealName: null, confidence: 0.7, evidence: null },
        fingerprint: `new-investor:${domain}`,
        excerpt: this.item.title,
        sensitivity: this.item.sensitivity,
      });
      return { company: null, resolution: "UNRESOLVED", confidence: 0.7, reason: "new investor pending review" };
    }

    if (!this.relevantEnough) return { company: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown domain on a low-relevance item" };

    const cat = this.classification?.category ?? this.item.category ?? "OTHER";
    const type: CompanyType = COMMERCIAL.has(cat) ? "PROSPECT" : cat === "STRATEGIC_PARTNER" ? "PARTNER" : cat === "MAJOR_VENDOR" ? "VENDOR" : "OTHER";
    const company = await this.createCompany(name, domain, type);
    return { company, resolution: "CREATED", confidence: 0.9 };
  }

  private async createCompany(name: string, domain: string, type: CompanyType): Promise<CompanyRow> {
    let finalName = name.slice(0, 200);
    if (await this.tx.company.findUnique({ where: { name: finalName }, select: { id: true } })) finalName = `${finalName} (${domain})`.slice(0, 200);
    const at = this.item.occurredAt < this.ctx.now ? this.item.occurredAt : this.ctx.now;
    const row = await this.tx.company.create({
      data: { name: finalName, type, domain, website: `https://${domain}`, relationship: 2, lastActivityAt: at, createdAt: this.ctx.now },
      select: { id: true, name: true, domain: true, type: true, parentId: true },
    });
    await addAlias(this.tx, "COMPANY", row.id, domain, "DOMAIN", "SYSTEM", 1, this.ctx.now);
    await recordActivity(this.env, "ENTITY_CREATED", `New company from ${domain}: ${row.name}`, { companyId: row.id }, { entity: "COMPANY", domain, type });

    // A new company that nearly duplicates an existing one goes to review as a possible merge.
    const n = normalizeCompanyName(row.name);
    const core = companyCoreName(n);
    let best: { c: CompanyRow; score: number } | null = null;
    for (const c of this.dir.companiesById.values()) {
      const cn = normalizeCompanyName(c.name);
      const fuzzy = isFuzzyCompanyMatch(n, cn);
      const score = core && core === companyCoreName(cn) ? Math.max(0.92, fuzzy.score) : fuzzy.match ? fuzzy.score : 0;
      if (score && (!best || score > best.score)) best = { c, score };
    }
    this.dir.addCompany(row);
    if (best) {
      const [a, b] = [best.c.id, row.id].sort();
      await queueReview(this.env, {
        kind: "ENTITY_MERGE",
        title: `Same company? ${row.name} / ${best.c.name}`,
        reason: `A company was created from ${domain} whose name closely matches ${best.c.name}.`,
        impact: 3,
        confidenceScore: best.score,
        proposal: { entityType: "COMPANY", keepId: best.c.id, keepLabel: best.c.name, mergeId: row.id, mergeLabel: row.name, score: Math.min(1, best.score), reason: `Name similarity ${Math.round(best.score * 100)}%; ${domain} is new.` },
        targetType: "COMPANY",
        targetId: best.c.id,
        candidates: [{ entityId: best.c.id, label: best.c.name, score: best.score }],
        fingerprint: `merge:COMPANY:${a}:${b}`,
        sensitivity: this.item.sensitivity,
      });
    }
    return row;
  }

  // ── People by email ──

  async personForEmail(email: string, display: string | null, role: MentionRole, companyHint: string | null): Promise<Outcome> {
    const addr = normalizeEmail(email);
    if (this.ctx.ceo.email && addr === this.ctx.ceo.email.toLowerCase()) return { entityId: this.ctx.ceo.personId, resolution: "RESOLVED", confidence: 1 };
    const known = this.dir.peopleByEmail.get(addr);
    if (known) {
      await this.learnName(known, display);
      return { entityId: known.id, resolution: "RESOLVED", confidence: 1 };
    }

    const domain = domainOf(addr);
    const participant = PARTICIPANT_ROLES.has(role);
    const company = domain ? await this.companyForDomain(domain, { participant: participant && !isRoleMailbox(addr), nameHint: companyHint }) : null;

    // A known person writing from a new address at their own company: same person, learn the address.
    if (isNameLike(display)) {
      const n = normalizePersonName(display);
      const same = (this.dir.peopleByName.get(n) ?? []).filter((p) => {
        if (!p.email && !p.companyId) return false;
        const pd = domainOf(p.email);
        return (pd && pd === domain) || (company?.company && p.companyId === company.company.id);
      });
      if (same.length === 1) {
        await addAlias(this.tx, "PERSON", same[0].id, addr, "EMAIL", "LEARNED", 0.9, this.ctx.now);
        this.dir.peopleByEmail.set(addr, same[0]);
        return { entityId: same[0].id, resolution: "RESOLVED", confidence: 0.9, reason: "name match at the same organization; address learned" };
      }
    }

    if (!participant || this.isNoise || isRoleMailbox(addr)) return { entityId: null, resolution: "UNRESOLVED", confidence: 0, reason: participant ? "role mailbox or noise" : "not a participant" };

    const own = domain === this.ownDomain;
    const type: PersonType = own ? "TEAM" : company?.company ? personTypeForCompany(company.company.type) : company?.reason === "new investor pending review" ? "INVESTOR" : "OTHER";
    const name = personDisplayName(display, addr).slice(0, 200);
    const row = await this.tx.person.create({
      data: { name, email: addr, type, companyId: company?.company?.id ?? null, createdAt: this.ctx.now },
      select: { id: true, name: true, email: true, companyId: true, type: true, isCeo: true },
    });
    await addAlias(this.tx, "PERSON", row.id, addr, "EMAIL", "SYSTEM", 1, this.ctx.now);
    await recordActivity(this.env, "ENTITY_CREATED", `New contact: ${row.name}${company?.company ? ` (${company.company.name})` : ""}`, { personId: row.id, companyId: row.companyId }, { entity: "PERSON", email: addr, role });

    // Same full name as someone we already know, but a different organization: ask, don't guess.
    const n = normalizePersonName(row.name);
    const twin = n.includes(" ") ? (this.dir.peopleByName.get(n) ?? []).find((p) => !p.isCeo) : undefined;
    this.dir.addPerson(row);
    if (twin) {
      const [a, b] = [twin.id, row.id].sort();
      await queueReview(this.env, {
        kind: "ENTITY_MERGE",
        title: `Same person? ${row.name} (${addr})`,
        reason: `${row.name} wrote from ${addr}, which is not an address we know for ${twin.name}${twin.email ? ` (${twin.email})` : ""}.`,
        impact: 2,
        confidenceScore: 0.75,
        proposal: { entityType: "PERSON", keepId: twin.id, keepLabel: twin.name, mergeId: row.id, mergeLabel: `${row.name} <${addr}>`, score: 0.75, reason: "Identical name, different address." },
        targetType: "PERSON",
        targetId: twin.id,
        candidates: [{ entityId: twin.id, label: twin.name, score: 0.75 }],
        fingerprint: `merge:PERSON:${a}:${b}`,
        sensitivity: this.item.sensitivity,
      });
    }
    // Attach to a pending investor review so approval can link them.
    if (company?.reason === "new investor pending review" && domain) await this.attachToInvestorReview(domain, row.id);
    return { entityId: row.id, resolution: "CREATED", confidence: 1 };
  }

  private async attachToInvestorReview(domain: string, personId: string) {
    const r = await this.tx.reviewQueueItem.findUnique({ where: { fingerprint: `new-investor:${domain}` }, select: { id: true, status: true, proposal: true } });
    if (!r || r.status !== "PENDING") return;
    const p = (r.proposal ?? {}) as { personIds?: string[] };
    const ids = new Set(p.personIds ?? []);
    if (ids.has(personId)) return;
    ids.add(personId);
    await this.tx.reviewQueueItem.update({ where: { id: r.id }, data: { proposal: { ...(r.proposal as object), personIds: [...ids] } as Prisma.InputJsonValue } });
  }

  /** Remember a new full-name spelling for a known person ("Henrik Sorensen" for "Dr. Henrik Sørensen"). */
  private async learnName(p: PersonRow, display: string | null) {
    if (!isNameLike(display)) return;
    const n = normalizePersonName(display);
    if (!n.includes(" ") || n === normalizePersonName(p.name)) return;
    if (await addAlias(this.tx, "PERSON", p.id, display, "NAME", "LEARNED", 0.9, this.ctx.now)) push(this.dir.peopleByName, n, p);
  }

  // ── People by name ──

  personByName(text: string, primaryCompanyId: string | null): Outcome {
    const n = normalizePersonName(text);
    if (!n || n.length < 2) return { entityId: null, resolution: "IGNORED", confidence: 0, reason: "empty name" };
    const ceoName = normalizePersonName(this.ctx.ceo.name);
    if (n === ceoName && n.includes(" ")) return { entityId: this.ctx.ceo.personId, resolution: "RESOLVED", confidence: 0.9 };

    const exact = this.dir.peopleByName.get(n) ?? [];
    if (exact.length === 1) return { entityId: exact[0].id, resolution: "RESOLVED", confidence: 0.9 };
    if (exact.length > 1) {
      const scoped = exact.filter((p) => this.participants.has(p.id) || (primaryCompanyId && p.companyId === primaryCompanyId));
      if (scoped.length === 1) return { entityId: scoped[0].id, resolution: "RESOLVED", confidence: 0.85 };
      return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.5, candidates: exact.slice(0, 5).map((p) => ({ entityId: p.id, label: p.name, score: 0.9 })), reason: "several people share this name" };
    }

    if (!n.includes(" ")) {
      // First name only: unique within a narrow scope, otherwise a human picks.
      const all = this.dir.peopleByFirst.get(n) ?? [];
      const scopes: PersonRow[][] = [
        all.filter((p) => this.participants.has(p.id)),
        primaryCompanyId ? all.filter((p) => p.companyId === primaryCompanyId) : [],
        all.filter((p) => p.type === "TEAM" || p.isCeo),
      ];
      for (const s of scopes) {
        if (s.length === 1) return { entityId: s[0].id, resolution: "RESOLVED", confidence: 0.7 };
        if (s.length > 1) break;
      }
      if (all.length) return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.4, candidates: all.slice(0, 5).map((p) => ({ entityId: p.id, label: p.name, score: 0.6 })), reason: "first name only" };
      return { entityId: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown person" };
    }

    const fuzzy = [...this.dir.peopleByName.entries()]
      .map(([form, people]) => ({ people, score: jaroWinkler(n, form) }))
      .filter((x) => x.score >= 0.93)
      .sort((a, b) => b.score - a.score);
    if (fuzzy.length) {
      const cands = fuzzy.flatMap((f) => f.people.map((p) => ({ entityId: p.id, label: p.name, score: Math.round(f.score * 100) / 100 }))).slice(0, 5);
      return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.5, candidates: cands, reason: "similar name" };
    }
    return { entityId: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown person" };
  }

  // ── Companies by name ──

  companyByName(text: string): Outcome {
    const n = normalizeCompanyName(text);
    if (!n) return { entityId: null, resolution: "IGNORED", confidence: 0, reason: "empty name" };
    const one = (list: CompanyRow[] | undefined) => (list && list.length === 1 ? list[0] : null);

    const canonical = this.dir.companiesByName.get(n);
    if (one(canonical)) return { entityId: canonical![0].id, resolution: "RESOLVED", confidence: 0.95 };
    const alias = this.dir.companiesByAlias.get(n);
    if (one(alias)) return { entityId: alias![0].id, resolution: "RESOLVED", confidence: 0.9 };
    const core = this.dir.companiesByCore.get(n) ?? this.dir.companiesByCore.get(companyCoreName(n));
    if (one(core)) return { entityId: core![0].id, resolution: "RESOLVED", confidence: 0.85 };

    // Known corporate families: "J&J" → Johnson & Johnson, "Genentech" → Genentech (or Roche when only the parent exists).
    const org = knownOrganizationByName(text);
    if (org) {
      const find = (forms: string[]) => {
        for (const f of forms) {
          const hit = one(this.dir.companiesByName.get(f)) ?? one(this.dir.companiesByAlias.get(f));
          if (hit) return hit;
        }
        return null;
      };
      const direct = find(knownForms(org));
      if (direct) return { entityId: direct.id, resolution: "RESOLVED", confidence: 0.9, reason: `known alias of ${org.canonical}` };
      const parent = knownParent(org);
      const parentRow = parent ? find(knownForms(parent)) : null;
      if (parentRow) return { entityId: parentRow.id, resolution: "RESOLVED", confidence: 0.75, reason: `${org.canonical} is part of ${parent!.canonical}` };
      const family = familyMembers(org)
        .map((m) => find(knownForms(m)))
        .filter((x): x is CompanyRow => !!x);
      if (family.length) return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.5, candidates: family.slice(0, 3).map((c) => ({ entityId: c.id, label: c.name, score: 0.6 })), reason: `same corporate family as ${org.canonical}` };
    }

    const scored: { c: CompanyRow; score: number }[] = [];
    for (const c of this.dir.companiesById.values()) {
      const m = isFuzzyCompanyMatch(n, normalizeCompanyName(c.name));
      if (m.match) scored.push({ c, score: m.score });
    }
    for (const [form, list] of this.dir.companiesByAlias) {
      const m = isFuzzyCompanyMatch(n, form);
      if (m.match) for (const c of list) scored.push({ c, score: m.score * 0.98 });
    }
    if (scored.length) {
      const best = new Map<string, { c: CompanyRow; score: number }>();
      for (const s of scored) if (!best.has(s.c.id) || best.get(s.c.id)!.score < s.score) best.set(s.c.id, s);
      const cands = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 3);
      return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.6, candidates: cands.map((x) => ({ entityId: x.c.id, label: x.c.name, score: Math.round(x.score * 100) / 100 })), reason: "similar company name" };
    }
    return { entityId: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown company" };
  }

  // ── Projects ──

  projectByName(text: string): Outcome {
    const n = normalizeCompanyName(text);
    if (!n) return { entityId: null, resolution: "IGNORED", confidence: 0 };
    for (const p of this.dir.projects) if (p.forms.includes(n)) return { entityId: p.row.id, resolution: "RESOLVED", confidence: 0.9 };
    const contained = this.dir.projects.filter((p) => p.forms.some((f) => f.length >= 4 && (` ${n} `.includes(` ${f} `) || (n.length >= 4 && ` ${f} `.includes(` ${n} `)))));
    if (contained.length === 1) return { entityId: contained[0].row.id, resolution: "RESOLVED", confidence: 0.8 };
    if (contained.length > 1) return { entityId: null, resolution: "AMBIGUOUS", confidence: 0.5, candidates: contained.slice(0, 3).map((p) => ({ entityId: p.row.id, label: p.row.name, score: 0.7 })) };
    return { entityId: null, resolution: "UNRESOLVED", confidence: 0, reason: "unknown project" };
  }
}

// ─── Stage entry point ───────────────────────────────────────────────────────

function pairDrafts(rows: { id: string; entityType: string; text: string; email: string | null; role: MentionRole; confidence: number }[], drafts: MentionDraft[]): MentionWork[] {
  const used = new Set<number>();
  return rows.map((row) => {
    let idx = drafts.findIndex((d, i) => !used.has(i) && d.entityType === row.entityType && d.text.slice(0, 300) === row.text && (d.email ?? null) === (row.email ?? null) && d.role === row.role);
    if (idx < 0) idx = drafts.findIndex((d, i) => !used.has(i) && d.entityType === row.entityType && d.text.slice(0, 300) === row.text);
    if (idx >= 0) used.add(idx);
    const draft: MentionDraft =
      idx >= 0 ? drafts[idx] : { entityType: row.entityType as MentionDraft["entityType"], text: row.text, email: row.email, role: row.role, confidence: row.confidence, domain: domainOf(row.email), companyHint: null };
    return { rowId: row.id, draft };
  });
}

function looksLikeDomain(text: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text.trim());
}

export async function resolveMentions(ctx: PipelineContext, item: LoadedSourceItem): Promise<ResolutionContext> {
  const stage = (item.stageData as StageData | null) ?? {};
  const classification = stage.classification ?? null;
  const rows = await ctx.db.entityMention.findMany({
    where: { sourceItemId: item.id, entityType: { in: ["PERSON", "COMPANY", "PROJECT"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, entityType: true, text: true, email: true, role: true, confidence: true },
  });
  const work = pairDrafts(rows, stage.mentions ?? []);
  const ownDomain = domainOf(ctx.ceo.email) ?? "cytohub.example";

  return ctx.db.$transaction(
    async (tx) => {
      const dir = await loadDirectory(tx);
      const r = new Resolver(ctx, tx, item, classification, dir, ownDomain);
      for (const w of work) {
        const d = w.draft;
        const domain = d.domain ?? domainOf(d.email);
        if (!domain) continue;
        const hint = d.entityType === "COMPANY" && !looksLikeDomain(d.text) ? d.text : d.companyHint;
        if (hint && !isDomainDerived(hint, domain) && !r.domainHints.has(domain.toLowerCase())) r.domainHints.set(domain.toLowerCase(), hint);
      }

      // 1. Participants with addresses (they anchor everything else).
      for (const w of work) {
        const d = w.draft;
        if (d.entityType !== "PERSON" || !d.email) continue;
        w.outcome = await r.personForEmail(d.email, d.text, d.role, d.companyHint ?? null);
        if (w.outcome.entityId && PARTICIPANT_ROLES.has(d.role)) r.participants.add(w.outcome.entityId);
      }
      // 2. Companies by domain, then by name.
      for (const w of work) {
        const d = w.draft;
        if (d.entityType !== "COMPANY") continue;
        const domain = d.domain ?? (looksLikeDomain(d.text) ? d.text.trim().toLowerCase() : null);
        if (domain) {
          const res = await r.companyForDomain(domain, { participant: PARTICIPANT_ROLES.has(d.role), nameHint: d.companyHint ?? (looksLikeDomain(d.text) ? null : d.text) });
          if (res.company || res.resolution !== "UNRESOLVED" || looksLikeDomain(d.text)) {
            w.outcome = { entityId: res.company?.id ?? null, resolution: res.resolution, confidence: res.confidence, reason: res.reason };
            continue;
          }
        }
        w.outcome = r.companyByName(d.companyHint ?? d.text);
      }

      // Provisional primary company for first-name scoping.
      const provisional = primaryCompany(item, work, dir, ctx.ceo.personId);

      // 3. People by name, 4. projects.
      for (const w of work) {
        const d = w.draft;
        if (d.entityType === "PERSON" && !d.email) w.outcome = r.personByName(d.text, provisional);
        else if (d.entityType === "PROJECT") w.outcome = r.projectByName(d.text);
      }

      // Persist mention outcomes.
      for (const w of work) {
        const o = w.outcome ?? { entityId: null, resolution: "UNRESOLVED" as const, confidence: 0 };
        await tx.entityMention.update({
          where: { id: w.rowId },
          data: {
            entityId: o.entityId,
            resolution: o.resolution,
            confidence: o.entityId ? Math.min(1, o.confidence) : w.draft.confidence,
            candidates: o.candidates?.length ? (o.candidates as unknown as Prisma.InputJsonValue) : undefined,
          },
        });
      }

      const resolution = buildResolution(item, work, dir, ctx.ceo.personId, ownDomain);
      resolution.dealIds = resolution.primaryCompanyId
        ? (await tx.deal.findMany({ where: { companyId: resolution.primaryCompanyId, status: "OPEN" }, orderBy: { updatedAt: "desc" }, select: { id: true } })).map((d) => d.id)
        : [];

      await touchContacts(tx, ctx, item, resolution);
      ctx.log("ENTITY_RESOLUTION", `${item.title}: ${resolution.people.length} people, ${resolution.companies.length} companies, ${resolution.unresolved.length} unresolved`);
      if (r.env.counters.reviewItems) ctx.count("reviewItems", r.env.counters.reviewItems);
      if (r.env.counters.recordsWritten) ctx.count("recordsWritten", r.env.counters.recordsWritten);
      return resolution;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

// ─── Resolution context ──────────────────────────────────────────────────────

function mostFrequent(ids: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [id, c] of counts) if (c > n) [best, n] = [id, c];
  return best;
}

function companyOfOutcome(w: MentionWork, dir: Directory): string | null {
  const id = w.outcome?.entityId;
  if (!id) return null;
  if (w.draft.entityType === "COMPANY") return id;
  if (w.draft.entityType === "PERSON") return dir.peopleById.get(id)?.companyId ?? null;
  return null;
}

/** The main external organization of the item (see ResolutionContext.primaryCompanyId). */
function primaryCompany(item: LoadedSourceItem, work: MentionWork[], dir: Directory, ceoPersonId: string): string | null {
  const external = (w: MentionWork) => !!w.outcome?.entityId && w.outcome.entityId !== ceoPersonId;
  const byRole = (roles: MentionRole[]) => work.filter((w) => roles.includes(w.draft.role) && external(w)).map((w) => companyOfOutcome(w, dir));
  const msg = item.emailMessage;
  if (msg) {
    if (msg.direction === "INBOUND") {
      const sender = byRole(["SENDER"]).find(Boolean);
      if (sender) return sender;
    } else if (msg.direction === "OUTBOUND") {
      // Main recipient: the first "to" address with a company.
      const to = Array.isArray(msg.to) ? (msg.to as { email?: string }[]).map((p) => (p.email ?? "").toLowerCase()) : [];
      for (const addr of to) {
        const w = work.find((x) => x.draft.email?.toLowerCase() === addr && x.draft.role === "RECIPIENT");
        const c = w ? companyOfOutcome(w, dir) : null;
        if (c) return c;
      }
      const any = byRole(["RECIPIENT", "CC"]).find(Boolean);
      if (any) return any;
    }
    return mostFrequent([...byRole(["SENDER", "RECIPIENT", "CC"]), ...work.filter((w) => w.draft.entityType === "COMPANY").map((w) => w.outcome?.entityId)]);
  }
  if (item.calendarEvent) return mostFrequent(byRole(["ATTENDEE", "ORGANIZER"])) ?? mostFrequent(work.filter((w) => w.draft.entityType === "COMPANY").map((w) => w.outcome?.entityId));
  if (item.kind === "MEETING_NOTES" && item.meeting?.companyId) return item.meeting.companyId;
  if (item.document?.companyId) return item.document.companyId;
  return mostFrequent(work.map((w) => companyOfOutcome(w, dir)));
}

function buildResolution(item: LoadedSourceItem, work: MentionWork[], dir: Directory, ceoPersonId: string, ownDomain: string): ResolutionContext {
  const people = new Map<string, ResolutionContext["people"][number]>();
  const companies = new Map<string, ResolutionContext["companies"][number]>();
  const projects = new Map<string, ResolutionContext["projects"][number]>();
  const unresolved: ResolutionContext["unresolved"] = [];

  const addCompany = (id: string, confidence: number, resolution: MentionResolution) => {
    const c = dir.companiesById.get(id);
    if (!c) return;
    const prev = companies.get(id);
    if (!prev || prev.confidence < confidence) companies.set(id, { type: "COMPANY", id, label: c.name, confidence, resolution: prev?.resolution === "CREATED" ? "CREATED" : resolution, companyType: c.type });
  };

  for (const w of work) {
    const o = w.outcome;
    const d = w.draft;
    if (!o || !o.entityId) {
      if (o?.resolution !== "IGNORED") unresolved.push({ text: d.text.slice(0, 200), entityType: d.entityType, reason: o?.reason ?? (o?.resolution === "AMBIGUOUS" ? "ambiguous" : "unresolved") });
      continue;
    }
    if (d.entityType === "PERSON") {
      const p = dir.peopleById.get(o.entityId);
      if (!p) continue;
      const prev = people.get(p.id);
      const role = prev && ROLE_RANK[prev.role] >= ROLE_RANK[d.role] ? prev.role : d.role;
      people.set(p.id, {
        type: "PERSON",
        id: p.id,
        label: p.name,
        confidence: Math.max(prev?.confidence ?? 0, o.confidence),
        resolution: prev?.resolution === "CREATED" ? "CREATED" : o.resolution,
        email: p.email ?? d.email ?? null,
        companyId: p.companyId,
        isCeo: p.isCeo || p.id === ceoPersonId,
        role,
      });
      if (p.companyId) addCompany(p.companyId, PARTICIPANT_ROLES.has(d.role) ? 1 : Math.min(0.9, o.confidence), "RESOLVED");
    } else if (d.entityType === "COMPANY") {
      addCompany(o.entityId, o.confidence, o.resolution);
    } else {
      const pr = dir.projects.find((x) => x.row.id === o.entityId);
      if (pr && (!projects.has(pr.row.id) || projects.get(pr.row.id)!.confidence < o.confidence)) {
        projects.set(pr.row.id, { type: "PROJECT", id: pr.row.id, label: pr.row.name, confidence: o.confidence, resolution: o.resolution, kind: pr.row.kind });
      }
    }
  }

  const primaryCompanyId = primaryCompany(item, work, dir, ceoPersonId);
  const isExternal = (p: ResolutionContext["people"][number]) => !p.isCeo && dir.peopleById.get(p.id)?.type !== "TEAM" && domainOf(p.email) !== ownDomain;
  const docLike = !item.emailMessage && !item.calendarEvent;
  const counterpartPersonIds = [...people.values()]
    .filter((p) => isExternal(p) && (PARTICIPANT_ROLES.has(p.role) || (docLike && p.confidence >= 0.85)))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role])
    .map((p) => p.id)
    .slice(0, 10);

  return {
    people: [...people.values()],
    companies: [...companies.values()],
    projects: [...projects.values()],
    primaryCompanyId,
    counterpartPersonIds,
    dealIds: [],
    unresolved: unresolved.slice(0, 50),
  };
}

/** Move lastContactAt / lastActivityAt forward for people and companies the CEO actually dealt with. */
async function touchContacts(tx: Tx, ctx: PipelineContext, item: LoadedSourceItem, resolution: ResolutionContext) {
  let at: Date | null = null;
  if (item.emailMessage) at = item.occurredAt;
  else if (item.calendarEvent && item.calendarEvent.status !== "CANCELLED" && item.calendarEvent.ceoResponse !== "DECLINED" && item.calendarEvent.startsAt <= ctx.now) at = item.calendarEvent.startsAt;
  else if (item.kind === "MEETING_NOTES") at = item.occurredAt;
  if (!at) return;
  if (at > ctx.now) at = ctx.now;
  const people = resolution.people.filter((p) => !p.isCeo && PARTICIPANT_ROLES.has(p.role)).map((p) => p.id);
  const companies = [...new Set(resolution.people.filter((p) => !p.isCeo && PARTICIPANT_ROLES.has(p.role) && p.companyId).map((p) => p.companyId!))];
  if (people.length) await tx.person.updateMany({ where: { id: { in: people }, OR: [{ lastContactAt: null }, { lastContactAt: { lt: at } }] }, data: { lastContactAt: at } });
  if (companies.length) await tx.company.updateMany({ where: { id: { in: companies }, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] }, data: { lastActivityAt: at } });
}
