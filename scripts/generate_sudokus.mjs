#!/usr/bin/env node
// Generates 100 sudoku puzzles with unique solutions across four difficulty tiers.
// Output: ./puzzles.json (project root)

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "puzzles.json");

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const findEmpty = (g) => {
  for (let i = 0; i < 81; i++) if (g[i] === 0) return i;
  return -1;
};

const isValid = (g, idx, n) => {
  const r = (idx / 9) | 0;
  const c = idx % 9;
  const br = ((r / 3) | 0) * 3;
  const bc = ((c / 3) | 0) * 3;
  for (let i = 0; i < 9; i++) {
    if (g[r * 9 + i] === n) return false;
    if (g[i * 9 + c] === n) return false;
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (g[(br + i) * 9 + (bc + j)] === n) return false;
  return true;
};

const fillGrid = (g) => {
  const idx = findEmpty(g);
  if (idx === -1) return true;
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const n of nums) {
    if (isValid(g, idx, n)) {
      g[idx] = n;
      if (fillGrid(g)) return true;
      g[idx] = 0;
    }
  }
  return false;
};

const countSolutions = (g, cap = 2) => {
  const idx = findEmpty(g);
  if (idx === -1) return 1;
  let count = 0;
  for (let n = 1; n <= 9; n++) {
    if (isValid(g, idx, n)) {
      g[idx] = n;
      count += countSolutions(g, cap - count);
      g[idx] = 0;
      if (count >= cap) return count;
    }
  }
  return count;
};

const generate = (targetClues) => {
  const solved = new Array(81).fill(0);
  fillGrid(solved);
  const puzzle = solved.slice();
  const order = shuffle([...Array(81).keys()]);
  let clues = 81;
  for (const pos of order) {
    if (clues <= targetClues) break;
    const saved = puzzle[pos];
    if (saved === 0) continue;
    puzzle[pos] = 0;
    const test = puzzle.slice();
    if (countSolutions(test, 2) !== 1) {
      puzzle[pos] = saved;
    } else {
      clues--;
    }
  }
  return { puzzle, solution: solved, clues };
};

const tiers = [
  { name: "easy", count: 30, clues: 42 },
  { name: "medium", count: 30, clues: 34 },
  { name: "hard", count: 25, clues: 30 },
  { name: "expert", count: 15, clues: 26 },
];

const out = [];
let id = 1;
const t0 = Date.now();
for (const t of tiers) {
  for (let i = 0; i < t.count; i++) {
    const start = Date.now();
    const { puzzle, solution, clues } = generate(t.clues);
    out.push({
      id: id++,
      difficulty: t.name,
      clues,
      puzzle: puzzle.join(""),
      solution: solution.join(""),
    });
    console.log(
      `#${String(id - 1).padStart(3, "0")} ${t.name.padEnd(6)} clues=${clues} (${Date.now() - start}ms)`,
    );
  }
}

writeFileSync(outPath, JSON.stringify(out));
console.log(`\nWrote ${out.length} puzzles to ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
