import { NextRequest, NextResponse } from "next/server";
import { inklingAudio, INKLING_MODEL } from "@/lib/models";
import { mockTranscript } from "@/lib/mock";

export const runtime = "nodejs";
export const maxDuration = 300;

const MOCK = process.env.NEURAL_MOCK === "1";

/**
 * Voice → Inkling → text.
 *
 * The browser sends a 16 kHz mono WAV (Inkling's stated audio spec). We hand it
 * to Inkling as an OpenAI-style `input_audio` content part and ask it to both
 * TRANSCRIBE and briefly characterise intent. The transcript is what the client
 * then injects into the Hermes brain (/api/chat).
 *
 * Inkling is the "ears"; Hermes never sees the audio.
 */
export async function POST(req: NextRequest) {
  try {
    if (MOCK) {
      // Simulate Inkling's audio latency, then return a demo transcript.
      await new Promise((r) => setTimeout(r, 700));
      return NextResponse.json(mockTranscript());
    }

    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "missing audio file" }, { status: 400 });
    }

    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const res = await inklingAudio.chat.completions.create({
      model: INKLING_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Transcribe the speech verbatim. Then on a new line prefixed " +
                "'INTENT:' give a one-sentence summary of what the speaker wants.",
            },
            { type: "input_audio", input_audio: { data: b64, format: "wav" } },
          ],
        },
      ],
      // Cheap effort — this is perception, not reasoning.
      reasoning_effort: "low",
      max_tokens: 600,
    });

    const raw = res.choices[0]?.message?.content ?? "";
    const [transcriptLine, ...rest] = raw.split(/\nINTENT:/i);
    return NextResponse.json({
      transcript: transcriptLine.trim(),
      intent: rest.join(" ").trim() || null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
