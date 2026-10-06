/**
 * Entity mention extraction (no database): who and what a source item refers to.
 *
 * Participants come from structured headers (sender / recipients / organizer /
 * attendees / author) with high confidence; organizations, people and
 * products found in the body are lower-confidence hints. Resolution (another
 * stage) maps mentions to canonical records — this module only finds them and
 * never drops the CEO's own address (role preserved; resolution decides).
 */
import type { MentionRole } from "@/generated/prisma/enums";
import type { LoadedSourceItem, MentionDraft, Participant, PipelineCeo } from "../types";
import { companyNameFromDomain, domainOf, isAutomatedAddress, isFreeMailDomain, nameFromEmail, normalizeName, registrableDomain } from "./text";

const ROLE_RANK: Record<MentionRole, number> = { SENDER: 7, ORGANIZER: 6, AUTHOR: 5, RECIPIENT: 4, ATTENDEE: 3, CC: 2, MENTIONED: 1 };
const MAX_MENTIONS = 80;
const BODY_SCAN_CHARS = 20_000;

// ─── Lexicon ─────────────────────────────────────────────────────────────────

const ORG_SUFFIX =
  "(?:Inc\\.?|Incorporated|Ltd\\.?|Limited|LLC|L\\.L\\.C\\.|GmbH|AG|SA|S\\.A\\.|plc|PLC|Corp\\.?|Corporation|Pharma|Pharmaceuticals|Therapeutics|Biosciences|Bio|Biologics|Biotech|" +
  "Ventures|Capital|Partners|Fund|Institute|University|Hospital|Labs|Laboratories|Oncology|Genomics|Diagnostics|Instruments|Sciences|Health\\s+System|Medical\\s+Center)";
const CAP_WORD = "\\p{Lu}[\\p{L}\\p{N}&'’.-]*";
const ORG_RE = new RegExp(`((?:${CAP_WORD}[ \\t]+){0,3}${CAP_WORD})[ \\t]+(${ORG_SUFFIX})(?![\\p{L}\\p{N}])`, "gu");
const ORG_OF_RE = new RegExp(`\\b((?:University|Institute|College|School|Academy)[ \\t]+of[ \\t]+(?:the[ \\t]+)?${CAP_WORD}(?:[ \\t]+${CAP_WORD}){0,2})`, "gu");

/** Capitalized words that open sentences or greetings, never part of an organization name. */
const ORG_LEAD_STOP = new Set(
  (
    "The A An At From With For To Our Your Their My We I And Or But Both Also However Please Once When If As So Then This That These Those Last Next Per " +
    "Re Fwd Fw Sent Subject Cc Bcc Dear Hi Hello Hey Thanks Thank Best Regards Cheers Congrats Congratulations Yesterday Today Tomorrow Team Great " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December " +
    "Attached Following Meeting Call Update Note Notes Agenda Action Decision Risk Next Steps Re: Via Called Signed Joined Met Spoke Introducing Intro"
  ).split(" "),
);

/** CamelCase tokens that are well-known third-party products, not CytoHub projects. */
const PRODUCT_STOP = new Set(
  (
    "PowerPoint LinkedIn YouTube JavaScript TypeScript GitHub GitLab PubMed MacBook iPhone DocuSign SharePoint OneDrive OneNote WhatsApp FedEx PayPal " +
    "HubSpot QuickBooks NetSuite DropBox WebEx GoToMeeting ZoomInfo ClinicalTrials BioRxiv MedRxiv ResearchGate ChatGPT OpenAI DeepMind AstraZeneca " +
    "GlaxoSmithKline BioNTech McKinsey PwC EY KPMG CytoHub SalesForce Salesforce FaceTime AirPods TikTok WeChat PhD MSc BSc"
  ).split(" "),
);

const TITLE_WORDS =
  /\b(?:VP|SVP|EVP|Vice President|President|Director|Head|Chief|Officer|Manager|Partner|Principal|Associate|Founder|Co-founder|CEO|CFO|COO|CSO|CTO|CMO|CBO|Counsel|Scientist|Professor|Lead|Analyst|Engineer|Specialist|Coordinator|Assistant|Investigator|Chair|Board|Member|Advisor|Consultant|Fellow|Researcher|Surgeon|Physician)\b/i;

/** Common first names (international) for conservative body-name detection. */
const FIRST_NAMES = new Set(
  (
    "Aaron Adam Adrian Ahmed Aisha Alan Alex Alexander Alexandra Ali Alice Alicia Amanda Amelia Amy Ana Andrea Andrew Angela Anil Anita Ann Anna Anne Anthony Arjun " +
    "Ben Benjamin Beth Bill Brian Bruno Carla Carlos Caroline Catherine Charles Charlotte Chen Chris Christian Christina Christopher Claire Claudia Daniel David Deborah " +
    "Diana Elena Elizabeth Ella Emily Emma Eric Erik Eva Fatima Felix Fiona Francesca Frank Gabriel George Grace Hannah Hans Helen Henrik Hiroshi Ian Ingrid Isabel " +
    "Jack Jacob James Jane Jason Javier Jennifer Jessica Jian Joanna Johan John Jonas Jonathan Jose Joseph Julia Julian Karen Karl Kate Katherine Kenji Kevin Kim Lars " +
    "Laura Lauren Lea Leah Lena Linda Lisa Lucas Lucy Luis Maria Mark Martin Mary Matthew Maya Mei Mia Michael Michelle Mohammed Nadia Natalie Nicholas Nicole Nina " +
    "Noah Oliver Olivia Omar Oscar Paul Paula Peter Philip Pierre Priya Rachel Rahul Raj Rajib Rebecca Richard Robert Ryan Sam Samuel Sandra Sara Sarah Sean Simon " +
    "Sofia Sophie Stefan Stephanie Steven Susan Thomas Tim Timothy Tom Victoria Vikram William Wei Yuki Zoe Marcus Daniela Ruth Hugo Leo Ravi Sanjay Priyanka Ahmad"
  ).split(" "),
);
const NAME_WORD = "\\p{Lu}[\\p{Ll}'’-]+";
const TITLED_RE = new RegExp(`\\b((?:Dr|Prof|Professor|Mr|Mrs|Ms|Mx)\\.?[ \\t]+${NAME_WORD}(?:[ \\t]+${NAME_WORD}){0,2})`, "gu");
const FIRST_LAST_RE = new RegExp(`(?<![\\p{L}.])(${NAME_WORD})[ \\t]+(${NAME_WORD}(?:-${NAME_WORD})?)(?![\\p{L}])`, "gu");
const SURNAME_STOP = new Set([...ORG_LEAD_STOP, "Pharma", "Capital", "Ventures", "Partners", "Fund", "Bio", "Therapeutics", "Biosciences", "Institute", "University", "Hospital", "Labs", "Cloud", "Series", "Board", "Data", "Model", "Team", "Office", "Group"]);

const PRODUCT_RE = /\b(\p{Lu}\p{Ll}+(?:\p{Lu}[\p{Ll}\p{N}]*)+(?:\.AI)?)(?![\p{L}])/gu;
const SERIES_RE = /\bSeries\s+([A-F])\b/g;

const SIGN_OFF = /^(?:best(?: regards| wishes)?|kind regards|warm regards|regards|thanks(?: again)?|thank you|many thanks|cheers|sincerely|warmly|all the best|talk soon|br)\s*[,!.]?\s*$/i;
const ACTION_LINE_RE = new RegExp(
  `^\\s*(?:[-*•]\\s*)?(?:\\[[ xX]?\\]\\s*)?(?:(?:[Aa]ction(?:\\s+[Ii]tems?)?|AI|[Tt]odo|TODO|[Tt]o-do|[Oo]wner|[Nn]ext\\s+[Ss]teps?)\\s*[:-]\\s*)?@?(${NAME_WORD}(?:\\s+${NAME_WORD})?)\\s*(?:to|will|should|is to|needs to|owns|:|-|–)\\s+\\p{Ll}`,
  "u",
);
const NOT_A_NAME = new Set(["We", "Team", "All", "Everyone", "Someone", "They", "I", "Me", "You", "Both", "Each", "Nobody", "Tbd", "Action", "Decision", "Risk", "Note", "Next", "Owner", "Agenda", "Attendees"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeOrg(name: string): string {
  return normalizeName(name)
    .replace(/\b(?:inc|incorporated|ltd|limited|llc|l\.l\.c|gmbh|ag|sa|s\.a|plc|corp|corporation|co)\.?$/g, "")
    .replace(/[.,]/g, "")
    .trim();
}

function trimOrg(raw: string): string | null {
  const words = raw.split(/\s+/);
  while (words.length > 1 && ORG_LEAD_STOP.has(words[0].replace(/[:,]$/, ""))) words.shift();
  // A bare suffix ("Capital", "University") is not an organization.
  if (words.length < 2) return null;
  let name = words.join(" ").replace(/[,;:]+$/, "");
  if (name.endsWith(".") && !/(?:Inc|Ltd|Corp|Co|S\.A|L\.L\.C)\.$/.test(name)) name = name.slice(0, -1);
  return name.length >= 3 ? name : null;
}

function participantsOf(json: unknown): Participant[] {
  if (!Array.isArray(json)) return [];
  const out: Participant[] = [];
  for (const p of json) {
    if (!p || typeof p !== "object") continue;
    const email = (p as { email?: unknown }).email;
    if (typeof email !== "string" || !email.includes("@")) continue;
    const name = (p as { name?: unknown }).name;
    out.push({ email: email.trim().toLowerCase(), name: typeof name === "string" && name.trim() ? name.trim() : null });
  }
  return out;
}

class MentionSet {
  private byKey = new Map<string, MentionDraft>();

  constructor(private internalDomains: Set<string>) {}

  private key(m: MentionDraft): string {
    if (m.entityType === "PERSON") return m.email ? `p:${m.email}` : `p:${normalizeName(m.text)}`;
    if (m.entityType === "COMPANY") return m.domain ? `c:${m.domain}` : `c:${normalizeOrg(m.text)}`;
    return `j:${normalizeName(m.text)}`;
  }

  add(m: MentionDraft) {
    const k = this.key(m);
    const prev = this.byKey.get(k);
    if (!prev) {
      this.byKey.set(k, { ...m });
      return;
    }
    if (ROLE_RANK[m.role] > ROLE_RANK[prev.role]) prev.role = m.role;
    prev.confidence = Math.max(prev.confidence, m.confidence);
    prev.email ??= m.email ?? null;
    prev.domain ??= m.domain ?? null;
    prev.companyHint ??= m.companyHint ?? null;
    // Prefer a real name over an address-derived one.
    if (m.text.length > prev.text.length && /\s/.test(m.text) && !/\s/.test(prev.text)) prev.text = m.text;
  }

  participant(p: Participant, role: MentionRole) {
    const full = domainOf(p.email);
    const domain = full ? registrableDomain(full) : null;
    const external = domain && !this.internalDomains.has(domain) && !isFreeMailDomain(domain);
    const automated = isAutomatedAddress(p.email);
    this.add({
      entityType: "PERSON",
      text: p.name?.replace(/^["']|["']$/g, "").trim() || nameFromEmail(p.email),
      email: p.email,
      domain,
      companyHint: external ? companyNameFromDomain(domain) : null,
      role,
      confidence: automated ? 0.3 : p.name ? 0.98 : 0.9,
    });
    if (external && !automated) {
      this.add({ entityType: "COMPANY", text: companyNameFromDomain(domain), domain, companyHint: null, role, confidence: 0.85 });
    }
  }

  /** Merge body mentions into participant mentions that are evidently the same entity. */
  finish(): MentionDraft[] {
    const all = [...this.byKey.values()];
    const people = all.filter((m) => m.entityType === "PERSON" && m.email);
    const domainCompanies = all.filter((m) => m.entityType === "COMPANY" && m.domain);
    const out: MentionDraft[] = [];
    for (const m of all) {
      if (m.entityType === "PERSON" && !m.email) {
        const n = normalizeName(m.text);
        const twin = people.find((p) => {
          const pn = normalizeName(p.text);
          return pn === n || (!n.includes(" ") && pn.split(" ")[0] === n);
        });
        if (twin) {
          twin.companyHint ??= m.companyHint ?? null;
          continue;
        }
      }
      if (m.entityType === "COMPANY" && !m.domain) {
        const org = normalizeOrg(m.text);
        const twin = domainCompanies.find((c) => {
          const label = normalizeOrg(c.text);
          return org === label || org.split(" ")[0] === label.split(" ")[0];
        });
        if (twin) {
          // "Brightwater" (from the domain) becomes "Brightwater Therapeutics" (from the text).
          if (m.text.length > twin.text.length) twin.text = m.text;
          twin.confidence = Math.max(twin.confidence, m.confidence);
          continue;
        }
      }
      out.push(m);
    }
    return out.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.confidence - a.confidence).slice(0, MAX_MENTIONS);
  }
}

// ─── Body scanning ───────────────────────────────────────────────────────────

/** Signature lines: "Karen Liu | VP Discovery | Brightwater Therapeutics" or a name / title / company block after a sign-off. */
export function scanSignatures(text: string): { name: string; title: string | null; org: string | null }[] {
  const lines = text.split("\n").map((l) => l.trim());
  const found: { name: string; title: string | null; org: string | null }[] = [];
  const nameShape = new RegExp(`^(?:(?:Dr|Prof|Mr|Mrs|Ms)\\.?\\s+)?${NAME_WORD}(?:\\s+${NAME_WORD}|\\s+\\p{Lu}\\.){1,3}$`, "u");
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/\s+[|·•]\s+|\s+[–—]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4 && nameShape.test(parts[0])) {
      const title = parts.slice(1).find((p) => TITLE_WORDS.test(p)) ?? null;
      const org = parts.slice(1).find((p) => p !== title && /^\p{Lu}/u.test(p) && !/[@\d]/.test(p)) ?? null;
      if (title || org) found.push({ name: parts[0], title, org });
      continue;
    }
    if (SIGN_OFF.test(lines[i])) {
      const block = lines.slice(i + 1, i + 6).filter(Boolean);
      const nameIdx = block.findIndex((l) => nameShape.test(l));
      if (nameIdx < 0) continue;
      const title = block[nameIdx + 1] && TITLE_WORDS.test(block[nameIdx + 1]) && block[nameIdx + 1].length < 80 ? block[nameIdx + 1] : null;
      const orgLine = block[title ? nameIdx + 2 : nameIdx + 1];
      const org = orgLine && /^\p{Lu}/u.test(orgLine) && !/[@:/]|\d{3}/.test(orgLine) && orgLine.length < 80 ? orgLine : null;
      if (title || org) found.push({ name: block[nameIdx], title, org });
    }
  }
  return found;
}

/** Organizations, people and products named in free text (lower confidence than participants). */
export function scanTextMentions(text: string, opts: { selfOrgs?: string[] } = {}): MentionDraft[] {
  const body = text.slice(0, BODY_SCAN_CHARS);
  const out: MentionDraft[] = [];
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && s < b);
  const self = new Set((opts.selfOrgs ?? []).map(normalizeOrg));

  for (const sig of scanSignatures(body)) {
    out.push({ entityType: "PERSON", text: sig.name, email: null, domain: null, companyHint: sig.org, role: "MENTIONED", confidence: 0.8 });
    if (sig.org && !self.has(normalizeOrg(sig.org))) out.push({ entityType: "COMPANY", text: sig.org, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.75 });
  }

  for (const re of [ORG_RE, ORG_OF_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(body); m; m = re.exec(body)) {
      const name = trimOrg(re === ORG_RE ? `${m[1]} ${m[2]}` : m[1]);
      if (!name || self.has(normalizeOrg(name))) continue;
      const start = m.index + m[0].indexOf(name.split(" ")[0]);
      if (overlaps(start, start + name.length)) continue;
      taken.push([start, start + name.length]);
      out.push({ entityType: "COMPANY", text: name, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.65 });
    }
  }

  TITLED_RE.lastIndex = 0;
  for (let m = TITLED_RE.exec(body); m; m = TITLED_RE.exec(body)) {
    const words = m[1].split(/\s+/);
    while (words.length > 2 && SURNAME_STOP.has(words.at(-1)!)) words.pop();
    const name = words.join(" ");
    if (overlaps(m.index, m.index + name.length)) continue;
    taken.push([m.index, m.index + name.length]);
    out.push({ entityType: "PERSON", text: name, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.7 });
  }

  FIRST_LAST_RE.lastIndex = 0;
  for (let m = FIRST_LAST_RE.exec(body); m; m = FIRST_LAST_RE.exec(body)) {
    if (!FIRST_NAMES.has(m[1]) || SURNAME_STOP.has(m[2])) {
      // Retry from the second word: "Thanks Karen Liu" → "Karen Liu".
      FIRST_LAST_RE.lastIndex = m.index + m[1].length;
      continue;
    }
    if (overlaps(m.index, m.index + m[0].length)) continue;
    taken.push([m.index, m.index + m[0].length]);
    out.push({ entityType: "PERSON", text: m[0], email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.5 });
  }

  PRODUCT_RE.lastIndex = 0;
  for (let m = PRODUCT_RE.exec(body); m; m = PRODUCT_RE.exec(body)) {
    const token = m[1];
    if (PRODUCT_STOP.has(token) || /^(?:Mc|Mac|De|Van|Von|La|Le|Di|Da|O)\p{Lu}/u.test(token)) continue;
    if (overlaps(m.index, m.index + token.length)) continue;
    out.push({ entityType: "PROJECT", text: token, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.5 });
  }

  SERIES_RE.lastIndex = 0;
  for (let m = SERIES_RE.exec(body); m; m = SERIES_RE.exec(body)) {
    out.push({ entityType: "PROJECT", text: `Series ${m[1]}`, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.4 });
  }
  return out;
}

/** "Action: Maya to send the deck", "- [ ] Jonas to update the model", "Priya: follow up with Calder". */
export function actionLineOwners(text: string): string[] {
  const names: string[] = [];
  for (const line of text.slice(0, BODY_SCAN_CHARS).split("\n")) {
    const m = ACTION_LINE_RE.exec(line);
    if (m && !NOT_A_NAME.has(m[1]) && !ORG_LEAD_STOP.has(m[1])) names.push(m[1]);
  }
  return names;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function extractMentions(item: LoadedSourceItem, ceo: PipelineCeo): MentionDraft[] {
  const internal = new Set<string>();
  for (const e of [ceo.email, item.connection.accountEmail]) {
    const d = domainOf(e);
    if (d && !isFreeMailDomain(d)) internal.add(registrableDomain(d));
  }
  const set = new MentionSet(internal);
  const selfOrgs = ["CytoHub", ...[...internal].map(companyNameFromDomain)];
  const texts: string[] = [];

  const msg = item.emailMessage;
  if (msg) {
    set.participant({ email: msg.fromEmail.toLowerCase(), name: msg.fromName }, "SENDER");
    for (const p of participantsOf(msg.to)) set.participant(p, "RECIPIENT");
    for (const p of participantsOf(msg.cc)) set.participant(p, "CC");
    texts.push(msg.subject, item.text ?? "");
  }

  const ev = item.calendarEvent;
  if (ev) {
    if (ev.organizerEmail) set.participant({ email: ev.organizerEmail.toLowerCase(), name: ev.organizerName }, "ORGANIZER");
    for (const p of participantsOf(ev.attendees)) {
      // Rooms and group calendars are not people.
      if (/resource\.calendar|group\.calendar|calendar\.google\.com$/.test(p.email)) continue;
      set.participant(p, "ATTENDEE");
    }
    texts.push(ev.title, ev.description ?? "");
  }

  const doc = item.document;
  if (doc) {
    if (doc.author) {
      const author = doc.author.trim();
      if (author.includes("@")) set.participant({ email: author.toLowerCase(), name: null }, "AUTHOR");
      else set.add({ entityType: "PERSON", text: author, email: null, domain: null, companyHint: null, role: "AUTHOR", confidence: 0.85 });
    }
    texts.push(doc.title, item.text ?? "");
  }

  if (!msg && !ev && !doc) texts.push(item.title, item.text ?? "");

  const body = texts.filter(Boolean).join("\n\n");
  for (const m of scanTextMentions(body, { selfOrgs })) set.add(m);
  if (item.kind === "MEETING_NOTES" || doc?.docType === "MEETING_NOTES") {
    for (const name of actionLineOwners(body)) set.add({ entityType: "PERSON", text: name, email: null, domain: null, companyHint: null, role: "MENTIONED", confidence: 0.6 });
  }
  return set.finish();
}
