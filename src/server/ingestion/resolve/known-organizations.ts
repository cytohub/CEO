/**
 * Corporate families and common abbreviations in pharma / biotech.
 *
 * Email and documents rarely use the legal name: "J&J", "JNJ", "Janssen",
 * "MSD", "BI". This dictionary maps those forms to a canonical organization
 * and records parent → subsidiary links. It never creates companies: the
 * resolver only uses it to reach companies that already exist in the Brain,
 * and to set Company.parentId / SUBSIDIARY_OF when both sides exist.
 */
import { normalizeCompanyName } from "./names";

export interface KnownOrganization {
  canonical: string;
  aliases: string[];
  /** Canonical name of the parent organization. */
  parent?: string;
}

export const KNOWN_ORGANIZATIONS: KnownOrganization[] = [
  { canonical: "Johnson & Johnson", aliases: ["J&J", "JNJ", "J and J", "Johnson and Johnson", "Johnson & Johnson Innovative Medicine"] },
  { canonical: "Janssen", aliases: ["Janssen Pharmaceuticals", "Janssen Pharmaceutica", "Janssen Research & Development", "Janssen R&D", "Janssen Biotech"], parent: "Johnson & Johnson" },
  { canonical: "Roche", aliases: ["F. Hoffmann-La Roche", "Hoffmann-La Roche", "Roche Holding", "Roche Pharma", "Roche Pharmaceuticals"] },
  { canonical: "Genentech", aliases: ["GNE"], parent: "Roche" },
  { canonical: "Chugai", aliases: ["Chugai Pharmaceutical"], parent: "Roche" },
  { canonical: "Sanofi", aliases: ["Sanofi-Aventis", "Sanofi Aventis", "Aventis", "SNY"] },
  { canonical: "Genzyme", aliases: ["Sanofi Genzyme"], parent: "Sanofi" },
  { canonical: "Merck & Co.", aliases: ["Merck", "MSD", "Merck Sharp & Dohme", "Merck Sharp and Dohme", "MRK"] },
  { canonical: "AstraZeneca", aliases: ["AZ", "Astra Zeneca", "AZN"] },
  { canonical: "Alexion", aliases: ["Alexion Pharmaceuticals", "Alexion AstraZeneca Rare Disease"], parent: "AstraZeneca" },
  { canonical: "MedImmune", aliases: [], parent: "AstraZeneca" },
  { canonical: "GSK", aliases: ["GlaxoSmithKline", "Glaxo SmithKline", "Glaxo"] },
  { canonical: "Bristol Myers Squibb", aliases: ["BMS", "Bristol-Myers Squibb", "Bristol Myers", "BMY"] },
  { canonical: "Celgene", aliases: [], parent: "Bristol Myers Squibb" },
  { canonical: "Eli Lilly", aliases: ["Lilly", "Eli Lilly and Company", "LLY"] },
  { canonical: "Pfizer", aliases: ["PFE"] },
  { canonical: "Seagen", aliases: ["Seattle Genetics"], parent: "Pfizer" },
  { canonical: "Novartis", aliases: ["NVS", "Novartis Pharma", "Novartis Pharmaceuticals"] },
  { canonical: "AbbVie", aliases: ["ABBV"] },
  { canonical: "Allergan", aliases: [], parent: "AbbVie" },
  { canonical: "Takeda", aliases: ["Takeda Pharmaceutical", "Takeda Pharmaceuticals"] },
  { canonical: "Shire", aliases: [], parent: "Takeda" },
  { canonical: "Boehringer Ingelheim", aliases: ["BI", "Boehringer"] },
  { canonical: "Bayer", aliases: ["Bayer Pharmaceuticals", "Bayer Pharma"] },
  { canonical: "Novo Nordisk", aliases: ["Novo", "NVO"] },
  { canonical: "Amgen", aliases: ["AMGN"] },
  { canonical: "Horizon Therapeutics", aliases: [], parent: "Amgen" },
  { canonical: "Gilead", aliases: ["Gilead Sciences", "GILD"] },
  { canonical: "Kite Pharma", aliases: ["Kite"], parent: "Gilead" },
  { canonical: "Biogen", aliases: ["BIIB"] },
  { canonical: "Moderna", aliases: ["ModernaTX", "MRNA"] },
  { canonical: "Regeneron", aliases: ["Regeneron Pharmaceuticals", "REGN"] },
  { canonical: "Vertex", aliases: ["Vertex Pharmaceuticals", "VRTX"] },
];

interface IndexEntry {
  org: KnownOrganization;
  /** The normalized form that matched (canonical or alias). */
  form: string;
}

let index: Map<string, IndexEntry> | null = null;

function buildIndex(): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>();
  for (const org of KNOWN_ORGANIZATIONS) {
    for (const name of [org.canonical, ...org.aliases]) {
      // Abbreviations keep their letters: "J&J" → "j and j", "AZ" → "az".
      const form = normalizeCompanyName(name);
      if (form && !map.has(form)) map.set(form, { org, form });
    }
  }
  return map;
}

export function knownOrganizationByName(name: string): KnownOrganization | null {
  index ??= buildIndex();
  const form = normalizeCompanyName(name);
  if (!form) return null;
  const hit = index.get(form) ?? index.get(form.replace(/\s+/g, ""));
  return hit?.org ?? null;
}

export function knownOrganizationByCanonical(canonical: string): KnownOrganization | null {
  return KNOWN_ORGANIZATIONS.find((o) => o.canonical === canonical) ?? null;
}

/** Every normalized form (canonical + aliases) of an organization. */
export function knownForms(org: KnownOrganization): string[] {
  return [...new Set([org.canonical, ...org.aliases].map(normalizeCompanyName).filter(Boolean))];
}

/** The top of the family ("Janssen" → "Johnson & Johnson"). */
export function familyRoot(org: KnownOrganization): KnownOrganization {
  let cur = org;
  for (let i = 0; i < 5 && cur.parent; i++) {
    const next = knownOrganizationByCanonical(cur.parent);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/** All organizations in the same corporate family (root first). */
export function familyMembers(org: KnownOrganization): KnownOrganization[] {
  const root = familyRoot(org);
  const out: KnownOrganization[] = [root];
  for (let i = 0; i < out.length; i++) {
    for (const o of KNOWN_ORGANIZATIONS) if (o.parent === out[i].canonical && !out.includes(o)) out.push(o);
  }
  return out;
}

export function knownParent(org: KnownOrganization): KnownOrganization | null {
  return org.parent ? knownOrganizationByCanonical(org.parent) : null;
}
