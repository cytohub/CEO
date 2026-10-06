/** Clean, round axis maximum and whole-number tick step for a count axis (0 … max). Pure. */
export function niceAxis(maxValue: number, targetTicks = 4): { max: number; step: number } {
  if (!(maxValue > 0)) return { max: targetTicks, step: 1 };
  const raw = maxValue / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const intStep = Math.max(1, Math.ceil(step));
  return { max: Math.ceil(maxValue / intStep) * intStep, step: intStep };
}
