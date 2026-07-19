import { createServerFn } from "@tanstack/react-start";
import carBuyingConfig from "../../config/car_buying.json";

// ---------- types ----------

type ClientToolParam = {
  id: string;
  type: "String" | "Number" | "Boolean";
  description: string;
  required?: boolean;
};

type AgentConfig = {
  role?: string;
  name: string;
  language: string;
  voice_id: string;
  llm: string;
  temperature: number;
  first_message: string;
  prompt: string;
  client_tools: {
    name: string;
    description: string;
    parameters: ClientToolParam[];
  }[];
};

type VerticalConfig = {
  vertical: string;
  agents?: Record<string, AgentConfig>;
};

// ---------- payload ----------

function buildAgentPayload(agent: AgentConfig) {
  const tools = agent.client_tools.map((t) => {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];
    for (const p of t.parameters) {
      properties[p.id] = { type: p.type.toLowerCase(), description: p.description };
      if (p.required) required.push(p.id);
    }
    return {
      type: "client",
      name: t.name,
      description: t.description,
      expects_response: false,
      parameters: { type: "object", properties, required },
    };
  });

  return {
    name: agent.name,
    conversation_config: {
      agent: {
        language: agent.language,
        prompt: {
          prompt: agent.prompt,
          llm: agent.llm,
          temperature: agent.temperature,
          tools,
        },
        first_message: agent.first_message,
      },
      tts: { voice_id: agent.voice_id },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
          tts: { voice_id: true },
        },
        custom_llm_extra_body: true,
        enable_conversation_initiation_client_data_from_webhook: false,
      },
    },
  };
}

// ---------- ElevenLabs helpers ----------

const EL = "https://api.elevenlabs.io";

async function elFetch(apiKey: string, path: string, init?: RequestInit) {
  const res = await fetch(`${EL}${path}`, {
    ...init,
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ElevenLabs ${init?.method ?? "GET"} ${path} [${res.status}]: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function findAgentIdByName(apiKey: string, name: string): Promise<string | null> {
  const list = await elFetch(apiKey, `/v1/convai/agents?search=${encodeURIComponent(name)}&page_size=100`);
  const match = (list.agents ?? []).find((a: { name: string; agent_id: string }) => a.name === name);
  return match?.agent_id ?? null;
}

async function createAgent(apiKey: string, agent: AgentConfig): Promise<string> {
  const res = await elFetch(apiKey, `/v1/convai/agents/create`, {
    method: "POST",
    body: JSON.stringify(buildAgentPayload(agent)),
  });
  if (!res.agent_id) throw new Error(`Create agent returned no agent_id: ${JSON.stringify(res)}`);
  return res.agent_id;
}

async function patchAgent(apiKey: string, agentId: string, agent: AgentConfig) {
  await elFetch(apiKey, `/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(buildAgentPayload(agent)),
  });
}

// ---------- persistence ----------

async function readSystemConfig(vertical: string, key: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("system_config").select("value").eq("vertical", vertical).eq("key", key).maybeSingle();
  const v = data?.value as { id?: string } | string | null | undefined;
  if (!v) return null;
  return typeof v === "string" ? v : (v.id ?? null);
}

async function writeSystemConfig(vertical: string, key: string, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("system_config").upsert({ vertical, key, value: { id } });
}

// ---------- public server function ----------

export const syncElevenLabsAgents = createServerFn({ method: "POST" }).handler(async () => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");

  const config = carBuyingConfig as VerticalConfig;
  const log: string[] = [];
  const agentsOut: Array<{ key: string; agent_id: string; created: boolean }> = [];

  if (config.agents) {
    for (const [key, agent] of Object.entries(config.agents)) {
      const cacheKey = `agent:${key}`;
      let agentId = await readSystemConfig(config.vertical, cacheKey);
      if (!agentId) agentId = await findAgentIdByName(apiKey, agent.name);
      let created = false;
      if (!agentId) {
        agentId = await createAgent(apiKey, agent);
        created = true;
        log.push(`Created agent "${agent.name}" → ${agentId}`);
      } else {
        await patchAgent(apiKey, agentId, agent);
        log.push(`Updated agent "${agent.name}" → ${agentId}`);
      }
      await writeSystemConfig(config.vertical, cacheKey, agentId);
      agentsOut.push({ key, agent_id: agentId, created });
    }
  }

  return { ok: true, vertical: config.vertical, agents: agentsOut, log };
});
