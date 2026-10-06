/**
 * CONTRACT STUB — implemented by the providers & sync workstream.
 * Connection lifecycle used by Settings → Integrations and OAuth callbacks.
 */
import type { SourceConnection } from "@/generated/prisma/client";
import type { SourceKind, SourceProvider } from "@/generated/prisma/enums";
import type { ProviderContext } from "./types";

/** Create a DEMO-mode connection backed by the mock adapters (sample CytoHub data). */
export async function createDemoConnection(_kind: SourceKind, _provider: SourceProvider, _owner: { userId: string }): Promise<SourceConnection> {
  throw new Error("createDemoConnection: not implemented yet");
}

/** Disconnect: revoke/forget credentials, stop webhooks; optionally delete ingested data per retention. */
export async function disconnectConnection(_connectionId: string, _opts: { deleteData: boolean; actor: { userId: string; email: string } }): Promise<void> {
  throw new Error("disconnectConnection: not implemented yet");
}

/** Build the ProviderContext for a connection (token refresh for LIVE connections). */
export async function getProviderContext(_connectionId: string, _now?: Date): Promise<ProviderContext> {
  throw new Error("getProviderContext: not implemented yet");
}
