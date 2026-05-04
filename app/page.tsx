"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

const SYSTEM_HINT =
  "Senior photo retouching AI agent. Provide: (1) understanding, (2) ordered tasks, (3) clarifying questions.";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function parseSseLines(chunkText: string) {
  // Returns complete SSE "events" (separated by blank line) plus remainder.
  const parts = chunkText.split("\n\n");
  const remainder = parts.pop() ?? "";
  return { events: parts, remainder };
}

function extractDataLines(sseEvent: string) {
  // Anthropic streams as SSE: lines like "event: ...", "data: {...}"
  const dataLines: string[] = [];
  for (const line of sseEvent.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  return dataLines;
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Send a retouching brief and I’ll break it into an ordered Photoshop task list."
    }
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isStreaming, [input, isStreaming]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isStreaming]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...nextMessages, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages
        })
      });

      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseLines(buffer);
        buffer = remainder;

        for (const ev of events) {
          for (const data of extractDataLines(ev)) {
            if (!data) continue;
            if (data === "[DONE]") continue;

            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }

            // Anthropic "messages" streaming
            if (parsed?.type === "content_block_delta" && parsed?.delta?.type === "text_delta") {
              assistantText += parsed.delta.text ?? "";
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (!last || last.role !== "assistant") return prev;
                copy[copy.length - 1] = { ...last, content: assistantText };
                return copy;
              });
            }
          }
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong.");
      setMessages(nextMessages); // remove empty assistant
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">
        <header className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-sm font-medium tracking-wide text-neutral-200">
              Retouching Brief Chat
            </h1>
            <div className="text-[11px] text-neutral-500">{SYSTEM_HINT}</div>
          </div>
        </header>

        <section className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-4">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={cn(
                "whitespace-pre-wrap text-sm leading-6",
                m.role === "user" ? "text-neutral-100" : "text-neutral-200"
              )}
            >
              <div className="mb-1 text-[11px] uppercase tracking-widest text-neutral-600">
                {m.role}
              </div>
              <div className="rounded-md bg-neutral-950">
                {m.content || (idx === messages.length - 1 && isStreaming ? "…" : "")}
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </section>

        <form onSubmit={onSubmit} className="mt-4">
          <div className="flex items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a retouching brief…"
              rows={1}
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent text-sm leading-6 text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) void onSubmit(e as any);
                }
              }}
            />
            <button
              type="submit"
              disabled={!canSend}
              className={cn(
                "h-[44px] shrink-0 rounded-md px-4 text-sm font-medium",
                canSend
                  ? "bg-neutral-100 text-neutral-950 hover:bg-white"
                  : "cursor-not-allowed bg-neutral-800 text-neutral-500"
              )}
            >
              {isStreaming ? "Streaming…" : "Send"}
            </button>
          </div>
          {error ? <div className="mt-2 text-xs text-red-400">{error}</div> : null}
          <div className="mt-2 text-xs text-neutral-600">
            Press <span className="text-neutral-400">Enter</span> to send,{" "}
            <span className="text-neutral-400">Shift+Enter</span> for a new line.
          </div>
        </form>
      </div>
    </main>
  );
}

