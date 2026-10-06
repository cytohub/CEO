/**
 * CEO attention allocation: where time actually went (calendar + task effort)
 * versus where the CEO intends it to go (AttentionTarget).
 */
import type { FocusArea } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { FOCUS_AREA_ORDER, FOCUS_AREAS } from "@/lib/domain";

export interface AttentionArea {
  area: FocusArea;
  label: string;
  minutes: number;
  actualPct: number;
  recommendedPct: number;
  /** actual − recommended, in percentage points. */
  gap: number;
  flag: "under" | "over" | null;
  rationale: string | null;
}

export interface AttentionSummary {
  windowDays: number;
  from: Date;
  to: Date;
  totalMinutes: number;
  areas: AttentionArea[];
  /** Share of time on strategic (vs operational) areas. */
  strategicPct: number;
  misaligned: AttentionArea[];
}

export async function computeAttention(
  client: Db | Tx,
  opts: { today: Date; windowDays: number; tolerance: number; from?: Date; to?: Date },
): Promise<AttentionSummary> {
  const to = opts.to ?? opts.today;
  const from = opts.from ?? addDays(to, -(opts.windowDays - 1));
  const entries = await client.timeEntry.groupBy({
    by: ["focusArea"],
    where: { date: { gte: from, lte: to } },
    _sum: { minutes: true },
  });
  const targets = await client.attentionTarget.findMany();

  const minutesBy = new Map(entries.map((e) => [e.focusArea, e._sum.minutes ?? 0]));
  const targetBy = new Map(targets.map((t) => [t.focusArea, t]));
  const totalMinutes = [...minutesBy.values()].reduce((a, b) => a + b, 0);

  const areas: AttentionArea[] = FOCUS_AREA_ORDER.map((area) => {
    const minutes = minutesBy.get(area) ?? 0;
    const actualPct = totalMinutes ? (minutes / totalMinutes) * 100 : 0;
    const target = targetBy.get(area);
    const recommendedPct = target?.recommendedPct ?? 0;
    const gap = actualPct - recommendedPct;
    let flag: AttentionArea["flag"] = null;
    if (totalMinutes > 0) {
      if (recommendedPct >= 3 && actualPct < recommendedPct * (1 - opts.tolerance) && gap <= -3) flag = "under";
      else if (actualPct > recommendedPct * (1 + opts.tolerance) && gap >= 4) flag = "over";
    }
    return {
      area,
      label: FOCUS_AREAS[area].label,
      minutes,
      actualPct: Math.round(actualPct * 10) / 10,
      recommendedPct,
      gap: Math.round(gap * 10) / 10,
      flag,
      rationale: target?.rationale ?? null,
    };
  });

  const strategicMinutes = areas.filter((a) => FOCUS_AREAS[a.area].strategic).reduce((s, a) => s + a.minutes, 0);

  return {
    windowDays: opts.windowDays,
    from,
    to,
    totalMinutes,
    areas,
    strategicPct: totalMinutes ? Math.round((strategicMinutes / totalMinutes) * 100) : 0,
    misaligned: areas.filter((a) => a.flag).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)),
  };
}
