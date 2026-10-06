/**
 * Claude integration for CytoHub Brain.
 *
 * Optional by design: every Brain feature has a deterministic rules engine,
 * and Claude upgrades the narrative layers (Chief of Staff, Prepare Me, the
 * daily brief headline) when credentials are present.
 */
import Anthropic from "@anthropic-ai/sdk";

export const CLAUDE_MODEL = process.env.CYTOHUB_CLAUDE_MODEL || "claude-opus-5-5";

/**
 * Server-side refusal fallback: on a policy decline the API re-runs the same
 * request on Anthropic's recommended fallback model inside the same call.
 */
export const CLAUDE_BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

export function claudeEnabled(): boolean {
  if (process.env.CYTOHUB_DISABLE_CLAUDE === "true") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
export function getClaude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * One-shot text generation with graceful degradation: returns null on any
 * error or refusal so callers can fall back to rules-based output.
 */
export async function generateText(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<string | null> {
  if (!claudeEnabled()) return null;
  try {
    const response = await getClaude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      betas: CLAUDE_BETAS,
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "low" },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[claude] API error ${error.status}: ${error.message}`);
    } else {
      console.error("[claude] request failed", error);
    }
    return null;
  }
}

/**
 * Structured generation: Claude returns JSON matching `schema`
 * (structured outputs). Returns null on any failure so callers fall back.
 */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<T | null> {
  if (!claudeEnabled()) return null;
  try {
    const response = await getClaude().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      betas: CLAUDE_BETAS,
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "medium", format: { type: "json_schema", schema: opts.schema } },
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof Anthropic.APIError) console.error(`[claude] API error ${error.status}: ${error.message}`);
    else console.error("[claude] structured request failed", error);
    return null;
  }
}
