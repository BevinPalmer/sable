export const runtime = "nodejs";

async function readScript(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = (await req.json().catch(() => null)) as null | { script?: unknown };
    return typeof json?.script === "string" ? json.script : "";
  }
  return await req.text().catch(() => "");
}

export async function POST(req: Request) {
  const script = (await readScript(req)).trim();
  if (!script) return Response.json({ ok: false, error: "Missing script." }, { status: 400 });

  // Next phase: execute in Photoshop. For now, we just log.
  console.log("Received ExtendScript:\n" + script);

  return Response.json({ ok: true });
}

