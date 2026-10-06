import { z } from "zod";

export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/** Run an action body, mapping validation and unexpected errors to a result. */
export async function attempt<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
    }
    console.error("[action]", error);
    return fail(error instanceof Error ? error.message : "Something went wrong");
  }
}

// Shared input schemas
export const id = z.string().min(1);
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .nullable()
  .optional();
export const rating = z.coerce.number().int().min(0).max(5);
