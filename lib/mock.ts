/**
 * Mock backend — drives the real UI (SSE stream, tool-trace, voice pipeline)
 * with no models, keys, or downloads. Enabled by NEURAL_MOCK=1.
 *
 * It mimics the true orchestrator's event shape exactly (token / tool / done),
 * and applies simple keyword routing so the Hermes→Inkling delegation fires on
 * the prompts that would really trigger it.
 */

type Send = (event: string, data: unknown) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream a string to the client word-by-word, like real token streaming. */
async function streamText(text: string, send: Send, perTokenMs = 22) {
  for (const tok of text.match(/\S+\s*/g) ?? [text]) {
    send("token", tok);
    await sleep(perTokenMs);
  }
}

const EFFORT_DELAY: Record<string, number> = {
  low: 500, medium: 900, high: 1500, xhigh: 2200, max: 3200,
};

/** Decide, from the last user turn, whether Hermes would delegate/tool-call. */
function route(text: string): "time" | "inkling" | "direct" {
  const t = text.toLowerCase();
  if (/\b(time|what.*o'?clock|date today)\b/.test(t)) return "time";
  if (
    /\d/.test(t) ||
    /\b(solve|calculate|reason|prove|why|how many|compare|analy|explain the|step by step|derive)\b/.test(t)
  ) return "inkling";
  if (/\b(neural chat|hermes|inkling|route|architecture)\b/.test(t)) return "direct";
  return text.length > 90 ? "inkling" : "direct";
}

/** If the prompt is a simple "A times B", return worked partial-product steps. */
function arithmeticSteps(text: string): string | null {
  const m = text.match(/(\d+)\s*(?:times|x|\*|×)\s*(\d+)/i);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const bOnes = b % 10;
  const bTens = b - bOnes;
  return [
    `Breaking ${a} × ${b} into partial products:`,
    "",
    `• ${a} × ${bTens} = ${a * bTens}`,
    `• ${a} × ${bOnes} = ${a * bOnes}`,
    `• Sum: ${a * bTens} + ${a * bOnes} = ${a * b}`,
    "",
    `So ${a} × ${b} = **${a * b}**.`,
  ].join("\n");
}

function answerFor(text: string, kind: string): string {
  const t = text.toLowerCase();
  if (kind === "time") {
    return `It's currently ${new Date().toLocaleString()}. (Answered with the local get_current_time tool — no model call needed.)`;
  }
  const arith = arithmeticSteps(text);
  if (arith) return arith;
  if (/train/.test(t) && /catch/.test(t)) {
    return [
      "Let me set it up. The first train leaves at 2:15 at 60 mph; the second at 2:45 at 80 mph — a 30-minute (0.5 h) head start.",
      "",
      "Head start distance: 60 × 0.5 = 30 miles.",
      "Closing speed: 80 − 60 = 20 mph.",
      "Time to close 30 miles: 30 ÷ 20 = 1.5 hours after 2:45.",
      "",
      "So the second train catches the first at **4:15 pm**, 120 miles from the start.",
    ].join("\n");
  }
  if (/neural chat|route|architecture|hermes|inkling/.test(t)) {
    return [
      "Neural Chat runs a two-model split:",
      "",
      "• Hermes is the orchestrator brain — it handles every turn, plans, and calls tools.",
      "• Inkling is the specialist — I delegate to it for anything multimodal (your voice/images) or that needs careful reasoning, via the inkling_reason tool.",
      "",
      "Your voice never touches Hermes directly: mic → Inkling (16 kHz audio understanding) → transcript → Hermes. That's why the trace above sometimes says \"Delegating to Inkling.\"",
    ].join("\n");
  }
  if (kind === "inkling") {
    return "Inkling worked through this and passed the result back to Hermes. (In mock mode I don't have a canned answer for this exact prompt — wire real HERMES_*/INKLING_* endpoints for a genuine response.)";
  }
  return "Hermes handled this directly — it didn't need deep reasoning or a tool. Ask me something with numbers, or say it out loud, to watch the Inkling delegation kick in.";
}

/** Full mock chat turn. `messages` is the OpenAI-style history. */
export async function mockChat(
  messages: { role: string; content: string }[],
  effort: string,
  send: Send
) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = String(lastUser?.content ?? "");
  const kind = route(text);

  await sleep(450); // Hermes "thinking"

  if (kind === "time") {
    send("tool", { name: "get_current_time", args: {} });
    await sleep(350);
  } else if (kind === "inkling") {
    send("tool", { name: "inkling_reason", args: { prompt: text, effort } });
    await sleep(EFFORT_DELAY[effort] ?? 900); // deeper effort = longer wait
  }

  await streamText(answerFor(text, kind), send);
  send("done", { ok: true });
}

/** Mock voice transcript — ignores the audio and returns a demo utterance. */
export function mockTranscript() {
  const options = [
    "What is seventeen times twenty-three?",
    "Explain how Neural Chat routes between Hermes and Inkling.",
    "What time is it right now?",
  ];
  // Deterministic pick (no Math.random in some runtimes): rotate by seconds.
  return { transcript: options[new Date().getSeconds() % options.length], intent: null };
}
