/**
 * Demo document drive for the CytoHub CEO: 14 real files (PPTX, XLSX, DOCX,
 * PDF, Markdown, CSV, TXT, PNG) generated at runtime, consistent with the
 * seeded workspace and the demo mailbox (prisma/seed-data.ts,
 * email-fixtures.ts): the Series B deck, Jonas's financial model v12, the
 * Brightwater MSA with clause 7.3 open, Calder's paid study, Lumen's SLA
 * recovery, CardioPredict at AUC 0.88, HeartReady's IND-enabling plan…
 *
 * Revealed over time from the connection's demo anchor:
 *   • most files exist before the anchor (first sync);
 *   • the Halvorsen NDA (+20 h) and the Lumen recovery plan (+4 h) appear later;
 *   • the investor deck v2 (+6 h, "raising $40M" instead of $35M, two slides
 *     added) and financial model v13 (+30 h, runway 16.6 → 15.9 months) are
 *     new versions of files already synced — significant changes.
 * Dates inside documents are written relative to the anchor so they always
 * read naturally.
 */
import type { NormalizedDocumentRef } from "../../types";
import { buildDocx, buildPdf, buildPng, buildPptx, buildXlsx, excelSerial } from "./document-fixtures-builders";
import type { Revealable } from "./reveal";
import type { DemoWorld } from "./world";

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  md: "text/markdown",
  txt: "text/plain",
  png: "image/png",
} as const;

interface FixtureVersion {
  /** Hours relative to the demo anchor when this version appears (negative = before). */
  at: number;
  build: (h: FixtureHelpers) => Buffer;
}

export interface DocumentFixture {
  key: string;
  title: string;
  folder: string;
  url: string;
  mimeType: string;
  author: (h: FixtureHelpers) => string;
  versions: FixtureVersion[];
}

export interface FixtureHelpers {
  w: DemoWorld;
  /** "November 13, 2026": business day `n` days from the anchor's day. */
  date(n: number): string;
  /** Same day as a Date (00:00 UTC). */
  day(n: number): Date;
  name(key: string): string;
}

function helpers(w: DemoWorld): FixtureHelpers {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
  return {
    w,
    day: (n) => w.clock.workday(n),
    date: (n) => fmt.format(w.clock.workday(n)),
    name: (key) => w.person(key).name,
  };
}

// ─── Series B investor deck (PPTX): $35M → $40M ─────────────────────────────

function investorDeck(h: FixtureHelpers, v: 1 | 2): Buffer {
  const raise = v === 1 ? "$35M" : "$40M";
  const slides = [
    {
      title: "CytoHub — Series B",
      bullets: [`Raising ${raise} to scale the human heart data platform`, "Confidential — prepared for Northbridge Ventures and Helix Capital Partners"],
      notes: "Open with the human-data thesis. Sarah Chen will ask about dataset defensibility first.",
    },
    {
      title: "The problem: cardiac safety still fails late",
      bullets: ["Cardiotoxicity remains a leading cause of late-stage attrition and post-market withdrawals", "iPSC and animal models miss human-specific arrhythmia risk", "Pharma pays for it in failed Phase II programs and delayed approvals"],
    },
    {
      title: "Our moat: the Human Heart Dataset",
      bullets: ["410 donor hearts profiled across functional, transcriptomic and imaging modalities", "3 hospital tissue sites live; Riverside University Hospital goes live in two weeks", "Target: 500 donor hearts by year-end"],
    },
    ...(v === 2
      ? [
          {
            title: "Why the dataset is defensible",
            bullets: ["Exclusive sourcing agreements with three hospital systems through 2029", "Donor consent covers commercial model training", "Five years of protocols and QA that a new entrant would have to rebuild"],
            notes: "Added for Northbridge: Sarah asked for a clear view of why the dataset is defensible.",
          },
        ]
      : []),
    {
      title: "CytoHub.AI — CardioPredict v2",
      bullets: ["Hold-out AUC 0.88 vs 0.90 target on 212 compounds", "Retraining on 60 new donor hearts; launch-scope decision this week", "Beta live with three design partners"],
    },
    {
      title: "Traction",
      bullets: ["$4.7M ARR, up from $2.6M a year ago", "10 pharma customers; net revenue retention 118%, gross retention 96%", "Calder Biosciences converted its pilot into a $350K paid validation study"],
    },
    ...(v === 2
      ? [
          {
            title: "Cohort retention by customer",
            table: [
              ["Cohort", "Customers", "Expanded", "Churned"],
              ["2024", "4 customers", "4", "0"],
              ["2025", "4 customers", "3", "0"],
              ["2026", "2 customers", "1", "0"],
            ],
            notes: "Northbridge asked for cohort retention by customer. No logo churn since 2024.",
          },
        ]
      : []),
    {
      title: "HeartReady",
      bullets: ["Six IND-enabling studies planned; three complete", `Pre-IND meeting request planned for ${h.date(100)}`],
    },
    {
      title: "Competition",
      bullets: ["CardiaSim raised a $60M Series C for iPSC-based models (launch H1 2027)", "Our edge: human donor heart data and clinical concordance"],
    },
    {
      title: `Use of funds (${raise})`,
      table: [
        ["Area", "Share"],
        ["Dataset scale-up to 1,000 donor hearts", "40%"],
        ["CytoHub.AI and CardioPredict v3", "30%"],
        ["HeartReady IND-enabling work", "20%"],
        ["G&A and working capital", "10%"],
      ],
    },
    {
      title: "Timeline",
      bullets: [`Lead investor term sheet by ${h.date(40)}`, `Series B first close ${h.date(85)}`, "Runway 16.6 months at current burn; 24+ months after a December close"],
    },
  ];
  return buildPptx({ title: "CytoHub Series B Investor Deck", author: h.name("jonas"), slides });
}

// ─── Financial model (XLSX): v12 → v13 ──────────────────────────────────────

function financialModel(h: FixtureHelpers, v: 12 | 13): Buffer {
  const burn = v === 12 ? 1_150_000 : 1_200_000;
  const runway = v === 12 ? 16.6 : 15.9;
  const slip = v === 12 ? 13.1 : 12.4;
  const money = (value: number) => ({ value, format: "currency" as const });
  return buildXlsx({
    title: "CytoHub Financial Model FY26–FY28",
    author: h.name("jonas"),
    sheets: [
      {
        name: "Summary",
        rows: [
          ["Metric", "Value", "Notes"],
          ["Model version", `v${v}`, v === 12 ? "Uploaded to the Series B data room" : "Adds the VP Sales hire and the third lab expansion to the burn"],
          ["Cash on hand", money(19_100_000), "End of September"],
          ["Monthly net burn", money(burn), v === 12 ? "Trailing three months" : "Forward three months"],
          ["Runway at current burn (months)", { value: runway, format: "decimal1" }, "No raise"],
          ["ARR (current)", money(4_730_000), "HubSpot, contracted"],
          ["FY26 revenue (forecast)", money(4_100_000), null],
          ["FY27 revenue (plan)", money(7_800_000), "Assumes Brightwater MSA signed this quarter"],
          ["Series B raise (planned)", money(40_000_000), "Lead investor not yet committed"],
          ["Pre-money valuation (assumed)", money(160_000_000), null],
          ["Net revenue retention", { value: 1.18, format: "percent" }, "Trailing twelve months"],
          [{ inline: "Prepared by Jonas Weber (CFO). Confidential — data room copy." }],
        ],
      },
      {
        name: "Runway scenarios",
        rows: [
          ["Scenario", "Monthly net burn", "Series B close", "Runway (months)", "Notes"],
          ["Base (no raise)", money(burn), "none", { value: runway, format: "decimal1" }, "Current plan"],
          ["Series B closes December", money(1_350_000), { value: excelSerial(h.day(85)), format: "date" }, "24+", "Includes planned Q1 hires"],
          ["Raise slips one quarter", money(burn), { value: excelSerial(h.day(176)), format: "date" }, { value: slip, format: "decimal1" }, "Defer two Q1 hires"],
        ],
      },
      {
        name: "Revenue by quarter",
        rows: [
          ["Quarter", "Bookings", "Revenue", "Ending ARR"],
          ["Q1 FY26", money(820_000), money(810_000), money(3_250_000)],
          ["Q2 FY26", money(1_150_000), money(930_000), money(3_700_000)],
          ["Q3 FY26", money(1_380_000), money(1_090_000), money(4_380_000)],
          ["Q4 FY26 (forecast)", money(1_900_000), money(1_270_000), money(5_100_000)],
        ],
      },
      {
        name: "Use of funds",
        rows: [
          ["Area", "Share", "Notes"],
          ["Dataset scale-up to 1,000 donor hearts", { value: 0.4, format: "percent" }, "Two new tissue sites"],
          ["CytoHub.AI and CardioPredict v3", { value: 0.3, format: "percent" }, "Includes compute partnership"],
          ["HeartReady IND-enabling work", { value: 0.2, format: "percent" }, "GLP toxicology and CMC"],
          ["G&A and working capital", { value: 0.1, format: "percent" }, null],
        ],
      },
    ],
  });
}

// ─── Contracts and proposals (DOCX) ─────────────────────────────────────────

function brightwaterMsa(h: FixtureHelpers): Buffer {
  return buildDocx({
    title: "Brightwater MSA v5 (redlined)",
    author: h.name("marcus"),
    header: "CONFIDENTIAL — DRAFT v5 — Brightwater Therapeutics / CytoHub Master Services Agreement",
    footer: "Privileged & Confidential · Attorney work product",
    body: [
      { heading: "Master Services Agreement — draft v5" },
      "This Master Services Agreement (the “Agreement”) is entered into between CytoHub, Inc. (“CytoHub”) and Brightwater Therapeutics, Inc. (“Brightwater”).",
      { heading: "Draft status", level: 2 },
      "Brightwater legal returned draft v5 with 14 of 16 redlines accepted. Two clauses remain open: 7.3 (derivative models) and 11.2 (liability cap).",
      {
        table: [
          ["Clause", "Topic", "Status", "Owner"],
          ["4.1", "Fees and payment", "Agreed", h.name("priya")],
          ["7.3", "Rights to derivative models", "Open — Brightwater requests a license", h.name("marcus")],
          ["11.2", "Limitation of liability", "Open — cap at 2x annual fees proposed", h.name("elena")],
        ],
      },
      { heading: "3. Term", level: 2 },
      "3.1 The initial term of this Agreement is 3 years from the Effective Date, renewable for successive 1-year terms.",
      { heading: "4. Fees", level: 2 },
      "4.1 Brightwater will pay total fees of $1.4M over the initial term, invoiced quarterly in advance.",
      { heading: "5. Services and deliverables", level: 2 },
      "5.2 CytoHub will deliver cardiac safety screening reports within 10 business days of compound receipt, with a monthly turnaround report to Brightwater's VP Discovery.",
      { heading: "7. Intellectual property and data rights", level: 2 },
      "7.1 CytoHub retains all rights in the Human Heart Dataset, the CytoHub platform and any improvements to them.",
      `7.3 **[OPEN] Derivative models.** Brightwater requests a perpetual license to any models trained on Brightwater compound data. CytoHub proposes a non-exclusive license limited to Brightwater's own compounds, with CytoHub retaining all rights to the dataset and platform improvements. A CEO decision is needed before the negotiation call on ${h.date(1)}.`,
      { heading: "11. Limitation of liability", level: 2 },
      "11.2 **[OPEN]** Brightwater proposes a liability cap of 2x annual fees; CytoHub's opening position was 1x annual fees.",
      { heading: "Signature", level: 2 },
      `Target signature date: ${h.date(18)}. ${h.name("karen")} (VP Discovery) is the Brightwater business owner; ${h.name("priya")} owns the deal for CytoHub.`,
    ],
  });
}

function calderProposal(h: FixtureHelpers): Buffer {
  return buildDocx({
    title: "Calder Biosciences — Paid Validation Study Proposal",
    author: h.name("priya"),
    header: "CytoHub · Proposal for Calder Biosciences",
    body: [
      { heading: "Paid validation study — proposal" },
      `Prepared for ${h.name("henrik")}, Chief Scientific Officer, Calder Biosciences, by ${h.name("priya")}, VP Business Development.`,
      { heading: "Summary", level: 2 },
      "Following the successful 2026 pilot, CytoHub proposes a 16-week paid validation study of CardioPredict on a 40-compound panel, keeping the same scientific team on both sides. Total study fee: $350K.",
      {
        table: [
          ["Item", "Fee"],
          ["Study setup and compound onboarding", "$40,000"],
          ["Screening of 40 compounds on human heart tissue", "$250,000"],
          ["CardioPredict v2 model report", "$60,000"],
          ["Total study fee", "$350,000"],
        ],
      },
      { heading: "Timeline and deliverables", level: 2 },
      `Study start: ${h.date(7)}.`,
      `CytoHub will deliver the interim readout by ${h.date(63)} and the final validation report by ${h.date(119)}.`,
      { heading: "Expansion option", level: 2 },
      "Calder may convert the study into a 3-year platform subscription at $600K per year, exercisable within 60 days of the final report. Pricing is held until the option expires.",
      { heading: "Commercial terms", level: 2 },
      `Payment: 50% on signature, 50% on delivery of the final report. This proposal is valid until ${h.date(30)}.`,
      "Calder's finance committee has approved the budget; the statement of work follows this proposal.",
    ],
  });
}

function halvorsenNda(h: FixtureHelpers): Buffer {
  return buildDocx({
    title: "Mutual NDA — Halvorsen Capital",
    author: h.name("marcus"),
    footer: "CytoHub standard mutual NDA (2026)",
    body: [
      { heading: "Mutual Non-Disclosure Agreement" },
      `This Mutual Non-Disclosure Agreement is effective as of ${h.date(1)} between CytoHub, Inc. (“CytoHub”) and Halvorsen Capital, a family office based in Oslo and Boston (“Halvorsen”).`,
      "Purpose: evaluation of a potential investment by Halvorsen Capital in CytoHub's Series B financing.",
      "Term: 2 years from the effective date; confidentiality obligations survive for 3 years after disclosure.",
      "Each party will protect the other party's Confidential Information with at least reasonable care and use it only for the Purpose. The Human Heart Dataset and CardioPredict model details are disclosed only in the Series B data room.",
      "Halvorsen contact: Erik Halvorsen, Partner (erik.halvorsen@halvorsencapital.example).",
      `Signed for CytoHub by ${h.name("marcus")}, General Counsel. Countersignature from Halvorsen Capital is due by ${h.date(3)}.`,
    ],
  });
}

function lumenRecoveryPlan(h: FixtureHelpers): Buffer {
  return buildDocx({
    title: "Lumen Biologics — Assay Turnaround Recovery Plan",
    author: h.name("daniel"),
    header: "CytoHub · Customer recovery plan · Lumen Biologics",
    body: [
      { heading: "Assay turnaround recovery plan" },
      `Prepared after the escalation call with ${h.name("rachel")} (Director of Toxicology, Lumen Biologics).`,
      { heading: "Situation", level: 2 },
      "Median assay turnaround reached 19 days against the 10-day SLA; this is the third consecutive month above the SLA.",
      `The $500K annual renewal is at risk. Lumen's renewal committee meets on ${h.date(15)}.`,
      { heading: "Recovery plan", level: 2 },
      {
        table: [
          ["Action", "Owner", "Due"],
          ["Dedicate two assay scientists to Lumen work", h.name("maya"), h.date(3)],
          ["Weekly SLA report every Monday", h.name("daniel"), h.date(5)],
          ["Turnaround dashboard shared with Lumen", h.name("daniel"), h.date(6)],
          ["Root-cause review of instrument downtime", h.name("elena"), h.date(8)],
        ],
      },
      { heading: "Commitments to Lumen", level: 2 },
      `CytoHub will restore median turnaround to 10 days by ${h.date(14)}.`,
      "CytoHub will issue service credits of $25,000 for the missed months.",
      `${h.name("daniel")} is the single accountable owner and Lumen's point of contact.`,
      { heading: "Risks", level: 2 },
      "Downtime on the Cellwave plate reader could delay the recovery; a backup reader is on order.",
    ],
  });
}

// ─── Reports (PDF) ──────────────────────────────────────────────────────────

function boardPreRead(h: FixtureHelpers): Buffer {
  return buildPdf({
    title: "Q4 Board Pre-read — Series B and Runway",
    author: h.name("jonas"),
    pages: [
      [
        "# Q4 board pre-read: Series B timeline and runway scenarios",
        `Prepared by ${h.name("jonas")}, CFO, for the board meeting on ${h.date(10)}. DRAFT for CEO review.`,
        "",
        "# Series B timeline",
        "Target raise: $40M led by a top-tier life-science investor.",
        "Lead candidates: Northbridge Ventures (partner meeting this week), Helix Capital Partners (diligence), Fjord Life Science Ventures (first meeting held).",
        "Granite Peak Capital has committed its full pro-rata. Meridian Health Ventures passed, citing stage.",
        `Named lead by ${h.date(40)}; term sheet signed by ${h.date(45)}; first close ${h.date(85)}.`,
        "",
        "# Runway scenarios (model v12)",
        "Cash on hand: $19.1M. Monthly net burn: $1.15M.",
        "Base (no raise): runway 16.6 months at current burn.",
        "Series B closes December: runway 24+ months, including the planned Q1 hires.",
        "Raise slips one quarter: runway 13.1 months; we would defer two Q1 hires.",
      ],
      [
        "# Decisions requested from the board",
        "1. Approve the option pool refresh from 10% to 13% ahead of the Series B.",
        "2. Endorse a limited release of CardioPredict v2 to design partners at AUC 0.88 while retraining toward the 0.90 target.",
        "",
        "# Risks",
        "No lead investor has committed yet; the board expects a named lead by mid-November to keep the December first close.",
        "CardiaSim's $60M Series C increases competitive pressure on the AI narrative.",
        "",
        "# Commitments",
        `The CEO will circulate the final Series B deck to the board by ${h.date(7)}.`,
        `${h.name("jonas")} will complete the data room financial section by ${h.date(3)}.`,
      ],
    ],
  });
}

function validationReport(h: FixtureHelpers): Buffer {
  return buildPdf({
    title: "CardioPredict v2 Validation Report (draft)",
    author: h.name("tom"),
    pages: [
      [
        "# CardioPredict v2 — validation report (draft)",
        `Author: ${h.name("tom")}, Head of AI. Status: draft for the executive team.`,
        "",
        "# Summary",
        "Hold-out AUC 0.88 vs 0.90 target on 212 compounds (sensitivity 0.91, specificity 0.79).",
        "The model meets the sensitivity bar but misses the publicly committed AUC target.",
        "",
        "# Data",
        "Training set: 410 donor hearts. Hold-out set: 212 compounds with known clinical cardiotoxicity outcomes.",
        "",
        "# Options",
        "A. Launch GA now at AUC 0.88. B. Delay GA six weeks for 0.90. C. Limited release to the three design partners while retraining.",
        "",
        "# Recommendation",
        "Option C: release CardioPredict v2 to the three design partners now and retrain on 60 new donor hearts from Riverside University Hospital.",
        `Retrained model readout expected by ${h.date(42)}. Launch-scope decision needed from the CEO by ${h.date(3)}.`,
      ],
      [
        "# Risks",
        "False negatives on hERG-negative arrhythmogenic compounds remain the main safety risk.",
        "Shipping below the publicly committed 0.90 bar could damage trust with safety pharmacology teams.",
        "",
        "# Next steps",
        `${h.name("tom")} will share the retraining plan with ${h.name("daniel")} by ${h.date(2)}.`,
        `${h.name("daniel")} will update customer-facing documentation before any release.`,
      ],
    ],
  });
}

// ─── Markdown, CSV, text ────────────────────────────────────────────────────

const text = (s: string) => Buffer.from(s, "utf8");

function heartReadyPlan(h: FixtureHelpers): Buffer {
  return text(`# HeartReady — IND-enabling plan

Owner: ${h.name("lea")}, Director, Translational Programs
Status: three of six studies complete

## Goal

Generate the preclinical efficacy and safety package needed to request a pre-IND meeting with FDA. Pre-IND meeting request planned for ${h.date(100)}.

## Studies

| Study | Status | Readout |
| --- | --- | --- |
| Human heart slice efficacy (dose-response) | Complete | — |
| Ex vivo arrhythmia safety panel | Complete | — |
| Biodistribution in large-animal model | Complete | — |
| GLP toxicology (28-day) | In progress | ${h.date(70)} |
| CMC process lock | Planned | ${h.date(80)} |
| Pharmacology summary for the briefing book | Planned | ${h.date(92)} |

## Budget

Total IND-enabling budget: $2.8M through the pre-IND request, funded from the Series B use of funds (HeartReady share 20%).

## Decisions

- We decided to run the GLP toxicology study at a single CRO to protect the timeline.

## Risks

- GLP toxicology CRO capacity is tight in Q1; a two-week slip would move the pre-IND request into the following month.
- Investor diligence: Anna Berg (Fjord Life Science Ventures) asked for this plan after her first meeting.

## Commitments

- ${h.name("lea")} will send the GLP toxicology interim summary to the CEO by ${h.date(20)}.
- The CEO will share this plan with Anna Berg at Fjord as follow-up to the first meeting.
`);
}

function ephysDataset(): Buffer {
  return text(
    [
      "Site,Donor hearts,Recordings,QC pass rate,Median donor age,Notes",
      'Massachusetts Heart Bank,182,4368,94%,52,"Longest-running site; includes 12 pediatric donors"',
      "Lakeshore Transplant Center,141,3102,91%,49,Live since 2025",
      'Pacific Cardiac Tissue Program,87,1740,89%,55,"QC re-review of 6 hearts pending, flagged by Maya"',
      'Riverside University Hospital,0,0,,,"Onboarding; first 12 hearts expected in November"',
      'Total,410,9210,92%,52,"Target: 500 donor hearts by year-end"',
    ].join("\r\n") + "\r\n",
  );
}

function operatingMemo(h: FixtureHelpers): Buffer {
  return text(`# Q4 operating memo

From: ${h.w.ceo.name} · To: leadership team

## Priorities for the quarter

1. Secure a Series B lead term sheet — target a named lead by ${h.date(40)}.
2. Sign the Brightwater Therapeutics MSA (target signature ${h.date(18)}).
3. Decide CardioPredict v2 launch scope this week and keep the AUC 0.90 commitment credible.
4. Hire a VP Sales — Laura Mitchell has a competing offer.
5. Close the SOC 2 Type II observation window with no exceptions.

## Decisions

- We will raise the Series B in Q4 rather than Q1 (decided with the board).
- ${h.name("daniel")} is the single owner for the Lumen turnaround recovery.

## Commitments

- ${h.name("daniel")} will ship the assay turnaround dashboard for Lumen by ${h.date(6)}.
- ${h.name("jonas")} will complete the data room financial section by ${h.date(3)}.
- ${h.name("sofia")} will close the VP Sales hire by ${h.date(2)}.

## Risks

- Lumen renewal ($500K) at risk over assay turnaround: 19 days against 10 contracted.
- Aster Cloud compute agreement stuck in legal; the 40% compute credits lapse if it is not signed by ${h.date(18)}.

## Ask

Protect fundraising time: at least 25% of my calendar goes to the raise until the lead is named.
`);
}

function apiSpec(h: FixtureHelpers): Buffer {
  return text(`# CardioPredict API — product spec v2

Owner: ${h.name("daniel")} (Head of Product) · Model owner: ${h.name("tom")}

## Overview

The CardioPredict API returns a cardiac-risk prediction for a compound from its structure and in-vitro assay data, trained on the CytoHub Human Heart Dataset.

## Endpoints

- \`POST /v2/predictions\` — submit a compound; returns a prediction id.
- \`GET /v2/predictions/{id}\` — risk score, confidence interval and the nearest reference compounds.
- \`GET /v2/models\` — model versions and validation metrics (current: AUC 0.88 on the hold-out set).

## Service levels

- Uptime commitment: 99.9% monthly.
- Rate limit: 60 requests per minute per customer.

## Pricing

- List price: $1,200 per compound.
- Volume tier: $900 per compound above 1,000 compounds a year.

## Launch

- GA target: ${h.date(45)}, subject to the launch-scope decision.
- Design-partner release can start as soon as the decision is made.

## Open questions

- Do we expose model confidence to customers before AUC reaches 0.90?
- Data retention for customer compound structures (default 90 days).
`);
}

function handbookExcerpt(): Buffer {
  return text(`CytoHub Employee Handbook — Time off and expenses (excerpt)

Time off
Employees accrue 25 days of paid time off per year. Requests longer than five consecutive days need two weeks' notice and manager approval in the HR system.

Expenses
Submit receipts within 30 days. Expenses above $5,000 require CFO approval; spend above $100,000 requires CEO approval.
Travel: economy class for flights under six hours; book through the company travel tool.

Questions go to the People team.
`);
}

// ─── Catalog ────────────────────────────────────────────────────────────────

const DRIVE = "https://drive.example.com/cytohub";

export const DOCUMENT_FIXTURES: DocumentFixture[] = [
  {
    key: "series-b-deck",
    title: "CytoHub Series B Investor Deck v7.pptx",
    folder: "/CytoHub/Fundraising/Series B",
    url: `${DRIVE}/series-b-deck-v7`,
    mimeType: MIME.pptx,
    author: (h) => h.name("jonas"),
    versions: [
      { at: -26, build: (h) => investorDeck(h, 1) },
      { at: 6, build: (h) => investorDeck(h, 2) },
    ],
  },
  {
    key: "financial-model",
    title: "CytoHub Financial Model FY26–FY28.xlsx",
    folder: "/CytoHub/Finance",
    url: `${DRIVE}/financial-model-v12`,
    mimeType: MIME.xlsx,
    author: (h) => h.name("jonas"),
    versions: [
      { at: -13, build: (h) => financialModel(h, 12) },
      { at: 30, build: (h) => financialModel(h, 13) },
    ],
  },
  {
    key: "brightwater-msa",
    title: "Brightwater MSA v5 (redlined).docx",
    folder: "/CytoHub/Legal/Customers/Brightwater",
    url: `${DRIVE}/brightwater-msa-v5`,
    mimeType: MIME.docx,
    author: (h) => h.name("marcus"),
    versions: [{ at: -14, build: brightwaterMsa }],
  },
  {
    key: "calder-proposal",
    title: "Calder Biosciences — Paid Validation Study Proposal.docx",
    folder: "/CytoHub/Sales/Calder",
    url: `${DRIVE}/calder-validation-study-proposal`,
    mimeType: MIME.docx,
    author: (h) => h.name("priya"),
    versions: [{ at: -74, build: calderProposal }],
  },
  {
    key: "halvorsen-nda",
    title: "Mutual NDA — Halvorsen Capital.docx",
    folder: "/CytoHub/Legal/NDAs",
    url: `${DRIVE}/nda-halvorsen-capital`,
    mimeType: MIME.docx,
    author: (h) => h.name("marcus"),
    versions: [{ at: 20, build: halvorsenNda }],
  },
  {
    key: "board-preread",
    title: "Q4 Board Pre-read — Series B and Runway.pdf",
    folder: "/CytoHub/Board/Q4",
    url: `${DRIVE}/board-q4-preread`,
    mimeType: MIME.pdf,
    author: (h) => h.name("jonas"),
    versions: [{ at: -1, build: boardPreRead }],
  },
  {
    key: "cardiopredict-validation",
    title: "CardioPredict v2 Validation Report (draft).pdf",
    folder: "/CytoHub/AI/CardioPredict",
    url: `${DRIVE}/cardiopredict-v2-validation`,
    mimeType: MIME.pdf,
    author: (h) => h.name("tom"),
    versions: [{ at: -20, build: validationReport }],
  },
  {
    key: "heartready-plan",
    title: "HeartReady IND-enabling Plan.md",
    folder: "/CytoHub/HeartReady",
    url: `${DRIVE}/heartready-ind-plan`,
    mimeType: MIME.md,
    author: (h) => h.name("lea"),
    versions: [{ at: -5 * 24, build: heartReadyPlan }],
  },
  {
    key: "ephys-dataset",
    title: "Electrophysiology Dataset Summary Q3.csv",
    folder: "/CytoHub/Science/Dataset",
    url: `${DRIVE}/ephys-dataset-summary-q3`,
    mimeType: MIME.csv,
    author: (h) => h.name("maya"),
    versions: [{ at: -4 * 24, build: ephysDataset }],
  },
  {
    key: "q4-operating-memo",
    title: "Q4 Operating Memo.md",
    folder: "/CytoHub/Leadership",
    url: `${DRIVE}/q4-operating-memo`,
    mimeType: MIME.md,
    author: (h) => h.w.ceo.name,
    versions: [{ at: -2 * 24, build: operatingMemo }],
  },
  {
    key: "lumen-recovery",
    title: "Lumen Biologics — Assay Turnaround Recovery Plan.docx",
    folder: "/CytoHub/Customers/Lumen",
    url: `${DRIVE}/lumen-recovery-plan`,
    mimeType: MIME.docx,
    author: (h) => h.name("daniel"),
    versions: [{ at: 4, build: lumenRecoveryPlan }],
  },
  {
    key: "handbook-excerpt",
    title: "Employee Handbook — Time Off and Expenses (excerpt).txt",
    folder: "/CytoHub/People/Policies",
    url: `${DRIVE}/handbook-time-off-expenses`,
    mimeType: MIME.txt,
    author: (h) => h.name("sofia"),
    versions: [{ at: -30 * 24, build: handbookExcerpt }],
  },
  {
    key: "cardiopredict-api-spec",
    title: "CardioPredict API — Product Spec v2.md",
    folder: "/CytoHub/Product",
    url: `${DRIVE}/cardiopredict-api-spec`,
    mimeType: MIME.md,
    author: (h) => h.name("daniel"),
    versions: [{ at: -6 * 24, build: apiSpec }],
  },
  {
    key: "whiteboard-photo",
    title: "Whiteboard — Series B narrative brainstorm.png",
    folder: "/CytoHub/Fundraising/Series B",
    url: `${DRIVE}/whiteboard-series-b`,
    mimeType: MIME.png,
    author: (h) => h.name("ben"),
    versions: [{ at: -24, build: () => buildPng(96, 64) }],
  },
];

export const DEMO_DOCUMENT_ID_PREFIX = "demo-doc:";

/** Generated bytes are deterministic per (anchor, version): cache them across syncs. */
const cache = new Map<string, Buffer>();
const CACHE_LIMIT = 128;

function cached(key: string, make: () => Buffer): Buffer {
  let hit = cache.get(key);
  if (!hit) {
    hit = make();
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(key, hit);
  }
  return hit;
}

/** Every version of every demo document, as revealable provider refs. */
export function buildDocumentFixtures(w: DemoWorld): Revealable<NormalizedDocumentRef>[] {
  const h = helpers(w);
  const out: Revealable<NormalizedDocumentRef>[] = [];
  for (const fx of DOCUMENT_FIXTURES) {
    const createdAt = w.clock.hours(fx.versions[0].at - 2);
    fx.versions.forEach((v, i) => {
      const versionKey = `${fx.key}@${i + 1}`;
      const bytes = cached(`${w.clock.anchor.toISOString()}|${w.clock.timezone}|${w.ceo.name}|${versionKey}`, () => v.build(h));
      const modifiedAt = w.clock.hours(v.at);
      const externalId = `${DEMO_DOCUMENT_ID_PREFIX}${fx.key}`;
      out.push({
        key: versionKey,
        externalId,
        revealAt: modifiedAt,
        item: {
          externalId,
          title: fx.title,
          mimeType: fx.mimeType,
          sizeBytes: bytes.length,
          createdAt,
          modifiedAt,
          author: fx.author(h),
          path: `${fx.folder}/${fx.title}`,
          webUrl: fx.url,
          // Like a Drive revision id: changes with every saved version.
          versionTag: `rev-${i + 1}`,
          download: async () => Buffer.from(bytes),
          raw: { id: fx.key, name: fx.title, mimeType: fx.mimeType, version: i + 1, modifiedTime: modifiedAt.toISOString(), size: bytes.length },
        },
      });
    });
  }
  return out;
}
