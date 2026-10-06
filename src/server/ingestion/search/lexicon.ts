/**
 * Loads the planner's Lexicon: company / person / project names, domains,
 * aliases (EntityAlias), corporate families, goal and deal names. Names only —
 * no source content. Cached per request.
 */
import { cache } from "react";
import { db } from "@/lib/db";
import type { Lexicon } from "./planner";

async function load(): Promise<Lexicon> {
  const [companies, people, goals, deals, projects, aliases] = await Promise.all([
    db.company.findMany({ select: { id: true, name: true, type: true, domain: true, parentId: true }, orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } }, take: 3000 }),
    db.person.findMany({ select: { id: true, name: true, email: true, companyId: true, isCeo: true }, orderBy: { lastContactAt: { sort: "desc", nulls: "last" } }, take: 5000 }),
    db.goal.findMany({ select: { id: true, title: true, type: true }, orderBy: { createdAt: "asc" }, take: 1000 }),
    db.deal.findMany({ select: { id: true, name: true, type: true, status: true, companyId: true }, take: 2000 }),
    db.project.findMany({ select: { id: true, name: true }, take: 1000 }),
    db.entityAlias.findMany({
      where: { entityType: { in: ["COMPANY", "PERSON", "PROJECT"] }, kind: { not: "EMAIL" }, confidence: { gte: 0.6 } },
      select: { entityType: true, entityId: true, alias: true },
      take: 20_000,
    }),
  ]);
  const aliasMap = new Map<string, string[]>();
  for (const a of aliases) {
    const key = `${a.entityType}:${a.entityId}`;
    const list = aliasMap.get(key) ?? [];
    list.push(a.alias);
    aliasMap.set(key, list);
  }
  return {
    companies: companies.map((c) => ({ ...c, aliases: aliasMap.get(`COMPANY:${c.id}`) ?? [] })),
    people: people.map((p) => ({ ...p, aliases: aliasMap.get(`PERSON:${p.id}`) ?? [] })),
    goals,
    deals,
    projects: projects.map((p) => ({ ...p, aliases: aliasMap.get(`PROJECT:${p.id}`) ?? [] })),
  };
}

export const loadLexicon = cache(load);
