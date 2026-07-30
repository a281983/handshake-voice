# Handshake — Architecture

Handshake is a voice AI agent that **finds sellers, calls them for quotes, negotiates a second round with leverage, and hands the customer a verified recommendation.** It is one config-driven engine that reskins across verticals — car buying is the live demo; home buying, medical bills, moving, and life insurance are configured.

The customer journey is four beats:

1. **Interview** — a fast voice Q&A builds the job spec.
2. **Round 1 — price the market** — the agent calls each seller for an itemized quote.
3. **Round 2 — negotiate the market** — it calls the cheapest sellers back and works them down with real, specific leverage.
4. **Recommendation — customer delight** — a verified report ranks the deals and narrates the win.

---

## Stack

| Layer | Choice |
| --- | --- |
| Framework | **TanStack Start** (React 19, file-based routing + server functions) |
| Build / runtime | **Vite**, **Bun**, deployed on **Lovable** (Nitro server) |
| State | **Supabase** — Postgres + Realtime + RLS |
| LLM | **Lovable AI Gateway** (Gemini Flash) by default; OpenAI-compatible override via env |
| Voice | **ElevenLabs** TTS per turn (focused call); browser **Web Speech** for the interview + narration |
| Discovery | **Tavily** (optional; falls back to persona names) |

No paid API is required for the core demo — Lovable Gateway + Supabase is enough. ElevenLabs and Tavily are optional enhancements that degrade gracefully.

---

## The "config, not code" seam

[`src/lib/types.ts`](src/lib/types.ts) defines `VerticalConfig`. [`src/lib/registry.ts`](src/lib/registry.ts) is the **only** file that imports the JSON packs in [`config/`](config). Everything else resolves the active vertical through `getVertical(id)`. **Adding a vertical = drop a JSON file + one line in the registry.**

Each config carries: labels (so the UI reads naturally per vertical), the intake schema, interview questions, a fair-market benchmark, a red-flag rule, the discovery query, and the **personas** — the simulated counterparties, each with a public style and a **private negotiation floor that lives only inside its own prompt.**

---

## Runtime configuration (settings layer)

A per-vertical settings object lives in the existing `system_config` table (`key = "settings"`) and is edited on the **`/admin`** page — no migration, no redeploy. [`src/lib/settings.functions.ts`](src/lib/settings.functions.ts) owns it.

```ts
type HandshakeSettings = {
  negotiate_top_n: number;      // negotiate the N cheapest Round-1 openers
  negotiation_style: "friendly_closer" | "aggressive" | "diplomatic";
  discovery_count: number;      // how many sellers to find & call in Round 1
  max_callbacks: number;        // retry a call on no-answer, up to N times
};
```

`getSettings` always returns a sanitized, fully-populated object (falls back to config-derived defaults), so the demo runs with zero setup. The pipeline, the caller prompt, and the discovery step all read these — this is the seam that makes the product read as a configurable platform rather than a fixed script.

---

## The journey, screen by screen

```
/  ─▶  /interview/$vertical  ─▶  createJob  ─▶  /confirm/$jobId  ─▶  /simulate/$jobId  ─▶  /report/$jobId
                                                       │
                                              /tracker/$jobId  (Realtime second-screen of the same job)
/admin  ─▶  edits system_config.settings  ─▶  read by the next job's pipeline
```

- **`/interview/$vertical`** — browser Web Speech Q&A; builds the spec and creates the job.
- **`/confirm/$jobId`** — the one tap. It persists the spec **and** unlocks mobile audio autoplay, then navigates to the show.
- **`/simulate/$jobId`** — the pipeline runs **client-side** here (so TTS plays off that confirm gesture). A live config chip shows the active settings.
- **`/report/$jobId`** — ranked deals, before→after per seller, red flags, the "Verified" badge, and a spoken recommendation.

---

## Orchestration — `src/lib/use-pipeline.ts`

The whole pipeline is a client-side state machine, kicked off once by the confirm gesture:

```
discover → Round 1 (parallel calls, one focused with real voice)
         → rank openers by price
         → Round 2 (negotiate the top-N cheapest, one focused)
         → eval → report
```

Server functions do only the secret-bearing work (discovery, LLM dialogue, TTS, eval). Each round **prefetches every call in parallel** and returns the captured bottom lines to the orchestrator, which ranks them and chooses the Round-2 targets from those real results.

---

## The "brain"

- **Leverage** ([`src/lib/leverage.ts`](src/lib/leverage.ts)) — for each Round-2 target it builds a structured, adversarial `LeveragePacket` from the **real** Round-1 quotes: the best *cheaper* rival's number (a pricier rival is never cited as leverage), which fees rivals waived, which of this seller's fees to attack by name, and a concrete target floored at the market benchmark. Pure and deterministic; it never reads persona floors.
- **Private floors** — each persona's walk-away number lives only in its prompt as a guardrail, so the price moves because the caller out-negotiates, not because a floor was hard-coded into the report.
- **Anti-bluff eval** ([`src/lib/eval-report.functions.ts`](src/lib/eval-report.functions.ts)) — deterministic checks that every fee is itemized (line items sum to the total) and every number is traceable to the transcript. These gate the "Verified" badge. The report then **ranks purely by final price**, so #1 is always the genuinely cheapest deal.

---

## Data model (Supabase)

| Table | Purpose |
| --- | --- |
| `jobs` | one per customer run; holds spec, stage, final report |
| `quotes` | one row per seller per round; line items, bottom line, transcript |
| `call_events` | append-only event log driving the Realtime tracker |
| `dealers` | the sellers selected for a job |
| `system_config` | per-vertical key/value JSONB — caches provisioned agent ids **and** the settings object |

Realtime is enabled on jobs/quotes/call_events. RLS: **public read, server-only write** via the service-role client.

---

## Two negotiation paths

- **Default (shipped):** the LLM roleplays both sides of each call in one structured request (~2–4s), then ElevenLabs voices the focused call turn-by-turn. Every run is cached to the `quotes` row, so a mid-demo failure replays the last good call instead of crashing.
- **Opt-in real agent-to-agent** (`USE_ELEVENLABS_AGENT_SIM=1`): uses ElevenLabs `simulate-conversation` against a provisioned Convai dealer agent. The browser WebRTC negotiator↔dealer bridge is scaffolded in [`src/lib/agents.functions.ts`](src/lib/agents.functions.ts) but gated off (slower, and not needed for the demo).

---

## What would look better in the future

- **Dynamic benchmark / market value.** Persona openings, floors, and the fair-market benchmark are anchored to a ~$30k used Honda CR-V. A real per-vehicle market lookup (make/model/mileage) would let arbitrary customer inputs stay financially coherent; today the demo should use a car in that class.
- **Real agent-to-agent audio.** Finish the WebRTC bridge so the focused call is two live ElevenLabs voices instead of narrated TTS.
- **Real PSTN dialing** (Twilio) to call the scraped seller numbers in production.
- **Server-driven, durable pipeline.** The pipeline is client-side today (for the audio gesture); moving it server-side with durable state would let a refresh resume a job and enable true parallel scale.
- **Deeper admin.** Promote more of `VerticalConfig` (personas, benchmark, red-flag threshold) into `/admin`, add per-run overrides, and put auth in front of it.
- **Realtime Scribe STT** for the interview instead of browser Web Speech.
