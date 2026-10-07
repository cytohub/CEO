/**
 * First-time setup of a production database — no demo data:
 *
 *   npm run db:bootstrap -- --name "Your Name" --email rb@cytohub.com [--timezone America/New_York]
 *
 * Run it once after `npm run db:migrate`, with DATABASE_URL pointing at the
 * production database. It creates the Brain source catalog and the CEO's
 * account, and prints a one-time password that must be replaced at first
 * sign-in. Safe to re-run: the catalog is upserted and an existing CEO is
 * left alone. Everyone else is added from Settings → Users & access.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "../src/lib/db";
import { CONNECTOR_DEFINITIONS } from "../src/server/brain/connectors";
import { generateOneTimePassword, hashPassword } from "../src/server/security/passwords";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    email: { type: "string" },
    timezone: { type: "string", default: process.env.DEFAULT_TIMEZONE || "America/New_York" },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  // Source catalog: one row per connector type; accounts attach to it when connected.
  for (const c of CONNECTOR_DEFINITIONS) {
    await db.brainSource.upsert({
      where: { key: c.key },
      create: { key: c.key, name: c.name, category: c.category, description: c.description, status: c.key === "workspace" ? "CONNECTED" : "NOT_CONNECTED", config: { provider: c.provider } },
      update: { name: c.name, category: c.category, description: c.description },
    });
  }
  console.log(`✓ Source catalog: ${CONNECTOR_DEFINITIONS.length} connectors`);

  const existing = await db.user.findFirst({ where: { role: "CEO" }, select: { email: true } });
  if (existing) {
    console.log(`✓ CEO account already exists (${existing.email}) — nothing else to do.`);
    return;
  }

  const name = values.name?.trim();
  const email = values.email?.trim().toLowerCase();
  if (!name) fail('Pass the CEO\'s name: --name "Your Name"');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Pass the CEO's work email: --email you@company.com");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
  } catch {
    fail(`Unknown timezone "${values.timezone}" — use an IANA name such as America/New_York`);
  }
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) fail(`A user with ${email} already exists`);

  const oneTimePassword = generateOneTimePassword();
  const passwordHash = await hashPassword(oneTimePassword);
  await db.$transaction(async (tx) => {
    const person =
      (await tx.person.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })) ??
      (await tx.person.create({ data: { name, email, title: "Chief Executive Officer", type: "TEAM", isCeo: true, department: "Office of the CEO" } }));
    await tx.person.update({ where: { id: person.id }, data: { isCeo: true } });
    await tx.user.create({
      data: { name, email, title: "Chief Executive Officer", timezone: values.timezone, role: "CEO", personId: person.id, passwordHash, mustChangePassword: true },
    });
  });

  console.log(`✓ CEO account created for ${name} <${email}> (${values.timezone})`);
  console.log("");
  console.log(`  One-time password:  ${oneTimePassword}`);
  console.log("");
  console.log("  It is shown only once. Sign in with it, and you'll be asked to choose your own password.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
