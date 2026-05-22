"use strict";

const STORAGE_KEY = "sudoku.state.v1";
const TIER_LABEL = {
  easy: "Eenvoudig",
  medium: "Gemiddeld",
  hard: "Moeilijk",
  expert: "Expert",
};

const els = {
  back: document.getElementById("back"),
  reset: document.getElementById("reset"),
  title: document.getElementById("title"),
  picker: document.getElementById("picker"),
  game: document.getElementById("game"),
  list: document.getElementById("puzzle-list"),
  board: document.getElementById("board"),
  pad: document.querySelector(".pad"),
  erase: document.getElementById("erase"),
  notes: document.getElementById("notes"),
  undo: document.getElementById("undo"),
  metaDiff: document.getElementById("meta-diff"),
  metaTime: document.getElementById("meta-time"),
  status: document.getElementById("status"),
  tabs: document.querySelectorAll(".tier-tab"),
};

const store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { puzzles: {}, lastOpened: null };
      const parsed = JSON.parse(raw);
      return {
        puzzles: parsed.puzzles || {},
        lastOpened: parsed.lastOpened ?? null,
      };
    } catch {
      return { puzzles: {}, lastOpened: null };
    }
  },
  save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode: silently ignore */
    }
  },
};

let puzzles = [];
let persisted = store.load();

const state = {
  view: "picker",
  filter: "all",
  current: null,
};

/* -------------------- INIT -------------------- */

async function init() {
  try {
    const res = await fetch("puzzles.json", { cache: "force-cache" });
    puzzles = await res.json();
  } catch (e) {
    els.list.innerHTML = `<div style="color:var(--pink);padding:24px">Kon puzzels niet laden.</div>`;
    return;
  }

  bindUI();
  renderPicker();

  if (persisted.lastOpened != null) {
    const saved = persisted.puzzles[persisted.lastOpened];
    const p = puzzles.find((x) => x.id === persisted.lastOpened);
    if (saved && p && !saved.completed && hasProgress(p, saved)) {
      openPuzzle(persisted.lastOpened);
      return;
    }
  }
  showView("picker");
}

function bindUI() {
  els.back.addEventListener("click", () => showView("picker"));
  els.reset.addEventListener("click", () => {
    if (!state.current) return;
    if (confirm("Puzzel opnieuw beginnen? Je voortgang wordt gewist.")) {
      resetCurrent();
    }
  });

  els.tabs.forEach((t) => {
    t.addEventListener("click", () => {
      els.tabs.forEach((x) => x.classList.toggle("active", x === t));
      state.filter = t.dataset.tier;
      renderPicker();
    });
  });

  els.pad.addEventListener("click", (e) => {
    const btn = e.target.closest(".num");
    if (!btn) return;
    enterNumber(parseInt(btn.dataset.n, 10));
  });

  els.erase.addEventListener("click", () => eraseCell());
  els.notes.addEventListener("click", () => {
    state.current && (state.current.notesMode = !state.current.notesMode);
    els.notes.classList.toggle("on", !!state.current?.notesMode);
  });
  els.undo.addEventListener("click", () => undo());

  els.board.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    selectCell(parseInt(cell.dataset.i, 10));
  });

  document.addEventListener("keydown", (e) => {
    if (state.view !== "game" || state.current?.selected == null) return;
    if (/^[1-9]$/.test(e.key)) enterNumber(parseInt(e.key, 10));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") eraseCell();
    else if (e.key === "ArrowLeft") moveSel(-1, 0);
    else if (e.key === "ArrowRight") moveSel(1, 0);
    else if (e.key === "ArrowUp") moveSel(0, -1);
    else if (e.key === "ArrowDown") moveSel(0, 1);
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.current || state.current.completed) return;
    if (document.hidden) {
      pauseTimer();
    } else if (state.view === "game") {
      resumeTimer();
    }
  });
}

/* -------------------- VIEWS -------------------- */

function showView(v) {
  state.view = v;
  els.picker.hidden = v !== "picker";
  els.game.hidden = v !== "game";
  els.back.hidden = v !== "game";
  els.reset.hidden = v !== "game";
  els.title.textContent = v === "picker" ? "Sudoku" : `Puzzel ${state.current?.id ?? ""}`;
  if (v === "picker") {
    pauseTimer();
    renderPicker();
  } else {
    resumeTimer();
  }
}

/* -------------------- PICKER -------------------- */

function renderPicker() {
  const filtered =
    state.filter === "all"
      ? puzzles
      : puzzles.filter((p) => p.difficulty === state.filter);

  els.list.innerHTML = filtered
    .map((p) => {
      const saved = persisted.puzzles[p.id];
      const inProgress = saved && !saved.completed && hasProgress(p, saved);
      const done = saved?.completed;
      const cls = `pcard${done ? " done" : ""}${inProgress && !done ? " progress" : ""}`;
      return `<button class="${cls}" data-id="${p.id}" data-tier="${p.difficulty}">
        <span class="pnum">${p.id}</span>
        <span class="ptier">${TIER_LABEL[p.difficulty]}</span>
      </button>`;
    })
    .join("");

  els.list.querySelectorAll(".pcard").forEach((b) =>
    b.addEventListener("click", () => openPuzzle(parseInt(b.dataset.id, 10))),
  );
}

function hasProgress(puzzle, saved) {
  if (!saved.values) return false;
  for (let i = 0; i < 81; i++) {
    const orig = puzzle.puzzle.charCodeAt(i) - 48;
    if (orig === 0 && saved.values[i] !== 0) return true;
    if (saved.notes && saved.notes[i] && saved.notes[i].length) return true;
  }
  return false;
}

/* -------------------- PUZZLE STATE -------------------- */

function openPuzzle(id) {
  const p = puzzles.find((x) => x.id === id);
  if (!p) return;
  const given = strToArr(p.puzzle);
  const saved = persisted.puzzles[id];
  const values = saved?.values ? saved.values.slice() : given.slice();
  const notes = Array.from({ length: 81 }, (_, i) => {
    const arr = saved?.notes?.[i] || [];
    return new Set(arr);
  });
  state.current = {
    id,
    difficulty: p.difficulty,
    given,
    values,
    notes,
    history: [],
    selected: null,
    notesMode: false,
    completed: saved?.completed || false,
    time: saved?.time || 0,
    startedAt: null,
  };
  persisted.lastOpened = id;
  persist();
  buildBoard();
  els.metaDiff.textContent = TIER_LABEL[p.difficulty];
  els.metaDiff.dataset.tier = p.difficulty;
  els.notes.classList.remove("on");
  showView("game");
  renderBoard();
  updateTimer();
  updateStatus();
  updatePadCounts();
}

function resetCurrent() {
  const c = state.current;
  c.values = c.given.slice();
  c.notes = Array.from({ length: 81 }, () => new Set());
  c.history = [];
  c.selected = null;
  c.completed = false;
  c.time = 0;
  c.startedAt = Date.now();
  persist();
  renderBoard();
  updatePadCounts();
  updateStatus();
}

/* -------------------- BOARD RENDER -------------------- */

let cellEls = new Array(81);

function buildBoard() {
  els.board.innerHTML = "";
  cellEls = new Array(81);
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const block = document.createElement("div");
      block.className = "block";
      for (let ir = 0; ir < 3; ir++) {
        for (let ic = 0; ic < 3; ic++) {
          const r = br * 3 + ir;
          const col = bc * 3 + ic;
          const i = r * 9 + col;
          const cell = document.createElement("div");
          cell.className = "cell";
          cell.dataset.i = String(i);
          cell.innerHTML = `<div class="notes" aria-hidden="true"></div><span class="val"></span>`;
          cellEls[i] = cell;
          block.appendChild(cell);
        }
      }
      els.board.appendChild(block);
    }
  }
}

function renderBoard() {
  const c = state.current;
  const conflicts = computeConflicts(c.values);
  const selVal = c.selected != null ? c.values[c.selected] : 0;

  for (let i = 0; i < 81; i++) {
    const el = cellEls[i];
    const val = c.values[i];
    const isGiven = c.given[i] !== 0;
    const valEl = el.querySelector(".val");
    const notesEl = el.querySelector(".notes");

    el.classList.toggle("given", isGiven);
    el.classList.toggle("conflict", conflicts.has(i));
    el.classList.toggle("selected", c.selected === i);
    el.classList.toggle(
      "peer",
      c.selected != null && c.selected !== i && isPeer(c.selected, i) && c.values[i] !== selVal,
    );
    el.classList.toggle(
      "same",
      c.selected != null && c.selected !== i && val !== 0 && val === selVal,
    );

    if (val !== 0) {
      valEl.textContent = val;
      notesEl.innerHTML = "";
    } else {
      valEl.textContent = "";
      const notes = c.notes[i];
      if (notes && notes.size) {
        let n = "";
        for (let d = 1; d <= 9; d++) {
          n += `<span>${notes.has(d) ? d : ""}</span>`;
        }
        notesEl.innerHTML = n;
      } else {
        notesEl.innerHTML = "";
      }
    }
  }
}

/* -------------------- INTERACTION -------------------- */

function selectCell(i) {
  state.current.selected = i;
  renderBoard();
}

function moveSel(dx, dy) {
  const c = state.current;
  if (c.selected == null) {
    c.selected = 40;
  } else {
    let r = (c.selected / 9) | 0;
    let col = c.selected % 9;
    r = Math.max(0, Math.min(8, r + dy));
    col = Math.max(0, Math.min(8, col + dx));
    c.selected = r * 9 + col;
  }
  renderBoard();
}

function enterNumber(n) {
  const c = state.current;
  if (c.completed || c.selected == null) return;
  const i = c.selected;
  if (c.given[i] !== 0) return;

  pushHistory();

  if (c.notesMode) {
    if (c.values[i] !== 0) c.values[i] = 0;
    if (c.notes[i].has(n)) c.notes[i].delete(n);
    else c.notes[i].add(n);
  } else {
    if (c.values[i] === n) {
      c.values[i] = 0;
    } else {
      c.values[i] = n;
      c.notes[i].clear();
      for (let j = 0; j < 81; j++) {
        if (j !== i && isPeer(i, j)) c.notes[j].delete(n);
      }
    }
  }
  persist();
  renderBoard();
  updatePadCounts();
  checkComplete();
}

function eraseCell() {
  const c = state.current;
  if (c.completed || c.selected == null) return;
  const i = c.selected;
  if (c.given[i] !== 0) return;
  if (c.values[i] === 0 && c.notes[i].size === 0) return;
  pushHistory();
  c.values[i] = 0;
  c.notes[i].clear();
  persist();
  renderBoard();
  updatePadCounts();
}

function pushHistory() {
  const c = state.current;
  c.history.push({
    values: c.values.slice(),
    notes: c.notes.map((s) => Array.from(s)),
  });
  if (c.history.length > 200) c.history.shift();
}

function undo() {
  const c = state.current;
  if (c.completed || !c.history.length) return;
  const snap = c.history.pop();
  c.values = snap.values;
  c.notes = snap.notes.map((arr) => new Set(arr));
  persist();
  renderBoard();
  updatePadCounts();
}

/* -------------------- COMPUTED -------------------- */

function isPeer(a, b) {
  if (a === b) return false;
  const ra = (a / 9) | 0,
    ca = a % 9,
    rb = (b / 9) | 0,
    cb = b % 9;
  if (ra === rb) return true;
  if (ca === cb) return true;
  if (((ra / 3) | 0) === ((rb / 3) | 0) && ((ca / 3) | 0) === ((cb / 3) | 0)) return true;
  return false;
}

function computeConflicts(values) {
  const conflicts = new Set();
  for (let g = 0; g < 9; g++) {
    const rowSeen = new Map();
    const colSeen = new Map();
    const boxSeen = new Map();
    for (let k = 0; k < 9; k++) {
      const ri = g * 9 + k;
      const ci = k * 9 + g;
      const bRow = ((g / 3) | 0) * 3 + ((k / 3) | 0);
      const bCol = (g % 3) * 3 + (k % 3);
      const bi = bRow * 9 + bCol;
      const rv = values[ri],
        cv = values[ci],
        bv = values[bi];
      if (rv !== 0) {
        if (rowSeen.has(rv)) {
          conflicts.add(ri);
          conflicts.add(rowSeen.get(rv));
        } else rowSeen.set(rv, ri);
      }
      if (cv !== 0) {
        if (colSeen.has(cv)) {
          conflicts.add(ci);
          conflicts.add(colSeen.get(cv));
        } else colSeen.set(cv, ci);
      }
      if (bv !== 0) {
        if (boxSeen.has(bv)) {
          conflicts.add(bi);
          conflicts.add(boxSeen.get(bv));
        } else boxSeen.set(bv, bi);
      }
    }
  }
  return conflicts;
}

function updatePadCounts() {
  const counts = new Array(10).fill(0);
  for (const v of state.current.values) counts[v]++;
  els.pad.querySelectorAll(".num").forEach((btn) => {
    const n = parseInt(btn.dataset.n, 10);
    btn.classList.toggle("complete", counts[n] >= 9);
  });
}

function checkComplete() {
  const c = state.current;
  if (c.completed) return;
  for (let i = 0; i < 81; i++) if (c.values[i] === 0) return;
  if (computeConflicts(c.values).size !== 0) return;
  c.completed = true;
  pauseTimer();
  persist();
  updateStatus();
}

function updateStatus() {
  const c = state.current;
  if (c.completed) {
    els.status.hidden = false;
    els.status.textContent = `Opgelost in ${fmtTime(c.time)} ✦`;
  } else {
    els.status.hidden = true;
  }
}

/* -------------------- TIMER -------------------- */

let tickHandle = null;

function resumeTimer() {
  const c = state.current;
  if (!c || c.completed) return;
  c.startedAt = Date.now();
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    updateTimer();
  }, 1000);
}

function pauseTimer() {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  const c = state.current;
  if (c && c.startedAt) {
    c.time += Math.floor((Date.now() - c.startedAt) / 1000);
    c.startedAt = null;
    persist();
  }
}

function updateTimer() {
  const c = state.current;
  if (!c) return;
  const live = c.startedAt ? Math.floor((Date.now() - c.startedAt) / 1000) : 0;
  els.metaTime.textContent = fmtTime(c.time + live);
}

function fmtTime(s) {
  const m = (s / 60) | 0;
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/* -------------------- PERSIST -------------------- */

function persist() {
  const c = state.current;
  if (c) {
    let liveTime = c.time;
    if (c.startedAt) liveTime += Math.floor((Date.now() - c.startedAt) / 1000);
    persisted.puzzles[c.id] = {
      values: c.values.slice(),
      notes: c.notes.map((s) => Array.from(s)),
      completed: c.completed,
      time: liveTime,
    };
  }
  store.save(persisted);
}

/* -------------------- HELPERS -------------------- */

function strToArr(s) {
  const out = new Array(81);
  for (let i = 0; i < 81; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}

window.addEventListener("pagehide", () => {
  if (state.current) {
    pauseTimer();
    persist();
  }
});
window.addEventListener("blur", () => {
  if (state.current) pauseTimer();
});

init();
