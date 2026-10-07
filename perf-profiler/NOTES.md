# Shared performance array layout

Derived by reading `_game/dist/js/manager-worker.js` and `_game/dist/js/simulation-worker.js`
(Sandustry 0.5.2, mods branch). Every entry below traces to an actual write in that code.

All three arrays are `Float32Array` views onto `SharedArrayBuffer`s allocated on the main
thread in `initManager`, so a main-thread mod reads them live at
`sandkit.state.shared.<name>`. Reading them costs nothing and never blocks.

`C` below means the simulation worker count (`environment.threadsLength`).

---

## `managerPerformance` — Float32Array(23), SharedArrayBuffer(92)

Written once per tick at the end of the manager's tick function. Indices 0–9 are the
manager's own measurements; 10–22 are a copy of the **slowest worker's** detail block.

| Idx | Meaning | Source |
|---|---|---|
| 0 | Total manager tick duration, ms | `performance.now() - l`, `l` taken at tick entry |
| 1 | Interval since the previous tick started, ms | `l - Fe` where `Fe` is the last tick's start |
| 2 | Manager's own serial work, ms | `max(0, total - mutationWait - parallelPhase)` |
| 3 | Time blocked on `mutationSync`, ms | `Atomics.wait` span; `0` when no mutation was pending |
| 4 | Slowest worker's completion time, ms | `max` over `workerCompletion[C+i]` |
| 5 | Parallel dispatch/join overhead, ms | `max(0, parallelPhase - slowestWorker)` |
| 6 | Index of the slowest worker | `b`, the argmax from index 4 |
| 7 | Slowest worker's `workerPerformance[0]` | see that table below |
| 8 | Slowest worker's `workerPerformance[1]` | " |
| 9 | Slowest worker's `workerPerformance[2]` | " |
| 10 | Phase 1 chunk work, ms | `workerDetailPerformance[13*b + 0]` |
| 11 | **Always 0 in this build** | slot declared but never accumulated — effectively reserved |
| 12 | Phase 2 chunk work, ms | `…+ 2` |
| 13 | Phase 2 barrier wait, ms | `…+ 3` |
| 14 | Phase 3 chunk work, ms | `…+ 4` |
| 15 | Phase 3 barrier wait, ms | `…+ 5` |
| 16 | Phase 4 chunk work, ms | `…+ 6` |
| 17 | Phase 4 barrier wait, ms | `…+ 7` |
| 18 | Slowest single chunk, ms | `…+ 8` |
| 19 | Column index of that slowest chunk (`-1` if none) | `…+ 9` |
| 20 | Row index of that slowest chunk (`-1` if none) | `…+ 10` |
| 21 | Phase number of that slowest chunk, 1–4 (`0` if none) | `…+ 11` |
| 22 | Count of chunks this worker processed | `…+ 12` |

"Phase" is the engine's four-pass sweep over each chunk. "Barrier wait" is time a worker
spent spinning on `Atomics.load` for a neighbouring chunk to finish — pure lost time, and
the most useful number here for spotting scheduling stalls.

### Indices 10–22 are gated

The workers only write their detail block when `shared.workerDetailEnabled[0] === 1`
(`Uint8Array(1)`). Nothing sets it by default: the game's own debug performance panel
sets it in a React `useEffect` when that panel mounts. **A profiler mod must set
`sandkit.state.shared.workerDetailEnabled[0] = 1` itself**, or indices 10–22 read as a
permanent row of zeros. Clearing it back to `0` when the panel hides is the polite move,
since collecting the detail costs the workers a `performance.now()` per chunk.

---

## `workerPerformance` — Float32Array(4 × C)

Worker `i` owns floats `4*i + 0..3`. **The meaning depends on the scheduling mode**, as
two different code paths write this array:

Modern `RunTick` path (the normal one):

| Offset | Meaning |
|---|---|
| +0 | Chunk processing, ms — total handler time minus barrier waits minus the tail phase |
| +1 | Total barrier/wait time across all phases, ms |
| +2 | Tail phase, ms — the post-tick fixup pass that runs after the chunk sweep |
| +3 | Always 0 — explicitly zeroed, unused |

Legacy `RunUpdate` (Even/Odd) path:

| Offset | Meaning |
|---|---|
| +0 | Even-column pass, ms |
| +1 | Odd-column pass, ms |
| +2 | PostUpdate pass, ms (accumulates when PostUpdate runs more than once) |
| +3 | Always 0 |

A HUD cannot tell the two apart from these floats alone, so label them neutrally
(e.g. "work / wait / tail") rather than asserting one mode's names.

---

## `workerCompletion` — Float32Array(2 × C)

A double buffer, **not** one float per worker:

- `[C + i]` — the live half. Written by the manager's own dispatch resolver as
  `performance.now() - timelineStartTime` when worker `i` reports done: that worker's
  dispatch-to-done latency for the current tick.
- `[i]` — the stable half. At the end of each tick the manager copies `[C+i] → [i]`.

**Read the first half** (`[0 .. C-1]`). It is a whole-tick-consistent snapshot; the second
half is mid-flight while a tick is running and will show a torn mix of old and new values.
Worker count is `workerCompletion.length / 2`.

---

## Nothing is unknown here

Every index above was traced to a specific write. The only entry that is not a live
measurement is `managerPerformance[11]`, and that is a determination rather than a guess:
the corresponding accumulator is declared, initialised to `0`, and never added to anywhere
in the worker's tick handler.
