import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single Prisma client per process. In development the instance is cached on
 * globalThis so hot reloads don't exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { __cytohubDb?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at PostgreSQL.",
    );
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const db: PrismaClient = globalForPrisma.__cytohubDb ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__cytohubDb = db;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
