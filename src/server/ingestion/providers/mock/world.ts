/**
 * The demo world: who is who (from the seeded CytoHub workspace) and the
 * demo connection's anchor, timezone and CEO name.
 *
 * People come straight from prisma/seed-data.ts with the seed's email rule
 * (`<key>@<company>.example`, team `<key>@cytohub.example`), so every demo
 * message and invite resolves to the seeded people and companies.
 */
import { COMPANIES, EXTERNAL_PEOPLE, TEAM } from "../../../../../prisma/seed-data";
import type { Participant, ProviderContext } from "../../types";
import { type DemoClock, demoClock } from "./clock";

export const DEMO_ACCOUNT_EMAIL = "ceo@cytohub.example";
export const DEMO_DEFAULT_TIMEZONE = "America/New_York";

export interface DemoPerson extends Participant {
  name: string;
  key: string;
  first: string;
  title: string;
  company: string | null;
  companyName: string | null;
}

const companyName = new Map(COMPANIES.map((c) => [c.key, c.name]));

/** First name for greetings: "Dr. Henrik Sørensen" → "Henrik", "Prof. Ingrid Holm" → "Ingrid". */
export function firstNameOf(name: string): string {
  const parts = name.replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "").split(/\s+/);
  return parts[0] ?? name;
}

export const PEOPLE: Record<string, DemoPerson> = Object.fromEntries(
  [...TEAM, ...EXTERNAL_PEOPLE].map((p) => [
    p.key,
    {
      key: p.key,
      name: p.name,
      first: firstNameOf(p.name),
      email: `${p.key}@${p.company ?? "cytohub"}.example`,
      title: p.title,
      company: p.company ?? null,
      companyName: p.company ? (companyName.get(p.company) ?? null) : null,
    },
  ]),
);

export interface DemoWorld {
  clock: DemoClock;
  ceo: DemoPerson;
  /** Greeting suffix: " Alex" when the CEO's first name is known, "" otherwise ("Hi,"). */
  hi: string;
  /** CEO sign-off name ("" when unknown). */
  signOff: string;
  person(key: string): DemoPerson;
}

export function demoWorldFromSettings(settings: Record<string, unknown>, opts: { accountEmail?: string | null } = {}): DemoWorld {
  const rawAnchor = typeof settings.demoAnchor === "string" ? Date.parse(settings.demoAnchor) : NaN;
  if (Number.isNaN(rawAnchor)) throw new Error("Demo connection has no valid settings.demoAnchor");
  const timezone = typeof settings.timezone === "string" && settings.timezone ? settings.timezone : DEMO_DEFAULT_TIMEZONE;
  const rawFirst = typeof settings.ceoFirstName === "string" ? settings.ceoFirstName.trim() : "";
  // A placeholder name ("CEO") is not something anyone writes in a greeting.
  const first = rawFirst && rawFirst.toUpperCase() !== "CEO" ? rawFirst : "";
  const rawName = typeof settings.ceoName === "string" ? settings.ceoName.trim() : "";
  const ceoName = rawName && rawName.toUpperCase() !== "CEO" ? rawName : first || "CEO";
  const ceo: DemoPerson = {
    key: "ceo",
    name: ceoName,
    first: first || "",
    email: (opts.accountEmail ?? DEMO_ACCOUNT_EMAIL).toLowerCase(),
    title: "Chief Executive Officer",
    company: "cytohub",
    companyName: "CytoHub",
  };
  return {
    clock: demoClock(new Date(rawAnchor), timezone),
    ceo,
    hi: first ? ` ${first}` : "",
    signOff: first,
    person(key) {
      if (key === "ceo") return ceo;
      const p = PEOPLE[key];
      if (!p) throw new Error(`Unknown demo person: ${key}`);
      return p;
    },
  };
}

export function demoWorld(ctx: ProviderContext): DemoWorld {
  return demoWorldFromSettings(ctx.connection.settings, { accountEmail: ctx.connection.accountEmail });
}
