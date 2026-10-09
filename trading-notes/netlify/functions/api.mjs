// Trading Notes – API (Netlify Function v2 + Netlify Blobs)
// Wszystkie dane (notatki, kategorie, zdjęcia) trzymane są w Netlify Blobs,
// więc ta sama zawartość jest widoczna na komputerze i telefonie.
import { getStore } from "@netlify/blobs";

const DB_KEY = "db";
const COOKIE = "tn_auth";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const env = (k) => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];

function stores() {
  if (globalThis.__TN_STORES__) return globalThis.__TN_STORES__; // lokalne testy
  return {
    data: getStore({ name: "trading-notes-data", consistency: "strong" }),
    images: getStore({ name: "trading-notes-images", consistency: "strong" }),
  };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function expectedToken() {
  const pw = env("APP_PASSWORD");
  if (!pw) return null;
  return sha256("trading-notes:" + pw);
}

function readCookie(req, name) {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const DEFAULT_DB = () => ({
  version: 1,
  categories: [
    { id: "c-strategie", name: "Strategie", color: "#a855f7", order: 0 },
    { id: "c-analizy", name: "Analizy rynku", color: "#6366f1", order: 1 },
    { id: "c-dziennik", name: "Dziennik transakcji", color: "#ec4899", order: 2 },
    { id: "c-psychologia", name: "Psychologia", color: "#14b8a6", order: 3 },
    { id: "c-nauka", name: "Nauka i wiedza", color: "#f59e0b", order: 4 },
  ],
  notes: [],
});

async function loadDb(store) {
  const db = await store.get(DB_KEY, { type: "json" });
  return db || DEFAULT_DB();
}

const isId = (s) => typeof s === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanNote(input, existing) {
  const now = new Date().toISOString();
  return {
    id: existing?.id || input.id,
    title: str(input.title, 300),
    body: str(input.body, 200000),
    categoryId: isId(input.categoryId) ? input.categoryId : null,
    tags: Array.isArray(input.tags)
      ? [...new Set(input.tags.map((t) => str(t, 40).trim().toLowerCase()).filter(Boolean))].slice(0, 30)
      : [],
    images: Array.isArray(input.images) ? input.images.filter(isId).slice(0, 50) : [],
    pinned: !!input.pinned,
    created: existing?.created || now,
    updated: now,
  };
}

// samo przypięcie/odpięcie nie zmienia daty edycji
function sameContent(a, b) {
  return a && JSON.stringify([a.title, a.body, a.categoryId, a.tags, a.images]) === JSON.stringify([b.title, b.body, b.categoryId, b.tags, b.images]);
}

function cleanCategory(input, existing, order) {
  return {
    id: existing?.id || input.id,
    name: str(input.name, 60).trim() || "Bez nazwy",
    color: /^#[0-9a-fA-F]{6}$/.test(input.color || "") ? input.color : "#a855f7",
    order: Number.isFinite(input.order) ? input.order : existing?.order ?? order,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id] = parts;
  const method = req.method;

  // ---- logowanie ----
  if (resource === "login" && method === "POST") {
    const token = await expectedToken();
    if (!token) return json({ error: "Brak zmiennej APP_PASSWORD w ustawieniach Netlify." }, 500);
    let body = {};
    try { body = await req.json(); } catch {}
    const given = await sha256("trading-notes:" + (body.password || ""));
    if (!safeEqual(given, token)) {
      await new Promise((r) => setTimeout(r, 600));
      return json({ error: "Nieprawidłowe hasło" }, 401);
    }
    const secure = url.protocol === "https:" ? " Secure;" : "";
    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=31536000`,
    });
  }
  if (resource === "logout") {
    return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }

  // ---- autoryzacja ----
  const token = await expectedToken();
  if (!token || !safeEqual(readCookie(req, COOKIE), token)) return json({ error: "unauthorized" }, 401);

  const { data, images } = stores();

  try {
    // GET /api/data – wszystko naraz
    if (resource === "data" && method === "GET") {
      return json(await loadDb(data));
    }

    // notatki
    if (resource === "notes" && isId(id)) {
      const db = await loadDb(data);
      const idx = db.notes.findIndex((n) => n.id === id);
      if (method === "PUT") {
        const input = await req.json();
        const note = cleanNote({ ...input, id }, idx >= 0 ? db.notes[idx] : null);
        if (idx >= 0 && sameContent(db.notes[idx], note)) note.updated = db.notes[idx].updated;
        // usuń zdjęcia, które zniknęły z notatki
        if (idx >= 0) {
          const removed = db.notes[idx].images.filter((i) => !note.images.includes(i));
          await Promise.all(removed.map((i) => images.delete(i)));
          db.notes[idx] = note;
        } else db.notes.push(note);
        await data.setJSON(DB_KEY, db);
        return json(note);
      }
      if (method === "DELETE") {
        if (idx >= 0) {
          await Promise.all(db.notes[idx].images.map((i) => images.delete(i)));
          db.notes.splice(idx, 1);
          await data.setJSON(DB_KEY, db);
        }
        return json({ ok: true });
      }
    }

    // kategorie
    if (resource === "categories" && isId(id)) {
      const db = await loadDb(data);
      const idx = db.categories.findIndex((c) => c.id === id);
      if (method === "PUT") {
        const input = await req.json();
        const cat = cleanCategory({ ...input, id }, idx >= 0 ? db.categories[idx] : null, db.categories.length);
        if (idx >= 0) db.categories[idx] = cat; else db.categories.push(cat);
        await data.setJSON(DB_KEY, db);
        return json(cat);
      }
      if (method === "DELETE") {
        if (idx >= 0) {
          db.categories.splice(idx, 1);
          db.notes.forEach((n) => { if (n.categoryId === id) n.categoryId = null; });
          await data.setJSON(DB_KEY, db);
        }
        return json({ ok: true });
      }
    }

    // zdjęcia
    if (resource === "images") {
      if (!id && method === "POST") {
        const type = req.headers.get("content-type") || "";
        if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return json({ error: "Nieobsługiwany format" }, 415);
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_IMAGE_BYTES) return json({ error: "Zdjęcie za duże" }, 413);
        const newId = "img-" + crypto.randomUUID().replace(/-/g, "");
        await images.set(newId, buf, { metadata: { type } });
        return json({ id: newId });
      }
      if (isId(id) && method === "GET") {
        const res = await images.getWithMetadata(id, { type: "arrayBuffer" });
        if (!res) return new Response("Not found", { status: 404 });
        return new Response(res.data, {
          headers: {
            "content-type": res.metadata?.type || "image/jpeg",
            "cache-control": "private, max-age=31536000, immutable",
          },
        });
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Błąd serwera" }, 500);
  }
};

export const config = { path: "/api/*" };
