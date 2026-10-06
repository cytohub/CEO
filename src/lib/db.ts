import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single Prisma client per process, created on first use (importing this
 * module has no side effects, so pure modules and unit tests can depend on it
 * without a database). In development the instance is cached on globalThis so
 * hot reloads don't exhaust the connection pool.
 */
const globalForPrisma = globalThis as unknown as { __cytohubDb?: PrismaClient };

function client(): PrismaClient {
  if (globalForPrisma.__cytohubDb) return globalForPrisma.__cytohubDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and point it at PostgreSQL.");
  }
  const created = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalForPrisma.__cytohubDb = created;
  return created;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = Reflect.get(client(), prop);
    return typeof value === "function" ? value.bind(client()) : value;
  },
});

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
