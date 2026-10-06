/**
 * Demo mailbox for the CytoHub CEO: ~45 business messages in ~20 threads
 * over the ten days before the demo anchor, a handful that arrive 2–20 hours
 * after it (revealed by later syncs), and the usual noise.
 *
 * The story matches the seeded workspace (prisma/seed-data.ts): Brightwater's
 * clause 7.3, the Northbridge partner meeting, Helix diligence, Lumen's SLA
 * escalation, Laura Mitchell's competing offer, CardioPredict at AUC 0.88…
 * Bodies include realistic quoted history and signatures so the normalizer
 * has real work to do. All text is generated from the anchor so dates read
 * naturally ("by Friday", "October 14") in the CEO's timezone.
 */
import { addDays } from "@/lib/dates";
import type { NormalizedAttachment, NormalizedEmail, Participant } from "../../types";
import { endOfMonthDay } from "./clock";
import type { Revealable } from "./reveal";
import { HELIX_MOVE, helixMovedStart, lumenDatasetDue, seedMeetingStart } from "./scenario";
import type { DemoWorld } from "./world";

type Who = string | { name: string; email: string };

interface AttachmentSpec {
  id: string;
  filename: string;
  mimeType: string;
  content: () => string;
}

interface MailSpec {
  key: string;
  thread: string;
  /** Hours relative to the demo anchor (negative = before). */
  at: number;
  from: Who;
  to: Who[];
  cc?: Who[];
  subject: string;
  body: (sentAt: Date) => string;
  /** Append the quoted text of an earlier message in the same thread. */
  quote?: { key: string; style: "gmail" | "outlook" };
  headers?: Record<string, string>;
  labels?: string[];
  attachments?: AttachmentSpec[];
  /** Deleted upstream this many hours after the anchor. */
  deletedAt?: number;
}

const external = (name: string, email: string) => ({ name, email });

/** Every message in the demo mailbox, in thread order. */
function specs(w: DemoWorld): MailSpec[] {
  const c = w.clock;
  const hi = `Hi${w.hi},`;
  const dear = w.hi ? `Dear${w.hi},` : "Hello,";
  const sign = w.signOff ? `Best,\n${w.signOff}` : "Best,";
  const when = (from: Date, key: string) => {
    const start = seedMeetingStart(c, key);
    return `${c.dayPhrase(from, c.dayOf(start))} at ${c.clockTime(start)}`;
  };
  const helixMoved = helixMovedStart(c);
  const lumenDue = c.monthDay(lumenDatasetDue(c));
  const asterDeadline = c.monthDay(endOfMonthDay(addDays(c.today, 20)));

  return [
    // ── Calder: budget approved → SOW promise → data package request → fulfilled after the anchor ──
    {
      key: "calder-1",
      thread: "calder-study",
      at: -30,
      from: "henrik",
      to: ["ceo"],
      cc: ["priya"],
      subject: "Calder paid validation study",
      body: () =>
        `${hi}\n\nGood news: our finance committee approved the budget for the paid validation study this afternoon. We'd like to start with the 40-compound panel we discussed and keep the same scientific team on both sides.\n\nCould you send over the statement of work so procurement can issue the PO?\n\nBest regards,\nHenrik\n\nDr. Henrik Sørensen\nChief Scientific Officer | Calder Biosciences\n+1 617 555 0142`,
    },
    {
      key: "calder-2",
      thread: "calder-study",
      at: -28,
      from: "ceo",
      to: ["henrik"],
      cc: ["priya"],
      subject: "Re: Calder paid validation study",
      body: () =>
        `Henrik,\n\nThat's wonderful news, and thank you for championing this internally. We will provide the updated SOW next week, with the 40-compound panel and the timeline your team proposed. Priya will coordinate with procurement on the PO.\n\n${sign}`,
      quote: { key: "calder-1", style: "gmail" },
    },
    {
      key: "calder-3",
      thread: "calder-study",
      at: -6,
      from: "henrik",
      to: ["ceo"],
      cc: ["priya"],
      subject: "Re: Calder paid validation study",
      body: (t) =>
        `${hi}\n\nThanks for the update on the SOW. One more request from our side: please send the revised data package by ${c.nextWeekdayPhrase(t, "Friday")}. Once we review it, we can discuss expanding the study.\n\nOur toxicology lead would also like to see the updated QT-prolongation results for the reference compounds, if they are ready.\n\nBest regards,\nHenrik\n\nDr. Henrik Sørensen\nChief Scientific Officer | Calder Biosciences`,
      quote: { key: "calder-2", style: "outlook" },
    },
    {
      key: "calder-4",
      thread: "calder-study",
      at: 14,
      from: "ceo",
      to: ["henrik"],
      cc: ["priya"],
      subject: "Re: Calder paid validation study",
      body: () =>
        `Henrik,\n\nAttached is the revised data package, including the updated QT-prolongation results for the reference compounds. Priya will propose a time early next week to walk your team through it and to discuss expanding the study.\n\n${sign}`,
      quote: { key: "calder-3", style: "gmail" },
      attachments: [{ id: "calder-4-att1", filename: "Calder_revised_data_package.csv", mimeType: "text/csv", content: calderDataPackage }],
    },

    // ── Aurelius: expansion proposal; CEO promises the updated proposal tomorrow ──
    {
      key: "aurelius-1",
      thread: "aurelius-expansion",
      at: -40,
      from: "priya",
      to: ["whitfield"],
      cc: ["ceo"],
      subject: "Aurelius expansion: three additional sites",
      body: () =>
        `Dear James,\n\nAs promised, here is our proposal to extend CytoHub cardiac safety screening to three additional Aurelius sites. The total is $900K over three years, with onboarding staggered so each site is live within six weeks of signature. The same validated assay panel and reporting you use in Basel would apply.\n\nHappy to walk your team through it.\n\nKind regards,\nPriya\n\nPriya Raman\nVP Business Development, CytoHub`,
    },
    {
      key: "aurelius-2",
      thread: "aurelius-expansion",
      at: -20,
      from: "whitfield",
      to: ["priya", "ceo"],
      subject: "Re: Aurelius expansion: three additional sites",
      body: () =>
        `Priya,${w.hi ? ` ${w.signOff},` : ""}\n\nThank you for the proposal. The scientific case is clear. Before I take it to our steering committee I need two things: a site-by-site onboarding timeline, and confirmation that the new sites get the same turnaround commitments as Basel.\n\nI'd also welcome a short call this week.\n\nKind regards,\nJames\n\nJames Whitfield\nHead of Safety Pharmacology\nAurelius`,
      quote: { key: "aurelius-1", style: "outlook" },
    },
    {
      key: "aurelius-3",
      thread: "aurelius-expansion",
      at: -18,
      from: "ceo",
      to: ["whitfield"],
      cc: ["priya"],
      subject: "Re: Aurelius expansion: three additional sites",
      body: (t) =>
        `James,\n\nThank you, both are fair asks. I'll send the updated proposal tomorrow with a site-by-site onboarding timeline and the turnaround commitments spelled out. Looking forward to our call ${when(t, "mAureliusCso")}.\n\n${sign}`,
      quote: { key: "aurelius-2", style: "gmail" },
    },

    // ── Brightwater: clause 7.3 still open; their legal will return language by Friday ──
    {
      key: "brightwater-1",
      thread: "brightwater-msa",
      at: -14,
      from: "karen",
      to: ["ceo"],
      cc: ["priya"],
      subject: "Brightwater MSA v5: clause 7.3",
      body: (t) =>
        `${hi}\n\nOur legal team accepted 14 of the 16 redlines in v5. Clause 7.3 (rights to derivative models) is the one that remains open, and we think 11.2 is close. Legal will return their revised language on clause 7.3 by ${c.nextWeekdayPhrase(t, "Friday")}.\n\nOur CSO would like a CEO-to-CEO conversation before tomorrow's negotiation. Can you make time in the morning?\n\nThanks,\nKaren\n\nKaren Liu\nVP Discovery | Brightwater Therapeutics`,
    },

    // ── Northbridge: partner meeting; term sheet promised next week ──
    {
      key: "northbridge-1",
      thread: "northbridge-partner",
      at: -18,
      from: "sarah",
      to: ["ceo"],
      subject: "Northbridge partner meeting confirmed",
      body: (t) =>
        `${hi}\n\nGreat news: the partner meeting is confirmed for ${when(t, "mNorthbridgePartner")} at our Boston office. The partners will want to see cohort retention by customer and a clear view of why the human heart dataset is defensible. Could you bring both?\n\nBest,\nSarah\n\nSarah Chen | Partner | Northbridge Ventures`,
    },
    {
      key: "northbridge-2",
      thread: "northbridge-partner",
      at: -17,
      from: "ceo",
      to: ["sarah"],
      cc: ["jonas"],
      subject: "Re: Northbridge partner meeting confirmed",
      body: () => `Sarah,\n\nThank you, we'll be there. We'll bring the cohort retention analysis by customer and a dedicated dataset-moat slide. Jonas will join me.\n\n${sign}`,
      quote: { key: "northbridge-1", style: "gmail" },
    },
    {
      key: "northbridge-3",
      thread: "northbridge-partner",
      at: -3,
      from: "sarah",
      to: ["ceo"],
      cc: ["jonas"],
      subject: "Re: Northbridge partner meeting confirmed",
      body: () =>
        `Perfect, thank you. One more thing so there are no surprises: if the partner meeting goes the way I expect, we will send the term sheet next week. We would ask for 30 days of exclusivity alongside it, so it's worth thinking about before we meet.\n\nSarah`,
      quote: { key: "northbridge-2", style: "gmail" },
    },

    // ── Helix: diligence + data room; they ask to move the session after the anchor ──
    {
      key: "helix-1",
      thread: "helix-diligence",
      at: -5,
      from: "david",
      to: ["ceo"],
      cc: ["jonas"],
      subject: "Helix: diligence and data room access",
      body: () =>
        `${hi}\n\nThanks again for the data request call with Jonas. Our investment committee has asked us to move into full diligence. Could you grant us access to the data room and propose two or three dates next week for a diligence session with your team? We'd like to cover commercial traction and the CardioPredict validation in depth.\n\nBest regards,\nDavid Morel\nPrincipal, Helix Capital Partners`,
    },
    {
      key: "helix-2",
      thread: "helix-diligence",
      at: -4,
      from: "ceo",
      to: ["david"],
      cc: ["jonas", "tom"],
      subject: "Re: Helix: diligence and data room access",
      body: (t) =>
        `David,\n\nGreat to hear. Jonas will send data room access today. For the diligence session, how about ${when(t, "mHelixDiligence")}? Tom Okafor, our Head of AI, will cover the technical diligence.\n\n${sign}`,
      quote: { key: "helix-1", style: "gmail" },
    },
    {
      key: "helix-3",
      thread: "helix-diligence",
      at: HELIX_MOVE.emailHours,
      from: "david",
      to: ["ceo"],
      cc: ["jonas", "tom"],
      subject: "Re: Helix: diligence and data room access",
      body: (t) => {
        const original = seedMeetingStart(c, HELIX_MOVE.meetingKey);
        return `${hi}\n\nApologies for the shuffle: our technical partner can't make ${c.dayPhrase(t, c.dayOf(original))}. Could we move the diligence session to ${c.dayPhrase(t, c.dayOf(helixMoved))} at ${c.clockTime(helixMoved)}? I'll send an updated invite.\n\nThanks,\nDavid`;
      },
      quote: { key: "helix-2", style: "gmail" },
    },

    // ── Fjord: HeartReady plan requested, still unanswered; nudge after the anchor ──
    {
      key: "fjord-1",
      thread: "fjord-heartready",
      at: -213,
      from: "anna",
      to: ["ceo"],
      subject: "HeartReady preclinical plan",
      body: () =>
        `${hi}\n\nThank you again for the meeting last week. The team left impressed with the human heart dataset. As discussed, could you send over the HeartReady preclinical plan and your timeline to a pre-IND meeting? We'd like to bring it to our Monday partner meeting.\n\nBest wishes,\nAnna\n\nAnna Berg | Partner | Fjord Life Science Ventures | Oslo`,
    },
    {
      key: "fjord-2",
      thread: "fjord-heartready",
      at: 16,
      from: "anna",
      to: ["ceo"],
      subject: "Re: HeartReady preclinical plan",
      body: () =>
        `${hi}\n\nJust checking in on the HeartReady plan. Our partners meet again on Monday and I'd love to include CytoHub. Even a short summary of the six studies and the pre-IND timing would help.\n\nBest wishes,\nAnna`,
      quote: { key: "fjord-1", style: "gmail" },
    },

    // ── Solstice: will circle back after the IC offsite; CEO pencils in a partner meeting ──
    {
      key: "solstice-1",
      thread: "solstice-ic",
      at: -60,
      from: "olivia",
      to: ["ceo"],
      subject: "Solstice: next steps after our IC offsite",
      body: () =>
        `${hi}\n\nThanks for the time on the intro call. We're interested. Our IC offsite is next week, and I'll circle back after it with next steps, most likely a partner meeting.\n\nBest,\nOlivia Hart\nPartner, Solstice Bio Fund`,
    },
    {
      key: "solstice-2",
      thread: "solstice-ic",
      at: -58,
      from: "ceo",
      to: ["olivia"],
      subject: "Re: Solstice: next steps after our IC offsite",
      body: (t) =>
        `Olivia,\n\nThank you, glad it resonated. To make it easy, I've pencilled in a partner meeting for ${when(t, "mSolstice")}. Just let me know after the offsite whether that works.\n\n${sign}`,
      quote: { key: "solstice-1", style: "outlook" },
    },

    // ── Board: Michael's pre-read request; CEO will get back by Thursday ──
    {
      key: "board-1",
      thread: "board-preread",
      at: -11,
      from: "michael",
      to: ["ceo"],
      cc: ["jonas"],
      subject: "Board pre-read: Series B timeline and runway scenarios",
      body: (t) =>
        `${hi}\n\nFor ${c.nextWeekdayPhrase(t, "Friday")}'s pre-read, please include the Series B timeline with named lead candidates and two runway scenarios: base, and the raise slipping one quarter. The board expects a named lead by mid-November to keep the December first close.\n\nThanks,\nMichael`,
    },
    {
      key: "board-2",
      thread: "board-preread",
      at: -10,
      from: "ceo",
      to: ["michael"],
      cc: ["jonas"],
      subject: "Re: Board pre-read: Series B timeline and runway scenarios",
      body: (t) => `Michael,\n\nUnderstood. Jonas has both scenarios in model v12. Let me review and get back to you by ${c.nextWeekdayPhrase(t, "Thursday")} with a draft of the pre-read.\n\n${sign}`,
      quote: { key: "board-1", style: "gmail" },
    },
    {
      key: "granite-1",
      thread: "granite-prorata",
      at: -50,
      from: "michael",
      to: ["ceo"],
      subject: "Granite Peak: Series B pro-rata",
      body: () =>
        `${hi}\n\nHappy to confirm that Granite Peak will take its full pro-rata in the Series B ($4M). The partnership signed off this morning; written confirmation from our counsel will follow.\n\nMichael\n\nMichael Grant | Managing Partner | Granite Peak Capital`,
    },
    {
      key: "duval-1",
      thread: "duval-option-pool",
      at: -100,
      from: "catherine",
      to: ["ceo"],
      subject: "Q4 board meeting: option pool refresh",
      body: () =>
        `${hi}\n\nAhead of the Q4 board meeting on ${c.longDay(c.dayOf(seedMeetingStart(c, "mBoardQ4")))}, could we find 20 minutes to talk through the option pool refresh? I'd like to understand how the VP Sales grant fits within the proposed band before it comes to a vote.\n\nWarm regards,\nCatherine`,
    },
    {
      key: "duval-2",
      thread: "duval-option-pool",
      at: -98,
      from: "ceo",
      to: ["catherine"],
      subject: "Re: Q4 board meeting: option pool refresh",
      body: () => `Catherine,\n\nOf course. Ben will find time early next week. Jonas and Sofia are finalizing the pool proposal, and I'll share it with you before the pre-read goes out.\n\n${sign}`,
      quote: { key: "duval-1", style: "outlook" },
    },

    // ── Legal: Vantage NDA + Brightwater 11.2 ──
    {
      key: "legal-1",
      thread: "legal-nda-msa",
      at: -30,
      from: "marcus",
      to: ["ceo"],
      subject: "Vantage NDA ready + Brightwater clause 11.2",
      body: () =>
        `Two quick items:\n\n1. The mutual NDA with Vantage Oncology is ready for signature. I accepted their redline on the residuals clause; everything else is our standard paper. Please sign via DocuSign when you have a moment.\n\n2. Brightwater MSA clause 11.2 (liability cap): they've accepted a cap at 2x annual fees. I recommend we take it. Clause 7.3 remains the only open issue. My recommended position is a non-exclusive, field-limited license to derivative models trained on Brightwater's own compounds, consistent with the Aurelius and Calder agreements.\n\nMarcus\n\nMarcus Hale\nGeneral Counsel, CytoHub`,
      attachments: [{ id: "legal-1-att1", filename: "Vantage_mutual_NDA_v3.txt", mimeType: "text/plain", content: vantageNda }],
    },
    {
      key: "legal-2",
      thread: "legal-nda-msa",
      at: -29,
      from: "ceo",
      to: ["marcus"],
      subject: "Re: Vantage NDA ready + Brightwater clause 11.2",
      body: () => `Thanks, Marcus. Agreed on both: go ahead and accept 11.2 at 2x. I'll sign the Vantage NDA tonight.\n\n${sign}`,
      quote: { key: "legal-1", style: "outlook" },
    },

    // ── Finance ──
    {
      key: "finance-1",
      thread: "finance-runway",
      at: -13,
      from: "jonas",
      to: ["ceo"],
      subject: "Runway scenarios: model v12",
      body: () =>
        `${hi}\n\nModel v12 is uploaded to the data room. Headlines:\n\n- Runway is 16.6 months at current burn ($1.15M a month).\n- With a $40M close in December, runway extends past 24 months.\n- If the raise slips one quarter, we are at 13.1 months and should defer two of the Q1 hires.\n\nCan we review the scenarios together before Michael's pre-read goes out? Summary table attached.\n\nJonas`,
      attachments: [{ id: "finance-1-att1", filename: "runway_scenarios_v12.csv", mimeType: "text/csv", content: runwayScenarios }],
    },
    {
      key: "finance-2",
      thread: "finance-marketing-budget",
      at: -6,
      from: "jonas",
      to: ["ceo"],
      subject: "Approval needed: Q4 marketing budget ($180K)",
      body: (t) =>
        `${hi}\n\nI need your approval on the Q4 marketing budget: $180K in total, $70K for our BIO-Europe presence and $110K for the CardioPredict v2 launch campaign. It's above your $100K approval threshold. I need a decision by ${c.nextWeekdayPhrase(t, "Thursday")} to secure the booth.\n\nJonas`,
    },

    // ── Recruiting: decision needed by Wednesday ──
    {
      key: "recruiting-1",
      thread: "recruiting-vp-sales",
      at: -7,
      from: "sofia",
      to: ["ceo"],
      subject: "Laura Mitchell: competing offer",
      body: (t) =>
        `${hi}\n\nLaura Mitchell told me this morning that she has a competing offer with a deadline. Her references were strong, four out of four, and the one flag on management style was addressed in the follow-up call.\n\nI need your decision on the offer package (base $240K, OTE $310K, 1.1% equity) by ${c.nextWeekdayPhrase(t, "Wednesday")}. If you approve, could you call her yourself to close? It would mean a lot to her.\n\nSofia`,
    },

    // ── Lumen escalation + new deliverable ──
    {
      key: "lumen-1",
      thread: "lumen-escalation",
      at: -9,
      from: "rachel",
      to: ["ceo"],
      cc: ["daniel"],
      subject: "Escalation: assay turnaround at 19 days vs 10 contracted",
      body: () =>
        `${dear}\n\nThis is the third month in a row that we've missed the SLA. Median assay turnaround is now 19 days against the 10 days in our agreement, and two of our programs are waiting on data.\n\nOur renewal committee meets in three weeks, and I can't recommend renewal without a credible recovery plan. I'd like to discuss it on our call.\n\nRachel Moore\nDirector of Toxicology, Lumen Biologics`,
    },
    {
      key: "lumen-2",
      thread: "lumen-escalation",
      at: -8,
      from: "daniel",
      to: ["rachel"],
      cc: ["ceo"],
      subject: "Re: Escalation: assay turnaround at 19 days vs 10 contracted",
      body: () =>
        `Rachel,\n\nUnderstood, and I'm sorry. We'll come to the call with a dated recovery plan: dedicated assay capacity for Lumen, a weekly SLA report, and me as your single point of contact.\n\nDaniel\n\nDaniel Kim\nHead of Product, CytoHub`,
      quote: { key: "lumen-1", style: "outlook" },
    },
    {
      key: "lumen-3",
      thread: "lumen-escalation",
      at: -2,
      from: "rachel",
      to: ["ceo"],
      cc: ["daniel"],
      subject: "Re: Escalation: assay turnaround at 19 days vs 10 contracted",
      body: () =>
        `Thanks, Daniel. That's the right shape, and I'll take it to our renewal committee once we've walked through it together.\n\nOne additional request: we need the revised electrophysiology dataset for compounds LB-2207 and LB-2219 by ${lumenDue}. Our safety review board meets the following day and this data is on the critical path.\n\nPlease confirm you can meet that date.\n\nRachel`,
      quote: { key: "lumen-2", style: "outlook" },
    },

    // ── Science ──
    {
      key: "science-1",
      thread: "science-riverside",
      at: -21,
      from: "maya",
      to: ["ceo"],
      subject: "Riverside onboarding plan complete",
      body: () =>
        `Quick update before our 1:1: the Riverside University Hospital onboarding plan is complete and the first 12 hearts are expected in November, so the third tissue site goes live in about two weeks. We're at 410 donor hearts profiled.\n\nThe dataset validation paper is with co-authors; we're on track to submit to Nature Biotechnology by ${c.monthDay(c.workday(25))}.\n\nMaya`,
    },
    {
      key: "ai-1",
      thread: "ai-launch-scope",
      at: -44,
      from: "tom",
      to: ["ceo"],
      cc: ["daniel", "priya"],
      subject: "CardioPredict v2: hold-out results and launch scope",
      body: (t) =>
        `${hi}\n\nHold-out validation is complete: AUC 0.88 on 212 compounds against our 0.90 target (sensitivity 0.91, specificity 0.79). Retraining on the 60 new donor hearts from Riverside should get us over 0.90 in five to six weeks.\n\nOptions:\n1. Launch GA now at 0.88.\n2. Delay GA six weeks for 0.90.\n3. Limited release to the three design partners at 0.88 with full transparency, retrain in parallel, GA at 0.90 or better.\n\nThe team recommends option 3. We need your call by ${c.nextWeekdayPhrase(t, "Friday")}.\n\nTom`,
    },
    {
      key: "ai-2",
      thread: "ai-launch-scope",
      at: -2.5,
      from: "ceo",
      to: ["tom"],
      cc: ["daniel", "priya"],
      subject: "Re: CardioPredict v2: hold-out results and launch scope",
      body: () =>
        `Thanks, Tom, and thanks to the whole team for the transparency here.\n\nWe decided to go with the limited release: v2 goes to the three design partners at AUC 0.88 with the full validation report, retraining on the 60 new hearts starts now, and GA waits until we're at 0.90 or better. Daniel, please update the launch plan and the press release timing accordingly.\n\n${sign}`,
      quote: { key: "ai-1", style: "gmail" },
    },

    // ── Partners ──
    {
      key: "nhi-1",
      thread: "nhi-term-sheet",
      at: -15,
      from: "ingrid",
      to: ["ceo"],
      cc: ["marcus"],
      subject: "NHI data partnership: term sheet",
      body: (t) =>
        `${dear}\n\nI'm delighted to share that our board approved the data partnership in principle. We would like your comments on the term sheet by ${c.nextWeekdayPhrase(t, "Friday")} so that we can announce the partnership at the steering committee on ${c.longDay(c.dayOf(seedMeetingStart(c, "mNhiSteering")))}.\n\nWith best regards,\nIngrid\n\nProf. Ingrid Holm\nDirector, Nordic Heart Institute`,
    },
    {
      key: "nhi-2",
      thread: "nhi-term-sheet",
      at: -14,
      from: "ceo",
      to: ["ingrid"],
      cc: ["marcus"],
      subject: "Re: NHI data partnership: term sheet",
      body: (t) =>
        `Ingrid,\n\nWonderful news, thank you. Marcus is finishing our legal review and we'll send comments by ${c.nextWeekdayPhrase(t, "Friday")}. One point to flag early: on the publication embargo we'd propose 60 days rather than 90.\n\n${sign}`,
      quote: { key: "nhi-1", style: "gmail" },
    },
    {
      key: "aster-1",
      thread: "aster-credits",
      at: -9,
      from: "alex",
      to: ["ceo"],
      cc: ["elena"],
      subject: "Aster Cloud agreement: compute credits",
      body: (t) =>
        `${hi}\n\nGood news from our side: I got approval to offer 40% compute credits for the first two years if we sign by ${asterDeadline}. That's roughly $400K of training compute.\n\nOn the open items, the liability cap and data residency, our legal team will send their comments back by ${c.nextWeekdayPhrase(t, "Wednesday")}. Apologies for the delay on our end.\n\nBest,\nAlex Rivera\nHead of Life Sciences Partnerships, Aster Cloud`,
    },
    {
      key: "aster-2",
      thread: "aster-credits",
      at: -8.5,
      from: "ceo",
      to: ["alex"],
      cc: ["elena"],
      subject: "Re: Aster Cloud agreement: compute credits",
      body: () => `Alex, that's a generous offer, thank you. Elena owns the open terms on our side. Once your legal comments are in, let's aim to sign well before the deadline.\n\n${sign}`,
      quote: { key: "aster-1", style: "gmail" },
    },

    // ── Vendor risk: a new contact at a known company ──
    {
      key: "cellwave-1",
      thread: "cellwave-delay",
      at: -36,
      from: external("Jan Richter", "jan.richter@cellwave.example"),
      to: ["ceo"],
      cc: ["elena", "maya"],
      subject: "Shipment delay: FlexSense MEA systems (PO 4471)",
      body: () =>
        `${dear}\n\nI'm writing to let you know that the shipment of the two FlexSense multi-electrode array systems on PO 4471 will be delayed by approximately six weeks because of a component shortage at our supplier. The revised delivery date is ${c.monthDay(c.workday(42))}.\n\nWe sincerely apologize for the inconvenience. Please let me know if you would like to discuss interim options.\n\nKind regards,\nJan Richter\nCustomer Logistics Manager\nCellwave Instruments GmbH | Munich`,
    },
    {
      key: "cellwave-2",
      thread: "cellwave-delay",
      at: -30,
      from: "elena",
      to: [external("Jan Richter", "jan.richter@cellwave.example")],
      cc: ["ceo", "maya"],
      subject: "Re: Shipment delay: FlexSense MEA systems (PO 4471)",
      body: () =>
        `Jan,\n\nThis delay affects our functional assay capacity for the hearts arriving from our new hospital site in November. Can you confirm by the end of the week whether a loaner system is available in the meantime?\n\nElena Costa\nCOO, CytoHub`,
      quote: { key: "cellwave-1", style: "outlook" },
    },

    // ── Vantage: CEO promises an introduction to Maya ──
    {
      key: "vantage-1",
      thread: "vantage-design-partner",
      at: -52,
      from: "nina",
      to: ["ceo"],
      subject: "Cardio-oncology design-partner program",
      body: () =>
        `${hi}\n\nThank you for letting us know about the decision to keep cardiac safety as the 2027 focus. We're supportive, and the design-partner program works well for us. Before we scope it, my team would like to understand the dataset better: how many donor hearts have oncology-drug exposure data, and which modalities are available for them?\n\nBest,\nNina\n\nDr. Nina Patel\nVP Translational Science, Vantage Oncology`,
    },
    {
      key: "vantage-2",
      thread: "vantage-design-partner",
      at: -50,
      from: "ceo",
      to: ["nina"],
      subject: "Re: Cardio-oncology design-partner program",
      body: () =>
        `Nina,\n\nThank you, that means a lot. I'll introduce you to Maya, our CSO, who leads the dataset; she can walk your team through the cohort and modalities. And I'm looking forward to our dinner at BIO-Europe.\n\n${sign}`,
      quote: { key: "vantage-1", style: "gmail" },
    },

    // ── A possible new investor from an unknown firm (after the anchor) ──
    {
      key: "halvorsen-1",
      thread: "halvorsen-intro",
      at: 6,
      from: external("Erik Halvorsen", "erik.halvorsen@halvorsencapital.example"),
      to: ["ceo"],
      subject: "Introduction: Halvorsen Capital and your Series B",
      body: () =>
        `${dear}\n\nI lead life-science investments at Halvorsen Capital, a family office based in Oslo and Boston. A co-investor mentioned that CytoHub is raising a Series B, and a proprietary human heart dataset is exactly the kind of platform we look for.\n\nWould you be open to a 30-minute call next week? We typically invest $3–5M per round and can move quickly.\n\nBest regards,\nErik Halvorsen\nPartner, Halvorsen Capital`,
    },

    // ── Internal: customer references ──
    {
      key: "refs-1",
      thread: "refs-northbridge",
      at: -146,
      from: "priya",
      to: ["ceo"],
      subject: "Customer references for Northbridge diligence",
      body: () => `Aurelius has agreed to be a reference, and I'm asking Calder next. I'd hold off on Lumen given the SLA situation. What do you think?\n\nPriya`,
    },
    {
      key: "refs-2",
      thread: "refs-northbridge",
      at: -145,
      from: "ceo",
      to: ["priya"],
      subject: "Re: Customer references for Northbridge diligence",
      body: () => `Agreed, skip Lumen for now. Ask Dr. Reyes at Riverside for a scientific reference instead.\n\n${sign}`,
      quote: { key: "refs-1", style: "outlook" },
    },

    // ── Noise ──
    {
      key: "noise-newsletter",
      thread: "noise-newsletter",
      at: -20,
      from: external("BioPharma Daily", "newsletter@biopharmadaily.example"),
      to: ["ceo"],
      subject: "BioPharma Daily: FDA advisory calendar and the Q4 funding round-up",
      body: () =>
        `Today in BioPharma Daily\n\n- FDA advisory committee calendar for the next six weeks\n- Q4 venture round-up: 41 biotech rounds above $50M\n- Opinion: is AI drug safety ready for regulators?\n\nRead online: https://biopharmadaily.example/issues/2041\n\nYou are receiving this because you subscribed at biopharmadaily.example. Unsubscribe: https://biopharmadaily.example/unsubscribe`,
      headers: { "list-unsubscribe": "<https://biopharmadaily.example/unsubscribe?u=8842>", "list-id": "BioPharma Daily <daily.biopharmadaily.example>", precedence: "bulk" },
      labels: ["CATEGORY_UPDATES"],
    },
    {
      key: "noise-marketing",
      thread: "noise-marketing",
      at: -50,
      from: external("LabSupply Pro", "offers@labsupplypro.example"),
      to: ["ceo"],
      subject: "This week only: 20% off pipette tips and filter plates",
      body: () => `Stock up before year-end. Use code LAB20 for 20% off pipette tips, filter plates and reservoirs through Sunday.\n\nShop now: https://labsupplypro.example/sale\n\nUnsubscribe: https://labsupplypro.example/u`,
      headers: { "list-unsubscribe": "<mailto:unsubscribe@labsupplypro.example>", precedence: "bulk" },
      labels: ["CATEGORY_PROMOTIONS"],
    },
    {
      key: "noise-hubspot",
      thread: "noise-hubspot",
      at: -30,
      from: external("HubSpot", "noreply@hubspot.example"),
      to: ["ceo"],
      subject: "Your weekly deals summary",
      body: () => `Here's what changed in your pipeline this week: 3 deals moved stage, 1 deal closed won, 2 deals have no activity in 14 days.\n\nView the report in HubSpot.`,
      labels: ["CATEGORY_UPDATES"],
    },
    {
      key: "noise-github",
      thread: "noise-github",
      at: -12,
      from: external("GitHub", "notifications@github.example"),
      to: ["ceo"],
      subject: "[cytohub/cardiopredict] Merged PR #482: retraining pipeline for donor cohort 7",
      body: () => `Merged #482 into main.\n\n— Reply to this email directly or view it on GitHub.\nYou are receiving this because you are subscribed to this thread.`,
      headers: { "list-id": "cytohub/cardiopredict <cardiopredict.cytohub.github.example>", precedence: "list" },
      labels: ["CATEGORY_UPDATES"],
    },
    {
      key: "noise-calendar",
      thread: "noise-calendar",
      at: HELIX_MOVE.inviteHours,
      from: external("Google Calendar", "calendar-notification@google.example"),
      to: ["ceo"],
      subject: `Updated invitation: Helix Capital — diligence session @ ${c.longDay(c.dayOf(helixMoved))} ${c.clockTime(helixMoved)}`,
      body: () => `This event has been changed.\n\nHelix Capital — diligence session\nWhen: ${c.longDay(c.dayOf(helixMoved))} ${c.clockTime(helixMoved)}\nOrganizer: david@helix.example\n\nInvitation from Google Calendar.`,
      headers: { "auto-submitted": "auto-generated" },
    },
    {
      key: "noise-cold-pitch",
      thread: "noise-cold-pitch",
      at: -28,
      from: external("Jake Morrison", "jake@growthleads.example"),
      to: ["ceo"],
      subject: "Quick question about CytoHub's pharma pipeline",
      body: () =>
        `${hi}\n\nI help biotech CEOs book 20+ qualified meetings with pharma buyers every month. Would it be crazy to grab 15 minutes next week to see if we could do the same for CytoHub?\n\nCheers,\nJake`,
      deletedAt: 10,
    },
    {
      key: "noise-newsletter-2",
      thread: "noise-newsletter-2",
      at: 8,
      from: external("Fierce Biotech Weekly", "newsletters@fiercebio.example"),
      to: ["ceo"],
      subject: "Fierce Biotech Weekly: cardiac safety AI heats up",
      body: () => `This week: CardiaSim's $60M Series C, two new AI cardiac-safety launches, and what pharma buyers are asking for.\n\nManage your subscription: https://fiercebio.example/preferences`,
      headers: { "list-unsubscribe": "<https://fiercebio.example/unsubscribe>", precedence: "bulk" },
      labels: ["CATEGORY_UPDATES"],
    },
    {
      key: "noise-bounce",
      thread: "noise-bounce",
      at: -70,
      from: external("Mail Delivery Subsystem", "mailer-daemon@cytohub.example"),
      to: ["ceo"],
      subject: "Delivery Status Notification (Failure)",
      body: () => `Address not found\n\nYour message to p.adeyemi@ostrava-pharma.example couldn't be delivered. The address couldn't be found, or is unable to receive mail.`,
      headers: { "auto-submitted": "auto-replied" },
    },
  ];
}

// ─── Attachments ─────────────────────────────────────────────────────────────

function calderDataPackage(): string {
  return [
    "compound_id,assay,endpoint,value,unit,donor_hearts,qc_status",
    "CAL-0412,hERG patch clamp,IC50,12.4,uM,6,pass",
    "CAL-0412,Human heart slice APD90,change_at_10uM,8.1,percent,6,pass",
    "CAL-0518,hERG patch clamp,IC50,3.2,uM,6,pass",
    "CAL-0518,Human heart slice APD90,change_at_10uM,21.7,percent,6,pass",
    "CAL-0533,Contractility,EC50,0.84,uM,5,pass",
    "REF-DOF,QT prolongation (reference),APD90 change at 0.01uM,14.9,percent,8,pass",
    "REF-MOX,QT prolongation (reference),APD90 change at 10uM,9.6,percent,8,pass",
    "REF-VER,QT prolongation (reference),APD90 change at 1uM,-2.1,percent,8,pass",
  ].join("\n");
}

function runwayScenarios(): string {
  return [
    "scenario,monthly_net_burn_usd,cash_usd,raise_close,runway_months,notes",
    "Base (no raise),1150000,19100000,none,16.6,Current plan",
    "Series B closes December,1350000,59100000,December,24+,Includes planned Q1 hires",
    "Raise slips one quarter,1150000,19100000,March,13.1,Defer two Q1 hires",
  ].join("\n");
}

function vantageNda(): string {
  return [
    "MUTUAL NON-DISCLOSURE AGREEMENT (v3)",
    "",
    "Parties: CytoHub, Inc. and Vantage Oncology, Inc.",
    "Purpose: evaluation of a cardio-oncology design-partner program.",
    "Term: two (2) years from the Effective Date; confidentiality obligations survive for five (5) years.",
    "Residuals: information retained in unaided memory may be used, excluding the CytoHub human heart dataset and any Vantage compound structures (Vantage redline accepted).",
    "Governing law: Delaware.",
  ].join("\n");
}

// ─── Builder ─────────────────────────────────────────────────────────────────

function domain(email: string) {
  return email.split("@")[1] ?? "cytohub.example";
}

function formatQuoteDate(w: DemoWorld, at: Date, style: "gmail" | "outlook") {
  const tz = w.clock.timezone;
  if (style === "gmail") {
    const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(at);
    return `${d} at ${w.clock.clockTime(at).replace("am", "AM").replace("pm", "PM")}`;
  }
  const d = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(at);
  return `${d} ${w.clock.clockTime(at).replace("am", "AM").replace("pm", "PM")}`;
}

/** The demo mailbox as revealable versions (deletions included as tombstones). */
export function buildEmailFixtures(w: DemoWorld): Revealable<NormalizedEmail>[] {
  const resolve = (who: Who): Participant & { name: string } => (typeof who === "string" ? { name: w.person(who).name, email: w.person(who).email } : who);
  const all = specs(w);
  const built = new Map<string, { email: NormalizedEmail; body: string }>();
  const out: Revealable<NormalizedEmail>[] = [];
  const dayTag = w.clock.today.toISOString().slice(0, 10).replace(/-/g, "");

  for (const s of all) {
    const sentAt = w.clock.hours(s.at);
    const from = resolve(s.from);
    const to = s.to.map(resolve);
    const cc = (s.cc ?? []).map(resolve);
    let body = s.body(sentAt);
    const previous = s.quote ? built.get(s.quote.key) : undefined;
    if (s.quote && previous) {
      const prev = previous.email;
      const quoted =
        s.quote.style === "gmail"
          ? `On ${formatQuoteDate(w, prev.sentAt, "gmail")} ${prev.from.name ?? prev.from.email} <${prev.from.email}> wrote:\n${previous.body
              .split("\n")
              .map((l) => (l ? `> ${l}` : ">"))
              .join("\n")}`
          : `________________________________\nFrom: ${prev.from.name ?? prev.from.email} <${prev.from.email}>\nSent: ${formatQuoteDate(w, prev.sentAt, "outlook")}\nTo: ${prev.to.map((p) => p.name ?? p.email).join("; ")}\nSubject: ${prev.subject}\n\n${previous.body}`;
      body = `${body}\n\n${quoted}`;
    }
    const outbound = from.email === w.ceo.email;
    const recent = s.at > -24;
    const attachments: NormalizedAttachment[] = (s.attachments ?? []).map((a) => {
      const content = a.content();
      return { externalId: a.id, filename: a.filename, mimeType: a.mimeType, sizeBytes: Buffer.byteLength(content), fetch: async () => Buffer.from(content, "utf8") };
    });
    const email: NormalizedEmail = {
      externalId: `demo-msg-${s.key}`,
      threadExternalId: `demo-thread-${s.thread}`,
      internetMessageId: `<${s.key}.${dayTag}@${domain(from.email)}>`,
      inReplyTo: previous?.email.internetMessageId ?? null,
      from,
      to,
      cc,
      bcc: [],
      replyTo: null,
      subject: s.subject,
      sentAt,
      bodyText: body,
      labels: outbound ? ["SENT"] : ["INBOX", ...(recent ? ["UNREAD"] : []), ...(s.labels ?? [])],
      folder: outbound ? "SENT" : "INBOX",
      isRead: outbound || !recent,
      headers: s.headers ?? {},
      attachments,
      webUrl: null,
      raw: { demo: true, key: s.key, thread: s.thread, from, to, cc, subject: s.subject, sentAt: sentAt.toISOString(), headers: s.headers ?? {}, body },
    };
    built.set(s.key, { email, body: s.body(sentAt) });
    out.push({ key: `msg:${s.key}`, externalId: email.externalId, revealAt: sentAt, item: email });
    if (s.deletedAt !== undefined) {
      out.push({ key: `deleted:${s.key}`, externalId: email.externalId, revealAt: w.clock.hours(s.deletedAt), item: null });
    }
  }
  return out;
}
