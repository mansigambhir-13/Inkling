# Neural Chat

A chat interface where **Hermes is the orchestrator brain** and **Inkling is the
multimodal + heavy-reasoning specialist**. Voice input flows **mic → Inkling
(ears) → text → Hermes (brain)** — Hermes never touches the audio itself.

## Architecture

```
Browser (Neural Chat UI)
  ├── text ─────────────► POST /api/chat ──► HERMES (orchestrator loop)
  │                                             │  tool_call: inkling_reason
  │                                             ▼
  │                                          INKLING (reason / vision, effort dial)
  └── 🎤 voice (16kHz WAV) ► POST /api/voice ─► INKLING (audio → transcript+intent)
                                                 │
                                                 └─► transcript injected as a
                                                     user turn into /api/chat (Hermes)
```

**Why the split**

| | Hermes | Inkling |
|---|---|---|
| Role | orchestrator brain, tool loop, planning | ears + hard reasoning + vision |
| Cost | small / cheap / every turn | 975B / expensive / only when delegated |
| Modalities | text only | text, **audio**, image |
| Knob | — | `reasoning_effort` (low → max) |

Hermes runs every turn and decides *when* to spend Inkling. Anything multimodal
or genuinely hard is delegated via the `inkling_reason` tool. Both models are
served behind the **OpenAI-compatible** HTTP schema, so swapping hosts
(self-host vLLM/SGLang ↔ Together/Fireworks/Modal) is just env vars.

## Files

| Path | Purpose |
|---|---|
| `app/page.tsx` | Neural Chat UI — text + mic, SSE streaming |
| `app/api/chat/route.ts` | **Hermes orchestrator loop** (tool calls → Inkling → stream) |
| `app/api/voice/route.ts` | Voice → Inkling audio understanding → transcript |
| `lib/models.ts` | Two OpenAI-compatible clients + effort type |
| `lib/tools.ts` | Hermes system prompt, tool schemas, `inkling_reason` bridge |
| `lib/wav.ts` | Browser mic → 16 kHz mono WAV (Inkling's audio spec) |

## Run

```bash
cp .env.example .env.local     # point HERMES_* and INKLING_* at your endpoints
npm install
npm run dev                    # http://localhost:3000
```

### Bring up the models (self-host example)

```bash
# Hermes brain (small, fast, tool-calling)
vllm serve NousResearch/Hermes-4-Llama-3.1-70B \
  --tool-call-parser hermes --served-model-name hermes --port 8000

# Inkling specialist (needs the VRAM: ~600GB NVFP4 / ~2TB BF16)
vllm serve thinkingmachines/Inkling \
  --tensor-parallel-size 8 --served-model-name inkling --port 8001
```

No cluster for Inkling? Point `INKLING_BASE_URL` at a hosted provider
(Together / Fireworks / Modal / Baseten). Note: hosted **audio** was pending at
launch — set `INKLING_AUDIO_BASE_URL` to a self-hosted Inkling for the voice leg
if your provider doesn't expose it yet.

## Notes / next steps

- The orchestrator uses standard OpenAI `tools`; vLLM's `--tool-call-parser
  hermes` maps Hermes's native `<tool_call>` tags onto that schema.
- `inkling_reason` currently supports text + image; extend `runTool` for audio
  or long-document delegation.
- For production: add auth, rate-limit the Inkling calls (they're the cost
  center), and persist conversations.
