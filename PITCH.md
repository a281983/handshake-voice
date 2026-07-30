# Handshake — pitch & architecture one-pager

## The problem

Everyone overpays for big purchases because negotiating means calling a dozen sellers, keeping their quotes straight, and playing them against each other — work almost nobody does well. Meanwhile **16,851 tiny dealers will never adopt quoting software. Every one of them answers the phone.**

## What we built

**A voice AI agent that shops a market for you, negotiates it, and hands you a verified best deal.** One config-driven engine, four beats:

1. **Interview** — a 30-second voice Q&A captures what you want.
2. **Round 1 — price the market** — the agent calls every seller in parallel and pulls an itemized quote from each.
3. **Round 2 — negotiate** — it calls the cheapest sellers back armed with real, specific leverage ("ValueMax is $29,200 and waived paint protection — your market adjustment has to go") and works them down.
4. **Recommendation** — a verified report ranks the deals and reads back the win.

Car buying is the live demo; **home buying, medical bills, moving, and life insurance are already configured** — each is a JSON file, not a rewrite.

## Why it's different

- **It actually negotiates.** Round 2 isn't a re-quote. We build a structured *leverage packet* from the real Round-1 quotes — the best competing price, which fees rivals waived, which of this seller's fees to attack by name — and the price moves because the agent out-negotiates, not because we scripted an outcome.
- **It can't bluff.** An independent eval checks that every fee is itemized and every number is traceable to the call transcript before the deal earns a **"Verified"** badge. That's our answer to "how do we know the AI didn't make it up?"
- **It's a platform, not a script.** Add a market by dropping in a config file. An `/admin` page tunes the strategy live — how many sellers to call, how many to negotiate, the negotiation style, callback retries — with zero code changes.

## Architecture

| Layer | Choice | Why |
| --- | --- | --- |
| App | **TanStack Start** (React 19, server functions) on Vite | one codebase, SSR + typed server calls |
| Compute | **Vercel** (Nitro) | serverless, no vendor lock |
| State | **Supabase** (Postgres + Realtime) | live "pizza-tracker" UI, portable |
| LLM | **OpenAI-compatible** (swappable: OpenAI / Groq / any gateway) | not tied to any one provider |
| Voice | **ElevenLabs** TTS + browser speech | premium voice, graceful fallback |
| Discovery | **Tavily** search | finds real local sellers |

**The engine (config, not code).** A single pipeline — discover → quote → leverage → negotiate → eval → report — is driven entirely by a `VerticalConfig`. One registry file maps a market id to its JSON pack; nothing else is vertical-specific. New market = one file.

**The brain.** Three deterministic pieces make the money trustworthy: the **leverage engine** (turns real quotes into a negotiating script), **private seller floors** (each counterparty's walk-away number lives only in its own prompt, never read by the report), and the **anti-bluff eval** (gates the Verified badge, and the report ranks purely by final price so #1 is always genuinely cheapest).

**Data flow.** Every call writes quotes and events to Supabase; the tracker UI subscribes over Realtime so the customer watches the market get worked in real time. Row-level security keeps writes server-only.

## Status & roadmap

**Built and working today:** full interview → 2-round negotiation → verified report; 5 configured verticals; live admin config surface; voice throughout; resilient (caches every call, falls back gracefully when any provider key is absent).

**Next:** real agent-to-agent phone audio (WebRTC bridge is scaffolded); real outbound PSTN dialing (Twilio) to call actual scraped numbers; per-vehicle market benchmarks so any input stays financially exact; deeper admin (edit personas, benchmarks, thresholds).

## The ask / the wedge

Start where switching costs are zero and the pain is sharp — **car buying and medical-bill negotiation** — then reuse the same engine across every high-friction, phone-mediated market. The moat is the negotiation-quality loop (leverage + verification), not the calls themselves.
