import { KATEGORIEN } from "./woerter.js";
import { shuffle, toast, showSection, escapeHtml } from "./common.js";

const $ = (s) => document.querySelector(s);
const STORE = "4221-imposter";

/* ───────── Zustand ───────── */

const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const state = {
  players: saved.players?.length >= 3 ? saved.players : ["Spieler 1", "Spieler 2", "Spieler 3", "Spieler 4"],
  impostors: saved.impostors || 1,
  cats: saved.cats?.filter((c) => KATEGORIEN[c])?.length ? saved.cats.filter((c) => KATEGORIEN[c]) : Object.keys(KATEGORIEN),
  hint: saved.hint ?? true,
  showCat: saved.showCat ?? true,
  score: { civ: 0, imp: 0 },
  used: new Set(),
  round: null
};

function persist() {
  try { localStorage.setItem(STORE, JSON.stringify({
    players: state.players, impostors: state.impostors, cats: state.cats, hint: state.hint, showCat: state.showCat
  })); } catch {}
}

const show = showSection;

/* ───────── Einstellungen ───────── */

function renderPlayers() {
  const box = $("#players");
  box.innerHTML = "";
  state.players.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "player-row";
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = name; inp.placeholder = "Spieler " + (i + 1); inp.maxLength = 20;
    inp.oninput = () => { state.players[i] = inp.value; persist(); };
    const del = document.createElement("button");
    del.className = "icon-btn"; del.textContent = "×"; del.setAttribute("aria-label", "entfernen");
    del.onclick = () => {
      if (state.players.length <= 3) return toast("Mindestens 3 Spieler");
      state.players.splice(i, 1); clampImp(); persist(); renderPlayers(); renderImp();
    };
    row.append(inp, del);
    box.appendChild(row);
  });
}

function maxImp() { return Math.max(1, state.players.length - 2); }
function clampImp() { state.impostors = Math.min(Math.max(1, state.impostors), maxImp()); }

function renderImp() {
  $("#impVal").textContent = state.impostors;
  const rec = Math.max(1, Math.floor(state.players.length / 4));
  $("#impHint").textContent = `${state.players.length} Spieler · empfohlen: ${rec}`;
}

function renderCats() {
  const box = $("#cats");
  box.innerHTML = "";
  for (const c of Object.keys(KATEGORIEN)) {
    const b = document.createElement("button");
    b.className = "chip" + (state.cats.includes(c) ? " on" : "");
    b.textContent = c;
    b.onclick = () => {
      if (state.cats.includes(c)) {
        if (state.cats.length === 1) return toast("Mindestens eine Kategorie");
        state.cats = state.cats.filter((x) => x !== c);
      } else state.cats.push(c);
      persist(); renderCats();
    };
    box.appendChild(b);
  }
}

$("#addPlayer").onclick = () => {
  if (state.players.length >= 20) return toast("Maximal 20 Spieler");
  state.players.push("Spieler " + (state.players.length + 1));
  persist(); renderPlayers(); renderImp();
  const inputs = $("#players").querySelectorAll("input");
  inputs[inputs.length - 1].select();
};
$("#impMinus").onclick = () => { state.impostors--; clampImp(); persist(); renderImp(); };
$("#impPlus").onclick = () => {
  if (state.impostors >= maxImp()) return toast("Mehr Imposter gehen bei der Spielerzahl nicht");
  state.impostors++; persist(); renderImp();
};
$("#hintToggle").checked = state.hint;
$("#catToggle").checked = state.showCat;
$("#hintToggle").onchange = (e) => { state.hint = e.target.checked; persist(); };
$("#catToggle").onchange = (e) => { state.showCat = e.target.checked; persist(); };

/* ───────── Runde ───────── */

function pickWord() {
  const pool = [];
  for (const c of state.cats) for (const pair of KATEGORIEN[c]) pool.push({ cat: c, pair });
  let fresh = pool.filter((p) => !state.used.has(p.pair[0]));
  if (!fresh.length) { state.used.clear(); fresh = pool; }
  const pick = fresh[Math.floor(Math.random() * fresh.length)];
  state.used.add(pick.pair[0]);
  // Zufällig vertauschen, damit nicht immer dasselbe Wort "das echte" ist
  const [a, b] = Math.random() < 0.5 ? pick.pair : [pick.pair[1], pick.pair[0]];
  return { cat: pick.cat, word: a, impWord: b };
}

function startRound() {
  const names = state.players.map((n, i) => n.trim() || "Spieler " + (i + 1));
  clampImp();
  const impIdx = new Set(shuffle(names.map((_, i) => i)).slice(0, state.impostors));
  const { cat, word, impWord } = pickWord();
  state.round = {
    cat, word, impWord,
    players: names.map((name, i) => ({ name, imp: impIdx.has(i) })),
    turn: 0
  };
  showDeal();
}

function showDeal() {
  const r = state.round;
  const p = r.players[r.turn];
  $("#card").classList.remove("flipped");
  $("#next").disabled = true;
  $("#dealStep").textContent = `Spieler ${r.turn + 1} / ${r.players.length}`;
  $("#dealName").textContent = p.name;
  $("#next").textContent = r.turn === r.players.length - 1 ? "Verdecken & los geht's" : "Verdecken & weitergeben";

  // Inhalt erst nach kurzer Verzögerung setzen, damit beim Zurückdrehen nichts aufblitzt
  cardReady = false;
  setTimeout(() => {
    cardReady = true;
    const back = $("#cardBack");
    back.classList.toggle("imp", p.imp);
    const catLine = state.showCat ? "Kategorie: " + r.cat : "";
    if (p.imp) {
      $("#cardRole").textContent = state.round.players.filter((x) => x.imp).length > 1 ? "Du bist ein Imposter" : "Du bist der Imposter";
      $("#cardWord").textContent = state.hint ? r.impWord : "Imposter";
      $("#cardHint").textContent = state.hint
        ? "Dein Wort ist ähnlich, aber nicht das echte. " + catLine
        : (catLine || "Hör gut zu und errate das Wort.");
    } else {
      $("#cardRole").textContent = "Zivilist";
      $("#cardWord").textContent = r.word;
      $("#cardHint").textContent = catLine;
    }
  }, 300);
  show("deal");
}

let cardReady = false;
$("#card").onclick = () => {
  if (!cardReady) return;
  $("#card").classList.toggle("flipped");
  $("#next").disabled = false;
};

$("#next").onclick = () => {
  const r = state.round;
  $("#card").classList.remove("flipped");
  if (r.turn < r.players.length - 1) {
    r.turn++;
    setTimeout(showDeal, 250);
  } else {
    showTalk();
  }
};

/* ───────── Diskussion + Timer ───────── */

let timerLeft = 180, timerRun = null;
function drawTimer() {
  const m = Math.floor(timerLeft / 60), s = timerLeft % 60;
  $("#timer").textContent = `${m}:${String(s).padStart(2, "0")}`;
  $("#timer").style.color = timerLeft === 0 ? "var(--danger)" : "";
}
function resetTimer() { clearInterval(timerRun); timerRun = null; timerLeft = 180; $("#timerBtn").textContent = "Timer starten"; drawTimer(); }
$("#timerBtn").onclick = () => {
  if (timerRun) { clearInterval(timerRun); timerRun = null; $("#timerBtn").textContent = "Weiter"; return; }
  $("#timerBtn").textContent = "Pause";
  timerRun = setInterval(() => {
    timerLeft = Math.max(0, timerLeft - 1); drawTimer();
    if (timerLeft === 0) { clearInterval(timerRun); timerRun = null; $("#timerBtn").textContent = "Zeit um"; navigator.vibrate?.(400); }
  }, 1000);
};
$("#timerReset").onclick = resetTimer;

function showTalk() {
  const r = state.round;
  const starter = r.players[Math.floor(Math.random() * r.players.length)];
  $("#starter").textContent = starter.name + " beginnt";
  $("#talkCat").textContent = state.showCat ? "Kategorie: " + r.cat : "Reihum ein passendes Wort sagen.";
  resetTimer();
  show("talk");
}

/* ───────── Auflösung ───────── */

$("#reveal").onclick = () => {
  const r = state.round;
  resetTimer();
  $("#resWord").textContent = r.word;
  $("#resImpWord").textContent = state.hint ? `Imposter-Wort: ${r.impWord}` : "";
  $("#resList").innerHTML = r.players.map((p) =>
    `<div><span class="${p.imp ? "imp" : ""}">${escapeHtml(p.name)}</span><span class="${p.imp ? "imp" : ""}">${p.imp ? "Imposter" : "Zivilist"}</span></div>`
  ).join("");
  $("#winCiv").disabled = $("#winImp").disabled = false;
  renderScore();
  show("result");
};

function renderScore() {
  $("#scoreCiv").textContent = state.score.civ;
  $("#scoreImp").textContent = state.score.imp;
}
$("#winCiv").onclick = () => { state.score.civ++; lockWin(); };
$("#winImp").onclick = () => { state.score.imp++; lockWin(); };
function lockWin() { $("#winCiv").disabled = $("#winImp").disabled = true; renderScore(); }

$("#again").onclick = startRound;
$("#toSetup").onclick = () => { renderPlayers(); renderImp(); show("setup"); };

$("#start").onclick = () => {
  if (state.players.length < 3) return toast("Mindestens 3 Spieler");
  startRound();
};


/* ───────── Start ───────── */
$("#modeLocal").onclick = () => show("setup");
$("#setupBack").onclick = () => show("modeSel");

clampImp();
renderPlayers(); renderImp(); renderCats();
show("modeSel");
