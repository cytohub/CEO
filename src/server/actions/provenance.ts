"use server";

import { z } from "zod";
import { EntityType } from "@/generated/prisma/enums";
import { getProvenance, type Provenance } from "@/server/queries/provenance";
import { ForbiddenError, can, requireViewer } from "@/server/security/session";

const input = z.object({ targetType: z.enum(EntityType), targetId: z.string().min(1).max(64) });

/**
 * Provenance for the View Source sheet. Any workspace, Brain or cockpit viewer
 * may ask; what comes back is filtered by their source access scope.
 */
export async function fetchProvenance(targetType: string, targetId: string): Promise<Provenance | null> {
  const viewer = await requireViewer();
  if (!can(viewer, "workspace.view") && !can(viewer, "brain.view") && !can(viewer, "cockpit.view")) throw new ForbiddenError("brain.view");
  const parsed = input.safeParse({ targetType, targetId });
  if (!parsed.success) return null;
  return getProvenance(viewer, parsed.data.targetType, parsed.data.targetId);
}
