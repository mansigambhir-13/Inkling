"use client";

import { useRef, useState } from "react";
import { MicRecorder } from "@/lib/wav";

type Role = "user" | "assistant";
interface Msg { role: Role; content: string; }

export default function NeuralChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [trace, setTrace] = useState<string | null>(null);
  const recorder = useRef<MicRecorder | null>(null);

  /** Send a user turn to the Hermes brain and stream the reply. */
  async function sendToHermes(history: Msg[]) {
    setBusy(true);
    setMessages([...history, { role: "assistant", content: "" }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const block of events) {
        const ev = block.match(/event: (.*)/)?.[1];
        const data = block.match(/data: (.*)/)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === "token") {
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = {
              role: "assistant",
              content: copy[copy.length - 1].content + payload,
            };
            return copy;
          });
        } else if (ev === "tool") {
          setTrace(
            payload.name === "inkling_reason"
              ? "🧠 delegating to Inkling…"
              : `🔧 ${payload.name}…`
          );
        } else if (ev === "done") {
          setTrace(null);
        } else if (ev === "error") {
          setTrace(null);
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { role: "assistant", content: `⚠️ ${payload.message}` };
            return copy;
          });
        }
      }
    }
    setBusy(false);
  }

  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendToHermes([...messages, { role: "user", content: text }]);
  }

  /** Voice: mic → Inkling (/api/voice) → transcript → Hermes brain. */
  async function toggleMic() {
    if (busy) return;
    if (!recording) {
      recorder.current = new MicRecorder();
      await recorder.current.start();
      setRecording(true);
      return;
    }

    setRecording(false);
    setTrace("🎤 Inkling is listening…");
    const wav = await recorder.current!.stop();

    const fd = new FormData();
    fd.append("audio", wav, "input.wav");
    const res = await fetch("/api/voice", { method: "POST", body: fd });
    const { transcript, error } = await res.json();
    setTrace(null);

    if (error) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ voice: ${error}` }]);
      return;
    }
    const text = (transcript || "").trim();
    if (!text) return;
    // The voice transcript becomes a normal user turn into the Hermes brain.
    await sendToHermes([...messages, { role: "user", content: text }]);
  }

  return (
    <div className="shell">
      <div className="brand">
        <span className="dot" />
        <h1>Neural Chat</h1>
      </div>
      <p className="sub">Hermes orchestrates · Inkling hears &amp; reasons</p>

      <div className="messages">
        {messages.length === 0 && (
          <div className="trace">Type a message or hold the mic to speak…</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="who">{m.role === "user" ? "You" : "Neural Chat"}</div>
            {m.content || (busy && i === messages.length - 1 ? "▍" : "")}
          </div>
        ))}
        {trace && <div className="trace">{trace}</div>}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          placeholder="Message Neural Chat…"
          disabled={busy}
        />
        <button
          className={`mic ${recording ? "recording" : ""}`}
          onClick={toggleMic}
          disabled={busy}
          title={recording ? "Stop & send" : "Record voice"}
        >
          {recording ? "■" : "🎤"}
        </button>
        <button className="send" onClick={onSend} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
