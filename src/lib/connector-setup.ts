/**
 * How to connect each key- or webhook-based source: where the CEO creates the
 * key at the vendor, the read-only permissions it needs, and where the
 * vendor's own instructions live. Shown in Settings → Integrations; the full
 * walkthrough, including the server-side OAuth apps, is docs/CONNECTORS.md.
 */
import type { SourceProvider } from "@/generated/prisma/enums";

export interface KeySetup {
  /** What the vendor calls the secret ("Service key", "User token"…). */
  keyLabel: string;
  steps: string[];
  /** Read-only permissions to tick when creating the key. */
  permissions: string[];
  note?: string;
  docsUrl: string;
}

export const KEY_SETUP: Partial<Record<SourceProvider, KeySetup>> = {
  HUBSPOT: {
    keyLabel: "Service key",
    steps: [
      "In HubSpot (as a super admin), open Development → Keys → Service keys. Some accounts show it under Settings → Integrations → Service keys.",
      "Choose Create service key and name it “CytoHub CEO”.",
      "Add the read scopes below, then Create.",
      "Copy the key and paste it here.",
    ],
    permissions: ["crm.objects.deals.read", "crm.objects.companies.read", "crm.objects.owners.read"],
    note: "Pipelines named for investors or fundraising count as fundraising; partnership pipelines as partnerships; everything else as sales.",
    docsUrl: "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys",
  },
  BREX: {
    keyLabel: "User token",
    steps: [
      "In Brex, sign in as an account admin and open Developer (Settings → Developer).",
      "Choose Create token and name it “CytoHub CEO”.",
      "Give it read-only access to the permissions below, then create it.",
      "Copy the token and paste it here.",
    ],
    permissions: ["Cash accounts (read)", "Cash transactions (read)", "Card transactions (read)"],
    note: "Brex expires tokens that go unused for 90 days; the hourly sync keeps this one active.",
    docsUrl: "https://developer.brex.com/docs/authentication/",
  },
  GRANOLA: {
    keyLabel: "API key",
    steps: [
      "In Granola, open Settings → Connectors → API keys. The API needs a Business or Enterprise plan.",
      "Create a key and copy it.",
      "Paste it here. Notes from the last 90 days are imported first, then new notes every hour.",
    ],
    permissions: ["Read notes (the key is read-only)"],
    note: "Your private notes are included only for notes you created, because the key belongs to you.",
    docsUrl: "https://docs.granola.ai",
  },
  READ_AI: {
    keyLabel: "Webhook signing key",
    steps: [
      "In Read AI, open Integrations → Webhooks and add a new personal webhook (a workspace webhook would send everyone’s meetings).",
      "Paste the webhook URL below as the endpoint and choose Meeting end as the trigger.",
      "Copy the signing key Read AI shows for the webhook and paste it here.",
    ],
    permissions: ["Meeting reports sent after each meeting (Read AI pushes; nothing is pulled)"],
    note: "Every delivery is checked against the signing key; anything unsigned or altered is rejected. Webhooks created before March 2026 send no signature, so create a new one.",
    docsUrl: "https://support.read.ai/hc/en-us/articles/16352415827219-Getting-Started-with-Webhooks",
  },
};
