/**
 * CytoHub sample workspace — fictional companies and people that exercise
 * every part of the command center. Dates are offsets from "today" so the
 * workspace always looks current. Edit freely; nothing here is hardcoded
 * into the application.
 */
import type {
  CompanyType,
  DealStatus,
  DealType,
  DecisionStatus,
  FocusArea,
  GoalStatus,
  GoalType,
  ItemSource,
  MeetingType,
  MetricCategory,
  MetricDirection,
  MetricUnit,
  MilestoneStatus,
  MilestoneType,
  PersonType,
  Priority,
  ResourceType,
  SignalKind,
  TaskStatus,
} from "../src/generated/prisma/enums";

// ─── Strategy ────────────────────────────────────────────────────────────────

export const PILLARS = [
  { key: "revenue", name: "Grow Pharma Revenue", color: "blue", description: "Win and expand pharma customers for cardiac safety and efficacy services and data." },
  { key: "ai", name: "Build CytoHub.AI", color: "orange", description: "Turn the human heart dataset into predictive models pharma relies on." },
  { key: "dataset", name: "Build Proprietary Human Heart Dataset", color: "aqua", description: "Scale the multi-modal human donor heart dataset — CytoHub's moat." },
  { key: "partnerships", name: "Expand Strategic Partnerships", color: "yellow", description: "Academic, clinical and compute partners that compound the platform." },
  { key: "fundraising", name: "Execute Fundraising", color: "magenta", description: "Close the Series B on plan and keep investors close." },
  { key: "heartready", name: "Advance HeartReady", color: "green", description: "Move the HeartReady program toward a pre-IND meeting." },
  { key: "team", name: "Build World-Class Team", color: "violet", description: "Hire and grow leaders who can scale CytoHub." },
  { key: "ops", name: "Increase Operational Excellence", color: "red", description: "Reliable delivery, compliance and financial discipline." },
] as const;
export type PillarKey = (typeof PILLARS)[number]["key"];

export const ATTENTION_TARGETS: { area: FocusArea; pct: number; rationale: string }[] = [
  { area: "FUNDRAISING", pct: 26, rationale: "Series B is the company's critical path through December." },
  { area: "REVENUE", pct: 14, rationale: "Brightwater and Aurelius need CEO-level relationships to close." },
  { area: "CUSTOMERS", pct: 10, rationale: "Executive sponsorship of top accounts protects renewals." },
  { area: "PRODUCT", pct: 5, rationale: "Daniel owns product; CEO sets direction at key decisions." },
  { area: "CYTOHUB_AI", pct: 8, rationale: "CardioPredict v2 launch shapes the 2027 story." },
  { area: "SCIENCE", pct: 6, rationale: "Stay close to dataset and HeartReady readouts." },
  { area: "PARTNERSHIPS", pct: 7, rationale: "Two partnerships to sign this year." },
  { area: "TEAM", pct: 7, rationale: "Weekly 1:1s and leadership development." },
  { area: "FINANCE", pct: 3, rationale: "Jonas runs finance; CEO reviews monthly." },
  { area: "OPERATIONS", pct: 3, rationale: "Elena and Ben own operations." },
  { area: "LEGAL", pct: 2, rationale: "Marcus escalates only material terms." },
  { area: "RECRUITING", pct: 5, rationale: "Close VP Sales and Head of Regulatory." },
  { area: "STRATEGY", pct: 3, rationale: "2027 plan and board preparation." },
  { area: "CEO_DEVELOPMENT", pct: 1, rationale: "Coaching and reflection." },
];

// ─── People & companies ──────────────────────────────────────────────────────

export const COMPANIES: { key: string; name: string; type: CompanyType; industry?: string; location?: string; website?: string; description: string; relationship: number; lastActivityDaysAgo?: number }[] = [
  { key: "aurelius", name: "Aurelius Pharma", type: "CUSTOMER", industry: "Big pharma", location: "Basel", website: "https://aurelius.example.com", description: "Top-20 pharma. Uses CytoHub cardiac safety screening across two sites; expansion to three more under discussion.", relationship: 5, lastActivityDaysAgo: 6 },
  { key: "calder", name: "Calder Biosciences", type: "CUSTOMER", industry: "Mid-size biotech", location: "Cambridge, MA", description: "Converted a pilot into a paid validation study.", relationship: 4, lastActivityDaysAgo: 1 },
  { key: "lumen", name: "Lumen Biologics", type: "CUSTOMER", industry: "Biologics", location: "San Diego", description: "Annual contract for assay services; renewal in negotiation and at risk over turnaround times.", relationship: 2, lastActivityDaysAgo: 0 },
  { key: "brightwater", name: "Brightwater Therapeutics", type: "PROSPECT", industry: "Cardiometabolic pharma", location: "New Jersey", description: "Negotiating a 3-year MSA for the cardiac safety platform.", relationship: 4, lastActivityDaysAgo: 0 },
  { key: "ostrava", name: "Ostrava Pharma", type: "PROSPECT", industry: "Generic & specialty pharma", location: "Prague", description: "Scientific evaluation of a cardiotox screening pilot; momentum has stalled.", relationship: 2, lastActivityDaysAgo: 19 },
  { key: "vantage", name: "Vantage Oncology", type: "PROSPECT", industry: "Oncology", location: "Boston", description: "Exploring a cardio-oncology safety program.", relationship: 3, lastActivityDaysAgo: 9 },
  { key: "northbridge", name: "Northbridge Ventures", type: "INVESTOR", industry: "Life-science VC", location: "Boston", description: "Top-tier life-science fund; leading candidate to lead the Series B.", relationship: 4, lastActivityDaysAgo: 1 },
  { key: "helix", name: "Helix Capital Partners", type: "INVESTOR", industry: "Growth equity", location: "New York", description: "Growth investor in diligence for the Series B.", relationship: 3, lastActivityDaysAgo: 2 },
  { key: "fjord", name: "Fjord Life Science Ventures", type: "INVESTOR", industry: "Life-science VC", location: "Oslo", description: "Had a first meeting; follow-up overdue.", relationship: 2, lastActivityDaysAgo: 15 },
  { key: "solstice", name: "Solstice Bio Fund", type: "INVESTOR", industry: "Crossover fund", location: "San Francisco", description: "Intro call held; waiting for their IC offsite.", relationship: 2, lastActivityDaysAgo: 14 },
  { key: "granite", name: "Granite Peak Capital", type: "INVESTOR", industry: "Venture capital", location: "London", description: "Series A lead and board member; committed to full pro-rata.", relationship: 5, lastActivityDaysAgo: 3 },
  { key: "meridian", name: "Meridian Health Ventures", type: "INVESTOR", industry: "Corporate VC", location: "Chicago", description: "Passed on the Series B citing stage.", relationship: 2, lastActivityDaysAgo: 21 },
  { key: "nhi", name: "Nordic Heart Institute", type: "ACADEMIC", industry: "Academic medical center", location: "Copenhagen", description: "Academic cardiac center; data partnership approved in principle.", relationship: 4, lastActivityDaysAgo: 1 },
  { key: "riverside", name: "Riverside University Hospital", type: "ACADEMIC", industry: "Hospital", location: "Philadelphia", description: "Third tissue-sourcing site, going live in two weeks.", relationship: 4, lastActivityDaysAgo: 3 },
  { key: "aster", name: "Aster Cloud", type: "PARTNER", industry: "Cloud compute", location: "Seattle", description: "Compute partnership for model training; contract stuck in legal.", relationship: 3, lastActivityDaysAgo: 0 },
  { key: "cellwave", name: "Cellwave Instruments", type: "VENDOR", industry: "Lab instruments", location: "Munich", description: "Instrument vendor for functional assays.", relationship: 3, lastActivityDaysAgo: 30 },
  { key: "cardiasim", name: "CardiaSim", type: "COMPETITOR", industry: "AI drug safety", location: "London", description: "AI cardiac-safety competitor trained on iPSC data; raised a $60M Series C.", relationship: 1 },
];

export type PersonSeed = {
  key: string;
  name: string;
  title: string;
  type: PersonType;
  company?: string;
  department?: string;
  expertise?: FocusArea[];
  lastContactDaysAgo?: number;
  notes?: string;
};

export const TEAM: PersonSeed[] = [
  { key: "maya", name: "Dr. Maya Lindqvist", title: "Chief Scientific Officer", type: "TEAM", department: "Science", expertise: ["SCIENCE"], lastContactDaysAgo: 0 },
  { key: "jonas", name: "Jonas Weber", title: "Chief Financial Officer", type: "TEAM", department: "Finance", expertise: ["FINANCE", "FUNDRAISING", "LEGAL"], lastContactDaysAgo: 0 },
  { key: "priya", name: "Priya Raman", title: "VP Business Development", type: "TEAM", department: "Commercial", expertise: ["REVENUE", "CUSTOMERS", "PARTNERSHIPS"], lastContactDaysAgo: 0 },
  { key: "tom", name: "Dr. Tom Okafor", title: "Head of AI", type: "TEAM", department: "CytoHub.AI", expertise: ["CYTOHUB_AI"], lastContactDaysAgo: 1 },
  { key: "elena", name: "Elena Costa", title: "Chief Operating Officer", type: "TEAM", department: "Operations", expertise: ["OPERATIONS", "LEGAL", "FINANCE"], lastContactDaysAgo: 1 },
  { key: "daniel", name: "Daniel Kim", title: "Head of Product", type: "TEAM", department: "Product", expertise: ["PRODUCT", "CUSTOMERS"], lastContactDaysAgo: 2 },
  { key: "sofia", name: "Sofia Andersen", title: "Head of People", type: "TEAM", department: "People", expertise: ["RECRUITING", "TEAM"], lastContactDaysAgo: 0 },
  { key: "marcus", name: "Marcus Hale", title: "General Counsel", type: "TEAM", department: "Legal", expertise: ["LEGAL"], lastContactDaysAgo: 2 },
  { key: "lea", name: "Dr. Lea Novak", title: "Director, Translational Programs", type: "TEAM", department: "HeartReady", expertise: ["SCIENCE"], lastContactDaysAgo: 4 },
  { key: "ben", name: "Ben Carter", title: "Executive Assistant to the CEO", type: "TEAM", department: "Office of the CEO", expertise: ["OPERATIONS", "CEO_DEVELOPMENT"], lastContactDaysAgo: 0 },
];

export const EXTERNAL_PEOPLE: PersonSeed[] = [
  { key: "karen", name: "Karen Liu", title: "VP Discovery", type: "CUSTOMER", company: "brightwater", lastContactDaysAgo: 1 },
  { key: "whitfield", name: "Dr. James Whitfield", title: "Head of Safety Pharmacology", type: "CUSTOMER", company: "aurelius", lastContactDaysAgo: 6 },
  { key: "henrik", name: "Dr. Henrik Sørensen", title: "Chief Scientific Officer", type: "CUSTOMER", company: "calder", lastContactDaysAgo: 1 },
  { key: "rachel", name: "Rachel Moore", title: "Director of Toxicology", type: "CUSTOMER", company: "lumen", lastContactDaysAgo: 0 },
  { key: "paul", name: "Paul Adeyemi", title: "Director, External Innovation", type: "CUSTOMER", company: "ostrava", lastContactDaysAgo: 19 },
  { key: "nina", name: "Dr. Nina Patel", title: "VP Translational Science", type: "CUSTOMER", company: "vantage", lastContactDaysAgo: 9 },
  { key: "sarah", name: "Sarah Chen", title: "Partner", type: "INVESTOR", company: "northbridge", lastContactDaysAgo: 1, notes: "Champions the human-data thesis internally. Wants cohort retention and dataset defensibility." },
  { key: "david", name: "David Morel", title: "Principal", type: "INVESTOR", company: "helix", lastContactDaysAgo: 2 },
  { key: "anna", name: "Anna Berg", title: "Partner", type: "INVESTOR", company: "fjord", lastContactDaysAgo: 12, notes: "Positive first meeting; asked for the HeartReady plan." },
  { key: "olivia", name: "Olivia Hart", title: "Partner", type: "INVESTOR", company: "solstice", lastContactDaysAgo: 15 },
  { key: "michael", name: "Michael Grant", title: "Managing Partner · Board member", type: "BOARD", company: "granite", lastContactDaysAgo: 3 },
  { key: "catherine", name: "Dr. Catherine Duval", title: "Independent board member", type: "BOARD", lastContactDaysAgo: 9 },
  { key: "ingrid", name: "Prof. Ingrid Holm", title: "Director", type: "PARTNER", company: "nhi", lastContactDaysAgo: 1 },
  { key: "samuel", name: "Dr. Samuel Reyes", title: "Chief of Cardiac Surgery", type: "PARTNER", company: "riverside", lastContactDaysAgo: 3 },
  { key: "alex", name: "Alex Rivera", title: "Head of Life Sciences Partnerships", type: "PARTNER", company: "aster", lastContactDaysAgo: 1 },
  { key: "laura", name: "Laura Mitchell", title: "VP Sales candidate", type: "CANDIDATE", lastContactDaysAgo: 2, notes: "Built cardiac-safety sales at a CRO from $3M to $25M." },
  { key: "ahmed", name: "Dr. Ahmed Farouk", title: "Head of Regulatory candidate", type: "CANDIDATE", lastContactDaysAgo: 8 },
];

// ─── Goals ───────────────────────────────────────────────────────────────────

export type GoalSeed = {
  key: string;
  title: string;
  description: string;
  type: GoalType;
  pillar: PillarKey;
  owner: string; // person key or "ceo"
  progress: number;
  status: GoalStatus;
  confidence: number;
  start?: number | "yearStart" | "quarterStart";
  target?: number | "yearEnd" | "quarterEnd";
  period?: "year" | "quarter" | "prevQuarter";
  parent?: string;
  department?: string;
  risks?: string;
  notes?: string;
  completedDaysAgo?: number;
};

export const GOALS: GoalSeed[] = [
  { key: "arr", title: "Reach $6M ARR by year-end", type: "ANNUAL", pillar: "revenue", owner: "priya", progress: 62, status: "AT_RISK", confidence: 55, start: "yearStart", target: "yearEnd", period: "year", description: "Grow recurring pharma revenue through new MSAs and expansion of existing accounts.", risks: "Brightwater MSA timing; VP Sales seat vacant since May; Lumen renewal at risk." },
  { key: "seriesB", title: "Close a $40M Series B", type: "COMPANY", pillar: "fundraising", owner: "ceo", progress: 38, status: "AT_RISK", confidence: 60, start: -45, target: 70, period: "year", description: "Raise a $40M Series B led by a top-tier life-science investor to fund dataset scale-up, CytoHub.AI v2 and HeartReady IND-enabling work.", risks: "No lead committed yet; CEO time on the raise is below plan; board expects a named lead by mid-November." },
  { key: "ai", title: "Launch CardioPredict v2 on CytoHub.AI", type: "ANNUAL", pillar: "ai", owner: "tom", progress: 64, status: "ON_TRACK", confidence: 70, start: "yearStart", target: "yearEnd", period: "year", description: "Ship the second-generation cardiac safety model, trained on the expanded human heart dataset, to every pharma customer.", risks: "Hold-out AUC 0.88 vs 0.90 target." },
  { key: "dataset", title: "Grow the Human Heart Dataset to 500 donor hearts", type: "ANNUAL", pillar: "dataset", owner: "maya", progress: 82, status: "ON_TRACK", confidence: 80, start: "yearStart", target: "yearEnd", period: "year", description: "Profile 500 human donor hearts with functional, transcriptomic and imaging data — the proprietary moat behind CytoHub.AI." },
  { key: "partners", title: "Sign two strategic partnerships", type: "ANNUAL", pillar: "partnerships", owner: "ceo", progress: 50, status: "AT_RISK", confidence: 55, start: "yearStart", target: "yearEnd", period: "year", description: "An academic cardiac data partnership and a compute partnership to scale model training.", risks: "Aster Cloud agreement stuck in legal review past its date." },
  { key: "heartready", title: "Complete HeartReady preclinical validation", type: "ANNUAL", pillar: "heartready", owner: "lea", progress: 46, status: "ON_TRACK", confidence: 68, start: "yearStart", target: 110, period: "year", description: "Generate the preclinical efficacy and safety package needed to request a pre-IND meeting." },
  { key: "team", title: "Hire six key leaders", type: "ANNUAL", pillar: "team", owner: "sofia", progress: 50, status: "OFF_TRACK", confidence: 40, start: "yearStart", target: "yearEnd", period: "year", description: "VP Sales, Head of Regulatory, Head of Data Engineering, Director of Customer Success, Head of Marketing, Controller.", risks: "VP Sales search running five months over plan; offer pending." },
  { key: "ops", title: "SOC 2 Type II and a five-day monthly close", type: "ANNUAL", pillar: "ops", owner: "elena", progress: 72, status: "ON_TRACK", confidence: 75, start: "yearStart", target: "yearEnd", period: "year", description: "Enterprise-grade compliance for pharma customers and faster financial reporting." },
  { key: "q4Brightwater", title: "Sign the Brightwater Therapeutics MSA", type: "QUARTERLY", parent: "arr", pillar: "revenue", owner: "priya", progress: 70, status: "AT_RISK", confidence: 60, start: "quarterStart", target: 25, period: "quarter", description: "Three-year master services agreement for the cardiac safety platform.", risks: "Data-rights clause 7.3 unresolved." },
  { key: "q4TermSheet", title: "Secure a Series B lead term sheet", type: "QUARTERLY", parent: "seriesB", pillar: "fundraising", owner: "ceo", progress: 35, status: "AT_RISK", confidence: 60, start: "quarterStart", target: 45, period: "quarter", description: "A signed term sheet from a lead investor." },
  { key: "q4CardioGA", title: "CardioPredict v2 general availability", type: "QUARTERLY", parent: "ai", pillar: "ai", owner: "tom", progress: 60, status: "ON_TRACK", confidence: 68, start: "quarterStart", target: 45, period: "quarter", description: "GA release with validation report and pricing." },
  { key: "q4Sites", title: "Onboard three new hospital tissue sites", type: "QUARTERLY", parent: "dataset", pillar: "dataset", owner: "maya", progress: 67, status: "ON_TRACK", confidence: 80, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "Expand donor heart sourcing capacity for 2027." },
  { key: "q4VPSales", title: "Hire a VP Sales", type: "QUARTERLY", parent: "team", pillar: "team", owner: "sofia", progress: 85, status: "AT_RISK", confidence: 65, start: "quarterStart", target: 10, period: "quarter", description: "Close the most critical open seat on the leadership team." },
  { key: "q4SOC2", title: "Complete the SOC 2 Type II observation window", type: "QUARTERLY", parent: "ops", pillar: "ops", owner: "elena", progress: 80, status: "ON_TRACK", confidence: 80, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "Close the observation window with no exceptions." },
  { key: "ceoFundraiseTime", title: "Spend at least 25% of my time on the raise until close", type: "CEO", pillar: "fundraising", owner: "ceo", progress: 45, status: "AT_RISK", confidence: 50, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "Protect fundraising time: investor meetings, narrative, data room. Measured from calendar allocation." },
  { key: "ceoOneOnOnes", title: "Weekly 1:1s with every direct report", type: "CEO", pillar: "team", owner: "ceo", progress: 85, status: "ON_TRACK", confidence: 85, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "Consistent coaching and early warning on execution." },
  { key: "ceoPharmaCSOs", title: "Build relationships with three top-20 pharma CSOs", type: "CEO", pillar: "revenue", owner: "ceo", progress: 33, status: "ON_TRACK", confidence: 65, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "CEO-level sponsorship for the 2027 enterprise pipeline." },
  { key: "deptPaper", title: "Publish the human heart dataset validation paper", type: "DEPARTMENT", department: "Science", pillar: "dataset", owner: "maya", progress: 70, status: "ON_TRACK", confidence: 75, start: "yearStart", target: 40, period: "year", description: "Peer-reviewed validation of the dataset's predictive value." },
  { key: "deptRunway", title: "Extend runway to 24 months through the raise", type: "DEPARTMENT", department: "Finance", pillar: "fundraising", owner: "jonas", progress: 40, status: "AT_RISK", confidence: 55, start: "quarterStart", target: 85, period: "quarter", description: "Close the Series B and hold burn to plan." },
  { key: "deptOnboarding", title: "Cut customer onboarding time to two weeks", type: "DEPARTMENT", department: "Product", pillar: "revenue", owner: "daniel", progress: 55, status: "ON_TRACK", confidence: 70, start: "quarterStart", target: "quarterEnd", period: "quarter", description: "From five weeks today to two." },
  { key: "q3Aurelius", title: "Close the Aurelius Pharma expansion", type: "QUARTERLY", parent: "arr", pillar: "revenue", owner: "priya", progress: 100, status: "COMPLETED", confidence: 100, start: -100, target: -8, period: "prevQuarter", description: "Expand Aurelius from one to two sites.", completedDaysAgo: 28 },
  { key: "japan", title: "Evaluate Japan market entry", type: "ANNUAL", pillar: "partnerships", owner: "priya", progress: 15, status: "PAUSED", confidence: 50, start: "yearStart", target: "yearEnd", period: "year", description: "Assess a distribution partnership in Japan.", notes: "Paused until after the Series B." },
];

// ─── Milestones ──────────────────────────────────────────────────────────────

export type MilestoneSeed = {
  key: string;
  title: string;
  type: MilestoneType;
  goal: string;
  owner: string;
  due: number;
  status: MilestoneStatus;
  progress: number;
  completedHoursAgo?: number;
  blocker?: string;
  successMetric?: string;
  description?: string;
};

export const MILESTONES: MilestoneSeed[] = [
  { key: "msArr4", title: "ARR crosses $4M", type: "ARR", goal: "arr", owner: "priya", due: -12, status: "COMPLETED", progress: 100, completedHoursAgo: 9 * 24 },
  { key: "msArr5", title: "ARR reaches $5M", type: "ARR", goal: "arr", owner: "priya", due: 56, status: "IN_PROGRESS", progress: 55, successMetric: "$5.0M contracted ARR" },
  { key: "msBrightwater", title: "Brightwater MSA signed", type: "PHARMA_CONTRACT", goal: "q4Brightwater", owner: "priya", due: 18, status: "AT_RISK", progress: 70, blocker: "Data-rights clause 7.3 (derivative models) unresolved between legal teams.", successMetric: "Signed MSA ≥ $1.4M over three years" },
  { key: "msCalder", title: "Calder pilot converts to a paid study", type: "PHARMA_CONTRACT", goal: "arr", owner: "priya", due: 3, status: "COMPLETED", progress: 100, completedHoursAgo: 20 },
  { key: "msDataRoom", title: "Series B data room complete", type: "FUNDRAISING", goal: "q4TermSheet", owner: "jonas", due: 5, status: "IN_PROGRESS", progress: 75 },
  { key: "msTermSheet", title: "Lead investor term sheet signed", type: "FUNDRAISING", goal: "q4TermSheet", owner: "ceo", due: 40, status: "PLANNED", progress: 20 },
  { key: "msFirstClose", title: "Series B first close", type: "FUNDRAISING", goal: "seriesB", owner: "jonas", due: 85, status: "PLANNED", progress: 0 },
  { key: "msAuc", title: "CardioPredict v2 validation (AUC ≥ 0.90)", type: "AI_MODEL", goal: "q4CardioGA", owner: "tom", due: 9, status: "AT_RISK", progress: 80, blocker: "Hold-out AUC at 0.88; retraining on 60 new donor hearts required.", successMetric: "Hold-out AUC ≥ 0.90 on 200+ compounds" },
  { key: "msBeta", title: "CardioPredict v2 beta with three design partners", type: "PRODUCT_RELEASE", goal: "ai", owner: "tom", due: -25, status: "COMPLETED", progress: 100, completedHoursAgo: 27 * 24 },
  { key: "msGA", title: "CardioPredict v2 GA release", type: "PRODUCT_RELEASE", goal: "q4CardioGA", owner: "daniel", due: 45, status: "PLANNED", progress: 30 },
  { key: "ms400", title: "400 donor hearts profiled", type: "SCIENTIFIC_VALIDATION", goal: "dataset", owner: "maya", due: -20, status: "COMPLETED", progress: 100, completedHoursAgo: 22 * 24 },
  { key: "ms500", title: "500 donor hearts profiled", type: "SCIENTIFIC_VALIDATION", goal: "dataset", owner: "maya", due: 70, status: "IN_PROGRESS", progress: 82 },
  { key: "msSite3", title: "Third hospital tissue site live", type: "PARTNERSHIP", goal: "q4Sites", owner: "maya", due: 14, status: "IN_PROGRESS", progress: 60 },
  { key: "msPaper", title: "Dataset validation paper submitted", type: "PUBLICATION", goal: "deptPaper", owner: "maya", due: 25, status: "IN_PROGRESS", progress: 70 },
  { key: "msHRReadout", title: "HeartReady preclinical efficacy readout", type: "THERAPEUTIC", goal: "heartready", owner: "lea", due: 32, status: "IN_PROGRESS", progress: 55 },
  { key: "msPreIND", title: "HeartReady pre-IND meeting request filed", type: "REGULATORY", goal: "heartready", owner: "lea", due: 100, status: "PLANNED", progress: 10 },
  { key: "msNHI", title: "Nordic Heart Institute data partnership signed", type: "PARTNERSHIP", goal: "partners", owner: "ceo", due: 12, status: "IN_PROGRESS", progress: 65 },
  { key: "msAster", title: "Aster Cloud compute partnership signed", type: "PARTNERSHIP", goal: "partners", owner: "elena", due: -4, status: "BLOCKED", progress: 50, blocker: "Liability cap and data-residency terms stuck in legal review." },
  { key: "msVPSales", title: "VP Sales hired", type: "HIRING", goal: "q4VPSales", owner: "sofia", due: -8, status: "AT_RISK", progress: 85, blocker: "Offer awaiting CEO approval; candidate holds a competing offer." },
  { key: "msRegHead", title: "Head of Regulatory hired", type: "HIRING", goal: "team", owner: "sofia", due: 40, status: "IN_PROGRESS", progress: 40 },
  { key: "msSOC2", title: "SOC 2 Type II report issued", type: "OTHER", goal: "q4SOC2", owner: "elena", due: 60, status: "IN_PROGRESS", progress: 70 },
];

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Impact ratings 0–5: strategic, revenue, fundraising, customer, scientific, risk, CEO uniqueness, opportunity cost. */
export type Impact = [s: number, r: number, f: number, c: number, sci: number, risk: number, u: number, opp: number];

export type TaskSeed = {
  key: string;
  title: string;
  description?: string;
  focus: FocusArea;
  priority?: Priority;
  status?: TaskStatus;
  due?: number | null;
  owner?: string; // default "ceo"
  goal?: string;
  ms?: string;
  pillar?: PillarKey;
  company?: string;
  people?: string[];
  decision?: string;
  impact: Impact;
  hard?: boolean;
  est?: number;
  act?: number;
  blocker?: string;
  source?: ItemSource;
  tags?: string[];
  createdDaysAgo?: number;
  completedDaysAgo?: number;
  postponed?: number;
  originalDue?: number;
  dependsOn?: string[];
  notes?: string;
  delegation?: { delegatedDaysAgo: number; due?: number; lastUpdateDaysAgo?: number; note?: string; expectations?: string; status?: "ACTIVE" | "NEEDS_FOLLOW_UP" | "COMPLETED" };
};

export const OPEN_CEO_TASKS: TaskSeed[] = [
  { key: "tDeck", title: "Finalize Series B narrative and deck v7", description: "Incorporate Northbridge feedback: dataset defensibility, cohort retention and the path to $20M ARR.", focus: "FUNDRAISING", priority: "P0", status: "IN_PROGRESS", due: 1, hard: true, goal: "seriesB", ms: "msDataRoom", company: "northbridge", people: ["sarah", "jonas"], impact: [5, 2, 5, 1, 1, 4, 5, 4], est: 180, createdDaysAgo: 6, tags: ["series-b", "narrative"] },
  { key: "tBrightwater", title: "Resolve Brightwater data-rights clause with Karen Liu", description: "Clause 7.3: Brightwater wants rights to derivative models trained on their compounds. Align on a field-limited license before tomorrow's negotiation.", focus: "REVENUE", priority: "P0", due: 1, hard: true, goal: "q4Brightwater", ms: "msBrightwater", company: "brightwater", people: ["karen", "priya", "marcus"], decision: "dDataRights", impact: [5, 5, 3, 4, 1, 5, 4, 4], est: 90, createdDaysAgo: 3, source: "EMAIL", tags: ["msa", "legal"] },
  { key: "tCardioDecision", title: "Decide CardioPredict v2 launch scope", description: "Go/no-go: launch at AUC 0.88 with design partners, or delay GA six weeks for 0.90.", focus: "CYTOHUB_AI", priority: "P1", due: 3, goal: "q4CardioGA", ms: "msAuc", people: ["tom", "daniel"], decision: "dCardio", impact: [5, 4, 3, 4, 3, 4, 5, 3], est: 60, createdDaysAgo: 2, source: "MEETING" },
  { key: "tNorthbridgeRehearsal", title: "Rehearse Northbridge partner pitch with Jonas", description: "Full run-through with Q&A on retention, moat and use of funds.", focus: "FUNDRAISING", priority: "P1", due: 1, goal: "seriesB", company: "northbridge", people: ["jonas"], impact: [5, 1, 5, 1, 1, 3, 5, 4], est: 90, createdDaysAgo: 1 },
  { key: "tAureliusCall", title: "Call Aurelius CSO about the three-site expansion", description: "Executive sponsorship for the $900K expansion proposal Priya sent.", focus: "CUSTOMERS", priority: "P1", due: 0, goal: "arr", company: "aurelius", people: ["whitfield", "priya"], impact: [4, 4, 2, 4, 1, 2, 4, 3], est: 30, createdDaysAgo: 4 },
  { key: "tVPOffer", title: "Approve VP Sales offer for Laura Mitchell", description: "Base $240K, OTE $310K, 1.1% equity. Candidate needs an answer by Wednesday.", focus: "RECRUITING", priority: "P0", due: 1, hard: true, goal: "q4VPSales", ms: "msVPSales", people: ["laura", "sofia"], decision: "dVPSales", impact: [4, 4, 2, 1, 0, 4, 5, 4], est: 30, createdDaysAgo: 2 },
  { key: "tLumen", title: "Call Rachel Moore (Lumen) with a turnaround recovery plan", description: "Dedicated assay capacity, weekly SLA reporting, Daniel as single owner.", focus: "CUSTOMERS", priority: "P0", due: 0, hard: true, goal: "arr", company: "lumen", people: ["rachel", "daniel"], impact: [3, 4, 1, 5, 1, 5, 4, 3], est: 45, createdDaysAgo: 1 },
  { key: "tBoardDeck", title: "Review Q4 board deck draft", focus: "STRATEGY", priority: "P1", due: 6, people: ["jonas", "michael"], impact: [4, 2, 3, 1, 1, 3, 4, 2], est: 90, createdDaysAgo: 5 },
  { key: "tBioTravel", title: "Book travel and hotel for BIO-Europe", focus: "OPERATIONS", priority: "P3", due: 5, impact: [1, 1, 0, 0, 0, 1, 1, 1], est: 30, createdDaysAgo: 7 },
  { key: "tCrmNotes", title: "Update investor CRM notes after the Helix call", focus: "FUNDRAISING", priority: "P2", due: 1, company: "helix", impact: [2, 0, 2, 0, 0, 1, 2, 1], est: 20, createdDaysAgo: 2 },
  { key: "tSoc2Questionnaire", title: "Review SOC 2 vendor security questionnaire", focus: "OPERATIONS", priority: "P2", due: 3, goal: "ops", impact: [2, 1, 0, 1, 0, 2, 1, 1], est: 60, createdDaysAgo: 6 },
  { key: "tNhiSign", title: "Sign the Nordic Heart Institute term sheet", focus: "PARTNERSHIPS", priority: "P1", status: "BLOCKED", due: 5, hard: true, goal: "partners", ms: "msNHI", company: "nhi", people: ["ingrid", "marcus"], impact: [5, 2, 3, 1, 4, 3, 5, 4], est: 45, blocker: "Waiting on legal review of IP and publication clauses (Marcus).", createdDaysAgo: 5, dependsOn: ["tNhiLegal"] },
  { key: "tFjordFollow", title: "Follow up with Anna Berg (Fjord) after the first meeting", description: "Send the HeartReady plan she asked for and propose a partner meeting.", focus: "FUNDRAISING", priority: "P1", due: -2, goal: "seriesB", company: "fjord", people: ["anna"], impact: [3, 0, 4, 0, 0, 2, 4, 3], est: 20, createdDaysAgo: 12, postponed: 3, originalDue: -9 },
  { key: "tHeartReadyMemo", title: "Draft HeartReady pre-IND strategy memo with Lea", focus: "SCIENCE", priority: "P2", due: 12, goal: "heartready", ms: "msPreIND", people: ["lea"], impact: [4, 0, 2, 0, 5, 2, 4, 2], est: 120, createdDaysAgo: 10 },
  { key: "tAllHands", title: "Prepare all-hands: Q4 priorities and Series B update", focus: "TEAM", priority: "P1", due: 3, impact: [3, 0, 1, 0, 0, 1, 5, 1], est: 60, createdDaysAgo: 3 },
  { key: "tDanielFeedback", title: "Give Daniel feedback on the onboarding roadmap", focus: "TEAM", priority: "P2", due: 4, goal: "deptOnboarding", people: ["daniel"], impact: [2, 1, 0, 2, 0, 1, 4, 1], est: 30, createdDaysAgo: 6 },
  { key: "tPricing", title: "Review data-licensing pricing proposal", focus: "REVENUE", priority: "P1", status: "WAITING", due: 6, goal: "arr", people: ["priya", "jonas"], decision: "dPricing", impact: [4, 5, 1, 2, 0, 2, 3, 3], est: 60, createdDaysAgo: 8, dependsOn: ["tBenchmark"] },
  { key: "tOptionPool", title: "Finalize option pool refresh proposal for the board", focus: "TEAM", priority: "P2", due: 9, people: ["jonas", "sofia"], impact: [3, 0, 2, 0, 0, 2, 4, 1], est: 60, createdDaysAgo: 9 },
  { key: "tAster", title: "Unblock the Aster Cloud agreement — call Alex Rivera", description: "40% compute credits are on the table if signed by Oct 31.", focus: "PARTNERSHIPS", priority: "P1", due: 0, goal: "partners", ms: "msAster", company: "aster", people: ["alex", "elena"], impact: [4, 1, 2, 0, 2, 3, 3, 4], est: 30, createdDaysAgo: 1 },
  { key: "tExpenses", title: "Submit Q3 expense report", focus: "OPERATIONS", priority: "P3", due: -1, impact: [1, 0, 0, 0, 0, 1, 2, 0], est: 30, createdDaysAgo: 25, postponed: 4, originalDue: -21 },
  { key: "tStrategy2027", title: "Outline the 2027 strategic plan", focus: "STRATEGY", priority: "P2", due: 30, impact: [5, 3, 3, 2, 2, 2, 5, 2], est: 240, createdDaysAgo: 14 },
  { key: "tCoach", title: "Prepare for executive coaching session", focus: "CEO_DEVELOPMENT", priority: "P3", due: 8, impact: [2, 0, 0, 0, 0, 0, 5, 0], est: 30, createdDaysAgo: 7 },
  { key: "tOstrava", title: "Re-engage Ostrava Pharma's head of external innovation", focus: "REVENUE", priority: "P2", due: 2, goal: "arr", company: "ostrava", people: ["paul", "priya"], impact: [3, 3, 0, 2, 0, 2, 3, 3], est: 30, createdDaysAgo: 1, source: "BRAIN" },
  { key: "tVantageDinner", title: "Set up dinner with the Vantage Oncology CSO at BIO-Europe", focus: "REVENUE", priority: "P2", due: 10, goal: "ceoPharmaCSOs", company: "vantage", people: ["nina"], impact: [3, 3, 0, 2, 0, 1, 4, 2], est: 15, createdDaysAgo: 5 },
  { key: "tRunway", title: "Review runway scenarios with Jonas", focus: "FINANCE", priority: "P1", due: 3, goal: "deptRunway", people: ["jonas"], impact: [4, 0, 4, 0, 0, 4, 4, 2], est: 60, createdDaysAgo: 1 },
  { key: "tGraniteWait", title: "Waiting: Granite Peak written pro-rata confirmation", focus: "FUNDRAISING", priority: "P2", status: "WAITING", due: 5, goal: "seriesB", company: "granite", people: ["michael"], impact: [3, 0, 4, 0, 0, 2, 3, 1], est: 10, createdDaysAgo: 4 },
  { key: "tJapan", title: "Explore a Japan distribution partner", focus: "PARTNERSHIPS", priority: "P3", status: "SOMEDAY", due: null, goal: "japan", impact: [3, 2, 0, 1, 0, 1, 3, 1], createdDaysAgo: 40 },
  { key: "tThoughtLeadership", title: "Write a thought-leadership piece on human-relevant cardiac models", focus: "STRATEGY", priority: "P3", status: "SOMEDAY", due: null, impact: [3, 1, 2, 1, 2, 0, 4, 1], createdDaysAgo: 30 },
  { key: "tBostonSite", title: "Evaluate a second lab site in Boston", focus: "OPERATIONS", priority: "P3", status: "SOMEDAY", due: null, decision: "dLabSite", impact: [3, 1, 1, 1, 2, 1, 3, 1], createdDaysAgo: 14 },
];

export const DELEGATED_TASKS: TaskSeed[] = [
  { key: "tDataroomFin", title: "Prepare the data room financial section", focus: "FUNDRAISING", priority: "P0", owner: "jonas", due: 3, goal: "q4TermSheet", ms: "msDataRoom", impact: [4, 0, 5, 0, 0, 3, 2, 3], est: 480, createdDaysAgo: 8, delegation: { delegatedDaysAgo: 8, due: 3, lastUpdateDaysAgo: 1, note: "Model v12 uploaded; cap table pending from counsel.", expectations: "Three-statement model, cohort revenue, cap table, use of funds." } },
  { key: "tRefs", title: "Collect three customer references for investors", focus: "FUNDRAISING", priority: "P1", owner: "priya", due: -1, goal: "seriesB", impact: [3, 1, 4, 2, 0, 2, 2, 2], est: 120, createdDaysAgo: 10, delegation: { delegatedDaysAgo: 10, due: -1, lastUpdateDaysAgo: 6, note: "Aurelius agreed; asking Calder and Lumen.", expectations: "Three referenceable pharma customers briefed before Northbridge diligence." } },
  { key: "tPress", title: "Draft the CardioPredict v2 launch press release", focus: "PRODUCT", priority: "P2", owner: "daniel", due: 20, goal: "q4CardioGA", ms: "msGA", impact: [2, 2, 1, 1, 0, 1, 2, 1], est: 120, createdDaysAgo: 4, delegation: { delegatedDaysAgo: 4, due: 20, lastUpdateDaysAgo: 1, note: "Outline approved by Tom; waiting on the launch-scope decision." } },
  { key: "tBenchmark", title: "Benchmark competitor cardiac-safety pricing", focus: "REVENUE", priority: "P1", owner: "priya", due: 5, decision: "dPricing", impact: [3, 4, 0, 1, 0, 1, 2, 2], est: 180, createdDaysAgo: 12, delegation: { delegatedDaysAgo: 12, due: 5, lastUpdateDaysAgo: 8, note: "Two of five competitors priced." } },
  { key: "tBioMeetings", title: "Schedule BIO-Europe partnering meetings", focus: "PARTNERSHIPS", priority: "P2", owner: "ben", due: 7, impact: [2, 2, 1, 1, 0, 1, 1, 2], est: 120, createdDaysAgo: 6, delegation: { delegatedDaysAgo: 6, due: 7, lastUpdateDaysAgo: 1, note: "11 meetings confirmed, 4 pending." } },
  { key: "tNhiLegal", title: "Complete legal review of the NHI term sheet", focus: "LEGAL", priority: "P1", owner: "marcus", due: 2, goal: "partners", ms: "msNHI", company: "nhi", impact: [4, 0, 1, 0, 3, 3, 2, 3], est: 180, createdDaysAgo: 5, delegation: { delegatedDaysAgo: 5, due: 2, lastUpdateDaysAgo: 2, note: "IP clause acceptable; publication embargo needs one more turn." } },
  { key: "tSiteOnboarding", title: "Compile the Riverside University Hospital onboarding plan", focus: "SCIENCE", priority: "P1", owner: "maya", status: "DONE", due: -2, goal: "q4Sites", ms: "msSite3", impact: [4, 0, 1, 0, 4, 2, 2, 2], est: 240, act: 260, createdDaysAgo: 12, completedDaysAgo: 3, delegation: { delegatedDaysAgo: 12, due: -2, lastUpdateDaysAgo: 3, note: "Plan complete; first 12 hearts expected in November.", status: "COMPLETED" } },
  { key: "tVPRefs", title: "Run reference checks on Laura Mitchell", focus: "RECRUITING", priority: "P1", owner: "sofia", status: "DONE", due: -1, goal: "q4VPSales", ms: "msVPSales", impact: [3, 2, 0, 0, 0, 3, 2, 2], est: 120, act: 140, createdDaysAgo: 6, completedDaysAgo: 1, delegation: { delegatedDaysAgo: 6, due: -1, lastUpdateDaysAgo: 1, note: "Four strong references; one flag on management style addressed.", status: "COMPLETED" } },
];

export const TEAM_TASKS: TaskSeed[] = [
  { key: "tRetrain", title: "Retrain CardioPredict on 60 new donor hearts", focus: "CYTOHUB_AI", priority: "P0", owner: "tom", status: "IN_PROGRESS", due: 7, ms: "msAuc", goal: "q4CardioGA", impact: [5, 3, 2, 3, 4, 4, 1, 4], est: 2400, createdDaysAgo: 10 },
  { key: "tValReport", title: "Write the v2 validation report for design partners", focus: "CYTOHUB_AI", priority: "P1", owner: "tom", due: 12, ms: "msGA", goal: "q4CardioGA", impact: [4, 3, 2, 3, 3, 2, 1, 2], est: 600, createdDaysAgo: 5 },
  { key: "tProfile40", title: "Profile 40 donor hearts from Riverside", focus: "SCIENCE", priority: "P1", owner: "maya", status: "IN_PROGRESS", due: 20, ms: "ms500", goal: "dataset", impact: [5, 1, 2, 0, 5, 2, 1, 3], est: 4800, createdDaysAgo: 15 },
  { key: "tManuscript", title: "Submit the manuscript to Nature Biotechnology", focus: "SCIENCE", priority: "P1", owner: "maya", due: 25, ms: "msPaper", goal: "deptPaper", impact: [4, 1, 3, 1, 5, 1, 1, 2], est: 600, createdDaysAgo: 20 },
  { key: "tDose4", title: "Complete dose-response study #4", focus: "SCIENCE", priority: "P1", owner: "lea", status: "IN_PROGRESS", due: 18, ms: "msHRReadout", goal: "heartready", impact: [4, 0, 2, 0, 5, 3, 1, 2], est: 3000, createdDaysAgo: 21 },
  { key: "tSoc2Evidence", title: "Collect SOC 2 evidence for Q4 controls", focus: "OPERATIONS", priority: "P2", owner: "elena", status: "IN_PROGRESS", due: 30, ms: "msSOC2", goal: "q4SOC2", impact: [3, 2, 0, 2, 0, 3, 1, 1], est: 1200, createdDaysAgo: 18 },
  { key: "tAsterCap", title: "Negotiate the Aster Cloud liability cap", focus: "LEGAL", priority: "P1", owner: "elena", status: "BLOCKED", due: -3, ms: "msAster", goal: "partners", company: "aster", impact: [3, 1, 1, 0, 1, 3, 2, 3], est: 240, blocker: "Aster legal has not responded in nine days.", createdDaysAgo: 20 },
  { key: "tRegShortlist", title: "Close the Head of Regulatory shortlist", focus: "RECRUITING", priority: "P2", owner: "sofia", due: 10, ms: "msRegHead", goal: "team", people: ["ahmed"], impact: [3, 0, 1, 0, 2, 2, 1, 2], est: 300, createdDaysAgo: 14 },
  { key: "tAureliusProposal", title: "Prepare the Aurelius expansion proposal v2", focus: "REVENUE", priority: "P1", owner: "priya", status: "IN_PROGRESS", due: 5, goal: "arr", company: "aurelius", impact: [4, 4, 1, 4, 0, 2, 1, 3], est: 300, createdDaysAgo: 9 },
  { key: "tTatDashboard", title: "Ship the assay turnaround dashboard for Lumen", focus: "PRODUCT", priority: "P1", owner: "daniel", due: 6, company: "lumen", goal: "deptOnboarding", impact: [3, 2, 0, 4, 0, 3, 1, 2], est: 600, createdDaysAgo: 3 },
  { key: "tRunwayModel", title: "Build runway scenarios (base, raise slips one quarter)", focus: "FINANCE", priority: "P1", owner: "jonas", status: "IN_PROGRESS", due: 2, goal: "deptRunway", impact: [4, 0, 4, 0, 0, 4, 1, 2], est: 360, createdDaysAgo: 4 },
];

/** CEO work completed over the last eight weeks (task history). */
export const COMPLETED_CEO_TASKS: TaskSeed[] = [
  { key: "hCalderTerms", title: "Negotiated Calder paid-study terms", focus: "REVENUE", completedDaysAgo: 3, impact: [4, 4, 2, 4, 1, 3, 4, 3], est: 60, act: 90, goal: "arr", company: "calder", people: ["henrik"] },
  { key: "hInvestorUpdate", title: "Sent the September investor update", focus: "FUNDRAISING", completedDaysAgo: 5, impact: [3, 0, 3, 0, 0, 1, 4, 1], est: 60, act: 75, goal: "seriesB" },
  { key: "hNhiMeeting", title: "Met Prof. Holm on the NHI collaboration", focus: "PARTNERSHIPS", completedDaysAgo: 5, impact: [4, 1, 2, 0, 4, 2, 5, 3], est: 60, act: 70, goal: "partners", company: "nhi", people: ["ingrid"] },
  { key: "hBrightwaterRedlines", title: "Reviewed Brightwater redlines with legal", focus: "REVENUE", completedDaysAgo: 6, impact: [4, 5, 2, 3, 0, 4, 4, 3], est: 90, act: 120, goal: "q4Brightwater", company: "brightwater", people: ["marcus", "priya"] },
  { key: "hCardiaSimPress", title: "Responded to press inquiry on CardiaSim", focus: "STRATEGY", completedDaysAgo: 2, impact: [2, 0, 1, 0, 0, 2, 4, 1], est: 30, act: 45 },
  { key: "hOneOnOnes1", title: "Weekly 1:1s with direct reports", focus: "TEAM", completedDaysAgo: 1, impact: [3, 0, 0, 0, 0, 1, 5, 1], est: 300, act: 330, goal: "ceoOneOnOnes" },
  { key: "hOneOnOnes2", title: "Weekly 1:1s with direct reports", focus: "TEAM", completedDaysAgo: 8, impact: [3, 0, 0, 0, 0, 1, 5, 1], est: 300, act: 300, goal: "ceoOneOnOnes" },
  { key: "hOneOnOnes3", title: "Weekly 1:1s with direct reports", focus: "TEAM", completedDaysAgo: 15, impact: [3, 0, 0, 0, 0, 1, 5, 1], est: 300, act: 280, goal: "ceoOneOnOnes" },
  { key: "hOneOnOnes4", title: "Weekly 1:1s with direct reports", focus: "TEAM", completedDaysAgo: 22, impact: [3, 0, 0, 0, 0, 1, 5, 1], est: 300, act: 310, goal: "ceoOneOnOnes" },
  { key: "hVPInterviews", title: "Interviewed three VP Sales finalists", focus: "RECRUITING", completedDaysAgo: 9, impact: [4, 3, 1, 0, 0, 3, 5, 3], est: 180, act: 210, goal: "q4VPSales" },
  { key: "hDuval", title: "Board 1:1 with Catherine Duval", focus: "STRATEGY", completedDaysAgo: 9, impact: [3, 0, 2, 0, 0, 1, 5, 1], est: 60, act: 60, people: ["catherine"] },
  { key: "hPaperReview", title: "Reviewed the dataset paper draft", focus: "SCIENCE", completedDaysAgo: 10, impact: [3, 0, 2, 0, 4, 1, 3, 1], est: 90, act: 120, goal: "deptPaper" },
  { key: "hWebsite", title: "Rewrote website messaging", focus: "OPERATIONS", completedDaysAgo: 11, impact: [1, 1, 1, 0, 0, 0, 2, 0], est: 60, act: 360 },
  { key: "hHelixMeeting", title: "Held first meeting with Helix Capital", focus: "FUNDRAISING", completedDaysAgo: 12, impact: [4, 0, 5, 0, 0, 2, 5, 3], est: 60, act: 75, goal: "seriesB", company: "helix", people: ["david"] },
  { key: "hFjordMeeting", title: "Held first meeting with Fjord", focus: "FUNDRAISING", completedDaysAgo: 12, impact: [3, 0, 4, 0, 0, 1, 5, 2], est: 60, act: 60, goal: "seriesB", company: "fjord", people: ["anna"] },
  { key: "hLease", title: "Reviewed office lease renewal", focus: "OPERATIONS", completedDaysAgo: 13, impact: [1, 0, 0, 0, 0, 2, 1, 0], est: 30, act: 180 },
  { key: "hLaunchFaq", title: "Wrote the CardioPredict launch FAQ", focus: "PRODUCT", completedDaysAgo: 14, impact: [2, 2, 1, 2, 1, 1, 2, 1], est: 60, act: 120, goal: "q4CardioGA" },
  { key: "hSolstice", title: "Intro call with Solstice Bio Fund", focus: "FUNDRAISING", completedDaysAgo: 15, impact: [3, 0, 3, 0, 0, 1, 5, 2], est: 45, act: 45, goal: "seriesB", company: "solstice", people: ["olivia"] },
  { key: "hRiverside", title: "Signed the Riverside University Hospital tissue agreement", focus: "PARTNERSHIPS", completedDaysAgo: 16, impact: [5, 1, 2, 0, 5, 2, 5, 4], est: 60, act: 60, goal: "q4Sites", company: "riverside", people: ["samuel"] },
  { key: "hPayroll", title: "Fixed payroll vendor issue", focus: "OPERATIONS", completedDaysAgo: 16, impact: [1, 0, 0, 0, 0, 2, 1, 0], est: 30, act: 150 },
  { key: "hCapTable", title: "Updated the cap table model with Jonas", focus: "FINANCE", completedDaysAgo: 17, impact: [3, 0, 3, 0, 0, 2, 3, 1], est: 60, act: 90, goal: "seriesB" },
  { key: "hPipelineSheet", title: "Rebuilt the investor pipeline spreadsheet", focus: "FUNDRAISING", completedDaysAgo: 18, impact: [2, 0, 2, 0, 0, 0, 1, 0], est: 30, act: 240 },
  { key: "hExpensePolicy", title: "Rewrote the expense policy", focus: "OPERATIONS", completedDaysAgo: 19, impact: [1, 0, 0, 0, 0, 1, 1, 0], est: 30, act: 90 },
  { key: "hNorthbridgeIntro", title: "Ran the Northbridge Ventures intro meeting", focus: "FUNDRAISING", completedDaysAgo: 20, impact: [5, 0, 5, 0, 0, 2, 5, 4], est: 60, act: 60, goal: "seriesB", company: "northbridge", people: ["sarah"] },
  { key: "hOkrRollout", title: "Rolled out Q4 OKRs to the company", focus: "TEAM", completedDaysAgo: 20, impact: [4, 0, 0, 0, 0, 1, 5, 2], est: 90, act: 90 },
  { key: "hHeartReadyBudget", title: "Approved HeartReady study #3 budget", focus: "SCIENCE", completedDaysAgo: 21, impact: [4, 0, 1, 0, 5, 2, 4, 2], est: 30, act: 30, goal: "heartready" },
  { key: "hHiringPlan", title: "Approved the Q4 hiring plan", focus: "TEAM", completedDaysAgo: 22, impact: [4, 1, 1, 0, 0, 2, 5, 2], est: 60, act: 75, goal: "team" },
  { key: "hOffsite", title: "Ran the exec offsite on Q4 OKRs", focus: "STRATEGY", completedDaysAgo: 24, impact: [5, 2, 2, 1, 1, 2, 5, 3], est: 480, act: 480 },
  { key: "hSoc2Auditor", title: "Approved the SOC 2 auditor engagement", focus: "OPERATIONS", completedDaysAgo: 26, impact: [3, 2, 0, 2, 0, 3, 3, 1], est: 30, act: 30, goal: "ops" },
  { key: "hPodcast", title: "Recorded a podcast on human heart data", focus: "CEO_DEVELOPMENT", completedDaysAgo: 27, impact: [2, 1, 1, 0, 1, 0, 4, 1], est: 60, act: 120 },
  { key: "hAurelius", title: "Closed the Aurelius Pharma expansion contract", focus: "REVENUE", completedDaysAgo: 28, impact: [5, 5, 3, 5, 1, 3, 4, 4], est: 120, act: 150, goal: "q3Aurelius", company: "aurelius", people: ["whitfield"] },
  { key: "hBetaScope", title: "Approved CardioPredict v2 beta scope", focus: "CYTOHUB_AI", completedDaysAgo: 30, impact: [4, 3, 2, 3, 3, 2, 4, 3], est: 60, act: 60, goal: "ai" },
  { key: "hAsterTerms", title: "Reviewed the Aster Cloud term sheet", focus: "PARTNERSHIPS", completedDaysAgo: 31, impact: [3, 1, 1, 0, 1, 2, 3, 2], est: 45, act: 60, goal: "partners", company: "aster" },
  { key: "hAiOpsHire", title: "Hired the Head of AI Operations", focus: "RECRUITING", completedDaysAgo: 33, impact: [4, 1, 1, 0, 2, 2, 4, 3], est: 120, act: 150, goal: "team" },
  { key: "hAureliusDinner", title: "Hosted Aurelius leadership dinner", focus: "CUSTOMERS", completedDaysAgo: 34, impact: [4, 4, 1, 5, 0, 2, 5, 3], est: 180, act: 180, company: "aurelius" },
  { key: "hBoardQ3", title: "Ran the Q3 board meeting", focus: "STRATEGY", completedDaysAgo: 35, impact: [5, 1, 4, 1, 1, 3, 5, 2], est: 240, act: 300 },
  { key: "hQ3Update", title: "Prepared the Q3 investor update", focus: "FUNDRAISING", completedDaysAgo: 36, impact: [3, 0, 3, 0, 0, 1, 4, 1], est: 90, act: 120 },
  { key: "hQaProtocol", title: "Approved dataset QA protocol v3", focus: "SCIENCE", completedDaysAgo: 38, impact: [4, 0, 1, 0, 5, 3, 3, 2], est: 60, act: 60, goal: "dataset" },
  { key: "hRaiseTimeline", title: "Finalized the Series B timeline with the board", focus: "FUNDRAISING", completedDaysAgo: 40, impact: [5, 0, 5, 0, 0, 3, 5, 4], est: 120, act: 120, goal: "seriesB" },
  { key: "hDataEngHire", title: "Closed the Head of Data Engineering hire", focus: "RECRUITING", completedDaysAgo: 42, impact: [4, 0, 1, 0, 3, 2, 4, 3], est: 120, act: 120, goal: "team" },
  { key: "hTargetList", title: "Built the Series B investor target list", focus: "FUNDRAISING", completedDaysAgo: 45, impact: [4, 0, 5, 0, 0, 2, 4, 3], est: 120, act: 180, goal: "seriesB" },
  { key: "hLumenOps", title: "Lumen operations review", focus: "CUSTOMERS", completedDaysAgo: 8, impact: [3, 3, 0, 4, 0, 4, 3, 2], est: 60, act: 60, company: "lumen", people: ["rachel"] },
];

export const CANCELLED_TASKS: TaskSeed[] = [
  { key: "xMeridianDeck", title: "Send follow-up deck to Meridian Health Ventures", focus: "FUNDRAISING", status: "CANCELLED", due: -18, company: "meridian", impact: [2, 0, 3, 0, 0, 1, 4, 1], createdDaysAgo: 25, source: "MEETING", notes: "Meridian passed before the deck was sent." },
  { key: "xCellwave", title: "Draft partnership one-pager for Cellwave", focus: "PARTNERSHIPS", status: "CANCELLED", due: -24, company: "cellwave", impact: [2, 1, 0, 0, 1, 0, 3, 1], createdDaysAgo: 35, source: "MEETING", notes: "Committed in a vendor meeting; never prioritized." },
];

// ─── Decisions ───────────────────────────────────────────────────────────────

export type DecisionSeed = {
  key: string;
  title: string;
  context: string;
  status: DecisionStatus;
  raisedDaysAgo: number;
  deadline?: number;
  impact: number;
  goal?: string;
  pillar: PillarKey;
  recommendation?: string;
  supportingInfo?: string;
  waitingOn?: string;
  finalDecision?: string;
  decidedDaysAgo?: number;
  outcome?: string;
  lessons?: string;
  companies?: string[];
  options: { title: string; description?: string; pros: string[]; cons: string[]; risks: string[]; recommended?: boolean }[];
};

export const DECISIONS: DecisionSeed[] = [
  {
    key: "dCardio",
    title: "CardioPredict v2: launch at AUC 0.88 now, or delay GA six weeks for 0.90?",
    context: "Hold-out validation landed at AUC 0.88 against the 0.90 bar we set publicly. Three design partners are ready to use v2; two competitors announced cardiac-safety AI products this quarter.",
    status: "NEEDED",
    raisedDaysAgo: 2,
    deadline: 3,
    impact: 5,
    goal: "q4CardioGA",
    pillar: "ai",
    recommendation: "Limited release to the three design partners at 0.88 with full validation transparency, retrain on 60 new donor hearts, and hold GA until ≥ 0.90.",
    supportingInfo: "Hold-out AUC 0.88 on 212 compounds. Design partners value early access. Retraining estimate: 5–6 weeks.",
    options: [
      { title: "Launch GA now at AUC 0.88", pros: ["Captures Q4 pharma budgets", "Momentum for the Series B story"], cons: ["Below the publicly committed 0.90 bar", "Support load during the raise"], risks: ["Trust damage with safety pharmacology teams if false negatives surface"] },
      { title: "Delay GA six weeks for 0.90", pros: ["Meets the committed bar", "Stronger validation narrative"], cons: ["Misses Q4 budget cycles", "Gives CardiaSim a window"], risks: ["Revenue slips into 2027"] },
      { title: "Limited release to design partners + parallel retraining", pros: ["Keeps partner momentum", "Transparent about 0.88", "GA still at ≥ 0.90"], cons: ["Two-track load on the AI team"], risks: ["Retraining may not reach 0.90 in six weeks"], recommended: true },
    ],
  },
  {
    key: "dDataRights",
    title: "Grant Brightwater a license to derivative models?",
    context: "Brightwater's legal team wants rights to models derived from their compound data (clause 7.3). It is the last open term on a $1.4M, three-year MSA.",
    status: "NEEDED",
    raisedDaysAgo: 3,
    deadline: 1,
    impact: 5,
    goal: "q4Brightwater",
    pillar: "revenue",
    recommendation: "Offer a non-exclusive license to derivative models limited to Brightwater's own compounds; CytoHub keeps all rights to the dataset and platform improvements.",
    supportingInfo: "Marcus confirms a field-limited license is consistent with the Aurelius and Calder agreements.",
    companies: ["brightwater"],
    options: [
      { title: "Accept full derivative-model rights", pros: ["Closes fastest"], cons: ["Sets a precedent that dilutes the moat"], risks: ["Future customers ask for the same"] },
      { title: "Refuse — all derived IP stays with CytoHub", pros: ["Protects the platform"], cons: ["Likely loses the MSA"], risks: ["$1.4M ARR slips out of 2026"] },
      { title: "Field-limited, non-exclusive license", pros: ["Meets their real need", "Consistent with existing contracts"], cons: ["Adds contract complexity"], risks: ["Brightwater may still push for exclusivity"], recommended: true },
    ],
  },
  {
    key: "dVPSales",
    title: "Hire Laura Mitchell as VP Sales at the requested package?",
    context: "Final candidate after a five-month search. Requested base $240K, OTE $310K, 1.1% equity. Competing offer with a Wednesday deadline.",
    status: "NEEDED",
    raisedDaysAgo: 2,
    deadline: 1,
    impact: 4,
    goal: "q4VPSales",
    pillar: "team",
    recommendation: "Approve as requested — within the board-approved band once the option pool refresh passes.",
    options: [
      { title: "Approve as requested", pros: ["Closes the most critical seat", "Strong references"], cons: ["Top of the band"], risks: ["Equity budget tight until the pool refresh"], recommended: true },
      { title: "Counter at 0.9% equity", pros: ["Preserves pool"], cons: ["Signals hesitation"], risks: ["Candidate accepts the competing offer"] },
      { title: "Continue the search", pros: ["More options"], cons: ["Another 3–4 months without sales leadership"], risks: ["ARR goal slips further"] },
    ],
  },
  {
    key: "dExclusivity",
    title: "Grant Northbridge an exclusivity period if they lead?",
    context: "Sarah Chen signalled Northbridge will ask for 30 days of exclusivity alongside a term sheet.",
    status: "NEEDED",
    raisedDaysAgo: 1,
    deadline: 9,
    impact: 5,
    goal: "seriesB",
    pillar: "fundraising",
    recommendation: "Only after a signed term sheet, and cap it at 21 days.",
    options: [
      { title: "30 days after term sheet", pros: ["Standard ask", "Signals commitment"], cons: ["Pauses Helix diligence"], risks: ["Leverage drops if terms change"] },
      { title: "21 days after signed term sheet", pros: ["Balances speed and leverage"], cons: ["May need negotiation"], risks: ["Northbridge pushes back"], recommended: true },
      { title: "No exclusivity", pros: ["Maximum leverage"], cons: ["May cost the lead"], risks: ["Northbridge walks"] },
    ],
  },
  {
    key: "dLabSite",
    title: "Second lab site: expand the current lab or open in Boston?",
    context: "Dataset growth beyond 500 hearts needs more profiling capacity in 2027.",
    status: "WAITING_INFO",
    raisedDaysAgo: 14,
    deadline: 30,
    impact: 4,
    pillar: "ops",
    waitingOn: "Jonas's cost model for both options and Maya's throughput analysis.",
    options: [
      { title: "Expand the current lab", pros: ["Lower cost", "No team split"], cons: ["Capacity ceiling in 2028"], risks: ["Construction delays"] },
      { title: "Open a Boston site", pros: ["Talent pool", "Closer to pharma customers"], cons: ["Higher burn", "Management overhead"], risks: ["Execution risk during the raise"] },
    ],
  },
  {
    key: "dPricing",
    title: "Set pricing for the data-licensing tier",
    context: "Pharma customers want direct access to dataset slices for their own modelling.",
    status: "WAITING_INFO",
    raisedDaysAgo: 10,
    deadline: 14,
    impact: 4,
    pillar: "revenue",
    waitingOn: "Competitor pricing benchmark (delegated to Priya).",
    options: [
      { title: "Per-slice annual license", pros: ["Simple"], cons: ["Caps upside"], risks: [] },
      { title: "Platform subscription + usage", pros: ["Expansion revenue"], cons: ["Harder to forecast"], risks: [] },
    ],
  },
  {
    key: "dOncology",
    title: "Prioritize cardiac safety over cardio-oncology for 2027",
    context: "Split focus was slowing both roadmaps.",
    status: "DECIDED",
    raisedDaysAgo: 20,
    decidedDaysAgo: 5,
    impact: 5,
    pillar: "ai",
    finalDecision: "Cardiac safety remains the 2027 wedge; cardio-oncology becomes a design-partner program with Vantage only.",
    outcome: "Roadmap updated; Vantage informed and supportive.",
    lessons: "A clear wedge made the investor story simpler within a week.",
    options: [
      { title: "Focus on cardiac safety", pros: ["Clear wedge"], cons: ["Defers oncology revenue"], risks: [], recommended: true },
      { title: "Run both tracks", pros: ["Broader market"], cons: ["Splits a small AI team"], risks: ["Both slip"] },
    ],
  },
  {
    key: "dSoc2",
    title: "SOC 2: build in-house or engage a readiness consultant?",
    context: "Pharma procurement requires SOC 2 Type II for 2027 renewals.",
    status: "DECIDED",
    raisedDaysAgo: 60,
    decidedDaysAgo: 50,
    impact: 3,
    pillar: "ops",
    finalDecision: "Engage a consultant for readiness; own the controls in-house.",
    outcome: "Type I achieved in six weeks; Type II window on track.",
    lessons: "Paying for speed on compliance freed Elena for customer onboarding — worth it.",
    options: [
      { title: "Consultant for readiness", pros: ["Speed"], cons: ["Cost"], risks: [], recommended: true },
      { title: "Fully in-house", pros: ["Cheaper"], cons: ["Slower"], risks: ["Misses renewals"] },
    ],
  },
  {
    key: "dRaiseTiming",
    title: "Raise the Series B in Q4 rather than Q1",
    context: "Runway and the CardioPredict v2 story supported an earlier raise.",
    status: "DECIDED",
    raisedDaysAgo: 70,
    decidedDaysAgo: 48,
    impact: 5,
    goal: "seriesB",
    pillar: "fundraising",
    finalDecision: "Start the raise in September with a target first close in December.",
    outcome: "Process launched; six firms engaged; lead not yet secured.",
    lessons: "Fundraising time must be protected on the calendar — CEO attention slipped below plan within three weeks.",
    options: [
      { title: "Raise in Q4", pros: ["More runway buffer"], cons: ["Less traction to show"], risks: [], recommended: true },
      { title: "Raise in Q1", pros: ["More traction"], cons: ["Runway pressure"], risks: ["Negotiating from weakness"] },
    ],
  },
  {
    key: "dJapan",
    title: "Enter Japan through a distribution partner in 2027?",
    context: "Inbound interest from two Japanese CROs.",
    status: "DEFERRED",
    raisedDaysAgo: 40,
    impact: 3,
    pillar: "partnerships",
    options: [
      { title: "Partner in 2027", pros: ["New market"], cons: ["Distraction during the raise"], risks: [] },
      { title: "Revisit after the Series B", pros: ["Focus"], cons: ["Interest may cool"], risks: [] },
    ],
  },
];

// ─── Deals ───────────────────────────────────────────────────────────────────

export type DealSeed = {
  key: string;
  name: string;
  type: DealType;
  company: string;
  stage: string;
  stageOrder: number;
  value: number | null;
  probability: number;
  status?: DealStatus;
  expectedClose?: number;
  stageChangedHoursAgo: number;
  lastActivityHoursAgo: number;
  /** Exact local [dayOffset, hour] — overrides lastActivityHoursAgo when timing matters. */
  lastActivityLocal?: [number, number];
  owner: string;
  nextStep?: string;
};

export const DEALS: DealSeed[] = [
  { key: "dlBrightwater", name: "Brightwater — cardiac safety MSA", type: "SALES", company: "brightwater", stage: "Contracting", stageOrder: 5, value: 1_400_000, probability: 70, expectedClose: 18, stageChangedHoursAgo: 16, lastActivityHoursAgo: 14, owner: "priya", nextStep: "Resolve clause 7.3 in tomorrow's negotiation" },
  { key: "dlAurelius", name: "Aurelius — expansion to three sites", type: "SALES", company: "aurelius", stage: "Proposal", stageOrder: 4, value: 900_000, probability: 60, expectedClose: 40, stageChangedHoursAgo: 9 * 24, lastActivityHoursAgo: 6 * 24, owner: "priya", nextStep: "CEO call with Dr. Whitfield" },
  { key: "dlCalder", name: "Calder — paid validation study", type: "SALES", company: "calder", stage: "Closed won", stageOrder: 6, value: 350_000, probability: 100, status: "WON", stageChangedHoursAgo: 20, lastActivityHoursAgo: 20, owner: "priya" },
  { key: "dlOstrava", name: "Ostrava — cardiotox screening pilot", type: "SALES", company: "ostrava", stage: "Scientific evaluation", stageOrder: 2, value: 600_000, probability: 30, expectedClose: 75, stageChangedHoursAgo: 40 * 24, lastActivityHoursAgo: 19 * 24, owner: "priya", nextStep: "Share the v2 validation summary" },
  { key: "dlVantage", name: "Vantage — cardio-oncology safety program", type: "SALES", company: "vantage", stage: "Discovery", stageOrder: 1, value: 450_000, probability: 15, expectedClose: 120, stageChangedHoursAgo: 9 * 24, lastActivityHoursAgo: 9 * 24, owner: "priya" },
  { key: "dlLumen", name: "Lumen — annual renewal", type: "SALES", company: "lumen", stage: "Renewal negotiation", stageOrder: 4, value: 500_000, probability: 45, expectedClose: 30, stageChangedHoursAgo: 15 * 24, lastActivityHoursAgo: 10, owner: "daniel", nextStep: "Recovery plan for assay turnaround" },
  { key: "fnNorthbridge", name: "Northbridge Ventures — Series B lead", type: "FUNDRAISING", company: "northbridge", stage: "Partner meeting", stageOrder: 3, value: 15_000_000, probability: 40, expectedClose: 45, stageChangedHoursAgo: 22, lastActivityHoursAgo: 18, owner: "ceo", nextStep: "Partner meeting Thursday 10:00" },
  { key: "fnHelix", name: "Helix Capital — Series B", type: "FUNDRAISING", company: "helix", stage: "Diligence", stageOrder: 4, value: 8_000_000, probability: 35, expectedClose: 50, stageChangedHoursAgo: 6 * 24, lastActivityHoursAgo: 5, owner: "ceo", nextStep: "Open data room; schedule diligence session" },
  { key: "fnFjord", name: "Fjord Life Science Ventures — Series B", type: "FUNDRAISING", company: "fjord", stage: "First meeting", stageOrder: 2, value: 5_000_000, probability: 20, expectedClose: 60, stageChangedHoursAgo: 18 * 24, lastActivityHoursAgo: 14.6 * 24, lastActivityLocal: [-15, 19], owner: "ceo", nextStep: "Send HeartReady plan" },
  { key: "fnSolstice", name: "Solstice Bio Fund — Series B", type: "FUNDRAISING", company: "solstice", stage: "Intro", stageOrder: 1, value: 6_000_000, probability: 10, expectedClose: 75, stageChangedHoursAgo: 15 * 24, lastActivityHoursAgo: 14.3 * 24, lastActivityLocal: [-15, 21], owner: "ceo" },
  { key: "fnGranite", name: "Granite Peak — pro-rata", type: "FUNDRAISING", company: "granite", stage: "Committed", stageOrder: 5, value: 4_000_000, probability: 90, expectedClose: 60, stageChangedHoursAgo: 10 * 24, lastActivityHoursAgo: 3 * 24, owner: "ceo" },
  { key: "fnMeridian", name: "Meridian Health Ventures — Series B", type: "FUNDRAISING", company: "meridian", stage: "Passed", stageOrder: 0, value: 5_000_000, probability: 0, status: "LOST", stageChangedHoursAgo: 21 * 24, lastActivityHoursAgo: 21 * 24, owner: "ceo" },
  { key: "ptNhi", name: "Nordic Heart Institute — data partnership", type: "PARTNERSHIP", company: "nhi", stage: "Term sheet", stageOrder: 3, value: null, probability: 70, expectedClose: 12, stageChangedHoursAgo: 5 * 24, lastActivityHoursAgo: 15, owner: "ceo" },
  { key: "ptAster", name: "Aster Cloud — compute partnership", type: "PARTNERSHIP", company: "aster", stage: "Legal review", stageOrder: 3, value: null, probability: 60, expectedClose: -4, stageChangedHoursAgo: 30 * 24, lastActivityHoursAgo: 9, owner: "elena" },
];

// ─── Meetings ────────────────────────────────────────────────────────────────

export type MeetingSeed = {
  key: string;
  title: string;
  type: MeetingType;
  focus: FocusArea;
  day: number; // workday offset
  hour: number;
  minute?: number;
  durationMin: number;
  importance: number;
  attendees: string[];
  company?: string;
  goal?: string;
  objective?: string;
  description?: string;
  location?: string;
  notes?: string;
};

export const MEETINGS: MeetingSeed[] = [
  // Past
  { key: "mNorthbridgeIntro", title: "Northbridge Ventures — intro", type: "INVESTOR", focus: "FUNDRAISING", day: -20, hour: 10, durationMin: 60, importance: 5, attendees: ["sarah"], company: "northbridge", goal: "seriesB", notes: "Sarah loves the human-data moat. Concerns: sales capacity (VP Sales gap) and customer concentration. Asked for retention cohorts and the dataset roadmap." },
  { key: "mFjordFirst", title: "Fjord Life Science Ventures — first meeting", type: "INVESTOR", focus: "FUNDRAISING", day: -12, hour: 15, durationMin: 60, importance: 4, attendees: ["anna"], company: "fjord", goal: "seriesB", notes: "Positive. Anna asked for the HeartReady preclinical plan and timeline to pre-IND." },
  { key: "mHelixFirst", title: "Helix Capital — first meeting", type: "INVESTOR", focus: "FUNDRAISING", day: -12, hour: 11, durationMin: 60, importance: 4, attendees: ["david"], company: "helix", goal: "seriesB", notes: "Helix focused on revenue quality and gross margin of data licensing." },
  { key: "mBrightwaterRedlines", title: "Brightwater MSA redline review", type: "CUSTOMER", focus: "REVENUE", day: -6, hour: 14, durationMin: 60, importance: 4, attendees: ["karen", "priya", "marcus"], company: "brightwater", goal: "q4Brightwater", notes: "14 of 16 redlines agreed. Open: 7.3 derivative models, 11.2 liability cap (likely resolvable)." },
  { key: "mNhiReview", title: "NHI term sheet review", type: "PARTNER", focus: "PARTNERSHIPS", day: -5, hour: 9, durationMin: 45, importance: 4, attendees: ["ingrid", "marcus"], company: "nhi", goal: "partners", notes: "Publication embargo of 90 days requested by NHI; CytoHub prefers 60." },
  { key: "mLumenOps", title: "Lumen operations review", type: "CUSTOMER", focus: "CUSTOMERS", day: -8, hour: 16, durationMin: 45, importance: 3, attendees: ["rachel", "daniel"], company: "lumen", notes: "Turnaround slipped to 16 days; Rachel frustrated. Daniel committed to a dashboard." },
  { key: "mGrantCheckin", title: "Board check-in — Michael Grant", type: "BOARD", focus: "STRATEGY", day: -3, hour: 17, durationMin: 30, importance: 4, attendees: ["michael"], company: "granite", goal: "seriesB", notes: "Board expects a named lead by mid-November to keep the December first close." },
  { key: "mHelixData", title: "Helix — data request call", type: "INVESTOR", focus: "FUNDRAISING", day: -2, hour: 13, durationMin: 30, importance: 3, attendees: ["david", "jonas"], company: "helix", goal: "seriesB" },
  { key: "mNorthbridgeFollow", title: "Northbridge — follow-up call", type: "INVESTOR", focus: "FUNDRAISING", day: -1, hour: 16, durationMin: 30, importance: 4, attendees: ["sarah"], company: "northbridge", goal: "seriesB", notes: "Sarah will bring CytoHub to the full partnership. Prepare cohort retention and the dataset moat slide." },
  // Today and ahead
  { key: "mLumenCall", title: "Lumen Biologics — escalation call", type: "CUSTOMER", focus: "CUSTOMERS", day: 0, hour: 11, durationMin: 45, importance: 4, attendees: ["rachel", "daniel"], company: "lumen", goal: "arr", objective: "Agree a dated turnaround recovery plan and protect the renewal." },
  { key: "mExecWeekly", title: "Exec team weekly", type: "INTERNAL", focus: "TEAM", day: 0, hour: 14, durationMin: 60, importance: 3, attendees: ["maya", "jonas", "priya", "tom", "elena", "daniel", "sofia"] },
  { key: "mMaya1on1", title: "1:1 — Maya Lindqvist", type: "ONE_ON_ONE", focus: "SCIENCE", day: 0, hour: 16, minute: 30, durationMin: 30, importance: 2, attendees: ["maya"] },
  { key: "mBrightwaterNeg", title: "Brightwater — MSA negotiation", type: "CUSTOMER", focus: "REVENUE", day: 1, hour: 9, durationMin: 60, importance: 5, attendees: ["karen", "priya", "marcus"], company: "brightwater", goal: "q4Brightwater", objective: "Close clause 7.3 with a field-limited license and agree a signature date." },
  { key: "mBoardPrep", title: "Board prep — Michael Grant", type: "BOARD", focus: "STRATEGY", day: 1, hour: 15, durationMin: 45, importance: 4, attendees: ["michael", "jonas"], company: "granite", goal: "seriesB", objective: "Align on the Series B timeline and runway scenarios before the pre-read." },
  { key: "mNorthbridgePartner", title: "Northbridge Ventures — partner meeting", type: "INVESTOR", focus: "FUNDRAISING", day: 2, hour: 10, durationMin: 90, importance: 5, attendees: ["sarah", "jonas"], company: "northbridge", goal: "seriesB", objective: "Earn a term sheet: prove retention, the dataset moat and the path to $20M ARR.", location: "Northbridge, Boston" },
  { key: "mAureliusCso", title: "Aurelius — CSO call", type: "CUSTOMER", focus: "CUSTOMERS", day: 2, hour: 14, durationMin: 30, importance: 4, attendees: ["whitfield", "priya"], company: "aurelius", goal: "arr", objective: "Executive sponsorship for the three-site expansion." },
  { key: "mAllHands", title: "All-hands: Q4 priorities", type: "INTERNAL", focus: "TEAM", day: 3, hour: 9, minute: 30, durationMin: 60, importance: 3, attendees: ["maya", "jonas", "priya", "tom", "elena", "daniel", "sofia", "marcus", "lea", "ben"] },
  { key: "mCardioGoNoGo", title: "CardioPredict v2 launch go/no-go", type: "INTERNAL", focus: "CYTOHUB_AI", day: 3, hour: 14, durationMin: 60, importance: 4, attendees: ["tom", "daniel", "priya"], goal: "q4CardioGA", objective: "Decide launch scope." },
  { key: "mHelixDiligence", title: "Helix Capital — diligence session", type: "INVESTOR", focus: "FUNDRAISING", day: 6, hour: 13, durationMin: 120, importance: 4, attendees: ["david", "jonas", "tom"], company: "helix", goal: "seriesB", objective: "Pass commercial and technical diligence." },
  { key: "mNhiSteering", title: "Nordic Heart Institute — steering committee", type: "PARTNER", focus: "PARTNERSHIPS", day: 8, hour: 9, durationMin: 90, importance: 4, attendees: ["ingrid", "maya"], company: "nhi", goal: "partners", objective: "Announce the partnership and agree the 2027 data plan." },
  { key: "mBoardQ4", title: "Q4 board meeting", type: "BOARD", focus: "STRATEGY", day: 10, hour: 9, durationMin: 240, importance: 5, attendees: ["michael", "catherine", "jonas"], goal: "seriesB", objective: "Board alignment on the raise, 2027 plan and option pool refresh." },
  { key: "mBioEurope", title: "BIO-Europe partnering (Munich)", type: "EXTERNAL", focus: "PARTNERSHIPS", day: 16, hour: 8, durationMin: 600, importance: 4, attendees: ["priya", "ben"], objective: "15 partnering meetings; Vantage CSO dinner.", location: "Munich" },
  { key: "mSolstice", title: "Solstice Bio Fund — partner meeting", type: "INVESTOR", focus: "FUNDRAISING", day: 23, hour: 11, durationMin: 60, importance: 3, attendees: ["olivia"], company: "solstice", goal: "seriesB" },
  { key: "mAureliusQbr", title: "Aurelius — quarterly business review", type: "CUSTOMER", focus: "CUSTOMERS", day: 30, hour: 10, durationMin: 90, importance: 4, attendees: ["whitfield", "priya", "daniel"], company: "aurelius", goal: "arr" },
  { key: "mOffsite", title: "Leadership offsite: 2027 plan", type: "INTERNAL", focus: "STRATEGY", day: 44, hour: 9, durationMin: 480, importance: 4, attendees: ["maya", "jonas", "priya", "tom", "elena", "daniel", "sofia"] },
  { key: "mFirstClose", title: "Series B first close — closing call", type: "INVESTOR", focus: "FUNDRAISING", day: 80, hour: 11, durationMin: 60, importance: 5, attendees: ["jonas", "michael"], goal: "seriesB" },
];

// ─── Resources ───────────────────────────────────────────────────────────────

export type ResourceSeed = {
  title: string;
  type: ResourceType;
  url?: string;
  description?: string;
  summary?: string;
  tags?: string[];
  source?: ItemSource;
  goals?: string[];
  tasks?: string[];
  milestones?: string[];
  decisions?: string[];
  people?: string[];
  companies?: string[];
};

export const RESOURCES: ResourceSeed[] = [
  { title: "Series B investor deck v6", type: "PRESENTATION", url: "https://drive.example.com/cytohub/series-b-deck-v6", summary: "28 slides: human heart dataset moat, CardioPredict v2, pharma traction ($4.4M ARR), HeartReady, use of funds.", tags: ["series-b", "investors"], source: "DOCUMENT", goals: ["seriesB", "q4TermSheet"], tasks: ["tDeck"], people: ["sarah"], companies: ["northbridge", "helix"] },
  { title: "Financial model FY26–FY28 (v12)", type: "FINANCIAL_MODEL", url: "https://drive.example.com/cytohub/financial-model-v12", summary: "Runway 16.6 months at current burn; 24+ months with a $40M December close.", tags: ["finance", "runway"], source: "DOCUMENT", goals: ["seriesB", "deptRunway"], tasks: ["tRunway", "tDataroomFin"], people: ["jonas"], decisions: ["dLabSite"] },
  { title: "Brightwater MSA draft v5 (redlined)", type: "CONTRACT", url: "https://drive.example.com/cytohub/brightwater-msa-v5", summary: "14 of 16 redlines agreed. Open: 7.3 derivative models; 11.2 liability cap.", tags: ["msa", "brightwater"], source: "DOCUMENT", goals: ["q4Brightwater"], milestones: ["msBrightwater"], tasks: ["tBrightwater"], decisions: ["dDataRights"], companies: ["brightwater"], people: ["karen"] },
  { title: "CardioPredict v2 validation report (draft)", type: "DOCUMENT", url: "https://drive.example.com/cytohub/cardiopredict-v2-validation", summary: "Hold-out AUC 0.88 on 212 compounds; sensitivity 0.91, specificity 0.79.", tags: ["ai", "validation"], source: "DOCUMENT", goals: ["ai", "q4CardioGA"], milestones: ["msAuc"], decisions: ["dCardio"], tasks: ["tCardioDecision"], people: ["tom"] },
  { title: "Human Heart Dataset specification v3", type: "DATASET", summary: "410 donor hearts; functional, transcriptomic and imaging modalities; QA protocol v3.", tags: ["dataset"], goals: ["dataset"], milestones: ["ms500"], people: ["maya"] },
  { title: "Dataset validation manuscript (draft)", type: "SCIENTIFIC_PAPER", summary: "Target: Nature Biotechnology. Shows human-heart-trained models outperform iPSC-trained models on clinical cardiotoxicity.", tags: ["publication"], goals: ["deptPaper"], milestones: ["msPaper"], people: ["maya"] },
  { title: "Q3 board deck", type: "PRESENTATION", url: "https://drive.example.com/cytohub/board-q3", tags: ["board"], goals: ["seriesB"], people: ["michael", "catherine"] },
  { title: "Competitive landscape: AI cardiac safety", type: "INTELLIGENCE", summary: "CardiaSim raised $60M (iPSC-based models, launch H1 2027). Differentiation: human donor heart data and clinical concordance.", tags: ["competition"], source: "BRAIN", decisions: ["dCardio", "dOncology"], companies: ["cardiasim"] },
  { title: "Nordic Heart Institute term sheet", type: "CONTRACT", tags: ["partnership"], milestones: ["msNHI"], tasks: ["tNhiSign", "tNhiLegal"], companies: ["nhi"], people: ["ingrid"] },
  { title: "SOC 2 readiness tracker", type: "DOCUMENT", tags: ["compliance"], goals: ["ops"], milestones: ["msSOC2"] },
  { title: "Northbridge Ventures — meeting notes", type: "MEETING_NOTES", summary: "Thesis fit on human data. Concerns: sales capacity and customer concentration.", tags: ["investors"], source: "MEETING", goals: ["seriesB"], companies: ["northbridge"], people: ["sarah"] },
  { title: "Series B data room", type: "LINK", url: "https://dataroom.example.com/cytohub-series-b", tags: ["series-b"], goals: ["q4TermSheet"], milestones: ["msDataRoom"] },
  { title: "HeartReady preclinical plan", type: "DOCUMENT", summary: "Six studies to the pre-IND package; three complete.", tags: ["heartready"], goals: ["heartready"], milestones: ["msHRReadout", "msPreIND"], people: ["lea", "anna"] },
  { title: "VP Sales candidate packet — Laura Mitchell", type: "DOCUMENT", tags: ["hiring"], decisions: ["dVPSales"], milestones: ["msVPSales"], people: ["laura", "sofia"] },
  { title: "Data-licensing pricing memo", type: "DOCUMENT", tags: ["pricing"], decisions: ["dPricing"], tasks: ["tPricing"] },
  { title: "Aurelius Pharma account plan", type: "DOCUMENT", tags: ["accounts"], companies: ["aurelius"], people: ["whitfield"], tasks: ["tAureliusCall"] },
  { title: "Customer reference list", type: "DOCUMENT", tags: ["series-b", "customers"], tasks: ["tRefs"], companies: ["aurelius", "calder"] },
  { title: "Cohort retention analysis 2024–2026", type: "DOCUMENT", summary: "Gross revenue retention 96%; net 118% trailing twelve months.", tags: ["series-b", "metrics"], tasks: ["tDeck"], goals: ["seriesB"] },
  { title: "Lumen Biologics assay SLA", type: "CONTRACT", summary: "10-day median turnaround commitment; service credits after two consecutive misses.", companies: ["lumen"] },
  { title: "Aster Cloud compute agreement (draft)", type: "CONTRACT", milestones: ["msAster"], companies: ["aster"] },
];

// ─── Metrics ─────────────────────────────────────────────────────────────────

export type MetricSeed = {
  key: string;
  name: string;
  category: MetricCategory;
  unit: MetricUnit;
  direction?: MetricDirection;
  target?: number;
  sourceKey?: string;
  description?: string;
  pillar?: PillarKey;
  goal?: string;
  /** Monthly values, oldest first; the last lands on the first of this month. */
  monthly?: number[];
  /** Extra point recorded `daysAgo` days ago (e.g. a fresh update). */
  latest?: { daysAgo: number; value: number };
  /** Weekly history multipliers for derived metrics (oldest first, relative to live). */
  weeklyFactors?: number[];
};

const M = 1_000_000;
export const METRICS: MetricSeed[] = [
  { key: "arr", name: "ARR", category: "ARR", unit: "CURRENCY", target: 6 * M, pillar: "revenue", goal: "arr", monthly: [2.6, 2.75, 2.9, 3.1, 3.25, 3.4, 3.55, 3.7, 3.85, 4.05, 4.25, 4.38].map((v) => v * M), latest: { daysAgo: 0, value: 4.73 * M }, sourceKey: "hubspot" },
  { key: "nrr", name: "Net revenue retention", category: "ARR", unit: "PERCENT", target: 120, pillar: "revenue", monthly: [108, 110, 111, 112, 115, 116, 118, 117, 119, 121, 122, 118], sourceKey: "manual" },
  { key: "revenue_ttm", name: "Revenue (trailing 12 months)", category: "REVENUE", unit: "CURRENCY", pillar: "revenue", monthly: [1.9, 2.0, 2.2, 2.35, 2.5, 2.65, 2.8, 2.95, 3.1, 3.3, 3.5, 3.65].map((v) => v * M), sourceKey: "quickbooks" },
  { key: "bookings_qtd", name: "Bookings (quarter to date)", category: "REVENUE", unit: "CURRENCY", target: 2 * M, pillar: "revenue", monthly: [0.3, 0.9, 1.4, 0.2, 0.8, 1.6, 0.4, 1.1, 1.9, 0.5, 1.2, 0.12].map((v) => v * M), latest: { daysAgo: 0, value: 0.47 * M }, sourceKey: "hubspot" },
  { key: "pipeline_weighted", name: "Weighted sales pipeline", category: "PIPELINE", unit: "CURRENCY", target: 5 * M, pillar: "revenue", sourceKey: "derived:pipeline.weighted", weeklyFactors: [0.78, 0.82, 0.85, 0.9, 0.93, 0.95, 0.97] },
  { key: "pipeline_total", name: "Open sales pipeline", category: "PIPELINE", unit: "CURRENCY", pillar: "revenue", sourceKey: "derived:pipeline.total", weeklyFactors: [0.85, 0.88, 0.9, 0.93, 0.95, 1.05, 1.02] },
  { key: "pharma_opps", name: "Open pharma opportunities", category: "PIPELINE", unit: "COUNT", sourceKey: "derived:pipeline.count", weeklyFactors: [0.8, 0.8, 1, 1, 1, 1.2, 1.2] },
  { key: "active_customers", name: "Active pharma customers", category: "CUSTOMERS", unit: "COUNT", target: 12, pillar: "revenue", monthly: [5, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9], latest: { daysAgo: 0, value: 10 }, sourceKey: "hubspot" },
  { key: "customer_health", name: "Customer health (avg, 0–10)", category: "CUSTOMERS", unit: "NUMBER", target: 8.5, monthly: [7.9, 8.0, 8.1, 8.1, 8.2, 8.3, 8.3, 8.4, 8.4, 8.3, 8.2, 7.9], sourceKey: "manual" },
  { key: "round_committed", name: "Series B committed", category: "FUNDRAISING", unit: "CURRENCY", target: 40 * M, pillar: "fundraising", goal: "seriesB", sourceKey: "derived:fundraising.committed", weeklyFactors: [0, 0, 1, 1, 1, 1, 1] },
  { key: "investor_weighted", name: "Weighted investor pipeline", category: "FUNDRAISING", unit: "CURRENCY", target: 40 * M, pillar: "fundraising", sourceKey: "derived:fundraising.weighted", weeklyFactors: [0.5, 0.62, 0.7, 0.8, 0.86, 0.92, 0.95] },
  { key: "investor_active", name: "Active investor conversations", category: "FUNDRAISING", unit: "COUNT", target: 8, sourceKey: "derived:fundraising.active", weeklyFactors: [0.6, 0.8, 1, 1.2, 1.2, 1, 1] },
  { key: "cash_on_hand", name: "Cash on hand", category: "CASH", unit: "CURRENCY", monthly: [31.5, 30.4, 29.2, 28.1, 26.9, 25.8, 24.6, 23.5, 22.4, 21.3, 20.2, 19.1].map((v) => v * M), sourceKey: "brex" },
  { key: "net_burn", name: "Net burn (monthly)", category: "CASH", unit: "CURRENCY", direction: "LOWER_IS_BETTER", target: 1.2 * M, monthly: [0.95, 0.97, 1.0, 1.02, 1.05, 1.07, 1.08, 1.1, 1.12, 1.13, 1.14, 1.15].map((v) => v * M), sourceKey: "brex" },
  { key: "runway", name: "Runway", category: "CASH", unit: "MONTHS", target: 24, pillar: "fundraising", sourceKey: "derived:cash.runway", weeklyFactors: [1.12, 1.1, 1.08, 1.06, 1.04, 1.02, 1.01] },
  { key: "cardiopredict_wau", name: "CardioPredict weekly active users", category: "PRODUCT", unit: "COUNT", target: 250, pillar: "ai", monthly: [40, 52, 61, 75, 88, 96, 110, 124, 139, 151, 168, 182], sourceKey: "manual" },
  { key: "assay_tat", name: "Assay turnaround (median days)", category: "PRODUCT", unit: "DAYS", direction: "LOWER_IS_BETTER", target: 10, pillar: "ops", monthly: [12, 11, 11, 10, 10, 9, 10, 11, 12, 13, 14, 16], latest: { daysAgo: 0, value: 19 }, sourceKey: "manual" },
  { key: "auc", name: "CardioPredict v2 hold-out AUC", category: "AI", unit: "NUMBER", target: 0.9, pillar: "ai", goal: "ai", monthly: [0.81, 0.82, 0.83, 0.84, 0.85, 0.86, 0.86, 0.87, 0.87, 0.88, 0.88, 0.88], sourceKey: "manual" },
  { key: "compounds_predicted", name: "Compounds predicted (cumulative)", category: "AI", unit: "COUNT", pillar: "ai", monthly: [1200, 1700, 2300, 2900, 3600, 4300, 5100, 5900, 6800, 7700, 8700, 9800], sourceKey: "manual" },
  { key: "donor_hearts", name: "Donor hearts profiled", category: "SCIENCE", unit: "COUNT", target: 500, pillar: "dataset", goal: "dataset", monthly: [255, 270, 288, 305, 322, 340, 356, 372, 388, 398, 404, 410], sourceKey: "manual" },
  { key: "assays_validated", name: "Assays validated", category: "SCIENCE", unit: "COUNT", target: 30, pillar: "dataset", monthly: [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26], sourceKey: "manual" },
  { key: "heartready_studies", name: "HeartReady preclinical studies complete", category: "THERAPEUTICS", unit: "COUNT", target: 6, pillar: "heartready", goal: "heartready", monthly: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3], sourceKey: "manual" },
  { key: "partnerships_active", name: "Active strategic partnerships", category: "PARTNERSHIPS", unit: "COUNT", target: 4, pillar: "partnerships", monthly: [1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3], sourceKey: "manual" },
  { key: "headcount", name: "Headcount", category: "TEAM", unit: "COUNT", target: 58, pillar: "team", monthly: [31, 32, 34, 35, 37, 38, 40, 41, 43, 44, 46, 47], sourceKey: "manual" },
  { key: "open_key_roles", name: "Open leadership roles", category: "TEAM", unit: "COUNT", direction: "LOWER_IS_BETTER", target: 0, pillar: "team", monthly: [6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3], sourceKey: "manual" },
  { key: "enps", name: "Employee NPS", category: "TEAM", unit: "NUMBER", target: 40, pillar: "team", monthly: [32, 33, 35, 34, 36, 37, 36, 38, 39, 37, 38, 38], sourceKey: "manual" },
];

// ─── Brain signals ───────────────────────────────────────────────────────────

export type SignalSeed = {
  source: string;
  kind: SignalKind;
  title: string;
  body?: string;
  hoursAgo: number;
  person?: string;
  company?: string;
  deal?: string;
  /** Metadata; `links` values are entity keys resolved at seed time. */
  meta: Record<string, unknown> & { links?: Record<string, string> };
};

export const SIGNALS: SignalSeed[] = [
  // Ingested since yesterday's refresh
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 14, person: "karen", company: "brightwater", deal: "dlBrightwater", title: "Brightwater legal returned MSA v5 — clause 7.3 still open", body: "Our legal team accepted 14 of 16 redlines. Clause 7.3 (rights to derivative models) remains open; our CSO would like a CEO-to-CEO conversation before tomorrow's negotiation. Can you make time in the morning?", meta: { signalType: "response_needed", importance: 5, urgency: 5, whyCeo: "Brightwater's CSO asked for a CEO-level conversation on the last open clause of a $1.4M MSA.", recommendedAction: "Reply to Karen today confirming 9:00 tomorrow; align with Priya and Marcus on the field-limited license position first.", links: { decisionId: "dDataRights", milestoneId: "msBrightwater", goalId: "q4Brightwater" } } },
  { source: "hubspot", kind: "CRM_UPDATE", hoursAgo: 16, company: "brightwater", deal: "dlBrightwater", title: "Brightwater MSA moved Proposal → Contracting", meta: { signalType: "deal_stage_change", stageFrom: "Proposal", stageTo: "Contracting", importance: 4, summary: "$1.4M over three years at 70% probability; expected close in 18 days." } },
  { source: "hubspot", kind: "CRM_UPDATE", hoursAgo: 22, company: "northbridge", deal: "fnNorthbridge", title: "Northbridge Ventures moved First meeting → Partner meeting", meta: { signalType: "deal_stage_change", stageFrom: "First meeting", stageTo: "Partner meeting", importance: 4, summary: "Sarah Chen is bringing CytoHub to the full partnership on Thursday." } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 18, person: "sarah", company: "northbridge", deal: "fnNorthbridge", title: "Northbridge partner meeting confirmed — Thursday 10:00", body: "Partners will want to see cohort retention by customer and a clear view of why the human heart dataset is defensible. Could you bring both?", meta: { signalType: "commitment", importance: 5, summary: "Sarah asked for cohort retention by customer and a dataset-defensibility slide.", commitment: { title: "Bring cohort retention analysis and dataset-moat slide to Northbridge", dueOffset: 2, focusArea: "FUNDRAISING", priority: "P0", strategicImpact: 5, fundraisingImpact: 5, ceoUniqueness: 4, estimatedMinutes: 90 }, links: { goalId: "seriesB" } } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 9, person: "rachel", company: "lumen", deal: "dlLumen", title: "Escalation: assay turnaround at 19 days vs 10 contracted", body: "This is the third month we've missed the SLA. Our renewal committee meets in three weeks and I can't recommend renewal without a credible recovery plan.", meta: { signalType: "escalation", importance: 5, urgency: 5, summary: "Third consecutive SLA miss; $500K renewal at risk.", whyCeo: "A $500K renewal is at risk and the customer has escalated to executive level for the third time.", recommendedAction: "Take today's 11:00 call yourself: commit to a dated recovery plan (dedicated capacity + weekly SLA report) with Daniel as single owner.", links: { goalId: "arr" } } },
  { source: "granola", kind: "MEETING_NOTE", hoursAgo: 20, person: "tom", title: "Exec team: CardioPredict v2 validation at AUC 0.88", body: "Tom: hold-out AUC 0.88 vs 0.90 target. Options: ship now, delay six weeks, or limited release to design partners while retraining on 60 new donor hearts. Team leaning toward the limited release. Needs a CEO decision by Friday.", meta: { signalType: "decision_request", importance: 5, urgency: 4, summary: "Team recommends a limited release while retraining; decision needed by Friday.", whyCeo: "Launch scope changes the revenue plan, the Series B narrative and customer trust.", recommendedAction: "Decide by Friday. The team recommends a limited release to design partners while retraining.", links: { decisionId: "dCardio", milestoneId: "msAuc", goalId: "q4CardioGA" } } },
  { source: "hubspot", kind: "CRM_UPDATE", hoursAgo: 20, company: "calder", deal: "dlCalder", person: "henrik", title: "Calder Biosciences: pilot converted to a paid validation study ($350K)", meta: { signalType: "deal_won", importance: 4, summary: "Tenth active pharma customer; first conversion from the 2026 pilot program.", links: { milestoneId: "msCalder", goalId: "arr" } } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 11, person: "michael", company: "granite", title: "Board pre-read: Series B timeline and runway scenarios", body: "Please include the Series B timeline with named lead candidates and two runway scenarios (base, and the raise slipping one quarter) in Friday's pre-read.", meta: { signalType: "commitment", importance: 4, summary: "Board wants the raise timeline and two runway scenarios by Friday.", commitment: { title: "Send board pre-read with Series B timeline and runway scenarios", dueOffset: 3, focusArea: "STRATEGY", priority: "P1", strategicImpact: 4, fundraisingImpact: 4, ceoUniqueness: 4, estimatedMinutes: 120 }, links: { goalId: "seriesB" } } },
  { source: "sharepoint", kind: "DOCUMENT", hoursAgo: 13, person: "jonas", title: "Financial model v12 uploaded by Jonas Weber", body: "Updated burn and runway: 16.6 months at current burn; 24+ months with a $40M close in December.", meta: { signalType: "development", importance: 3, summary: "Runway 16.6 months at current burn; 24+ months post-close." } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 15, person: "ingrid", company: "nhi", deal: "ptNhi", title: "Nordic Heart Institute board approved the data partnership in principle", body: "We'd like comments on the term sheet by Friday so we can announce at the steering committee.", meta: { signalType: "opportunity", importance: 4, summary: "Term sheet comments due Friday; announcement planned at the steering committee.", whyCeo: "A signed academic data partnership is one of two 2026 partnership goals and a Series B proof point.", recommendedAction: "Get Marcus's legal review done by Thursday so you can sign Friday.", links: { milestoneId: "msNHI", goalId: "partners" } } },
  { source: "teams", kind: "MESSAGE", hoursAgo: 7, person: "sofia", title: "Laura Mitchell has a competing offer — needs an answer by Wednesday", meta: { signalType: "hiring_decision", importance: 5, urgency: 5, summary: "Final VP Sales candidate; four strong references.", whyCeo: "VP Sales is the most critical open seat; the search is five months late and the candidate has a deadline.", recommendedAction: "Approve the package today (within band) and call Laura personally to close.", links: { decisionId: "dVPSales", milestoneId: "msVPSales", goalId: "q4VPSales" } } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 9, person: "alex", company: "aster", deal: "ptAster", title: "Aster Cloud: 40% compute credits if signed by Oct 31", meta: { signalType: "opportunity", importance: 4, summary: "Worth roughly $400K of training compute over two years.", whyCeo: "Time-boxed concession tied to a stalled partnership you own.", recommendedAction: "Call Alex today; ask Elena to resolve the liability cap so you can sign before the deadline.", links: { milestoneId: "msAster", goalId: "partners" } } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 5, person: "david", company: "helix", deal: "fnHelix", title: "Helix: requesting a diligence session and data room access", meta: { signalType: "investor_request", importance: 4, urgency: 4, summary: "Helix is moving into diligence.", whyCeo: "Helix moving to diligence is a buying signal in an active raise; speed signals strength.", recommendedAction: "Grant data room access today and propose diligence dates next week.", links: { goalId: "seriesB" } } },
  { source: "sharepoint", kind: "DOCUMENT", hoursAgo: 19, company: "cardiasim", title: "Market intelligence: CardiaSim raises a $60M Series C", body: "CardiaSim announced a $60M Series C to launch an AI cardiac-safety product in H1 2027, trained on iPSC data rather than human hearts.", meta: { signalType: "risk", importance: 4, summary: "A better-funded competitor is entering cardiac-safety AI; differentiation rests on human heart data.", recommendation: "Sharpen the dataset-moat story for Thursday's Northbridge meeting." } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 6, person: "jonas", title: "Approval needed: Q4 marketing budget ($180K)", body: "Covers BIO-Europe presence and the CardioPredict v2 launch campaign. Needed by Thursday to secure the booth.", meta: { signalType: "approval_request", importance: 3, urgency: 3, summary: "BIO-Europe ($70K) plus launch campaign ($110K).", whyCeo: "Spend above your $100K approval threshold.", recommendedAction: "Approve BIO-Europe now; tie the launch campaign to the CardioPredict launch-scope decision.", dueOffset: 2 } },
  { source: "granola", kind: "MEETING_NOTE", hoursAgo: 21, person: "maya", title: "1:1 with Maya: third hospital site live in two weeks", meta: { signalType: "development", importance: 3, summary: "Riverside onboarding plan complete; first 12 hearts expected in November.", links: { milestoneId: "msSite3" } } },
  // Processed in yesterday's refresh
  { source: "hubspot", kind: "CRM_UPDATE", hoursAgo: 40, company: "aurelius", deal: "dlAurelius", title: "Aurelius expansion proposal sent ($900K)", meta: { signalType: "development", importance: 3 } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 50, person: "michael", company: "granite", title: "Granite Peak will take its full pro-rata ($4M)", meta: { signalType: "development", importance: 4, summary: "Insider commitment strengthens the lead conversation." } },
  { source: "granola", kind: "MEETING_NOTE", hoursAgo: 34, person: "michael", company: "granite", title: "Board check-in: a named lead is expected by mid-November", meta: { signalType: "risk", importance: 4, summary: "The board expects a named lead by mid-November to keep the December close." } },
  { source: "teams", kind: "MESSAGE", hoursAgo: 28, person: "elena", company: "aster", title: "Aster legal unresponsive for nine days", meta: { signalType: "risk", importance: 3, summary: "Compute partnership is past its target date." } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 60, person: "olivia", company: "solstice", title: "Solstice: interested — will circle back after their IC offsite", meta: { signalType: "development", importance: 2 } },
  { source: "outlook-mail", kind: "EMAIL", hoursAgo: 30, person: "henrik", company: "calder", title: "Calder budget approved for the paid study", meta: { signalType: "opportunity", importance: 3 } },
];
