import type OpenAI from "openai";
import { inkling, INKLING_MODEL, type ReasoningEffort } from "./models";

/**
 * The Hermes system prompt. Hermes is trained on the ChatML + <tools> agent
 * convention; we hand it standard OpenAI `tools` (vLLM's `--tool-call-parser
 * hermes` maps its native <tool_call> tags onto this schema), and steer it to
 * DELEGATE anything multimodal or genuinely hard to Inkling instead of guessing.
 */
export const HERMES_SYSTEM_PROMPT = `You are Neural Chat, a helpful agentic assistant.

You are the ORCHESTRATOR. You are fast and good at planning and tool use, but you
cannot see images or hear audio, and you should not attempt heavy step-by-step
reasoning yourself. For any of the following, call the \`inkling_reason\` tool and
use its answer:
  • questions about an image or audio the user provided,
  • math / logic / multi-step reasoning that needs care,
  • long-document analysis.

Call exactly one tool at a time and wait for its result before continuing.
When you have enough information, answer the user directly and concisely.`;

/** Tools exposed to Hermes. `inkling_reason` is the bridge to the 975B brain. */
export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "inkling_reason",
      description:
        "Delegate a hard-reasoning, long-context, or multimodal subtask to Inkling (975B). Use for math/logic, careful analysis, or anything about a provided image/audio.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Self-contained instruction/question for Inkling.",
          },
          image_url: {
            type: "string",
            description: "Optional image URL or data: URI to reason over.",
          },
          effort: {
            type: "string",
            enum: ["low", "medium", "high", "xhigh", "max"],
            description:
              "Reasoning effort. Higher = deeper but more tokens/cost. Default medium.",
          },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Return the current server time in ISO-8601. A cheap local tool (no model call).",
      parameters: { type: "object", properties: {} },
    },
  },
];

/** Executes a Hermes-requested tool call and returns a string result. */
export async function runTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_current_time":
      return new Date().toISOString();

    case "inkling_reason": {
      const prompt = String(args.prompt ?? "");
      const effort = (args.effort as ReasoningEffort) ?? "medium";
      const imageUrl = args.image_url ? String(args.image_url) : undefined;

      const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
      ];
      if (imageUrl) {
        content.push({ type: "image_url", image_url: { url: imageUrl } });
      }

      const res = await inkling.chat.completions.create({
        model: INKLING_MODEL,
        messages: [{ role: "user", content }],
        // Inkling-specific knob passed through the OpenAI-compatible endpoint.
        // @ts-expect-error non-standard field forwarded verbatim by vLLM/SGLang.
        reasoning_effort: effort,
        max_tokens: 2000,
      });
      return res.choices[0]?.message?.content ?? "(no answer)";
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
