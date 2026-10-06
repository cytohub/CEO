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
  /(?:,?\s*\b(?:so that|so (?:we|i|they|you) can|in order to|when you (?:get|have) a (?:chance|moment|minute)|if (?:possible|you can|you could)|at your (?:earliest )?convenience|as soon as (?:possible|you can)|asap|thanks?(?: you)?|please|for (?:our|my|their) (?:review|records|files|reference)|ahead of (?:time|schedule)|whenever you can)\b.*$|\s*[?.!;:,]+\s*$)/i;

/** Indirect objects to drop ("send us the deck"); "them" only when a direct object follows ("send them the deck", not "send them to me"). */
const OBJECT_PRONOUN = /^(\S+)\s+(?:(?:it\s+)?(?:over\s+)?(?:to\s+)?(?:us|me|him|her)\s+|them\s+(?=(?:the|a|an|our|your|my)\b))(?=\S)/i;
const ARTICLE_AFTER_VERB = /^((?:\S+)(?:\s+(?:over|back|out|up))?)\s+(?:the|a|an|your|our|my|this|that)\s+(?=\S)/i;

export interface TitleContext {
  /** Phrase to remove (the deadline as written: "by Friday"). */
  dateText?: string | null;
  /** Who "me/us" refers to — the message sender. */
  senderFirst?: string | null;
  /** Who "you" refers to when the CEO writes — the primary recipient. */
  recipientFirst?: string | null;
}

/** Normalize an action clause to a title ("Send revised data package"); null when nothing actionable is left. */
export function actionTitle(clause: string, ctx: TitleContext = {}, max = 90): string | null {
  let s = clause.replace(/\s+/g, " ").trim();
  if (ctx.dateText) {
    const at = s.toLowerCase().indexOf(ctx.dateText.toLowerCase());
    if (at >= 0) s = `${s.slice(0, at)} ${s.slice(at + ctx.dateText.length)}`.replace(/\s+/g, " ").trim();
  }
  for (let i = 0; i < 3; i++) s = s.replace(LEAD_IN, "").trim();
  // Cut purpose clauses and trailing punctuation (repeat: "…, please." → "…").
  for (let i = 0; i < 3; i++) s = s.replace(TRAILING, "").trim();
  if (!s) return null;

  // Point of view: "let me know" → "let Karen know"; "get back to you" → "get back to Karen".
  if (ctx.senderFirst) {
    s = s.replace(/\blet (?:me|us) know\b/i, `let ${ctx.senderFirst} know`).replace(/\b(back to|with|to) (?:me|us)\b/i, `$1 ${ctx.senderFirst}`);
  }
  if (ctx.recipientFirst) s = s.replace(/\b(back to|with) you\b/i, `$1 ${ctx.recipientFirst}`);
  // "call me" → "call Rachel": the person is the point of the action, not a pronoun to drop.
  if (ctx.senderFirst) s = s.replace(/^(call|email|ping|text|phone|contact|meet|update|brief|tell|remind|invite|thank|visit|join)\s+(?:me|us)\b/i, `$1 ${ctx.senderFirst}`);
  s = s.replace(/^(send|share|forward|give|email|show|get|pass|resend|return)\s+you\s+/i, "$1 ");
  s = s.replace(OBJECT_PRONOUN, "$1 ");
  // "have comments back" → "send comments back"; "have the model ready" → "finish the model".
  s = s.replace(/^have\s+(.+?)\s+(back|over|across)(?=$|\s+to\b)/i, "send $1 $2").replace(/^have\s+(.+?)\s+(?:ready|done|finished|completed|wrapped up)$/i, "finish $1");
  s = s.replace(ARTICLE_AFTER_VERB, "$1 ");
  s = s.replace(/\s+/g, " ").replace(/[\s,;:–—-]+$/, "").trim();
  if (s.length < 3) return null;
  if (s.length > max) {
    const cut = s.slice(0, max);
    s = cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max * 0.6))).replace(/[\s,;:–—-]+$/, "");
  }
  return capitalize(s);
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
