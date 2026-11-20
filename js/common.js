import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

let client = null;

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

export async function getSupabase() {
  if (!supabaseConfigured()) return null;
  if (client) return client;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}

let memId = null;
export function clientId() {
  let id = null;
  try { id = localStorage.getItem("4221-client"); } catch {}
  if (!id) {
    id = memId || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    memId = id;
    try { localStorage.setItem("4221-client", id); } catch {}
  }
  return id;
}

let toastTimer;
export function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Zeigt genau einen Bildschirm (section[data-view]) innerhalb von <main>
export function showSection(id) {
  document.querySelectorAll("main section[data-view]").forEach((s) => s.classList.toggle("hidden", s.id !== id));
  window.scrollTo({ top: 0 });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
