"use client";

import { useEffect, useRef, useState } from "react";
import { MicRecorder } from "@/lib/wav";

type Role = "user" | "assistant";
interface Msg { role: Role; content: string; }
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface Trace { text: string; kind: "hermes" | "inkling"; }

const SUGGESTIONS = [
  { k: "Reasoning → Inkling", t: "If a train leaves at 2:15pm going 60mph and another at 2:45pm going 80mph, when does the second catch the first?" },
  { k: "Tool use", t: "What time is it right now?" },
  { k: "Just chat", t: "Explain how Neural Chat routes between Hermes and Inkling." },
];

export default function NeuralChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [focused, setFocused] = useState(false);
  const [effort, setEffort] = useState<Effort>("medium");
  const [trace, setTrace] = useState<Trace | null>(null);
  const recorder = useRef<MicRecorder | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, trace]);

  /** Send a user turn to the Hermes brain and stream the reply. */
  async function sendToHermes(history: Msg[]) {
    setBusy(true);
    setTrace({ text: "Hermes is thinking…", kind: "hermes" });
    setMessages([...history, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, effort }),
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
            setTrace(null);
            setMessages((m) => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { role: "assistant", content: last.content + payload };
              return copy;
            });
          } else if (ev === "tool") {
            setTrace(
              payload.name === "inkling_reason"
                ? { text: "Delegating to Inkling — deep reasoning…", kind: "inkling" }
                : { text: `Running tool: ${payload.name}…`, kind: "hermes" }
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
    } catch (e) {
      setTrace(null);
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `⚠️ ${e instanceof Error ? e.message : "request failed"}`,
        };
        return copy;
      });
    }
    setBusy(false);
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    await sendToHermes([...messages, { role: "user", content: t }]);
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
    setBusy(true);
    setTrace({ text: "Inkling is listening…", kind: "inkling" });
    try {
      const wav = await recorder.current!.stop();
      const fd = new FormData();
      fd.append("audio", wav, "input.wav");
      const res = await fetch("/api/voice", { method: "POST", body: fd });
      const { transcript, error } = await res.json();
      setTrace(null);
      if (error) {
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ voice: ${error}` }]);
        setBusy(false);
        return;
      }
      const text = (transcript || "").trim();
      setBusy(false);
      if (text) await sendToHermes([...messages, { role: "user", content: text }]);
    } catch (e) {
      setTrace(null);
      setBusy(false);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `⚠️ mic: ${e instanceof Error ? e.message : "capture failed"}` },
      ]);
    }
  }

  const showLastCaret = busy && messages[messages.length - 1]?.role === "assistant";

  return (
    <div className="shell">
      <header className="header">
        <div className="logo"><span className="orb" /></div>
        <div className="titles">
          <h1>Neural Chat</h1>
          <div className="flow">
            <span className="pill"><b>Hermes</b> brain</span>
            <span className="arrow">→</span>
            <span className="pill"><b>Inkling</b> ears &amp; reasoning</span>
          </div>
        </div>
        <div className="effort">
          <label htmlFor="effort">Inkling effort</label>
          <select
            id="effort"
            value={effort}
            onChange={(e) => setEffort(e.target.value as Effort)}
          >
            <option value="low">Low · fast</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">X-High</option>
            <option value="max">Max · deepest</option>
          </select>
        </div>
      </header>

      <div className="messages" ref={scroller}>
        {messages.length === 0 && !trace ? (
          <div className="empty">
            <div className="bigorb" />
            <h2>Talk to Neural Chat</h2>
            <p>Type, or hold the mic to speak — Inkling hears you, Hermes replies.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.t} className="chip" onClick={() => send(s.t)}>
                  <span className="k">{s.k}</span>
                  {s.t}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`row ${m.role}`}>
              <div className={`avatar ${m.role === "user" ? "you" : "nc"}`}>
                {m.role === "user" ? "You" : "◈"}
              </div>
              <div className="bubble">
                {m.content}
                {showLastCaret && i === messages.length - 1 && !m.content && (
                  <span className="caret">▍</span>
                )}
              </div>
            </div>
          ))
        )}

        {trace && (
          <div className={`trace ${trace.kind}`}>
            <span className="spark" />
            {trace.text}
          </div>
        )}
      </div>

      <div className={`composer ${focused ? "focused" : ""}`}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder={recording ? "Recording… tap ■ to send" : "Message Neural Chat…"}
          disabled={busy || recording}
        />
        {recording && <span className="rec-label">● REC</span>}
        <button
          className={`icon-btn ${recording ? "recording" : ""}`}
          onClick={toggleMic}
          disabled={busy}
          title={recording ? "Stop & send" : "Record voice"}
        >
          {recording ? "■" : "🎤"}
        </button>
        <button
          className="send"
          onClick={() => send(input)}
          disabled={busy || recording || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
