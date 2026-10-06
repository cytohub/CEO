/**
 * CONTRACT STUB — implemented by the resolution & write workstream.
 * Knowledge-graph queries over Relationship edges + hard foreign keys.
 */
import type { EntityType, RelationType } from "@/generated/prisma/enums";

export interface GraphNode {
  type: EntityType;
  id: string;
}

export interface GraphNeighbor extends GraphNode {
  relation: RelationType;
  direction: "out" | "in";
  confidence: number;
  evidenceCount: number;
  lastSeenAt: Date;
}

export async function neighbors(_node: GraphNode, _opts: { relations?: RelationType[]; types?: EntityType[]; limit?: number } = {}): Promise<GraphNeighbor[]> {
  throw new Error("neighbors: not implemented yet");
}

/** Source items connected to an entity (mentions, threads/documents about it, meetings it attended). Newest first. */
export async function sourceItemIdsForEntity(_node: GraphNode, _opts: { limit?: number; since?: Date } = {}): Promise<string[]> {
  throw new Error("sourceItemIdsForEntity: not implemented yet");
}

/** A company plus its corporate family (parent and subsidiaries), for "everything related to J&J". */
export async function companyFamilyIds(_companyId: string): Promise<string[]> {
  throw new Error("companyFamilyIds: not implemented yet");
}
