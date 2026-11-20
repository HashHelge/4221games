import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.0.0/+esm";
import { getSupabase, supabaseConfigured, clientId, toast } from "./common.js";

const $ = (s) => document.querySelector(s);
const VS = "︎"; // erzwingt Text-Darstellung (kein Emoji auf iOS)
const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FILES = "abcdefgh";
const ME = clientId();

let game = new Chess();
let mode = null;          // "local" | "online"
let myColor = "w";        // "w" | "b" | null (Zuschauer)
let flipped = false;
let selected = null;
let legal = [];
let lastMove = null;
let busy = false;

const online = { sb: null, id: null, row: null, channel: null, poll: null };

/* ───────── Menü ───────── */

if (!supabaseConfigured()) {
  $("#noOnline").classList.remove("hidden");
  $("#btnCreate").disabled = true;
  $("#btnJoin").disabled = true;
}

$("#btnLocal").onclick = startLocal;
$("#btnCreate").onclick = createOnline;
$("#btnJoin").onclick = () => {
  const code = $("#joinCode").value.trim().toUpperCase();
  if (code.length < 4) return toast("Code eingeben");
  openOnline(code);
};
$("#joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnJoin").click(); });

$("#btnUndo").onclick = () => { if (mode !== "local") return; game.undo(); updateLastMoveFromHistory(); clearSel(); render(); };
$("#btnFlip").onclick = () => { flipped = !flipped; render(); };
$("#btnLeave").onclick = leave;
$("#btnResign").onclick = resign;
$("#btnRematch").onclick = rematch;
$("#btnCopy").onclick = async () => {
  const url = location.origin + location.pathname + "?game=" + online.id;
  try { await navigator.clipboard.writeText(url); toast("Link kopiert"); }
  catch { prompt("Link kopieren:", url); }
};

function show(id) {
  $("#menu").classList.toggle("hidden", id !== "menu");
  $("#play").classList.toggle("hidden", id !== "play");
}

function startLocal() {
  stopOnline();
  mode = "local"; myColor = "w"; flipped = false;
  game = new Chess(); lastMove = null; clearSel();
  $("#sharePanel").classList.add("hidden");
  $("#btnUndo").classList.remove("hidden");
  $("#btnResign").classList.add("hidden");
  $("#btnRematch").classList.remove("hidden");
  $("#btnRematch").textContent = "Neues Spiel";
  show("play"); render();
}

/* ───────── Online ───────── */

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

async function createOnline(_, preferColor) {
  const sb = await getSupabase();
  if (!sb) return;
  const color = preferColor || (Math.random() < 0.5 ? "w" : "b");
  for (let tries = 0; tries < 4; tries++) {
    const id = genCode();
    const row = { id, white: color === "w" ? ME : null, black: color === "b" ? ME : null, fen: new Chess().fen(), pgn: "" };
    const { error } = await sb.from("chess_games").insert(row);
    if (!error) return openOnline(id);
    if (!String(error.code).startsWith("23")) { console.error(error); return toast("Fehler: " + error.message); }
  }
  toast("Konnte kein Spiel erstellen");
}

async function openOnline(id) {
  const sb = await getSupabase();
  if (!sb) return toast("Online-Modus nicht eingerichtet");
  stopOnline();
  online.sb = sb;

  let { data: row, error } = await sb.from("chess_games").select("*").eq("id", id).maybeSingle();
  if (error || !row) { toast("Spiel nicht gefunden"); show("menu"); return; }

  // freien Platz übernehmen
  if (row.white !== ME && row.black !== ME) {
    const seat = !row.white ? "white" : !row.black ? "black" : null;
    if (seat) {
      const { data } = await sb.from("chess_games").update({ [seat]: ME, updated_at: new Date().toISOString() })
        .eq("id", id).is(seat, null).select().maybeSingle();
      if (data) row = data;
      else ({ data: row } = await sb.from("chess_games").select("*").eq("id", id).maybeSingle());
    }
  }

  mode = "online"; online.id = id; game = new Chess(); lastMove = null; clearSel();
  history.replaceState(null, "", "?game=" + id);
  $("#codeOut").textContent = id;
  $("#sharePanel").classList.remove("hidden");
  $("#btnUndo").classList.add("hidden");
  $("#btnRematch").textContent = "Revanche";
  show("play");
  applyRow(row, true);
  subscribe();
}

function subscribe() {
  const { sb, id } = online;
  online.channel = sb.channel("game-" + id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chess_games", filter: "id=eq." + id },
      (p) => applyRow(p.new))
    .subscribe((status) => $("#live").classList.toggle("on", status === "SUBSCRIBED"));
  // Fallback, falls Realtime mal hakt
  online.poll = setInterval(refresh, 4000);
}

async function refresh() {
  if (mode !== "online" || busy) return;
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

  if ((row.pgn || "") !== game.pgn()) {
    try {
      game = new Chess();
      if (row.pgn) game.loadPgn(row.pgn);
    } catch {
      game = new Chess(row.fen);
    }
    updateLastMoveFromHistory();
    clearSel();
  }
  if (prev && !prev.rematch && row.rematch && myColor) toast("Revanche angeboten!");
  render();
}

async function pushMove(prevFen) {
  busy = true;
  const res = resultOf();
  const { data, error } = await online.sb.from("chess_games")
    .update({ fen: game.fen(), pgn: game.pgn(), result: res?.result ?? null, reason: res?.reason ?? null, updated_at: new Date().toISOString() })
    .eq("id", online.id).eq("fen", prevFen).select().maybeSingle();
  busy = false;
  if (error || !data) { toast("Zug nicht gespeichert – lade neu"); refresh(); }
  else online.row = data;
}

async function resign() {
  if (mode !== "online" || !myColor || finished()) return;
  if (!confirm("Wirklich aufgeben?")) return;
  const result = myColor === "w" ? "0-1" : "1-0";
  const { data } = await online.sb.from("chess_games")
    .update({ result, reason: "Aufgabe", updated_at: new Date().toISOString() })
    .eq("id", online.id).select().maybeSingle();
  if (data) applyRow(data);
}

async function rematch() {
  if (mode === "local") return startLocal();
  const row = online.row;
  if (!row || !myColor) return;
  if (row.rematch) return openOnline(row.rematch);
  // Farben tauschen
  const sb = online.sb;
  const id = genCode();
  const newColor = myColor === "w" ? "b" : "w";
  const { error } = await sb.from("chess_games").insert({
    id, white: newColor === "w" ? ME : null, black: newColor === "b" ? ME : null, fen: new Chess().fen(), pgn: ""
  });
  if (error) return toast("Revanche fehlgeschlagen");
  await sb.from("chess_games").update({ rematch: id }).eq("id", row.id);
  openOnline(id);
}

function leave() {
  stopOnline();
  mode = null;
  history.replaceState(null, "", location.pathname);
  show("menu");
}

/* ───────── Spiellogik ───────── */

function resultOf() {
  if (game.isCheckmate()) return { result: game.turn() === "w" ? "0-1" : "1-0", reason: "Schachmatt" };
  if (game.isStalemate()) return { result: "½-½", reason: "Patt" };
  if (game.isThreefoldRepetition()) return { result: "½-½", reason: "Stellungswiederholung" };
  if (game.isInsufficientMaterial()) return { result: "½-½", reason: "Ungenügendes Material" };
  if (game.isDraw()) return { result: "½-½", reason: "Remis" };
  return null;
}

function finished() {
  return Boolean((mode === "online" && online.row?.result) || resultOf());
}

function canInteract() {
  if (finished()) return false;
  if (mode === "local") return true;
  if (mode === "online") {
    const r = online.row;
    return Boolean(r && r.white && r.black && myColor && game.turn() === myColor && !busy);
  }
  return false;
}

function clearSel() { selected = null; legal = []; }

function updateLastMoveFromHistory() {
  const h = game.history({ verbose: true });
  const m = h[h.length - 1];
  lastMove = m ? { from: m.from, to: m.to } : null;
}

function onSquare(sq) {
  if (!canInteract()) return;
  const piece = game.get(sq);
  if (selected) {
    const hits = legal.filter((m) => m.to === sq);
    if (hits.length) {
      if (hits.some((m) => m.promotion)) return askPromotion(selected, sq);
      return makeMove({ from: selected, to: sq });
    }
  }
  if (piece && piece.color === game.turn() && selected !== sq) {
    selected = sq;
    legal = game.moves({ square: sq, verbose: true });
  } else clearSel();
  render();
}

function makeMove(m) {
  const prevFen = game.fen();
  let res = null;
  try { res = game.move(m); } catch { res = null; }
  if (!res) return;
  lastMove = { from: res.from, to: res.to };
  clearSel();
  render();
  if (mode === "online") pushMove(prevFen);
}

function askPromotion(from, to) {
  const color = game.turn();
  const box = $("#promoChoices");
  box.innerHTML = "";
  for (const t of ["q", "r", "b", "n"]) {
    const b = document.createElement("button");
    b.className = "promo-btn";
    b.innerHTML = `<span class="pc ${color}">${GLYPH[t]}${VS}</span>`;
    b.onclick = () => { $("#promo").classList.add("hidden"); makeMove({ from, to, promotion: t }); };
    box.appendChild(b);
  }
  $("#promo").classList.remove("hidden");
}
$("#promo").addEventListener("click", (e) => { if (e.target.id === "promo") { $("#promo").classList.add("hidden"); clearSel(); render(); } });

/* ───────── Darstellung ───────── */

function render() {
  const el = $("#board");
  el.innerHTML = "";
  const board = game.board();
  const inCheck = game.inCheck();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const rr = flipped ? 7 - r : r;
      const ff = flipped ? 7 - f : f;
      const sq = FILES[ff] + (8 - rr);
      const cell = board[rr][ff];
      const btn = document.createElement("button");
      btn.className = "sq " + ((rr + ff) % 2 ? "dark" : "light");
      btn.setAttribute("aria-label", sq);
      if (lastMove && (lastMove.from === sq || lastMove.to === sq)) btn.classList.add("last");
      if (selected === sq) btn.classList.add("sel");
      if (legal.some((m) => m.to === sq)) btn.classList.add(cell ? "cap" : "dot");
      if (cell && cell.type === "k" && cell.color === game.turn() && inCheck) btn.classList.add("check");
      if (cell) {
        const s = document.createElement("span");
        s.className = "pc " + cell.color;
        s.textContent = GLYPH[cell.type] + VS;
        btn.appendChild(s);
      }
      if (f === 0) btn.insertAdjacentHTML("beforeend", `<span class="coord rank">${8 - rr}</span>`);
      if (r === 7) btn.insertAdjacentHTML("beforeend", `<span class="coord file">${FILES[ff]}</span>`);
      btn.onclick = () => onSquare(sq);
      el.appendChild(btn);
    }
  }
  renderStatus();
  renderMoves();
}

function renderStatus() {
  const turnName = game.turn() === "w" ? "Weiß" : "Schwarz";
  let main = "", small = "";
  const r = online.row;
  const res = (mode === "online" && r?.result) ? { result: r.result, reason: r.reason } : resultOf();

  if (res) {
    const winner = res.result === "1-0" ? "Weiß gewinnt" : res.result === "0-1" ? "Schwarz gewinnt" : "Remis";
    main = winner; small = res.reason + " · " + res.result;
  } else if (mode === "local") {
    main = turnName + " am Zug"; small = game.inCheck() ? "Schach!" : "Lokales Spiel";
  } else if (mode === "online") {
    if (!r?.white || !r?.black) { main = "Warte auf Gegner…"; small = "Teile den Code oder Link"; }
    else if (!myColor) { main = turnName + " am Zug"; small = "Du schaust zu"; }
    else {
      main = game.turn() === myColor ? "Du bist am Zug" : "Gegner ist am Zug";
      small = "Du spielst " + (myColor === "w" ? "Weiß" : "Schwarz") + (game.inCheck() ? " · Schach!" : "");
    }
  }
  $("#status").innerHTML = `${main}<small>${small}</small>`;

  const over = Boolean(res);
  if (mode === "online") {
    $("#btnResign").classList.toggle("hidden", over || !myColor || !r?.black || !r?.white);
    $("#btnRematch").classList.toggle("hidden", !over || !myColor);
    $("#btnRematch").textContent = r?.rematch ? "Revanche beitreten" : "Revanche";
  } else if (mode === "local") {
    $("#btnRematch").classList.remove("hidden");
  }
}

function renderMoves() {
  const h = game.history();
  const el = $("#moves");
  let html = "";
  for (let i = 0; i < h.length; i += 2) {
    html += `<span class="n">${i / 2 + 1}.</span><span>${h[i]}</span><span>${h[i + 1] ?? ""}</span>`;
  }
  el.innerHTML = html || `<span class="n" style="grid-column:1/-1">Noch keine Züge</span>`;
  el.scrollTop = el.scrollHeight;
}

/* ───────── Start ───────── */

const urlCode = new URLSearchParams(location.search).get("game");
if (urlCode && supabaseConfigured()) openOnline(urlCode.toUpperCase());
else show("menu");
