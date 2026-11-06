import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

// Ernesta eSkola — progresa glabāšana serverī.
// Bez piekļuves koda: kas zina adresi, var nolasīt un saglabāt progresu.
// Dienas kopijas un "-pirms" kopija ļauj atjaunot, ja kaut kas tiek sabojāts.
const MAX_BYTES = 300_000;
const STORE = "eskola-progress";

function rigaDay(): string {
  // YYYY-MM-DD pēc Rīgas laika
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Riga" });
}

export default async (req: Request, _context: Context) => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("list")) {
      const { blobs } = await store.list({ prefix: "daily/" });
      const days = blobs.map((b) => b.key.slice("daily/".length)).sort().reverse().slice(0, 30);
      return Response.json({ days });
    }
    const day = url.searchParams.get("day");
    if (day && !/^\d{4}-\d{2}-\d{2}(-pirms)?$/.test(day)) {
      return Response.json({ error: "bad_day" }, { status: 400 });
    }
    const state = await store.get(day ? `daily/${day}` : "current", { type: "json" });
    return Response.json({ state: state ?? null });
  }

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
    let body: any;
    try { body = JSON.parse(text); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
    const state = body && body.state;
    if (!state || typeof state !== "object" || !state.stats) {
      return Response.json({ error: "bad_state" }, { status: 400 });
    }
    // Neļauj vecākai ierīces versijai pārrakstīt jaunāku progresu
    const current: any = await store.get("current", { type: "json" });
    if (current && (current.updated || 0) > (state.updated || 0)) {
      return Response.json({ error: "stale", state: current }, { status: 409 });
    }
    // Ja progress samazinās (piem. "Sākt no jauna" vai vecas kopijas ielāde), saglabā iepriekšējo stāvokli
    if (current && (state.totalCorrect || 0) < (current.totalCorrect || 0)) {
      await store.setJSON(`daily/${rigaDay()}-pirms`, current);
    }
    await store.setJSON("current", state);
    await store.setJSON(`daily/${rigaDay()}`, state);
    return Response.json({ ok: true, updated: state.updated || 0 });
  }

  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/progress",
  method: ["GET", "PUT"],
};
