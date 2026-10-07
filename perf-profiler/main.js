/** @format */

// Perf Profiler — a live read-out of where a simulation tick's time actually goes.
//
// The engine already measures itself. Every tick the manager worker writes its own
// timings into three SharedArrayBuffers, and the simulation workers write theirs.
// Nothing in the game surfaces them outside its internal debug panel. This mod reads
// those same arrays and puts them on screen.
//
// Reading is free: the arrays are shared memory that is written whether anyone looks
// or not, so the panel costs nothing but the redraw. See NOTES.md in this folder for
// the full index-by-index layout, traced from manager-worker.js and simulation-worker.js.
//
// Press J.

const { state, api, react } = sandkit;
const { createElement: h, useState, useEffect } = react;

const NS = "perf-profiler";
const ACCENT = "#66d9ee";

let visible = false;

// --- sampling ----------------------------------------------------------------
//
// Everything here is defensive. The arrays only exist once a world is loaded, so at
// the menu, during loading, and after a game update that moves them, `shared()`
// returns null and the panel says so rather than throwing inside a React render.
//
// Layout is documented in NOTES.md. Two points that are easy to get wrong:
//
//   - workerCompletion is 2*C floats, not C. The second half is written live as each
//     worker reports in, so it is torn mid-tick; the first half is the manager's
//     end-of-tick snapshot. Read the first half.
//
//   - managerPerformance[10..22] are only written when workerDetailEnabled[0] is 1.
//     Nothing sets that by default — the game's own debug panel sets it when it
//     mounts. So we set it while the panel is open and clear it when it closes,
//     since collecting the detail costs the workers a clock read per chunk.

const perf = {
	ok: false,
	why: "waiting for a world",
	manager: null,
	workers: [],
};

function shared() {
	try {
		const s = sandkit.state && sandkit.state.shared;
		if (!s || !s.managerPerformance || !s.workerCompletion) return null;
		return s;
	} catch (err) {
		return null;
	}
}

// Ask the workers to collect (or stop collecting) the per-phase detail block.
function setDetail(on) {
	try {
		const s = shared();
		if (s && s.workerDetailEnabled) s.workerDetailEnabled[0] = on ? 1 : 0;
	} catch (err) {
		/* older build, or the flag moved — indices 10-22 just stay zero */
	}
}

function sample() {
	const s = shared();
	if (!s) {
		perf.ok = false;
		perf.why = "waiting for a world";
		return;
	}

	try {
		const mp = s.managerPerformance;
		const wc = s.workerCompletion;
		const wp = s.workerPerformance;

		const manager = new Array(mp.length);
		for (let i = 0; i < mp.length; i++) manager[i] = mp[i];

		const count = Math.floor(wc.length / 2);
		const workers = new Array(count);
		for (let i = 0; i < count; i++) {
			const base = 4 * i;
			workers[i] = {
				completion: wc[i],
				work: wp ? wp[base] : 0,
				wait: wp ? wp[base + 1] : 0,
				tail: wp ? wp[base + 2] : 0,
			};
		}

		perf.manager = manager;
		perf.workers = workers;
		perf.ok = true;
		perf.why = "";
	} catch (err) {
		perf.ok = false;
		perf.why = "shared arrays moved — see console";
		if (!sampleErrorLogged) {
			sampleErrorLogged = true;
			console.log(`[${NS}] sampling failed:`, err && err.message);
		}
	}
}

let sampleErrorLogged = false;

// --- styles ------------------------------------------------------------------
//
// Inline objects throughout. The game's CSS is compiled from the game's own markup,
// so only the Tailwind utilities it happens to use exist — anything invented here
// would silently do nothing.

const S = {
	panel: {
		position: "fixed",
		top: "8px",
		right: "8px",
		minWidth: "260px",
		padding: "10px 12px",
		background: "rgba(12, 14, 18, 0.88)",
		border: "1px solid rgba(255, 255, 255, 0.14)",
		borderRadius: "4px",
		color: "#e6e6e6",
		font: "12px/1.45 ui-monospace, Menlo, Consolas, monospace",
		userSelect: "none",
		// 18 workers is a lot of rows; bound it rather than paint over the game.
		maxHeight: "calc(100vh - 24px)",
		overflowY: "auto",
	},
	title: {
		color: ACCENT,
		fontWeight: "bold",
		letterSpacing: "0.04em",
		marginBottom: "6px",
	},
	section: {
		color: ACCENT,
		opacity: 0.75,
		marginTop: "8px",
		marginBottom: "2px",
		borderBottom: "1px solid rgba(255, 255, 255, 0.12)",
	},
	row: { display: "flex", gap: "6px", alignItems: "baseline" },
	idx: { opacity: 0.35, minWidth: "18px", textAlign: "right" },
	label: { flex: "1 1 auto" },
	value: { textAlign: "right", whiteSpace: "pre" },
	dim: { opacity: 0.55 },
	foot: { opacity: 0.55, marginTop: "6px", whiteSpace: "normal" },
};

// --- rows --------------------------------------------------------------------
//
// Every label below traces to an entry in NOTES.md. Milliseconds get two decimals so
// the column does not jitter; indices and counts are integers, which do not jitter
// either and read as nonsense with a decimal point ("worker 3.00").

const ms = (v) => `${v.toFixed(2)} ms`;
const int = (v) => String(Math.round(v));

const MANAGER = [
	[0, "tick total", ms],
	[1, "tick interval", ms],
	[2, "manager serial", ms],
	[3, "mutation wait", ms],
	[4, "slowest worker", ms],
	[5, "dispatch overhead", ms],
	[6, "slowest worker #", int],
	[7, "  its work", ms],
	[8, "  its wait", ms],
	[9, "  its tail", ms],
];

const DETAIL = [
	[10, "phase 1 work", ms],
	[12, "phase 2 work", ms],
	[13, "phase 2 wait", ms],
	[14, "phase 3 work", ms],
	[15, "phase 3 wait", ms],
	[16, "phase 4 work", ms],
	[17, "phase 4 wait", ms],
	[18, "slowest chunk", ms],
	[19, "  its column", int],
	[20, "  its row", int],
	[21, "  its phase", int],
	[22, "chunks processed", int],
	[11, "idx 11 (unused)", ms],
];

function row(i, label, value) {
	return h(
		"div",
		{ key: i, style: S.row },
		h("span", { style: S.idx }, String(i)),
		h("span", { style: S.label }, label),
		h("span", { style: S.value }, value),
	);
}

// --- panel -------------------------------------------------------------------

function Panel() {
	const [, setTick] = useState(0);

	// Nothing pushes state at an injected component, so it pulls. While the panel is
	// hidden this does no work at all.
	useEffect(() => {
		const id = setInterval(() => {
			if (!visible) return;
			sample();
			setTick((n) => n + 1);
		}, 250);
		return () => clearInterval(id);
	}, []);

	if (!visible) return null;

	if (!perf.ok) {
		return h(
			"div",
			{ style: S.panel },
			h("div", { style: S.title }, "perf-profiler"),
			h("div", { style: S.dim }, perf.why),
		);
	}

	const m = perf.manager;

	// The detail block is all zeros until the workers have ticked at least once with
	// collection enabled — a beat after the panel opens. Say so rather than showing a
	// column of 0.00 that looks like a broken read.
	const detailLive = DETAIL.some(([i]) => m[i] !== 0);

	return h(
		"div",
		{ style: S.panel },
		h("div", { style: S.title }, "perf-profiler"),

		h("div", { style: S.section }, "manager"),
		MANAGER.map(([i, label, fmt]) => row(i, label, fmt(m[i]))),

		h("div", { style: S.section }, `slowest worker detail — #${int(m[6])}`),
		detailLive
			? DETAIL.map(([i, label, fmt]) => row(i, label, fmt(m[i])))
			: h("div", { style: S.dim }, "collecting…"),

		h("div", { style: S.section }, `workers (${perf.workers.length})`),
		perf.workers.map((w, i) =>
			h(
				"div",
				{ key: `w${i}`, style: S.row },
				h("span", { style: S.idx }, int(i)),
				h("span", { style: S.label }, i === Math.round(m[6]) ? "▸ done" : "done"),
				h("span", { style: S.value }, ms(w.completion)),
			),
		),
		h(
			"div",
			{ style: S.foot },
			"work / wait / tail per worker: ",
			perf.workers
				.map((w) => `${w.work.toFixed(1)}/${w.wait.toFixed(1)}/${w.tail.toFixed(1)}`)
				.join("  "),
		),
	);
}

// --- mounting ----------------------------------------------------------------
//
// inject() throws if the UI is not up yet, which it usually is not at load time.
// Hooking game:ready covers the ordinary case without making the load-time attempt
// an error.

function mount() {
	try {
		api.ui.inject("panel", Panel);
		console.log(`[${NS}] panel injected`);
		return true;
	} catch (err) {
		return false;
	}
}

if (!mount()) {
	api.events.on("game:ready", () => {
		mount();
	});
	console.log(`[${NS}] UI not ready at load — hooked game:ready`);
}

// J is free in the base game, and clear of K and L which this repo's other mods take.
try {
	api.input.registerBinding("PerfProfilerPanel", ["KeyJ"], {
		displayNameKey: "Toggle Perf Profiler",
		category: "Perf Profiler",
		handlers: {
			down: () => {
				visible = !visible;
				setDetail(visible);
				if (visible) sample();
				api.ui.overlays.update("global");
			},
		},
	});
} catch (err) {
	console.log(`[${NS}] could not register the key binding — API moved?`);
}
