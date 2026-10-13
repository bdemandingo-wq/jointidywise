// Direct Anthropic API adapter that mimics OpenAI chat.completions shape,
// so existing callers keep working without changes to their response parsing.
//
// - Non-stream: returns a Response whose JSON body has {choices:[{message:{content, tool_calls}}]}.
// - Stream (stream:true): returns a Response with SSE chunks
//   `data: {"choices":[{"delta":{"content":"..."}}]}\n\n` and a terminal `data: [DONE]\n\n`.
// - Errors: JSON `{ error: string }` with Anthropic status forwarded.
//
// Credit accounting stays with the caller (consume_ai_credit); this helper
// only replaces the upstream provider.

export const MODEL_HAIKU = "claude-haiku-4-5";
export const MODEL_SONNET = "claude-sonnet-4-6";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export function mapModel(model?: string): string {
  const m = (model || "").toLowerCase();
  if (m.startsWith("claude-")) return model!;
  // Heavier reasoning / analysis models -> Sonnet
  if (m.includes("pro") || m.includes("sonnet") || m.includes("gpt-5") || m.includes("opus")) {
    return MODEL_SONNET;
  }
  // Everything else (flash, haiku, nano, lite, mini, unknown) -> Haiku
  return MODEL_HAIKU;
}

interface OpenAiMessagePart {
  type?: string;
  text?: string;
  image_url?: { url: string } | string;
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAiMessagePart[];
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAiToolChoice {
  type: "function";
  function: { name: string };
}

export interface OpenAiChatBody {
  model?: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: OpenAiTool[];
  tool_choice?: OpenAiToolChoice | "auto" | "none";
  response_format?: { type: "json_object" | "text" };
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function makeCorsHeaders(cors?: Record<string, string>) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    ...(cors || {}),
  };
}

function dataUrlToImageSource(url: string) {
  // data:image/png;base64,XXXX
  const m = url.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.*)$/);
  if (!m) return null;
  return { type: "base64" as const, media_type: m[1], data: m[2] };
}

function convertMessages(messages: OpenAiMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
  const systems: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") systems.push(msg.content);
      else if (Array.isArray(msg.content)) {
        systems.push(msg.content.map((p) => p.text || "").join("\n"));
      }
      continue;
    }

    if (msg.role === "tool") {
      // Convert to Anthropic tool_result user turn.
      out.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: msg.tool_call_id || "unknown",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        }],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: unknown[] = [];
      if (typeof msg.content === "string" && msg.content) {
        parts.push({ type: "text", text: msg.content });
      }
      for (const call of msg.tool_calls || []) {
        let args: unknown = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
        parts.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: args,
        });
      }
      out.push({ role: "assistant", content: parts.length ? parts : "" });
      continue;
    }

    // user
    if (typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const parts: unknown[] = [];
      for (const p of msg.content) {
        if (p.type === "text" && p.text) parts.push({ type: "text", text: p.text });
        else if (p.type === "image_url" && p.image_url) {
          const url = typeof p.image_url === "string" ? p.image_url : p.image_url.url;
          const src = dataUrlToImageSource(url);
          if (src) parts.push({ type: "image", source: src });
          else parts.push({ type: "image", source: { type: "url" as const, url } });
        }
      }
      out.push({ role: "user", content: parts.length ? parts : "" });
    } else {
      out.push({ role: "user", content: "" });
    }
  }

  // Merge consecutive same-role turns (Anthropic requires alternation).
  const merged: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) {
      const a = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content || "") }];
      const b = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content || "") }];
      last.content = [...a, ...b];
    } else {
      merged.push({ ...m });
    }
  }

  return {
    system: systems.length ? systems.join("\n\n") : undefined,
    messages: merged,
  };
}

function convertTools(tools?: OpenAiTool[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description || "",
    input_schema: t.function.parameters,
  }));
}

function convertToolChoice(choice?: OpenAiToolChoice | "auto" | "none") {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return undefined;
  if (typeof choice === "object" && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

interface AnthropicResponse {
  id: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

function openAiFinishReason(stop: string | null | undefined): string {
  if (stop === "tool_use") return "tool_calls";
  // OpenAI uses "length" when the completion hit max_tokens. Callers need
  // that distinct from a normal stop so a cut-off blog is not saved.
  if (stop === "max_tokens") return "length";
  return "stop";
}

function toOpenAiCompletion(a: AnthropicResponse) {
  const text = a.content.filter((c) => c.type === "text").map((c: any) => c.text).join("");
  const toolCalls = a.content
    .filter((c) => c.type === "tool_use")
    .map((c: any) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
    }));

  return {
    id: a.id,
    object: "chat.completion",
    model: a.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: openAiFinishReason(a.stop_reason),
    }],
    usage: {
      prompt_tokens: a.usage.input_tokens,
      completion_tokens: a.usage.output_tokens,
      total_tokens: a.usage.input_tokens + a.usage.output_tokens,
    },
  };
}

async function anthropicError(status: number, upstream: Response, corsHeaders: Record<string, string>) {
  const bodyText = await upstream.text().catch(() => "");
  let message = "AI request failed. Please try again.";
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed?.error?.message) message = String(parsed.error.message);
  } catch { /* keep default */ }
  console.error(`[anthropic] upstream ${status}: ${bodyText.slice(0, 500)}`);

  if (status === 429) {
    return new Response(
      JSON.stringify({ error: "AI is temporarily rate limited. Please try again in a moment." }),
      { status: 429, headers: { ...corsHeaders, ...JSON_HEADERS } },
    );
  }
  if (status === 401 || status === 403) {
    return new Response(
      JSON.stringify({ error: "AI is temporarily unavailable. Please try again later." }),
      { status: 502, headers: { ...corsHeaders, ...JSON_HEADERS } },
    );
  }
  return new Response(
    JSON.stringify({ error: message }),
    { status: status >= 500 ? 502 : status, headers: { ...corsHeaders, ...JSON_HEADERS } },
  );
}

export interface AnthropicChatOptions {
  corsHeaders?: Record<string, string>;
  /** Explicit anthropic model to use (bypasses mapping). */
  anthropicModel?: string;
}

export async function anthropicChat(
  body: OpenAiChatBody,
  opts: AnthropicChatOptions = {},
): Promise<Response> {
  const cors = makeCorsHeaders(opts.corsHeaders);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "AI is not configured. Please contact support." }),
      { status: 500, headers: { ...cors, ...JSON_HEADERS } },
    );
  }

  const model = opts.anthropicModel || mapModel(body.model);
  const { system, messages } = convertMessages(body.messages || []);
  const tools = convertTools(body.tools);
  const tool_choice = convertToolChoice(body.tool_choice);

  const jsonMode = body.response_format?.type === "json_object";
  const systemFinal = jsonMode
    ? [
        system || "",
        "Respond ONLY with a single valid JSON object. No prose, no markdown, no code fences.",
      ].filter(Boolean).join("\n\n")
    : system;

  const upstreamBody: Record<string, unknown> = {
    model,
    max_tokens: body.max_tokens ?? 4096,
    messages,
    ...(systemFinal ? { system: systemFinal } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(tools ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {}),
    ...(body.stream ? { stream: true } : {}),
  };

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    return anthropicError(upstream.status, upstream, cors);
  }

  if (body.stream) {
    if (!upstream.body) {
      return new Response(
        JSON.stringify({ error: "AI stream unavailable. Please try again." }),
        { status: 502, headers: { ...cors, ...JSON_HEADERS } },
      );
    }
    const translated = translateStream(upstream.body);
    return new Response(translated, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  const data = (await upstream.json()) as AnthropicResponse;
  return new Response(JSON.stringify(toOpenAiCompletion(data)), {
    status: 200,
    headers: { ...cors, ...JSON_HEADERS },
  });
}

// Translate Anthropic SSE events into OpenAI-compatible chat.completion.chunk SSE.
function translateStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const chunkId = `chatcmpl-${Math.random().toString(36).slice(2, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  const send = (controller: ReadableStreamDefaultController<Uint8Array>, delta: Record<string, unknown>, finish?: string | null) => {
    const payload = {
      id: chunkId,
      object: "chat.completion.chunk",
      created,
      choices: [{ index: 0, delta, ...(finish !== undefined ? { finish_reason: finish } : {}) }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let buffer = "";
      let opened = false;

      // The content block state per index (we mostly care about index 0 text).
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = raw.split("\n");
            let eventType = "";
            let dataStr = "";
            for (const line of lines) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
            }
            if (!dataStr) continue;
            let evt: any;
            try { evt = JSON.parse(dataStr); } catch { continue; }

            if (eventType === "content_block_delta" || evt?.type === "content_block_delta") {
              const d = evt.delta;
              if (d?.type === "text_delta" && typeof d.text === "string") {
                if (!opened) { send(controller, { role: "assistant" }); opened = true; }
                send(controller, { content: d.text });
              }
              // (input_json_delta for tool_use is intentionally ignored in stream path —
              //  callers that need tool_use output use non-streaming mode.)
            } else if (eventType === "message_delta" || evt?.type === "message_delta") {
              const stop = evt?.delta?.stop_reason;
              if (stop) {
                send(controller, {}, openAiFinishReason(stop));
              }
            } else if (eventType === "message_stop" || evt?.type === "message_stop") {
              controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            }
          }
        }
      } catch (e) {
        console.error("[anthropic] stream error", e);
      } finally {
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });
}
