import { NextRequest } from "next/server";
import type OpenAI from "openai";
import { hermes, HERMES_MODEL } from "@/lib/models";
import { HERMES_SYSTEM_PROMPT, tools, runTool } from "@/lib/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const MAX_TOOL_HOPS = 5;

/**
 * The Hermes orchestrator loop.
 *
 *   1. Send the conversation + tools to Hermes (the brain).
 *   2. If Hermes emits tool calls, run them (inkling_reason bridges to Inkling)
 *      and feed results back — up to MAX_TOOL_HOPS times.
 *   3. Once Hermes produces a plain answer, stream it to the client.
 *
 * Steps 1–2 are non-streamed (we need the full tool_calls object); the final
 * answer is streamed token-by-token.
 */
export async function POST(req: NextRequest) {
  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  const convo: ChatMessage[] = [
    { role: "system", content: HERMES_SYSTEM_PROMPT },
    ...messages,
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
          const res = await hermes.chat.completions.create({
            model: HERMES_MODEL,
            messages: convo,
            tools,
            tool_choice: "auto",
            temperature: 0.7,
          });

          const msg = res.choices[0]?.message;
          if (!msg) break;

          // No tool calls → Hermes already produced the final answer above.
          // Emit it (chunked so the UI renders progressively) and finish.
          if (!msg.tool_calls?.length) {
            const text = msg.content ?? "";
            for (let i = 0; i < text.length; i += 24) {
              send("token", text.slice(i, i + 24));
            }
            send("done", { ok: true });
            controller.close();
            return;
          }

          // Otherwise: record the tool-call turn, execute each tool, loop.
          convo.push(msg);
          for (const call of msg.tool_calls) {
            const name = call.function.name;
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function.arguments || "{}");
            } catch {
              /* leave args empty on malformed JSON */
            }
            send("tool", { name, args });
            const result = await runTool(name, args);
            convo.push({
              role: "tool",
              tool_call_id: call.id,
              content: result,
            });
          }
        }

        // Hit the hop limit — ask Hermes for a final answer with tools off.
        const wrap = await hermes.chat.completions.create({
          model: HERMES_MODEL,
          messages: convo,
          temperature: 0.7,
          stream: true,
        });
        for await (const chunk of wrap) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) send("token", delta);
        }
        send("done", { ok: true });
        controller.close();
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
