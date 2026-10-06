/**
 * Classification stage: why does this item matter to the CEO (if at all)?
 *
 * Looks up the participants and named organizations in the Brain (Person by
 * email, Company by domain or name, EntityAlias emails/domains/names) and
 * hands plain facts to the pure rules in classify-rules.ts.
 */
import type { CompanyType, PersonType } from "@/generated/prisma/enums";
import type { Classification, LoadedSourceItem, MentionDraft, Participant, PipelineContext } from "../types";
import { type ClassifyFacts, type CompanyFacts, type ParticipantFacts, type PersonFacts, classifyFacts } from "./classify-rules";
import { domainOf, isFreeMailDomain, normalizeName, registrableDomain } from "./text";

const PERSON_SELECT = {
  id: true,
  name: true,
  email: true,
  type: true,
  title: true,
  department: true,
  isCeo: true,
  company: { select: { id: true, name: true, type: true } },
} as const;

type PersonRow = { id: string; name: string; email: string | null; type: PersonType; title: string | null; department: string | null; isCeo: boolean; company: CompanyFacts | null };

function toPerson(p: PersonRow): PersonFacts {
  return { id: p.id, name: p.name, type: p.type, title: p.title, department: p.department, isCeo: p.isCeo, company: p.company };
}

function participantList(json: unknown): Participant[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((p): p is { email: string; name?: string | null } => !!p && typeof p === "object" && typeof (p as { email?: unknown }).email === "string")
    .map((p) => ({ email: p.email.toLowerCase(), name: p.name ?? null }));
}

/** Gather the facts classification needs (all database access lives here). */
export async function gatherClassifyFacts(ctx: PipelineContext, item: LoadedSourceItem, mentions: MentionDraft[]): Promise<ClassifyFacts> {
  const { db } = ctx;
  const ceoEmail = ctx.ceo.email?.toLowerCase() ?? null;
  const internalDomains = new Set(
    [ceoEmail, item.connection.accountEmail]
      .map((e) => domainOf(e))
      .filter((d): d is string => !!d && !isFreeMailDomain(d))
      .map(registrableDomain),
  );

  const personMentions = mentions.filter((m) => m.entityType === "PERSON" && m.email);
  const emails = [...new Set(personMentions.map((m) => m.email!.toLowerCase()))];
  const domains = [...new Set([...emails.map((e) => domainOf(e)), ...mentions.filter((m) => m.entityType === "COMPANY").map((m) => m.domain)].filter((d): d is string => !!d).map(registrableDomain))].filter(
    (d) => !isFreeMailDomain(d),
  );
  const orgNames = [...new Set(mentions.filter((m) => m.entityType === "COMPANY" && !m.domain).map((m) => m.text))].slice(0, 40);
  const authorNames = mentions.filter((m) => m.entityType === "PERSON" && !m.email && m.role === "AUTHOR").map((m) => m.text);

  const [people, companiesByDomain, companiesByName, aliases, authors] = await Promise.all([
    emails.length ? db.person.findMany({ where: { email: { in: emails } }, select: PERSON_SELECT }) : [],
    domains.length ? db.company.findMany({ where: { domain: { in: domains } }, select: { id: true, name: true, type: true, domain: true } }) : [],
    orgNames.length ? db.company.findMany({ where: { name: { in: orgNames, mode: "insensitive" } }, select: { id: true, name: true, type: true } }) : [],
    emails.length || domains.length || orgNames.length
      ? db.entityAlias.findMany({
          where: {
            OR: [
              { kind: "EMAIL", entityType: "PERSON", normalized: { in: emails } },
              { kind: "DOMAIN", entityType: "COMPANY", normalized: { in: domains } },
              { kind: { in: ["NAME", "ABBREVIATION", "SUBSIDIARY", "FORMER_NAME"] }, entityType: "COMPANY", normalized: { in: orgNames.map(normalizeName) } },
            ],
          },
          select: { entityType: true, entityId: true, normalized: true, kind: true },
        })
      : [],
    authorNames.length ? db.person.findMany({ where: { name: { in: authorNames, mode: "insensitive" } }, select: PERSON_SELECT }) : [],
  ]);

  // Resolve aliases to their canonical rows.
  const aliasPersonIds = aliases.filter((a) => a.entityType === "PERSON").map((a) => a.entityId);
  const aliasCompanyIds = aliases.filter((a) => a.entityType === "COMPANY").map((a) => a.entityId);
  const [aliasPeople, aliasCompanies] = await Promise.all([
    aliasPersonIds.length ? db.person.findMany({ where: { id: { in: aliasPersonIds } }, select: PERSON_SELECT }) : [],
    aliasCompanyIds.length ? db.company.findMany({ where: { id: { in: aliasCompanyIds } }, select: { id: true, name: true, type: true } }) : [],
  ]);

  const personByEmail = new Map<string, PersonRow>();
  for (const p of people) if (p.email) personByEmail.set(p.email.toLowerCase(), p);
  for (const a of aliases.filter((x) => x.entityType === "PERSON")) {
    const p = aliasPeople.find((x) => x.id === a.entityId);
    if (p && !personByEmail.has(a.normalized)) personByEmail.set(a.normalized, p);
  }
  const companyByDomain = new Map<string, CompanyFacts>();
  for (const c of companiesByDomain) if (c.domain) companyByDomain.set(registrableDomain(c.domain), { id: c.id, name: c.name, type: c.type });
  for (const a of aliases.filter((x) => x.entityType === "COMPANY" && x.kind === "DOMAIN")) {
    const c = aliasCompanies.find((x) => x.id === a.entityId);
    if (c && !companyByDomain.has(a.normalized)) companyByDomain.set(a.normalized, c);
  }

  const participants: ParticipantFacts[] = [];
  for (const m of personMentions) {
    const email = m.email!.toLowerCase();
    const row = personByEmail.get(email) ?? null;
    const domain = domainOf(email);
    const reg = domain ? registrableDomain(domain) : null;
    const company = row?.company ?? (reg ? companyByDomain.get(reg) ?? null : null);
    const isCeo = Boolean(row?.isCeo) || (ceoEmail != null && email === ceoEmail);
    participants.push({
      email,
      name: row?.name ?? m.text,
      role: m.role,
      person: row ? toPerson(row) : null,
      company,
      internal: row ? row.type === "TEAM" : reg != null && internalDomains.has(reg),
      isCeo,
    });
  }
  for (const a of authors) {
    participants.push({ email: a.email, name: a.name, role: "AUTHOR", person: toPerson(a), company: a.company, internal: a.type === "TEAM", isCeo: a.isCeo });
  }

  const participantCompanyIds = new Set(participants.map((p) => p.company?.id).filter(Boolean));
  const mentioned = new Map<string, CompanyFacts>();
  for (const c of [...companiesByName, ...aliasCompanies.filter((c) => aliases.some((a) => a.entityId === c.id && a.kind !== "DOMAIN")), ...companiesByDomain]) {
    if (!participantCompanyIds.has(c.id)) mentioned.set(c.id, { id: c.id, name: c.name, type: c.type as CompanyType });
  }

  const facts: ClassifyFacts = {
    kind: item.kind,
    title: item.title,
    text: item.text ?? "",
    occurredAt: item.occurredAt,
    timezone: ctx.ceo.timezone,
    ceoFirstName: ctx.ceo.firstName,
    defaultSensitivity: item.connection.defaultSensitivity,
    participants,
    mentionedCompanies: [...mentioned.values()],
  };

  const msg = item.emailMessage;
  if (msg) {
    const to = participantList(msg.to);
    const cc = participantList(msg.cc);
    facts.email = {
      direction: msg.direction,
      isAutomated: msg.isAutomated,
      fromEmail: msg.fromEmail.toLowerCase(),
      labels: msg.labels,
      ceoInTo: ceoEmail != null && to.some((p) => p.email === ceoEmail),
      ceoInCc: ceoEmail != null && cc.some((p) => p.email === ceoEmail),
      recipientCount: to.length + cc.length,
      ceoInThread: msg.direction === "OUTBOUND" || msg.thread.lastOutboundAt != null,
      attachmentNames: msg.attachments.map((a) => a.filename),
    };
  }

  const ev = item.calendarEvent;
  if (ev) {
    facts.event = {
      status: ev.status,
      ceoResponse: ev.ceoResponse,
      isRecurring: ev.isRecurring,
      attendeeCount: participantList(ev.attendees).length,
      ceoIsOrganizer: ceoEmail != null && ev.organizerEmail?.toLowerCase() === ceoEmail,
    };
  }

  if (item.document) facts.document = { path: item.document.path, format: item.document.format, mimeType: item.document.mimeType };
  return facts;
}

export async function classifyItem(ctx: PipelineContext, item: LoadedSourceItem, mentions: MentionDraft[]): Promise<Classification> {
  const facts = await gatherClassifyFacts(ctx, item, mentions);
  const classification = classifyFacts(facts);
  ctx.log("classify", `${item.title} → ${classification.category} / ${classification.relevance} (${classification.relevanceScore})`);
  return classification;
}
