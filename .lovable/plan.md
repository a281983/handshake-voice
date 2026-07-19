## Goal

Replace the simulated LLM-dialogue calls with **real ElevenLabs Conversational AI Agents** talking to each other in the browser over WebRTC, with structured tool calls extracting quotes/fees. Keep the existing pipeline UI (focused call + parallel background + narration + pause).

## Scope decisions (I'm picking defaults — flag if you disagree)

1. **No real PSTN this pass.** Twilio outbound is a separate integration (needs a purchased number + verified caller ID). Instead: agent-to-agent conversation in the browser — one WebRTC session for our negotiator, one for the dealer persona, bridged via a shared `MediaStream` server-audio-relay in the browser.
2. **Sequential focused call only gets true agent-to-agent audio.** Background "parallel" calls stay as fast LLM-simulated transcripts (cheaper, and ElevenLabs charges per minute per agent × 2 = 6 concurrent agent sessions is expensive). Focused call is real; background = simulated but with real ElevenLabs voices per turn.
3. **4 agents provisioned per vertical**: 1 negotiator ("Handshake buyer") + 3 dealer personas (Summit/ValueMax/Premier). Provisioned once, ids cached in `system_config`.
4. **Tool calls on the negotiator only**: `record_quote(line_items, bottom_line, apr)`, `flag_hidden_fee(name, amount)`, `end_call(reason)`. Dealer agents have no client tools — they just role-play from their persona system prompt.
5. **Interview stays browser Web Speech.** Real ElevenLabs Scribe realtime is a separate follow-up; the interview already works and this pass is focused on the call rounds.

## Architecture

```text
Browser (Simulate page)
  ├─ Negotiator Session (WebRTC) ──► ElevenLabs Agent A (buyer)
  │     • client_tools: record_quote, flag_hidden_fee, end_call
  │     • overrides.firstMessage = "Hi, I'm calling about the {make} {model}…"
  │     • overrides.prompt appends job spec + (round 2) leverage
  │
  ├─ Dealer Session (WebRTC) ──────► ElevenLabs Agent B (persona)
  │     • overrides.prompt = persona.prompt from config
  │     • overrides.firstMessage = "Thanks for calling {name}, how can I help?"
  │
  └─ Audio bridge (Web Audio API):
        NegotiatorOutputStream ──► DealerInputTrack (replaced via RTCRtpSender.replaceTrack)
        DealerOutputStream    ──► NegotiatorInputTrack
        Both output streams   ──► speakers (mixed) at 1.5× via AudioContext
```

Focused call flow:
1. Server function mints two conversation tokens (one per agent).
2. Client opens both `useConversation` sessions with `connectionType: "webrtc"` and `overrides`.
3. Audio bridge cross-wires the two peers so they hear each other; user hears both.
4. Negotiator `client_tools.record_quote` fires → we persist the quote row and end the session.
5. On `onDisconnect` or `end_call`, mark `state: done` and move on.

Background calls: keep current `simulateCall` + per-turn TTS (already works).

## Files to create / change

### New
- `src/lib/agents.functions.ts` — server fns:
  - `provisionAgents(vertical)` — POST `/v1/convai/agents/create` for the negotiator + each persona (idempotent, upserts into `system_config`). Called once on `/admin/sync` and lazily from the pipeline.
  - `getCallTokens(jobId, dealerId)` — mints two `conversation/token`s (negotiator, dealer) and returns `{ negotiatorToken, dealerToken, negotiatorAgentId, dealerAgentId, overrides }`.
- `src/lib/use-live-call.ts` — orchestrates a single focused live call:
  - Boots two `useConversation` instances, wires the audio bridge, exposes `transcript`, `liveBottomLine`, `state`, `stop()`.
  - Handles `client_tool_call` → persists a quote via `recordQuote` server fn and calls `endSession()`.
- `src/routes/api/public/agents.tool-webhook.ts` — optional post-call webhook for audit only (agent → our server on `end_call`). Signature-verified.

### Modified
- `config/car_buying.json` — add `negotiator_prompt` (system prompt for our agent) and `client_tools` schema block. Add `voice_id` for the negotiator (use `cgSgspJ2msm6clMCkdW9`, already in `caller_voice_id`).
- `src/lib/use-pipeline.ts` — when in round 1 or 2, for the *focused* call, use `useLiveCall` instead of `simulateCall`+`synthesizeTurn`. Background calls unchanged.
- `src/lib/simulate-call.functions.ts` — expose `recordQuote({jobId, dealerId, round, quote})` server fn that live calls use to persist tool-call results.
- `src/routes/simulate.$jobId.tsx` — swap the focused card's transcript source (already reads from `views[key]` — we just push turns from the live conversation's `onMessage` into the same shape).
- `src/routes/__root.tsx` — no change; Home button stays.

### Removed / deprecated
- Nothing removed. Simulated path becomes the fallback (used for background calls and when `ELEVENLABS_API_KEY` is missing).

## Agent provisioning (system prompts)

**Negotiator** (built from `config.negotiator_prompt` + job spec at token time via `overrides.agent.prompt.prompt`):

> You are a sharp, friendly car buyer calling a dealer to negotiate. The user is buying: {make} {model}, {condition}, budget ${budget}, in {city}, features {features}. In round 1: get an itemized out-the-door quote and call `record_quote`. In round 2: you already have competing offers {leverage}; push for a better price, then call `record_quote`. Be dry, quick-witted, never rude. When you have the final number, call `end_call`.

**Dealers**: persona.prompt from config (unchanged), passed as `overrides.agent.prompt.prompt`.

## Tool call contract (negotiator client_tools)

```ts
record_quote: {
  vehicle_price: number|null,
  fees: [{ label: string, amount: number }],
  bottom_line: number,
  add_ons_declined: string[],
}
flag_hidden_fee: { label: string, amount: number }
end_call: { reason: "quoted" | "walked" | "deal" }
```

Configured in the ElevenLabs Agent UI's client tools schema at provision time.

## Data flow for one focused live call

1. Pipeline enters quote round → calls `getCallTokens` → mounts `<LiveCallCard>` with tokens.
2. `useLiveCall`:
   - `negotiator.startSession({ conversationToken, connectionType:"webrtc", overrides })`
   - `dealer.startSession({ conversationToken, connectionType:"webrtc", overrides })`
   - Bridge audio: `dealer.getInputStream() → negotiator.output`, vice-versa (via `AudioContext.createMediaStreamDestination`).
   - Both `onMessage(user_transcript|agent_response)` pushed into a single transcript array with speaker=negotiator|dealer.
3. On `client_tool_call` `record_quote` → `recordQuote(...)` → close both sessions.
4. Card state → `done`; pipeline moves to next dealer.

## Environment

- Required: `ELEVENLABS_API_KEY` (already scaffolded).
- Optional: `ELEVENLABS_AGENT_ID_NEGOTIATOR`, `ELEVENLABS_AGENT_ID_DEALER_{PERSONA_ID}` (env override; else lazy-provision).

## Cost/rate notes I'll surface in UI

- Each focused call = 2 concurrent agents. A round of 3 dealers = 3 focused calls sequentially (background stays simulated), so ~6 agent-minutes per round.
- If `ELEVENLABS_API_KEY` missing → fall back to simulated path with a banner "Live agents disabled — using simulation."

## Out of scope (explicitly)

- Real PSTN dialing (Twilio) — separate pass.
- Realtime Scribe STT for the interview.
- Making background calls also live agent-to-agent.
- Multi-language.

## Test plan

1. `/admin/sync` provisions 4 agents; confirm ids in `system_config`.
2. Run a full car_buying job. Verify:
   - Focused call: two voices audible, taking turns, dealer sounds like their persona.
   - `record_quote` tool call fires → quote row written → card shows bottom line.
   - Background 2 cards animate with transcripts & TTS turns (unchanged).
   - Round 2 uses leverage in the negotiator's prompt.
3. Kill `ELEVENLABS_API_KEY` → app falls back gracefully to simulation with banner.

Confirm and I'll build it. Flag anything in **Scope decisions** you want changed (esp. #1 no PSTN, #2 only focused call is live).