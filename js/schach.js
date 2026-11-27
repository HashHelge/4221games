import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm";
import { getSupabase, supabaseConfigured, clientId, toast, escapeHtml } from "./common.js";

/* ═════════════ Einstellungen ═════════════ */

// LVM-Logo auf dem grünen Eckfeld (unten links aus Sicht des Spielers).
// Datei einfach unter diesem Pfad ins Repo legen. Fehlt sie, bleibt das Feld leer.
const LOGO_URL = "img/lvm-logo.png";

const TIME_CONTROLS = [
  { group: "Bullet", items: [[1, 0], [2, 1]] },
  { group: "Blitz", items: [[3, 0], [3, 2], [5, 0], [5, 3]] },
  { group: "Schnellschach", items: [[10, 0], [15, 10], [30, 0]] }
];
const EMOTES = ["👍", "😂", "😮", "😅", "🔥", "👏", "🤝", "😭", "🤔", "😎", "🙈", "🎉"];
const PHRASES = ["GG", "Gut gespielt!", "Viel Glück!", "Danke!", "Ups", "Revanche?"];

/* ═════════════ Grundlagen ═════════════ */

const $ = (s) => document.querySelector(s);
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FILES = "abcdefgh";
const ME = clientId();
const NAME_KEY = "4221-name";
const TC_KEY = "4221-chess-tc";
const TYPE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const GLYPH = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
};
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const other = (c) => (c === "w" ? "b" : "w");
const colorName = (c) => (c === "w" ? "Weiß" : "Schwarz");

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
};

function pieceHtml(color, type) {
  return `<piece class="${TYPE_NAME[type]} ${color === "w" ? "white" : "black"}" data-g="${GLYPH[color][type]}"></piece>`;
}

/* Figurensatz prüfen: Lädt das CSS mit den Standardfiguren nicht, bleiben Unicode-Figuren. */
function checkPieceCss() {
  const probe = document.createElement("piece");
  probe.className = "pawn white";
  probe.style.cssText = "position:absolute;left:-999px;width:10px;height:10px";
  document.body.appendChild(probe);
  const ok = /url\(/.test(getComputedStyle(probe).backgroundImage || "");
  probe.remove();
  document.body.classList.toggle("svg-pieces", ok);
  return ok;
}
const pieceLink = document.getElementById("pieceCss");
if (pieceLink) {
  if (!checkPieceCss()) {
    pieceLink.addEventListener("load", () => { checkPieceCss(); });
    setTimeout(checkPieceCss, 1500);
  }
}

/* Logo vorladen */
let logoOk = false;
const logoImg = new Image();
logoImg.onload = () => { logoOk = true; if (mode) renderBoard(); };
logoImg.src = LOGO_URL;

/* ═════════════ Zustand ═════════════ */

let game = new Chess();
let mode = null;               // "local" | "online"
let myColor = "w";             // online: "w" | "b" | null (Zuschauer)
let flipped = false;
let selected = null;
let targets = [];              // Zielfelder der Auswahl
let selIsPre = false;          // Auswahl ist für einen Premove
let premove = null;            // { from, to }
let viewPly = null;            // null = aktuelle Stellung, sonst Zug-Index
let history = [];              // verbose Züge
let fens = [START_FEN];
let localResult = null;        // { result, reason } bei Zeit/Aufgabe im lokalen Spiel
let resultShownFor = null;
let tc = null;                 // { base: Sek., inc: Sek. } | null = Arbeitsmodus
const clock = { w: 0, b: 0, ref: 0 };
let drag = null;
let pendingRender = false;

const online = { sb: null, id: null, row: null, channel: null, poll: null, busy: false, offset: null, lastMoveAt: null, claiming: false };
const chat = { ids: new Set(), lastSend: 0 };

/* ═════════════ Menü ═════════════ */

let chosenTc = (() => {
  const v = store.get(TC_KEY);
  if (v === "none") return null;
  const m = /^(\d+)\+(\d+)$/.exec(v || "");
  return m ? { base: +m[1] * 60, inc: +m[2] } : { base: 600, inc: 0 };
})();

function tcLabel(t) { return t ? `${t.base / 60}+${t.inc}` : "Arbeitsmodus"; }
function tcLong(t) { return t ? `${t.base / 60} min${t.inc ? " + " + t.inc + " s" : ""}` : "Arbeitsmodus · ohne Zeit"; }

function renderTcList() {
  const box = $("#tcList");
  box.innerHTML = "";
  for (const g of TIME_CONTROLS) {
    const wrap = document.createElement("div");
    wrap.className = "tc-group";
    wrap.innerHTML = `<span class="label" style="font-size:11px">${g.group}</span>`;
    const row = document.createElement("div");
    row.className = "tc-row";
    for (const [m, i] of g.items) {
      const b = document.createElement("button");
      b.className = "tc-btn" + (chosenTc && chosenTc.base === m * 60 && chosenTc.inc === i ? " on" : "");
      b.textContent = `${m} | ${i}`;
      b.title = `${m} Minuten${i ? `, +${i} Sekunden pro Zug` : ""}`;
      b.onclick = () => { chosenTc = { base: m * 60, inc: i }; store.set(TC_KEY, `${m}+${i}`); renderTcList(); };
      row.appendChild(b);
    }
    wrap.appendChild(row);
    box.appendChild(wrap);
  }
  const wg = document.createElement("div");
  wg.className = "tc-group";
  wg.innerHTML = `<span class="label" style="font-size:11px">Ohne Uhr</span>`;
  const wr = document.createElement("div");
  wr.className = "tc-row";
  const w = document.createElement("button");
  w.className = "tc-btn work" + (chosenTc ? "" : " on");
  w.innerHTML = `Arbeitsmodus <small>Keine Zeitbegrenzung – zwischendurch weiterspielen</small>`;
  w.onclick = () => { chosenTc = null; store.set(TC_KEY, "none"); renderTcList(); };
  wr.appendChild(w);
  wg.appendChild(wr);
  box.appendChild(wg);
}
renderTcList();

$("#myName").value = store.get(NAME_KEY) || "";

if (!supabaseConfigured()) {
  $("#noOnline").classList.remove("hidden");
  $("#btnCreate").disabled = true;
  $("#btnJoin").disabled = true;
}

function readName() {
  const n = $("#myName").value.trim().slice(0, 20);
  if (!n) { toast("Bitte gib deinen Namen ein"); $("#myName").focus(); return null; }
  store.set(NAME_KEY, n);
  return n;
}

$("#btnLocal").onclick = startLocal;
$("#btnCreate").onclick = () => { const n = readName(); if (n) createOnline(n); };
$("#btnJoin").onclick = () => {
  const code = $("#joinCode").value.trim().toUpperCase();
  if (code.length < 4) return toast("Bitte Code eingeben");
  const n = readName();
  if (n) openOnline(code, n);
};
$("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnJoin").click(); });

function show(id) {
  $("#menu").classList.toggle("hidden", id !== "menu");
  $("#play").classList.toggle("hidden", id !== "play");
  window.scrollTo({ top: 0 });
}

/* ═════════════ Lokal ═════════════ */

function startLocal() {
  stopOnline();
  mode = "local"; myColor = "w"; flipped = false;
  game = new Chess(); localResult = null; premove = null; viewPly = null; resultShownFor = null;
  tc = chosenTc ? { ...chosenTc } : null;
  clock.w = clock.b = tc ? tc.base * 1000 : 0;
  clock.ref = Date.now();
  syncHistory(); clearSel();
  $("#sharePanel").classList.add("hidden");
  $("#chat").classList.add("hidden");
  show("play"); render();
}

/* ═════════════ Online ═════════════ */

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function client() {
  if (!online.sb) online.sb = await getSupabase();
  return online.sb;
}

function newGameRow(id, color, name, t) {
  const ms = t ? t.base * 1000 : null;
  return {
    id, fen: START_FEN, pgn: "",
    white: color === "w" ? ME : null, black: color === "b" ? ME : null,
    white_name: color === "w" ? name : null, black_name: color === "b" ? name : null,
    tc_base: t ? t.base : null, tc_inc: t ? t.inc : 0, white_ms: ms, black_ms: ms
  };
}

async function createOnline(name, preferColor, t = chosenTc) {
  const sb = await client();
  if (!sb) return;
  const color = preferColor || (Math.random() < 0.5 ? "w" : "b");
  for (let tries = 0; tries < 4; tries++) {
    const id = genCode();
    const { error } = await sb.from("chess_games").insert(newGameRow(id, color, name, t));
    if (!error) return openOnline(id, name);
    if (!String(error.code).startsWith("23")) { console.error(error); return toast("Fehler: " + error.message); }
  }
  toast("Konnte kein Spiel erstellen");
}

async function openOnline(id, name = store.get(NAME_KEY) || "Gast") {
  const sb = await client();
  if (!sb) return toast("Online-Modus nicht eingerichtet");
  stopOnline();

  let { data: row, error } = await sb.from("chess_games").select("*").eq("id", id).maybeSingle();
  if (error) { console.error(error); toast("Verbindung fehlgeschlagen: " + error.message); show("menu"); return; }
  if (!row) { toast("Spiel " + id + " gibt es nicht"); show("menu"); return; }

  // freien Platz übernehmen
  if (row.white !== ME && row.black !== ME) {
    const seat = !row.white ? "white" : !row.black ? "black" : null;
    if (seat) {
      const { data } = await sb.from("chess_games")
        .update({ [seat]: ME, [seat + "_name"]: name, updated_at: new Date().toISOString() })
        .eq("id", id).is(seat, null).select().maybeSingle();
      if (data) row = data;
      else ({ data: row } = await sb.from("chess_games").select("*").eq("id", id).maybeSingle());
    }
  }

  mode = "online"; online.id = id; online.offset = null; online.lastMoveAt = null; online.claiming = false;
  game = new Chess(); localResult = null; premove = null; viewPly = null; resultShownFor = null;
  syncHistory(); clearSel();
  history_replace("?game=" + id);
  $("#codeOut").textContent = id;
  $("#sharePanel").classList.remove("hidden");
  $("#chat").classList.remove("hidden");
  chat.ids.clear();
  $("#chatLog").innerHTML = "";
  show("play");
  applyRow(row, true);
  subscribe();
  loadChat();
}

function history_replace(q) {
  try { window.history.replaceState(null, "", q || location.pathname); } catch { /* egal */ }
}

function subscribe() {
  const { sb, id } = online;
  online.channel = sb.channel("chess-" + id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chess_games", filter: "id=eq." + id },
      (p) => applyRow(p.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chess_chat", filter: "game_id=eq." + id },
      (p) => addChat(p.new))
    .subscribe((status) => $("#live").classList.toggle("on", status === "SUBSCRIBED"));
  online.poll = setInterval(refresh, 4000); // Fallback, falls Realtime hakt
}

async function refresh() {
  if (mode !== "online" || online.busy) return;
  const { data } = await online.sb.from("chess_games").select("*").eq("id", online.id).maybeSingle();
  if (data) applyRow(data);
}

function stopOnline() {
  if (online.channel) online.sb.removeChannel(online.channel);
  clearInterval(online.poll);
  online.channel = null; online.poll = null; online.row = null; online.id = null;
}

function applyRow(row, first = false) {
  const prev = online.row;
  online.row = row;
  myColor = row.white === ME ? "w" : row.black === ME ? "b" : null;
  if (first) flipped = myColor === "b";

  tc = row.tc_base ? { base: row.tc_base, inc: row.tc_inc || 0 } : null;

  // Serverzeit gegen lokale Uhr abgleichen
  if (row.last_move_at && row.last_move_at !== online.lastMoveAt) {
    if (!first && online.lastMoveAt) {
      const sample = Date.now() - Date.parse(row.last_move_at);
      online.offset = online.offset === null ? sample : Math.min(online.offset, sample);
    }
    online.lastMoveAt = row.last_move_at;
  }
  clock.w = row.white_ms ?? 0;
  clock.b = row.black_ms ?? 0;
  clock.ref = Date.parse(row.last_move_at || row.updated_at || row.created_at) + (online.offset ?? 0);

  let moved = false;
  if ((row.pgn || "") !== game.pgn()) {
    const before = history.length;
    try {
      const g = new Chess();
      if (row.pgn) g.loadPgn(row.pgn);
      game = g;
    } catch {
      game = new Chess(row.fen);
    }
    syncHistory();
    moved = history.length !== before;
    if (!selIsPre) clearSel();
  }
  if (prev && !prev.rematch && row.rematch && myColor) toast("Revanche angeboten!");
  if (!dragActive()) render(); else pendingRender = true;
  if (moved && premove && myColor && game.turn() === myColor) setTimeout(tryPremove, 40);
}

async function pushMove(prevFen, myMs) {
  online.busy = true;
  const res = boardResult();
  const patch = { fen: game.fen(), pgn: game.pgn(), result: res?.result ?? null, reason: res?.reason ?? null, updated_at: new Date().toISOString() };
  if (myMs !== undefined) patch[myColor === "w" ? "white_ms" : "black_ms"] = Math.max(0, Math.round(myMs));
  const { data, error } = await online.sb.from("chess_games").update(patch)
    .eq("id", online.id).eq("fen", prevFen).select().maybeSingle();
  online.busy = false;
  if (error || !data) { toast("Zug nicht gespeichert – lade neu"); refresh(); }
  else applyRow(data);
}

async function resign() {
  if (finished()) return;
  if (mode === "local") {
    localResult = { result: game.turn() === "w" ? "0-1" : "1-0", reason: colorName(game.turn()) + " gibt auf" };
    return render();
  }
  if (!myColor) return;
  const btn = $("#btnResign");
  if (btn.dataset.confirm !== "1") {
    btn.dataset.confirm = "1"; btn.textContent = "Wirklich aufgeben?";
    setTimeout(() => { btn.dataset.confirm = ""; btn.textContent = "Aufgeben"; }, 3000);
    return;
  }
  btn.dataset.confirm = ""; btn.textContent = "Aufgeben";
  const { data } = await online.sb.from("chess_games")
    .update({ result: myColor === "w" ? "0-1" : "1-0", reason: "Aufgabe", updated_at: new Date().toISOString() })
    .eq("id", online.id).is("result", null).select().maybeSingle();
  if (data) applyRow(data);
}

async function rematch() {
  if (mode === "local") return startLocal();
  const row = online.row;
  if (!row || !myColor) return;
  if (row.rematch) return openOnline(row.rematch);
  const name = store.get(NAME_KEY) || "Gast";
  const sb = online.sb;
  const id = genCode();
  const t = row.tc_base ? { base: row.tc_base, inc: row.tc_inc || 0 } : null;
  const { error } = await sb.from("chess_games").insert(newGameRow(id, other(myColor), name, t));
  if (error) return toast("Revanche fehlgeschlagen");
  await sb.from("chess_games").update({ rematch: id }).eq("id", row.id);
  openOnline(id, name);
}

function leave() {
  stopOnline();
  mode = null; premove = null;
  history_replace();
  show("menu");
}

/* ═════════════ Uhr ═════════════ */

function clockRunning() {
  if (!tc || finished() || history.length < 2) return null;
  if (mode === "online" && !(online.row?.white && online.row?.black)) return null;
  return game.turn();
}

function remaining(c) {
  if (!tc) return 0;
  return clockRunning() === c ? clock[c] - (Date.now() - clock.ref) : clock[c];
}

function fmtClock(ms) {
  ms = Math.max(0, ms);
  if (ms < 20000) {
    const s = Math.floor(ms / 1000), t = Math.floor((ms % 1000) / 100);
    return `0:${String(s).padStart(2, "0")}.${t}`;
  }
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function hasMatingMaterial(color) {
  let minors = 0;
  for (const row of game.board()) for (const p of row) {
    if (!p || p.color !== color || p.type === "k") continue;
    if (p.type === "p" || p.type === "r" || p.type === "q") return true;
    minors++;
  }
  return minors >= 2;
}

function timeoutResult(loser) {
  const winner = other(loser);
  if (!hasMatingMaterial(winner)) return { result: "½-½", reason: "Zeit abgelaufen – ungenügendes Material" };
  return { result: winner === "w" ? "1-0" : "0-1", reason: "Zeit abgelaufen" };
}

async function claimFlag(loser) {
  if (online.claiming) return;
  online.claiming = true;
  const r = timeoutResult(loser);
  const { data } = await online.sb.from("chess_games")
    .update({ result: r.result, reason: r.reason, [loser === "w" ? "white_ms" : "black_ms"]: 0, updated_at: new Date().toISOString() })
    .eq("id", online.id).is("result", null).eq("fen", game.fen()).select().maybeSingle();
  online.claiming = false;
  if (data) applyRow(data);
}

setInterval(() => {
  if (!mode) return;
  renderClocks();
  const run = clockRunning();
  if (!run) return;
  const rem = remaining(run);
  if (mode === "local" && rem <= 0) {
    clock[run] = 0; clock.ref = Date.now();
    localResult = timeoutResult(run);
    render();
  } else if (mode === "online" && myColor) {
    if ((run === myColor && rem <= 0) || (run !== myColor && rem <= -2000)) claimFlag(run);
  }
}, 100);

/* ═════════════ Spiellogik ═════════════ */

function syncHistory() {
  history = game.history({ verbose: true });
  fens = [START_FEN];
  const g = new Chess();
  for (const m of history) { g.move(m.san); fens.push(g.fen()); }
}

function boardResult() {
  if (game.isCheckmate()) return { result: game.turn() === "w" ? "0-1" : "1-0", reason: "Schachmatt" };
  if (game.isStalemate()) return { result: "½-½", reason: "Patt" };
  if (game.isThreefoldRepetition()) return { result: "½-½", reason: "Dreifache Stellungswiederholung" };
  if (game.isInsufficientMaterial()) return { result: "½-½", reason: "Ungenügendes Material" };
  if (game.isDraw()) return { result: "½-½", reason: "50-Züge-Regel" };
  return null;
}

function currentResult() {
  if (mode === "online" && online.row?.result) return { result: online.row.result, reason: online.row.reason };
  return localResult || boardResult();
}
const finished = () => Boolean(currentResult());

function canMoveNow() {
  if (finished() || viewPly !== null) return false;
  if (mode === "local") return true;
  if (mode === "online") {
    const r = online.row;
    return Boolean(r && r.white && r.black && myColor && game.turn() === myColor && !online.busy);
  }
  return false;
}

function canPremove() {
  if (mode !== "online" || finished() || viewPly !== null) return false;
  const r = online.row;
  return Boolean(r && r.white && r.black && myColor && game.turn() !== myColor);
}

function clearSel() { selected = null; targets = []; selIsPre = false; }

// Zielfelder für Premoves: geometrisch, unabhängig von der aktuellen Besetzung
function premoveTargets(sq, p) {
  const f = FILES.indexOf(sq[0]), r = +sq[1] - 1, out = [];
  const add = (df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(FILES[nf] + (nr + 1)); };
  const ray = (df, dr) => { for (let i = 1; i < 8; i++) add(df * i, dr * i); };
  const dir = p.color === "w" ? 1 : -1;
  switch (p.type) {
    case "p":
      add(0, dir); if ((p.color === "w" && r === 1) || (p.color === "b" && r === 6)) add(0, 2 * dir);
      add(-1, dir); add(1, dir); break;
    case "n": [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]].forEach(([a, b]) => add(a, b)); break;
    case "b": ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1); break;
    case "r": ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1); break;
    case "q": ray(1, 1); ray(1, -1); ray(-1, 1); ray(-1, -1); ray(1, 0); ray(-1, 0); ray(0, 1); ray(0, -1); break;
    case "k":
      for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (a || b) add(a, b);
      if (sq === (p.color === "w" ? "e1" : "e8")) { add(2, 0); add(-2, 0); }
      break;
  }
  return out;
}

function select(sq) {
  const p = game.get(sq);
  selected = sq;
  if (canMoveNow()) {
    selIsPre = false;
    targets = [...new Set(game.moves({ square: sq, verbose: true }).map((m) => m.to))];
  } else {
    selIsPre = true;
    targets = premoveTargets(sq, p);
  }
}

function isMovable(sq) {
  const p = game.get(sq);
  if (!p) return false;
  if (canMoveNow()) return p.color === game.turn();
  if (canPremove()) return p.color === myColor;
  return false;
}

function attempt(from, to) {
  if (selIsPre) {
    premove = { from, to };
    clearSel(); render();
    return;
  }
  const moves = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!moves.length) { clearSel(); render(); return; }
  if (moves.some((m) => m.promotion)) return askPromotion(from, to);
  makeMove({ from, to });
}

function makeMove(m) {
  const prevFen = game.fen();
  const mover = game.turn();
  const plyBefore = history.length;
  let res = null;
  try { res = game.move(m); } catch { res = null; }
  if (!res) { clearSel(); render(); return false; }

  // Uhr: Bedenkzeit abziehen (ab dem 2. Zug je Seite) und Inkrement gutschreiben
  let myMs;
  if (tc) {
    const running = plyBefore >= 2;
    const left = running ? clock[mover] - (Date.now() - clock.ref) : clock[mover];
    myMs = left + (running ? tc.inc * 1000 : 0);
    if (mode === "local") { clock[mover] = myMs; clock.ref = Date.now(); }
  }
  syncHistory();
  viewPly = null; clearSel();
  if (mode === "local" && tc && history.length === 2) clock.ref = Date.now();
  render();
  if (mode === "online") pushMove(prevFen, tc ? myMs : undefined);
  return true;
}

function tryPremove() {
  const p = premove;
  premove = null;
  if (!p || !canMoveNow()) { render(); return; }
  const legal = game.moves({ square: p.from, verbose: true }).filter((m) => m.to === p.to);
  if (!legal.length) { render(); return; }
  makeMove({ from: p.from, to: p.to, promotion: legal.some((m) => m.promotion) ? "q" : undefined });
}

function askPromotion(from, to) {
  const color = game.turn();
  const box = $("#promoChoices");
  box.innerHTML = "";
  for (const t of ["q", "r", "b", "n"]) {
    const b = document.createElement("button");
    b.className = "promo-btn";
    b.setAttribute("aria-label", { q: "Dame", r: "Turm", b: "Läufer", n: "Springer" }[t]);
    b.innerHTML = pieceHtml(color, t);
    b.onclick = () => { $("#promo").classList.add("hidden"); makeMove({ from, to, promotion: t }); };
    box.appendChild(b);
  }
  $("#promo").classList.remove("hidden");
}
$("#promo").addEventListener("click", (e) => {
  if (e.target.id === "promo") { $("#promo").classList.add("hidden"); clearSel(); render(); }
});

/* ═════════════ Maus / Touch auf dem Brett ═════════════ */

const boardEl = $("#board");
const dragActive = () => Boolean(drag && drag.moved);

function squareAt(x, y) {
  const r = boardEl.getBoundingClientRect();
  if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
  let f = Math.floor(((x - r.left) / r.width) * 8);
  let rk = 7 - Math.floor(((y - r.top) / r.height) * 8);
  if (flipped) { f = 7 - f; rk = 7 - rk; }
  return FILES[f] + (rk + 1);
}

function sqEl(sq) { return boardEl.querySelector(`[data-sq="${sq}"]`); }

boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

boardEl.addEventListener("pointerdown", (e) => {
  if (!mode) return;
  if (e.button === 2) { premove = null; clearSel(); render(); return; }
  if (e.button !== 0) return;
  if (viewPly !== null) { viewPly = null; render(); return; }
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;

  if (selected && targets.includes(sq) && sq !== selected) { attempt(selected, sq); return; }

  if (isMovable(sq)) {
    const wasSelected = selected === sq;
    select(sq);
    render();
    startDrag(e, sq, wasSelected);
  } else {
    if (premove) premove = null;
    clearSel(); render();
  }
});

function startDrag(e, sq, wasSelected) {
  const pEl = sqEl(sq)?.querySelector("piece");
  if (!pEl) return;
  const size = boardEl.getBoundingClientRect().width / 8;
  drag = { from: sq, wasSelected, moved: false, x0: e.clientX, y0: e.clientY, size, ghost: null, src: pEl, hover: null, pid: e.pointerId };
  try { boardEl.setPointerCapture(e.pointerId); } catch { /* egal */ }
}

boardEl.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    const g = document.createElement("div");
    g.className = "drag-ghost";
    g.style.width = g.style.height = drag.size + "px";
    g.style.setProperty("--bs", drag.size * 8 + "px");
    g.innerHTML = drag.src.outerHTML;
    document.body.appendChild(g);
    drag.ghost = g;
    drag.src.classList.add("ghosted");
    boardEl.classList.add("dragging");
  }
  drag.ghost.style.left = e.clientX - drag.size / 2 + "px";
  drag.ghost.style.top = e.clientY - drag.size / 2 + "px";
  const over = squareAt(e.clientX, e.clientY);
  if (over !== drag.hover) {
    if (drag.hover) sqEl(drag.hover)?.classList.remove("hover");
    drag.hover = over;
    if (over && targets.includes(over)) sqEl(over)?.classList.add("hover");
  }
});

function endDrag(e, cancelled) {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const d = drag;
  drag = null;
  boardEl.classList.remove("dragging");
  d.ghost?.remove();
  if (cancelled) { render(); return; }
  const to = e ? squareAt(e.clientX, e.clientY) : null;
  if (d.moved) {
    if (to && to !== d.from && targets.includes(to)) return attempt(d.from, to);
    render();
  } else if (to === d.from && d.wasSelected) {
    clearSel(); render();
  } else if (pendingRender) { pendingRender = false; render(); }
}
boardEl.addEventListener("pointerup", (e) => endDrag(e, false));
boardEl.addEventListener("pointercancel", (e) => endDrag(e, true));

/* ═════════════ Tastatur: Züge nachspielen ═════════════ */

function setView(ply) {
  const n = history.length;
  if (ply === null || ply >= n) viewPly = null;
  else viewPly = Math.max(0, ply);
  clearSel();
  render();
}
const curPly = () => (viewPly === null ? history.length : viewPly);

document.addEventListener("keydown", (e) => {
  if (!mode || $("#play").classList.contains("hidden")) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "ArrowLeft") { setView(curPly() - 1); e.preventDefault(); }
  else if (e.key === "ArrowRight") { setView(curPly() + 1); e.preventDefault(); }
  else if (e.key === "ArrowUp" || e.key === "Home") { setView(0); e.preventDefault(); }
  else if (e.key === "ArrowDown" || e.key === "End") { setView(null); e.preventDefault(); }
  else if (e.key === "Escape") { premove = null; clearSel(); render(); }
});
$("#navFirst").onclick = () => setView(0);
$("#navPrev").onclick = () => setView(curPly() - 1);
$("#navNext").onclick = () => setView(curPly() + 1);
$("#navLast").onclick = () => setView(null);

/* ═════════════ Darstellung ═════════════ */

function render() {
  renderBoard();
  renderBars();
  renderStatus();
  renderMoves();
  renderResultCard();
}

function shownPosition() {
  return viewPly === null ? game : new Chess(fens[viewPly]);
}

function renderBoard() {
  const pos = shownPosition();
  const board = pos.board();
  const ply = curPly();
  const last = ply > 0 ? history[ply - 1] : null;
  const inCheck = pos.inCheck();
  const turn = pos.turn();
  const logoSq = flipped ? "h8" : "a1";
  let html = "";

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r;
      const ff = flipped ? 7 - f : f;
      const sq = FILES[ff] + (8 - rr);
      const cell = board[rr][ff];
      const cls = ["sq", (rr + ff) % 2 ? "dark" : "light"];
      if ((last && (last.from === sq || last.to === sq)) || selected === sq) cls.push("hl");
      if (premove && (premove.from === sq || premove.to === sq)) cls.push("pre");
      if (targets.includes(sq)) { cls.push("hint"); if (cell) cls.push("cap"); }
      if (cell && cell.type === "k" && cell.color === turn && inCheck) cls.push("check");
      if (viewPly === null && isMovable(sq)) cls.push("movable");
      html += `<div class="${cls.join(" ")}" data-sq="${sq}">`;
      if (logoOk && sq === logoSq) html += `<img class="sq-logo" src="${LOGO_URL}" alt="">`;
      if (f === 0) html += `<span class="coord rank">${8 - rr}</span>`;
      if (r === 7) html += `<span class="coord file">${FILES[ff]}</span>`;
      // Premove sichtbar machen: Figur steht schon auf dem Zielfeld
      let shown = cell;
      if (premove && viewPly === null) {
        if (sq === premove.from) shown = null;
        else if (sq === premove.to) shown = game.get(premove.from) || cell;
      }
      if (shown) html += pieceHtml(shown.color, shown.type);
      html += `</div>`;
    }
  }
  boardEl.innerHTML = html;
}

function material(pos) {
  const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  let wv = 0, bv = 0;
  for (const row of pos.board()) for (const p of row) {
    if (!p || p.type === "k") continue;
    cnt[p.color][p.type]++;
    if (p.color === "w") wv += VALUE[p.type]; else bv += VALUE[p.type];
  }
  return { cnt, diff: wv - bv };
}

function capturedHtml(byColor, mat) {
  // Figuren, die byColor geschlagen hat = fehlende Figuren der Gegenseite
  const opp = other(byColor);
  let html = "";
  for (const t of ["p", "n", "b", "r", "q"]) {
    const missing = Math.max(0, START_COUNT[t] - mat.cnt[opp][t]);
    if (!missing) continue;
    html += `<span class="cap-group">${pieceHtml(opp, t).repeat(missing)}</span>`;
  }
  const adv = byColor === "w" ? mat.diff : -mat.diff;
  if (adv > 0) html += `<span class="diff">+${adv}</span>`;
  return html;
}

function playerName(c) {
  if (mode === "local") return { name: colorName(c), sub: "" };
  const r = online.row || {};
  const n = c === "w" ? r.white_name : r.black_name;
  const seat = c === "w" ? r.white : r.black;
  if (!seat) return { name: "Warte auf Gegner …", sub: "" };
  return { name: n || colorName(c), sub: (myColor === c ? "du · " : "") + colorName(c) };
}

function renderBars() {
  const mat = material(shownPosition());
  const bottom = flipped ? "b" : "w";
  for (const [el, c] of [[$("#barBottom"), bottom], [$("#barTop"), other(bottom)]]) {
    const pn = playerName(c);
    el.innerHTML = `
      <div class="avatar ${c}">${escapeHtml((pn.name || "?").trim().charAt(0).toUpperCase())}</div>
      <div class="pinfo">
        <div class="pname">${escapeHtml(pn.name)}${pn.sub ? `<em>${pn.sub}</em>` : ""}</div>
        <div class="captured">${capturedHtml(c, mat)}</div>
      </div>
      <div class="clock" data-clock="${c}"></div>`;
  }
  renderClocks();
}

function renderClocks() {
  const run = clockRunning();
  document.querySelectorAll("[data-clock]").forEach((el) => {
    const c = el.dataset.clock;
    if (!tc) { el.classList.add("hidden-clock"); return; }
    el.classList.remove("hidden-clock");
    const ms = remaining(c);
    el.textContent = fmtClock(ms);
    el.classList.toggle("run", run === c);
    el.classList.toggle("low", ms < 20000 && (run === c || ms <= 0));
  });
}

function renderStatus() {
  const res = currentResult();
  const r = online.row;
  let main = "", small = "";
  if (res) {
    main = res.result === "1-0" ? "Weiß gewinnt" : res.result === "0-1" ? "Schwarz gewinnt" : "Remis";
    small = `${res.reason} · ${res.result}`;
  } else if (mode === "local") {
    main = colorName(game.turn()) + " ist am Zug";
    small = (game.inCheck() ? "Schach! · " : "") + tcLong(tc);
  } else if (mode === "online") {
    if (!r?.white || !r?.black) { main = "Warte auf Gegner …"; small = "Teile den Code oder Link · " + tcLong(tc); }
    else if (!myColor) { main = colorName(game.turn()) + " ist am Zug"; small = "Du schaust zu · " + tcLong(tc); }
    else {
      main = game.turn() === myColor ? "Du bist am Zug" : "Gegner ist am Zug";
      small = (game.inCheck() ? "Schach! · " : "") + tcLong(tc) + (premove ? " · Premove gesetzt" : "");
    }
  }
  if (viewPly !== null) small = `Ansicht: Zug ${viewPly} von ${history.length} · ↓ oder ⏭ zurück zur Partie`;
  $("#status").innerHTML = `${escapeHtml(main)}<small>${escapeHtml(small)}</small>`;

  const over = Boolean(res);
  $("#btnUndo").classList.toggle("hidden", mode !== "local");
  $("#btnUndo").disabled = !history.length;
  $("#btnResign").classList.toggle("hidden", over || (mode === "online" && (!myColor || !r?.white || !r?.black)));
  $("#btnRematch").classList.toggle("hidden", !over || (mode === "online" && !myColor));
  $("#btnRematch").textContent = mode === "local" ? "Neue Partie" : r?.rematch ? "Revanche beitreten" : "Revanche";
}

function renderMoves() {
  const el = $("#moves");
  const cur = curPly();
  if (!history.length) { el.innerHTML = `<div class="empty">Noch keine Züge</div>`; return; }
  let html = "";
  for (let i = 0; i < history.length; i += 2) {
    const alt = (i / 2) % 2 ? " row-alt" : "";
    html += `<span class="n${alt}">${i / 2 + 1}.</span>`;
    for (const j of [i, i + 1]) {
      if (j < history.length) html += `<span class="${alt.trim()}"><button class="mv${cur === j + 1 ? " cur" : ""}" data-ply="${j + 1}">${escapeHtml(history[j].san)}</button></span>`;
      else html += `<span class="${alt.trim()}"></span>`;
    }
  }
  el.innerHTML = html;
  el.querySelectorAll(".mv").forEach((b) => (b.onclick = () => setView(+b.dataset.ply)));
  const curBtn = el.querySelector(".mv.cur");
  if (curBtn) {
    const top = curBtn.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2;
  }
}

function gameKey() { return mode === "online" ? online.id : "local-" + fens.length; }

function renderResultCard() {
  const res = currentResult();
  const card = $("#resultCard");
  if (!res || resultShownFor === "closed:" + gameKey()) { card.classList.add("hidden"); return; }
  const mine = mode === "online" && myColor;
  let title = res.result === "½-½" ? "Remis" : res.result === "1-0" ? "Weiß gewinnt" : "Schwarz gewinnt";
  if (mine && res.result !== "½-½") title = (res.result === "1-0") === (myColor === "w") ? "Du hast gewonnen!" : "Du hast verloren";
  $("#rcTitle").textContent = title;
  $("#rcReason").textContent = res.reason;
  $("#rcRematch").classList.toggle("hidden", mode === "online" && !myColor);
  $("#rcRematch").textContent = mode === "local" ? "Neue Partie" : online.row?.rematch ? "Revanche beitreten" : "Revanche";
  card.classList.remove("hidden");
}
$("#rcClose").onclick = () => { resultShownFor = "closed:" + gameKey(); renderResultCard(); };
$("#rcRematch").onclick = rematch;
$("#rcMenu").onclick = leave;

/* ═════════════ Buttons ═════════════ */

$("#btnFlip").onclick = () => { flipped = !flipped; render(); };
$("#btnUndo").onclick = () => {
  if (mode !== "local" || !history.length) return;
  game.undo(); localResult = null; syncHistory(); viewPly = null; clearSel(); clock.ref = Date.now(); render();
};
$("#btnResign").onclick = resign;
$("#btnRematch").onclick = rematch;
$("#btnLeave").onclick = leave;
$("#btnCopy").onclick = async () => {
  const url = location.origin + location.pathname + "?game=" + online.id;
  try { await navigator.clipboard.writeText(url); toast("Link kopiert"); }
  catch { toast("Code: " + online.id); }
};

/* ═════════════ Chat ═════════════ */

const emoteBox = $("#emotes");
for (const e of EMOTES) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = e; b.title = "Senden: " + e;
  b.onclick = () => sendChat(e);
  emoteBox.appendChild(b);
}
for (const p of PHRASES) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "phrase"; b.textContent = p;
  b.onclick = () => sendChat(p);
  emoteBox.appendChild(b);
}

$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#chatInput").value.trim();
  if (!v) return;
  $("#chatInput").value = "";
  sendChat(v);
});

async function loadChat() {
  const id = online.id;
  const { data, error } = await online.sb.from("chess_chat").select("*").eq("game_id", id).order("created_at").limit(100);
  if (id !== online.id) return;
  if (error) { $("#chatLog").innerHTML = `<div class="empty">Chat nicht verfügbar. Bitte die neue schema.sql in Supabase ausführen.</div>`; return; }
  $("#chatLog").innerHTML = "";
  (data || []).forEach(addChat);
  if (!data?.length) $("#chatLog").innerHTML = `<div class="empty">Noch keine Nachrichten. Sag Hallo 👋</div>`;
}

const EMOJI_ONLY = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,8}$/u;

function addChat(m) {
  if (!m || m.game_id !== online.id || chat.ids.has(m.id)) return;
  chat.ids.add(m.id);
  const log = $("#chatLog");
  log.querySelector(".empty")?.remove();
  const div = document.createElement("div");
  const mine = m.sender === ME;
  const big = EMOJI_ONLY.test(m.body) && !/^[\d#*\s]+$/.test(m.body);
  div.className = "msg" + (mine ? " me" : "") + (big ? " big" : "");
  div.innerHTML = `<b>${escapeHtml(mine ? "Du" : m.name || "Gast")}</b><span class="txt">${escapeHtml(m.body)}</span>`;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(div);
  if (atBottom || mine) log.scrollTop = log.scrollHeight;
}

async function sendChat(text) {
  if (mode !== "online" || !online.id) return;
  const now = Date.now();
  if (now - chat.lastSend < 700) return toast("Nicht so schnell 🙂");
  chat.lastSend = now;
  const { data, error } = await online.sb.from("chess_chat")
    .insert({ game_id: online.id, sender: ME, name: store.get(NAME_KEY) || "Gast", body: text.slice(0, 300) })
    .select().maybeSingle();
  if (error) { console.error(error); return toast("Nachricht nicht gesendet"); }
  addChat(data);
}

/* ═════════════ Start ═════════════ */

const urlCode = new URLSearchParams(location.search).get("game");
if (urlCode && supabaseConfigured()) {
  const name = store.get(NAME_KEY);
  if (name) openOnline(urlCode.toUpperCase(), name);
  else { $("#joinCode").value = urlCode.toUpperCase(); show("menu"); $("#myName").focus(); toast("Gib deinen Namen ein und tritt bei"); }
} else show("menu");
