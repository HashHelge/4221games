// Online-Imposter: jede:r spielt am eigenen Handy. Synchronisiert über Supabase.
import { KATEGORIEN } from "./woerter.js";
import { getSupabase, supabaseConfigured, clientId, toast, shuffle, showSection, escapeHtml } from "./common.js";

const $ = (s) => document.querySelector(s);
const ME = clientId();
const NAME_KEY = "4221-name";
const SETTINGS_KEY = "4221-imposter-online";

const S = {
  sb: null, code: null, room: null, players: [],
  ch: null, poll: null, pending: null,
  view: null, roundN: null, flipped: false, busy: false
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* egal */ } }
};
const now = () => new Date().toISOString();
const isHost = () => S.room?.host === ME;
const me = () => S.players.find((p) => p.client_id === ME);
const nameOf = (id) =>
  S.room?.round?.players?.find((p) => p.id === id)?.name ||
  S.players.find((p) => p.client_id === id)?.name || "?";

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function savedSettings() {
  const all = Object.keys(KATEGORIEN);
  let s = {};
  try { s = JSON.parse(store.get(SETTINGS_KEY)) || {}; } catch { /* egal */ }
  const cats = (s.cats || []).filter((c) => KATEGORIEN[c]);
  return { impostors: s.impostors || 1, cats: cats.length ? cats : all, hint: s.hint ?? true, showCat: s.showCat ?? true };
}

/* ───────── Einstieg ───────── */

$("#modeOnline").onclick = () => {
  if (!supabaseConfigured()) {
    $("#oNoOnline").classList.remove("hidden");
    return toast("Online-Modus ist noch nicht eingerichtet");
  }
  $("#oName").value = store.get(NAME_KEY) || "";
  showSection("onStart");
};
$("#oBack").onclick = () => showSection("modeSel");
$("#oCreate").onclick = createRoom;
$("#oJoin").onclick = () => joinRoom($("#oCode").value.trim().toUpperCase());
$("#oCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#oJoin").click(); });
$("#oLeave").onclick = () => exitRoom(true);

function readName() {
  const n = $("#oName").value.trim().slice(0, 20);
  if (!n) { toast("Bitte gib deinen Namen ein"); $("#oName").focus(); return null; }
  store.set(NAME_KEY, n);
  return n;
}

async function client() {
  if (!S.sb) S.sb = await getSupabase();
  return S.sb;
}

async function createRoom() {
  const name = readName();
  if (!name || S.busy) return;
  S.busy = true;
  try {
    const sb = await client().catch((e) => { toast("Supabase konnte nicht geladen werden"); throw e; });
    for (let i = 0; i < 4; i++) {
      const id = genCode();
      const { error } = await sb.from("imposter_rooms").insert({ id, host: ME, settings: savedSettings() });
      if (!error) return await joinRoom(id, name);
      if (!String(error.code).startsWith("23")) { console.error(error); return toast("Fehler: " + error.message); }
    }
    toast("Konnte keinen Raum erstellen");
  } finally { S.busy = false; }
}

async function joinRoom(id, name = readName()) {
  if (!name) return;
  if (!id || id.length < 4) return toast("Bitte Code eingeben");
  const sb = await client();
  const { data: room, error: e1 } = await sb.from("imposter_rooms").select("id").eq("id", id).maybeSingle();
  if (e1) { console.error(e1); return toast("Verbindung fehlgeschlagen: " + e1.message); }
  if (!room) return toast("Raum " + id + " gibt es nicht");
  const { error } = await sb.from("imposter_players")
    .upsert({ room_id: id, client_id: ME, name }, { onConflict: "room_id,client_id" });
  if (error) { console.error(error); return toast("Beitreten fehlgeschlagen: " + error.message); }
  enter(id);
}

/* ───────── Verbindung ───────── */

function enter(id) {
  stop();
  S.code = id; S.view = null; S.roundN = null; S.flipped = false;
  history.replaceState(null, "", "?room=" + id);
  $("#oBarCode").textContent = id;
  $("#oBar").classList.remove("hidden");
  S.ch = S.sb.channel("imp-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "imposter_rooms", filter: "id=eq." + id }, schedule)
    .on("postgres_changes", { event: "*", schema: "public", table: "imposter_players", filter: "room_id=eq." + id }, schedule)
    .subscribe();
  S.poll = setInterval(refresh, 3000); // Fallback, falls Realtime hakt
  refresh();
}

function schedule() {
  clearTimeout(S.pending);
  S.pending = setTimeout(refresh, 120);
}

function stop() {
  if (S.ch) S.sb.removeChannel(S.ch);
  clearInterval(S.poll);
  clearTimeout(S.pending);
  S.ch = null; S.poll = null;
}

async function refresh() {
  const code = S.code;
  if (!code) return;
  const [r, p] = await Promise.all([
    S.sb.from("imposter_rooms").select("*").eq("id", code).maybeSingle(),
    S.sb.from("imposter_players").select("*").eq("room_id", code).order("joined_at")
  ]);
  if (code !== S.code) return;
  if (r.error || p.error) return; // kurzer Netzwerkfehler, nächster Versuch folgt
  if (!r.data) { toast("Der Raum wurde geschlossen"); return exitRoom(false); }
  S.room = r.data;
  S.players = p.data || [];

  // Nach Neuladen o. ä. wieder eintragen
  if (!me()) {
    const name = store.get(NAME_KEY) || "Gast";
    await S.sb.from("imposter_players").upsert({ room_id: code, client_id: ME, name }, { onConflict: "room_id,client_id" });
    return schedule();
  }
  // Host weg? Dann übernimmt die erste Person in der Liste.
  if (!S.players.some((x) => x.client_id === S.room.host) && S.players[0]?.client_id === ME) {
    await S.sb.from("imposter_rooms").update({ host: ME, updated_at: now() }).eq("id", code).eq("host", S.room.host);
    return schedule();
  }
  render();
}

async function exitRoom(remote) {
  const code = S.code, wasHost = isHost();
  const others = S.players.filter((p) => p.client_id !== ME);
  stop();
  S.code = null; S.room = null; S.players = []; S.view = null;
  $("#oBar").classList.add("hidden");
  history.replaceState(null, "", location.pathname);
  showSection("modeSel");
  if (remote && code) {
    await S.sb.from("imposter_players").delete().eq("room_id", code).eq("client_id", ME);
    if (!others.length) await S.sb.from("imposter_rooms").delete().eq("id", code);
    else if (wasHost) await S.sb.from("imposter_rooms").update({ host: others[0].client_id, updated_at: now() }).eq("id", code);
  }
}

async function updateRoom(patch, extra) {
  let q = S.sb.from("imposter_rooms").update({ ...patch, updated_at: now() }).eq("id", S.code);
  if (extra) q = extra(q);
  const { error } = await q;
  if (error) { console.error(error); toast("Konnte nicht speichern"); }
  schedule();
}

/* ───────── Darstellung ───────── */

function render() {
  const r = S.room;
  if (r.round && r.round.n !== S.roundN) { S.roundN = r.round.n; S.flipped = false; }
  const view = { lobby: "onLobby", playing: "onPlay", voting: "onVote", result: "onResult" }[r.phase] || "onLobby";
  if (view === "onLobby") renderLobby();
  else if (view === "onPlay") renderPlay();
  else if (view === "onVote") renderVote();
  else renderResult();
  if (S.view !== view) { S.view = view; showSection(view); }
}

/* Lobby */

function renderLobby() {
  const r = S.room, st = r.settings;
  $("#lCode").textContent = S.code;
  $("#lCount").textContent = S.players.length + " Spieler" + (S.players.length < 3 ? " · mindestens 3 nötig" : "");
  $("#lPlayers").innerHTML = S.players.map((p) =>
    `<div><span>${escapeHtml(p.name)}${p.client_id === ME ? '<em class="tag">du</em>' : ""}</span>` +
    `<span class="tag">${p.client_id === r.host ? "Host" : ""}</span></div>`).join("");

  $("#lSettings").classList.toggle("hidden", !isHost());
  $("#lWait").classList.toggle("hidden", isHost());

  const maxImp = Math.max(1, S.players.length - 2);
  if (isHost()) {
    $("#lImpVal").textContent = st.impostors;
    $("#lImpHint").textContent = `empfohlen: ${Math.max(1, Math.floor(S.players.length / 4))}` + (st.impostors > maxImp ? ` · bei ${S.players.length} Spielern max. ${maxImp}` : "");
    $("#lHint").checked = st.hint;
    $("#lShowCat").checked = st.showCat;
    const box = $("#lCats");
    box.innerHTML = "";
    for (const c of Object.keys(KATEGORIEN)) {
      const b = document.createElement("button");
      b.className = "chip" + (st.cats.includes(c) ? " on" : "");
      b.textContent = c;
      b.onclick = () => {
        let cats = st.cats.includes(c) ? st.cats.filter((x) => x !== c) : [...st.cats, c];
        if (!cats.length) return toast("Mindestens eine Kategorie");
        setSettings({ cats });
      };
      box.appendChild(b);
    }
    $("#lStart").disabled = S.players.length < 3;
  } else {
    const n = st.cats.length === Object.keys(KATEGORIEN).length ? "alle Kategorien" : st.cats.join(", ");
    $("#lSummary").textContent = `${st.impostors} Imposter · ${n}`;
  }
}

function setSettings(patch) {
  S.room.settings = { ...S.room.settings, ...patch };
  store.set(SETTINGS_KEY, JSON.stringify(S.room.settings));
  render();
  updateRoom({ settings: S.room.settings });
}

$("#lImpMinus").onclick = () => setSettings({ impostors: Math.max(1, S.room.settings.impostors - 1) });
$("#lImpPlus").onclick = () => {
  const max = Math.max(1, S.players.length - 2);
  if (S.room.settings.impostors >= max) return toast(`Bei ${S.players.length} Spielern sind max. ${max} Imposter möglich`);
  setSettings({ impostors: S.room.settings.impostors + 1 });
};
$("#lHint").onchange = (e) => setSettings({ hint: e.target.checked });
$("#lShowCat").onchange = (e) => setSettings({ showCat: e.target.checked });
$("#lCopy").onclick = async () => {
  const url = location.origin + location.pathname + "?room=" + S.code;
  try { await navigator.clipboard.writeText(url); toast("Link kopiert"); }
  catch { toast("Code: " + S.code); }
};
$("#lStart").onclick = startRound;

/* Runde starten (nur Host) */

function pickWord(cats, used) {
  const pool = [];
  for (const c of cats) for (const pair of KATEGORIEN[c] || []) pool.push({ cat: c, pair });
  let fresh = pool.filter((p) => !used.includes(p.pair[0]));
  if (!fresh.length) fresh = pool;
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  const [word, impWord] = Math.random() < 0.5 ? pick.pair : [pick.pair[1], pick.pair[0]];
  return { cat: pick.cat, word, impWord, key: pick.pair[0] };
}

async function startRound() {
  if (!isHost() || S.busy) return;
  if (S.players.length < 3) return toast("Mindestens 3 Spieler nötig");
  S.busy = true;
  try {
    const st = S.room.settings;
    const ids = S.players.map((p) => p.client_id);
    const k = Math.min(Math.max(1, st.impostors), Math.max(1, ids.length - 2));
    const prev = S.room.round || {};
    const w = pickWord(st.cats, prev.used || []);
    const round = {
      n: (prev.n || 0) + 1,
      cat: w.cat, word: w.word, impWord: w.impWord,
      players: S.players.map((p) => ({ id: p.client_id, name: p.name })),
      impostors: shuffle(ids).slice(0, k),
      starter: ids[Math.floor(Math.random() * ids.length)],
      used: [...(prev.used || []), w.key].slice(-80),
      winner: null, reason: null, counts: null, accused: null
    };
    await S.sb.from("imposter_players").update({ vote: null }).eq("room_id", S.code);
    await updateRoom({ phase: "playing", round });
  } finally { S.busy = false; }
}

/* Rolle anzeigen */

function renderPlay() {
  const r = S.room, rd = r.round, st = r.settings;
  const inRound = rd.players.some((p) => p.id === ME);
  const isImp = rd.impostors.includes(ME);
  const multi = rd.impostors.length > 1;

  $("#pRound").textContent = "Runde " + rd.n;
  $("#pStarter").textContent = rd.starter === ME ? "Du beginnst" : nameOf(rd.starter) + " beginnt";
  $("#pCat").textContent = st.showCat ? "Kategorie: " + rd.cat : "";

  $("#oCard").classList.toggle("hidden", !inRound);
  $("#pLate").classList.toggle("hidden", inRound);
  $("#oCard").classList.toggle("flipped", S.flipped);

  const back = $("#oCardBack");
  back.classList.toggle("imp", isImp);
  if (isImp) {
    $("#oCardRole").textContent = multi ? "Du bist ein Imposter" : "Du bist der Imposter";
    $("#oCardWord").textContent = st.hint ? rd.impWord : "Imposter";
    const partners = rd.impostors.filter((id) => id !== ME).map(nameOf);
    $("#oCardHint").textContent =
      (st.hint ? "Ähnlich, aber nicht das echte Wort." : "Hör gut zu und errate das Wort.") +
      (partners.length ? " Mit dir: " + partners.join(", ") + "." : "");
  } else {
    $("#oCardRole").textContent = "Zivilist";
    $("#oCardWord").textContent = rd.word;
    $("#oCardHint").textContent = "";
  }

  $("#pHost").classList.toggle("hidden", !isHost());
  $("#pWait").classList.toggle("hidden", isHost());
}

$("#oCard").onclick = () => {
  S.flipped = !S.flipped;
  $("#oCard").classList.toggle("flipped", S.flipped);
};
$("#pVote").onclick = () => isHost() && updateRoom({ phase: "voting" });
$("#pAbort").onclick = () => isHost() && updateRoom({ phase: "lobby" });

/* Abstimmung */

function renderVote() {
  const rd = S.room.round;
  const voters = rd.players.map((p) => p.id);
  const votes = S.players.filter((p) => voters.includes(p.client_id) && p.vote);
  const inRound = voters.includes(ME);
  const myVote = me()?.vote;

  $("#vCount").textContent = `${votes.length} / ${voters.length} abgestimmt`;
  $("#vSub").textContent = inRound
    ? "Tippe auf eine Person. Du kannst deine Stimme ändern, bis aufgelöst wird."
    : "Du schaust diese Runde nur zu.";

  const box = $("#vList");
  box.innerHTML = "";
  if (inRound) {
    for (const p of rd.players) {
      if (p.id === ME) continue;
      const b = document.createElement("button");
      b.className = "vote-btn" + (myVote === p.id ? " on" : "");
      b.textContent = p.name;
      b.onclick = () => castVote(p.id);
      box.appendChild(b);
    }
  }

  $("#vResolve").classList.toggle("hidden", !isHost());
  if (isHost() && votes.length === voters.length && voters.length) resolve();
}

async function castVote(id) {
  const m = me();
  if (!m) return;
  m.vote = id;
  renderVote();
  const { error } = await S.sb.from("imposter_players").update({ vote: id }).eq("room_id", S.code).eq("client_id", ME);
  if (error) toast("Stimme nicht gespeichert");
  schedule();
}

$("#vResolve").onclick = resolve;

async function resolve() {
  if (!isHost() || S.busy || S.room.phase !== "voting") return;
  S.busy = true;
  try {
    const rd = S.room.round;
    const ids = rd.players.map((p) => p.id);
    const counts = {};
    for (const p of S.players) {
      if (ids.includes(p.client_id) && ids.includes(p.vote)) counts[p.vote] = (counts[p.vote] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1]) ? sorted[0][0] : null;
    const caught = Boolean(top && rd.impostors.includes(top));
    const winner = caught ? "civ" : "imp";
    const reason = !sorted.length ? "Niemand hat abgestimmt"
      : !top ? "Gleichstand – der Imposter entkommt"
      : caught ? `${nameOf(top)} wurde enttarnt`
      : `${nameOf(top)} war unschuldig`;
    const score = { civ: 0, imp: 0, ...S.room.score };
    score[winner]++;
    await updateRoom(
      { phase: "result", score, round: { ...rd, counts, accused: top, winner, reason } },
      (q) => q.eq("phase", "voting")
    );
  } finally { S.busy = false; }
}

/* Ergebnis */

function renderResult() {
  const r = S.room, rd = r.round;
  const multi = rd.impostors.length > 1;
  $("#rWinner").textContent = rd.winner === "civ" ? "Zivilisten gewinnen" : multi ? "Imposter gewinnen" : "Imposter gewinnt";
  $("#rReason").textContent = rd.reason || "";
  $("#rWord").textContent = rd.word;
  $("#rImpWord").textContent = r.settings.hint ? ` · Imposter hatte: ${rd.impWord}` : "";
  const counts = rd.counts || {};
  $("#rList").innerHTML = rd.players.map((p) => {
    const imp = rd.impostors.includes(p.id);
    const c = counts[p.id] || 0;
    return `<div><span class="${imp ? "imp" : ""}">${escapeHtml(p.name)}${p.id === ME ? '<em class="tag">du</em>' : ""}</span>` +
      `<span class="${imp ? "imp" : ""}">${imp ? "Imposter" : "Zivilist"} · ${c} ${c === 1 ? "Stimme" : "Stimmen"}</span></div>`;
  }).join("");
  $("#rScoreCiv").textContent = r.score?.civ || 0;
  $("#rScoreImp").textContent = r.score?.imp || 0;
  $("#rHost").classList.toggle("hidden", !isHost());
  $("#rWait").classList.toggle("hidden", isHost());
  $("#rGuessed").classList.toggle("hidden", rd.winner !== "civ");
}

$("#rNext").onclick = startRound;
$("#rLobby").onclick = () => isHost() && updateRoom({ phase: "lobby" });
$("#rGuessed").onclick = () => {
  if (!isHost()) return;
  const rd = S.room.round;
  if (rd.winner !== "civ") return;
  const score = { civ: 0, imp: 0, ...S.room.score };
  score.civ = Math.max(0, score.civ - 1);
  score.imp++;
  updateRoom({ score, round: { ...rd, winner: "imp", reason: "Der Imposter hat das Wort erraten" } });
};

/* ───────── Start über Einladungslink ───────── */

const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom && supabaseConfigured()) {
  const code = urlRoom.toUpperCase();
  const name = store.get(NAME_KEY);
  $("#oCode").value = code;
  $("#oName").value = name || "";
  if (name) joinRoom(code, name);
  else { showSection("onStart"); $("#oName").focus(); toast("Gib deinen Namen ein und tritt bei"); }
}
