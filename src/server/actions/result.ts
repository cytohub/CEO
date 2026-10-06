import { z } from "zod";
import { audit } from "@/server/security/audit";
import type { Capability } from "@/server/security/rbac";
import { AuthError, ForbiddenError, requireCapability } from "@/server/security/session";

export type ActionResult<T = void> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

/**
 * Run an action body: verify the caller (server actions are reachable by
 * direct POST, so every one re-checks the session and capability), then map
 * validation and unexpected errors to a result.
 */
export async function attempt<T>(fn: () => Promise<ActionResult<T>>, opts: { capability?: Capability } = {}): Promise<ActionResult<T>> {
  const capability = opts.capability ?? "workspace.edit";
  try {
    await requireCapability(capability);
    return await fn();
  } catch (error) {
    if (error instanceof AuthError) return fail(error.message);
    if (error instanceof ForbiddenError) {
      await audit({ action: "auth.denied", outcome: "DENIED", metadata: { capability } });
      return fail(error.message);
    }
    if (error instanceof z.ZodError) {
      return fail(error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
    }
    console.error("[action]", error);
    return fail(error instanceof Error ? error.message : "Something went wrong");
  }
}

/** attempt() with an explicit capability, for actions outside the workspace. */
export function attemptAs<T>(capability: Capability, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  return attempt(fn, { capability });
}

// Shared input schemas
export const id = z.string().min(1);
export const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .nullable()
  .optional();
export const rating = z.coerce.number().int().min(0).max(5);
