/**
 * Turning a clause into a short action title:
 *   "please send us the revised data package by Friday so we can review it"
 *     → "Send revised data package"
 *
 * Steps: drop the politeness lead-in, the deadline phrase and trailing purpose
 * clauses, rewrite first/second-person objects from the CEO's point of view,
 * drop the article right after the verb, capitalize, and cap the length.
 * The writer deduplicates on these titles, so they must be stable.
 */
import { capitalize } from "./text";

/** Base-form verbs that open an actionable request or commitment. */
export const ACTION_VERBS = new Set(
  (
    "send share forward sign countersign review confirm approve provide prepare update schedule set introduce connect call email reply respond check look " +
    "get follow circle finalize draft submit complete deliver upload give make book arrange decide consider join attend bring read comment weigh loop add " +
    "resend return execute transfer wire pay advise clarify explain walk present revise fix resolve escalate contact reach ping sync discuss let take put " +
    "file register ask tell invite nominate recommend choose pick select assign authorize coordinate organize plan document summarize outline propose " +
    "quote price release ship grant extend renew cancel hold reserve double-check verify validate test run analyze compile gather collect pull pass flag " +
    "highlight remind keep start kick launch finish close negotiate draft request order sort chase find dig think figure work have circulate distribute " +
    "post brief nudge shortlist interview hire onboard refresh rerun retrain train benchmark tell text phone meet visit host cover prioritize approve " +
    "delay postpone move pause stop drop proceed accept reject decline adopt switch use defer continue reduce increase cut raise invest expand go"
  ).split(" "),
);

/** Requests that are pleasantries, not work. */
export const BOILERPLATE = /\b(?:let (?:me|us) know if you (?:have|need) (?:any|anything)|if you have any questions|don'?t hesitate|feel free|find attached|see attached|find enclosed|note that|thanks in advance|looking forward|let me know (?:your thoughts|what you think)\s*[.!]?$|keep me posted|keep up the|have a (?:great|good|nice))\b/i;

const LEAD_IN =
  /^(?:(?:and|also|so|but|then|ok(?:ay)?|great|thanks|thank you)[,!]?\s+)*(?:[\p{Lu}][\p{L}'’-]+,\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+|kindly\s+)?(?:also\s+)?|(?:please|pls|kindly)\s+(?:do\s+)?(?:also\s+)?(?:make sure (?:to|that you)\s+)?|(?:i|we)\s+(?:would\s+)?need you to\s+|(?:i|we)(?:'ll| will| would like to| want to| plan to| intend to| promise to| can)\s+|(?:i|we)(?:'m| am| are|'re) going to\s+|let me\s+(?=(?:check|confirm|get|look|circle|follow|ask|see|think|find|dig|review|send|share|loop|set|put|pull|reach|connect|talk|speak|sync)\b)|happy to\s+|(?:i'd|we'd) be happy to\s+)/iu;

const TRAILING =
  /(?:,?\s*\b(?:so that|so (?:that )?(?:we|i|they|you|our \w+|the \w+|\w+) can|in order to|when you (?:get|have) a (?:chance|moment|minute|sec)|when you have a moment|if (?:possible|you can|you could|that works)|at your (?:earliest )?convenience|as soon as (?:possible|you can)|asap|thanks?(?: you)?|please|for (?:our|my|their) (?:review|records|files|reference)|ahead of (?:time|schedule)|whenever you can|accordingly|as needed|as discussed|most likely|probably|ideally|if they are ready|if ready|once we['’]ve [^,.]*|once you['’]ve [^,.]*)\b.*$|\s*[?.!;:,]+\s*$)/i;

/** Indirect objects to drop ("send us the deck"); "them" only when a direct object follows ("send them the deck", not "send them to me"). */
const OBJECT_PRONOUN = /^(\S+)\s+(?:(?:it\s+)?(?:over\s+)?(?:to\s+)?(?:us|me|him|her)\s+|them\s+(?=(?:the|a|an|our|your|my)\b))(?=\S)/i;
const ARTICLE_AFTER_VERB = /^((?:\S+)(?:\s+(?:back|out|up))?)\s+(?:the|a|an|your|our|my|this|that)\s+(?=\S)/i;
/** Verbs whose pronoun object is a person ("call her", "email him"). */
const PERSON_VERBS = /^(call|email|ping|text|phone|contact|meet|update|brief|tell|remind|invite|thank|visit|introduce|congratulate|close)\s+(?:her|him|them)\b/i;

export interface TitleContext {
  /** Phrase to remove (the deadline as written: "by Friday"). */
  dateText?: string | null;
  /** Who "me/us" refers to — the message sender. */
  senderFirst?: string | null;
  /** Who "you" refers to when the CEO writes — the primary recipient. */
  recipientFirst?: string | null;
  /** The third person "her/him/them" most likely refers to (named earlier in the message). */
  thirdParty?: string | null;
  /** Rewrite "your" as "our": the CEO is the one asked, so "your team" is CytoHub's. */
  ceoPerspective?: boolean;
}

/** Normalize an action clause to a title ("Send revised data package"); null when nothing actionable is left. */
export function actionTitle(clause: string, ctx: TitleContext = {}, max = 64): string | null {
  let s = clause.replace(/\s+/g, " ").trim();
  if (ctx.dateText) {
    const at = s.toLowerCase().indexOf(ctx.dateText.toLowerCase());
    if (at >= 0) s = `${s.slice(0, at)} ${s.slice(at + ctx.dateText.length)}`.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  }
  for (let i = 0; i < 3; i++) s = s.replace(LEAD_IN, "").trim();
  // Second sentences after a semicolon and relative clauses are detail, not the action.
  s = s.split(/\s*;\s*|\s+—\s+/)[0];
  s = s.replace(/,\s+(?:our|my|your|their|the)\s+[^,]{2,40},\s*/i, " ").replace(/,\s+(?:who|which|where|whose)\b.*$/i, "");
  // Cut purpose clauses and trailing punctuation (repeat: "…, please." → "…").
  for (let i = 0; i < 3; i++) s = s.replace(TRAILING, "").trim();
  if (!s) return null;

  // Point of view: "let me know" → "let Karen know"; "get back to you" → "get back to Karen".
  if (ctx.senderFirst) {
    s = s.replace(/\blet (?:me|us) know if you (?:would like|want|wish|need) to\b/i, `tell ${ctx.senderFirst} whether you want to`);
    s = s.replace(/\blet (?:me|us) know\b/i, `let ${ctx.senderFirst} know`).replace(/\b(back to|with|to) (?:me|us)\b/i, `$1 ${ctx.senderFirst}`);
  }
  if (ctx.recipientFirst) s = s.replace(/\b(back to|with) you\b/i, `$1 ${ctx.recipientFirst}`).replace(/^introduce you to\b/i, `introduce ${ctx.recipientFirst} to`);
  // "call me" → "call Rachel"; "call her yourself" → "call Laura Mitchell": the person is the point of the action.
  if (ctx.senderFirst) s = s.replace(/^(call|email|ping|text|phone|contact|meet|update|brief|tell|remind|invite|thank|visit|join)\s+(?:me|us)\b/i, `$1 ${ctx.senderFirst}`);
  if (ctx.thirdParty) s = s.replace(PERSON_VERBS, `$1 ${ctx.thirdParty}`);
  s = s.replace(/\s+(?:yourself|myself|ourselves)\b/gi, "");
  s = s.replace(/^(send|share|forward|give|email|show|get|pass|resend|return)\s+you\s+/i, "$1 ");
  s = s.replace(/^(send|hand|pass|bring|get)\s+over\s+/i, "$1 ");
  s = s.replace(OBJECT_PRONOUN, "$1 ");
  // "have comments back" → "send comments back"; "have the model ready" → "finish the model".
  s = s.replace(/^have\s+(.+?)\s+(back|over|across)(?=$|\s+to\b)/i, "send $1 $2").replace(/^have\s+(.+?)\s+(?:ready|done|finished|completed|wrapped up)$/i, "finish $1");
  s = s.replace(ARTICLE_AFTER_VERB, "$1 ");
  if (ctx.ceoPerspective) s = s.replace(/\byour\b/gi, "our");
  s = s.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").replace(/[\s,;:–—-]+$/, "").trim();
  if (s.length < 3) return null;
  return capitalize(fitTitle(s, max));
}

const TITLE_BOUNDARY = /\s(?:and|or|for|with|to|in|on|at|by|from|of|that|which|who|because|so|after|before|while|including|via|once|when)\s|,\s/gi;
const DANGLING_WORDS = /(?:\s+(?:and|or|the|a|an|of|for|with|to|in|on|at|by|from|that|which|who|so|via|your|our|its))+$/i;

/**
 * Shorten at a natural boundary. A boundary whose remainder is a short final
 * conjunct ("… LB-2207 and LB-2219") is skipped, so a cut never silently drops
 * one of two named items.
 */
export function fitTitle(input: string, max: number): string {
  let s = input.trim();
  if (s.length <= max) return s;
  let cut = -1;
  for (const m of s.matchAll(TITLE_BOUNDARY)) {
    const at = m.index!;
    if (at > max) break;
    if (at < max * 0.45) continue;
    const tail = s.slice(at + m[0].length);
    if (/^(?:and|or)$/i.test(m[0].trim()) && tail.length <= 14) continue;
    cut = at;
  }
  if (cut < 0) cut = Math.max(s.lastIndexOf(" ", max), Math.floor(max * 0.6));
  s = s.slice(0, cut).replace(/[\s,;:–—-]+$/, "").replace(DANGLING_WORDS, "").replace(/[\s,;:–—-]+$/, "");
  if ((s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length) s = s.slice(0, s.lastIndexOf("(")).trim();
  return s;
}

/** A title whose object is too thin to act on: "Make time in the morning", "Sign via DocuSign", "Follow up". */
export function weakObject(title: string): boolean {
  if (hasPronounObject(title)) return true;
  if (/^(?:make|find|take|have|get|set aside) (?:some )?(?:time|a look|a moment)\b|^(?:follow up|circle back|check in|touch base|get back|reach out|join|attend|be|come)\b/i.test(title)) return true;
  const words = title.split(/\s+/);
  if (words.length < 2) return true;
  // Verb followed directly by a preposition or adverb: no object at all ("Sign via DocuSign", "Reply today").
  return /^(?:via|when|by|at|in|before|after|today|tomorrow|now|soon|asap|on|with|for)$/i.test(words[1]);
}

/** The first word of a clause, lower-cased ("Send revised…" → "send"). */
export function leadVerb(clause: string): string {
  return (clause.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z-]/g, "");
}

/** "Send them to Karen", "Review it": the object is only a pronoun, so the title needs context. */
export function hasPronounObject(title: string): boolean {
  return /^\S+\s+(?:(?:it|them|this|that|these|those|one)\b)(?!\s+(?:the|a|an)\b)/i.test(title);
}

export function startsWithActionVerb(clause: string): boolean {
  return ACTION_VERBS.has(leadVerb(clause));
}
