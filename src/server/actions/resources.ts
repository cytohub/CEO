"use server";

import { z } from "zod";
import { ResourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, ok, type ActionResult } from "./result";

const ids = z.array(z.string()).max(50).optional();

const resourceSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(240),
  type: z.enum(ResourceType),
  url: z.union([z.url(), z.literal("")]).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  summary: z.string().trim().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  goalIds: ids,
  taskIds: ids,
  milestoneIds: ids,
  decisionIds: ids,
  personIds: ids,
  companyIds: ids,
});

export type ResourceInput = z.input<typeof resourceSchema>;

const conn = (list?: string[]) => (list ? { set: list.map((id) => ({ id })) } : undefined);

export async function createResource(input: ResourceInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = resourceSchema.parse(input);
    const r = await db.resource.create({
      data: {
        title: data.title,
        type: data.type,
        url: data.url || null,
        description: data.description,
        summary: data.summary,
        tags: data.tags ?? [],
        goals: data.goalIds?.length ? { connect: data.goalIds.map((id) => ({ id })) } : undefined,
        tasks: data.taskIds?.length ? { connect: data.taskIds.map((id) => ({ id })) } : undefined,
        milestones: data.milestoneIds?.length ? { connect: data.milestoneIds.map((id) => ({ id })) } : undefined,
        decisions: data.decisionIds?.length ? { connect: data.decisionIds.map((id) => ({ id })) } : undefined,
        people: data.personIds?.length ? { connect: data.personIds.map((id) => ({ id })) } : undefined,
        companies: data.companyIds?.length ? { connect: data.companyIds.map((id) => ({ id })) } : undefined,
      },
    });
    await logActivity(db, { type: "RESOURCE_ADDED", summary: `Resource added: ${r.title}` });
    revalidateAll();
    return ok({ id: r.id }, "Resource added");
  });
}

export async function updateResource(resourceId: string, input: Partial<ResourceInput>): Promise<ActionResult> {
  return attempt(async () => {
    const data = resourceSchema.partial().parse(input);
    await db.resource.update({
      where: { id: resourceId },
      data: {
        title: data.title,
        type: data.type,
        url: data.url === undefined ? undefined : data.url || null,
        description: data.description,
        summary: data.summary,
        tags: data.tags,
        goals: conn(data.goalIds),
        tasks: conn(data.taskIds),
        milestones: conn(data.milestoneIds),
        decisions: conn(data.decisionIds),
        people: conn(data.personIds),
        companies: conn(data.companyIds),
      },
    });
    revalidateAll();
    return ok(undefined, "Resource updated");
  });
}

export async function deleteResource(resourceId: string): Promise<ActionResult> {
  return attempt(async () => {
    await db.resource.delete({ where: { id: resourceId } });
    revalidateAll();
    return ok(undefined, "Resource removed");
  });
}
