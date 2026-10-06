import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export const milestoneInclude = {
  goal: { select: { id: true, title: true } },
  pillar: { select: { id: true, name: true, color: true } },
  owner: { select: { id: true, name: true, isCeo: true } },
  _count: { select: { tasks: true } },
} satisfies Prisma.MilestoneInclude;

export type MilestoneRow = Prisma.MilestoneGetPayload<{ include: typeof milestoneInclude }>;

export async function getMilestones() {
  return db.milestone.findMany({ include: milestoneInclude, orderBy: { dueDate: "asc" } });
}

export const milestoneDetailInclude = {
  ...milestoneInclude,
  tasks: {
    orderBy: [{ status: "asc" }, { priorityScore: "desc" }],
    select: { id: true, title: true, status: true, dueDate: true, priorityScore: true, owner: { select: { name: true, isCeo: true } } },
  },
  resources: { select: { id: true, title: true, type: true, url: true } },
  notes: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, body: true, createdAt: true, author: true } },
  activities: { orderBy: { createdAt: "desc" }, take: 15, select: { id: true, summary: true, createdAt: true, actor: true } },
  insights: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, type: true } },
} satisfies Prisma.MilestoneInclude;

export type MilestoneDetail = Prisma.MilestoneGetPayload<{ include: typeof milestoneDetailInclude }>;

export async function getMilestoneDetail(id: string): Promise<MilestoneDetail | null> {
  return db.milestone.findUnique({ where: { id }, include: milestoneDetailInclude });
}
