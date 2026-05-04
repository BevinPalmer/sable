export const runtime = "edge";

type ClientMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT =
  'You are a senior photo retouching AI agent for e-commerce brands. You receive retouching briefs in natural language and break them down into specific, ordered retouching tasks. You understand Photoshop workflows including frequency separation, dodge and burn, color grading, background removal, and compositing. When given a brief, respond with: 1) your understanding of the request, 2) the ordered task list you will execute, 3) any clarifying questions before you begin.';

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("Missing ANTHROPIC_API_KEY. Add it to .env.local.", { status: 500 });
  }

  let body: { messages?: ClientMessage[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return new Response("Provide { messages: [...] }.", { status: 400 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      stream: true,
      messages
    })
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return new Response(errText || `Anthropic error (${upstream.status})`, { status: 502 });
  }

  // Anthropic responds as SSE; we pass-through so the client can parse it.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

