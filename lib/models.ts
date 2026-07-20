import OpenAI from "openai";

/**
 * Two OpenAI-compatible clients — the whole architecture rests on the fact that
 * both Hermes and Inkling can be served behind the OpenAI HTTP schema
 * (vLLM / SGLang / Together / Fireworks / HF router).
 *
 *   HERMES  → the orchestrator "brain": cheap, fast, tight tool discipline.
 *   INKLING → the multimodal + heavy-reasoning specialist (voice, vision, hard reasoning).
 */

export const hermes = new OpenAI({
  baseURL: process.env.HERMES_BASE_URL,
  apiKey: process.env.HERMES_API_KEY ?? "sk-local",
});
export const HERMES_MODEL = process.env.HERMES_MODEL ?? "hermes";

export const inkling = new OpenAI({
  baseURL: process.env.INKLING_BASE_URL,
  apiKey: process.env.INKLING_API_KEY ?? "sk-local",
});
export const INKLING_MODEL = process.env.INKLING_MODEL ?? "inkling";

/**
 * Audio can live on a different host than text/vision because hosted routers
 * did not expose Inkling audio at launch. Falls back to the main Inkling host.
 */
export const inklingAudio = new OpenAI({
  baseURL: process.env.INKLING_AUDIO_BASE_URL || process.env.INKLING_BASE_URL,
  apiKey:
    process.env.INKLING_AUDIO_API_KEY ||
    process.env.INKLING_API_KEY ||
    "sk-local",
});

/** Inkling's headline knob — trade tokens/cost for reasoning depth. */
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
