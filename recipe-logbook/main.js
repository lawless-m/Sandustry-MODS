/** @format */

// Recipe Logbook — a recipe book that starts empty and writes itself.
//
// A recipe appears only once you have SEEN EVERY ONE OF ITS OUTPUTS. Nothing
// is listed up front, so "what am I meant to do with all this Redsand?" stays
// a question you answer by playing rather than by reading.
//
// Two sources are merged:
//
//   1. The live registry at state.sandkit.mods.recipes — smelters, condensers,
//      steamDryers, synthesizers, snowmakers, and any contacts/shakers/presses/
//      growers a mod has added. Read fresh every tick, so other mods' recipes
//      show up with no work here.
//
//   2. A static table of the behaviours the base game HARDCODES in the
//      simulation and never registers: the four contact reactions, the shaker,
//      the kinetic press, the planter box, burning, and terrain digging. These
//      cannot be discovered by reading the registry — it is empty for them.
//      Verified by reading simulation-worker.js; see Sandustry-Recipes.pdf.
//
// ---------------------------------------------------------------------------
// One unsupported reach-through, wrapped so a game update becomes an empty
// panel rather than a crash:
//
//   state.sandkit.mods.recipes    -> the live registry
//
// api.structures.recipes exposes only register(), so there is no supported way
// to READ what is registered. Everything else here is public API:
//
//   api.elements.getNameByType         the game's own display name — which is
//                                      why this says "Cinder" and "Amethelis"
//                                      where the internal ids say basalt and
//                                      petalium
//   api.elements.getDefinitionByType   for metaColor, the swatch colour
//   api.elements.getResolvedTypeAtCell reading the world for discovery
//   api.elements.getTypeFromId         resolving the static table below
// ---------------------------------------------------------------------------

const { state, api, react } = sandkit;
const { createElement: h, useState, useEffect, useRef } = react;

const NS = "recipe-logbook";
const ACCENT = "#eecb66";

let visible = false;

// --- element and structure lookup -------------------------------------------

const nameCache = new Map();

// The display name the game itself shows, plus its minimap colour. Falls back
// to the numeric type so an unknown element is still visibly *something*.
function element(type) {
	if (type === null || type === undefined) return null;
	if (nameCache.has(type)) return nameCache.get(type);

	const info = { type, name: `#${type}`, color: "#8a8a8a" };
	try {
		const name = api.elements.getNameByType(type);
		if (typeof name === "string" && name.length) info.name = name;
	} catch (err) {
		/* unnamed in this build */
	}
	try {
		const def = api.elements.getDefinitionByType(type);
		if (def && typeof def.metaColor === "number") {
			info.color = "#" + (def.metaColor & 0xffffff).toString(16).padStart(6, "0");
		}
	} catch (err) {
		/* the grey fallback stands */
	}

	nameCache.set(type, info);
	return info;
}

function typeFromId(id) {
	try {
		const type = api.elements.getTypeFromId(id);
		return Number.isInteger(type) ? type : null;
	} catch (err) {
		return null; // not registered in this build
	}
}

function structureName(typeId, fallback) {
	try {
		const def = api.structures.getDefinitionByType(typeId);
		if (def && def.nameKey) {
			const name = api.i18n.t(def.nameKey);
			if (typeof name === "string" && name.length && name !== def.nameKey) return name;
		}
	} catch (err) {
		/* fall through to the label */
	}
	return fallback;
}

// --- the hardcoded base behaviours ------------------------------------------
//
// Element ids, not types: types are assigned at registration and differ between
// builds. Resolved through typeFromId every rebuild, so anything missing from
// this build simply drops out of the list.

const BASE = [
	{
		section: "Contact Reactions",
		note: "Two elements touching. No machine required.",
		rows: [
			{ in: ["water", "sand"], out: [["wetSand", 1]] },
			{ in: ["water", "seed"], out: [["wetSeed", 1]] },
			{ in: ["water", "lava"], out: [["steam", 1]], note: "lava persists" },
			{ in: ["water", "flame"], out: [["steam", 1]] },
			{ in: ["voidPetal", "sandium"], out: [["gloom", 1]] },
		],
	},
	{
		section: "Shaker",
		note: "Wet sand rides on top. Residue stays; gold falls out the underside.",
		rows: [
			{
				in: ["wetSand"],
				out: [["residue", 1], ["gold", 0.25]],
				note: "gold drops 2 cells below",
			},
		],
	},
	{
		section: "Kinetic Press",
		note: "Input must be falling fast enough on impact.",
		rows: [
			{
				in: ["burntResidue"],
				out: [["seed", 1], ["gold", 1]],
				note: "needs downward velocity",
			},
		],
	},
	{
		section: "Planter Box",
		note: "Wet seed germinates; where the seedling blooms, the terrain turns.",
		rows: [{ in: ["wetSeed"], out: [["seedling", 1]] }],
	},
	{
		section: "Burning",
		note: "Flame, fire, a flamethrower, or a Burner Belt fuelled by a Thermal Buffer.",
		rows: [
			{ in: ["residue"], out: [["burntResidue", 0.25]] },
			{ in: ["dryPetalium"], out: [["florin", 0.5]], note: "florin rises as gas" },
		],
	},
];

// --- the live registry ------------------------------------------------------

// Machine recipe lists, in the order they read best. The label is only a
// fallback: the real name comes from the structure config when it resolves.
const MACHINES = [
	{ key: "smelters", type: "smelter", label: "Smelter", note: "Heat from a Thermal Buffer, or lava in the row directly below." },
	{ key: "condensers", type: "thermofroster", label: "Condenser", note: "Cold from a Thermal Buffer, or snow above." },
	{ key: "steamDryers", type: "thermodryer", label: "Steam Dryer", note: "Steam in the cells below is the fuel." },
	{ key: "snowmakers", type: "snowmaker", label: "Snowmaker", note: "1 energy per tick." },
	{ key: "synthesizers", type: "aurixiteCrystallizer", label: "Synthesizer", note: "Fills a 4x4: 16 units in, plus 800 energy." },
];

function registry() {
	try {
		const mods = state && state.sandkit && state.sandkit.mods;
		return (mods && mods.recipes) || {};
	} catch (err) {
		return {};
	}
}

// Everything, merged into one shape: { section, note, rows: [{in, out, note}] }
// where `in` and `out` hold resolved element info objects.
function build() {
	const out = [];

	for (const group of BASE) {
		const rows = [];
		for (const r of group.rows) {
			const ins = r.in.map(typeFromId).map(element);
			const outs = r.out
				.map(([id, chance]) => {
					const info = element(typeFromId(id));
					return info && { ...info, chance };
				})
				.filter(Boolean);
			if (ins.every(Boolean) && outs.length) {
				rows.push({ in: ins, out: outs, note: r.note });
			}
		}
		if (rows.length) out.push({ section: group.section, note: group.note, rows });
	}

	const reg = registry();

	// Contacts are empty in the base game but a mod may have added some.
	const contacts = Array.isArray(reg.contacts) ? reg.contacts : [];
	if (contacts.length) {
		const rows = [];
		for (const c of contacts) {
			const a = element(c.inputA);
			const b = element(c.inputB);
			const outs = [element(c.outputA), element(c.outputB)]
				.filter(Boolean)
				.map((o) => ({ ...o, chance: 1 }));
			if (a && b && outs.length) rows.push({ in: [a, b], out: outs, note: "from a mod" });
		}
		if (rows.length) out.push({ section: "Contact Reactions (modded)", note: "", rows });
	}

	for (const m of MACHINES) {
		const list = Array.isArray(reg[m.key]) ? reg[m.key] : [];
		const rows = [];
		for (const r of list) {
			const input = element(r.input);
			const outs = (r.outputs || [])
				.map((o) => {
					const info = element(o.elementType);
					return info && { ...info, chance: o.chance };
				})
				.filter(Boolean);
			if (input && outs.length) rows.push({ in: [input], out: outs });
		}
		if (rows.length) {
			out.push({
				section: structureName(m.type, m.label),
				note: m.note,
				needs: m.type,
				rows,
			});
		}
	}

	// Mod-registered shakers, presses and growers, if any.
	const extra = [
		["shakers", "Shaker (modded)", (r) => [].concat(r.outputsAbove || [], r.outputsBelow || [])],
		["kineticPresses", "Kinetic Press (modded)", (r) => r.outputs || []],
		["growers", "Planter Box (modded)", (r) => r.outputs || []],
	];
	for (const [key, label, pick] of extra) {
		const list = Array.isArray(reg[key]) ? reg[key] : [];
		const rows = [];
		for (const r of list) {
			const input = element(r.input);
			const outs = pick(r)
				.map((o) => {
					const info = element(o.elementType);
					return info && { ...info, chance: o.chance };
				})
				.filter(Boolean);
			if (input && outs.length) rows.push({ in: [input], out: outs });
		}
		if (rows.length) out.push({ section: label, note: "", rows });
	}

	return out;
}

// --- discovery --------------------------------------------------------------
//
// Kept in save storage (state.store.mods), so it travels with the save and a
// new game starts blank again. An array rather than a Set: it has to survive
// being structured-cloned into the save worker.

function bag() {
	try {
		const b = api.storage.ensure(NS);
		if (!Array.isArray(b.seen)) b.seen = [];
		return b;
	} catch (err) {
		return { seen: [] };
	}
}

let seen = new Set();
let seenLoadedFor = null;

function loadSeen() {
	const b = bag();
	// Reloading a save swaps the whole store out from under us.
	if (seenLoadedFor !== b) {
		seen = new Set(b.seen);
		seenLoadedFor = b;
	}
	return b;
}

function markSeen(type) {
	if (type === null || type === undefined || seen.has(type)) return false;
	seen.add(type);
	const b = bag();
	if (Array.isArray(b.seen)) b.seen.push(type);
	return true;
}

function typeAt(x, y) {
	try {
		return api.elements.getResolvedTypeAtCell(x, y);
	} catch (err) {
		return null;
	}
}

// Sweep the visible world on a rotating phase, so a full pass costs little but
// completes within a few seconds. You discover a material by looking at it.
let phase = 0;

function sampleViewport() {
	let cellSize = 4;
	try {
		const m = api.rendering.getGridMetrics();
		if (m && m.cellSize) cellSize = m.cellSize;
	} catch (err) {
		/* the default is right for every build so far */
	}

	const cam = state && state.session && state.session.camera;
	if (!cam) return;

	let vw = window.innerWidth;
	let vh = window.innerHeight;
	try {
		const v = api.rendering.getOverlayViewportSize();
		if (v && v.width && v.height) {
			vw = v.width;
			vh = v.height;
		}
	} catch (err) {
		/* window dimensions are close enough */
	}

	let zoom = 1;
	try {
		zoom = (state.session.view && state.session.view.zoom) || 1;
	} catch (err) {
		/* unzoomed */
	}

	const x0 = Math.floor(cam.x / cellSize);
	const y0 = Math.floor(cam.y / cellSize);
	const w = Math.ceil(vw / cellSize / zoom);
	const hgt = Math.ceil(vh / cellSize / zoom);

	const STRIDE = 4;
	const off = phase % STRIDE;
	const offy = Math.floor(phase / STRIDE) % STRIDE;
	phase++;

	let budget = 4000;
	for (let y = y0 + offy; y < y0 + hgt && budget > 0; y += STRIDE) {
		for (let x = x0 + off; x < x0 + w && budget > 0; x += STRIDE) {
			budget--;
			markSeen(typeAt(x, y));
		}
	}
}

// A machine's own cells are always worth reading: the output of a smelt lands
// exactly where the input was, and a sparse viewport sweep can miss it.
function sampleMachines() {
	let list = null;
	try {
		list = state.store && state.store.structures;
	} catch (err) {
		return;
	}
	if (!Array.isArray(list)) return;

	const wanted = new Set(MACHINES.map((m) => m.type));
	for (let i = 0; i < list.length; i++) {
		const s = list[i];
		if (!s || !wanted.has(s.type)) continue;
		for (let dy = -1; dy <= 4; dy++) {
			for (let dx = 0; dx < 4; dx++) {
				markSeen(typeAt(s.x + dx, s.y + dy));
			}
		}
	}
}

// Seeing every output is the core test. On its own it is a good proxy for
// "you have made this", but not a perfect one: gold, sand and water occur
// naturally, and florinol can be dug out of florinolSoil. So a machine's
// recipes additionally require that you have BUILT that machine — without
// which a Condenser recipe could reveal itself to someone who has only ever
// found florinol in the ground.
function hasBuilt(type) {
	if (!type) return true;
	try {
		const list = state.store && state.store.structures;
		if (!Array.isArray(list)) return false;
		for (let i = 0; i < list.length; i++) {
			if (list[i] && list[i].type === type) return true;
		}
	} catch (err) {
		/* no store yet */
	}
	return false;
}

const isKnown = (row, group) =>
	row.out.every((o) => seen.has(o.type)) && hasBuilt(group && group.needs);

// --- panel layout -----------------------------------------------------------

const LAYOUT_KEY = "recipe-logbook:layout";
const box = { x: null, y: null, w: 340, h: 420 };

try {
	const saved = api.storage.local.get(LAYOUT_KEY);
	if (saved && typeof saved === "object") Object.assign(box, saved);
} catch (err) {
	/* first run, or a mangled entry — the defaults stand */
}

const saveBox = () => {
	try {
		api.storage.local.set(LAYOUT_KEY, box);
	} catch (err) {
		/* not worth a crash over a window position */
	}
};

function place(el) {
	const parent = el && el.parentElement;
	const w = (parent && parent.clientWidth) || window.innerWidth;
	const hh = (parent && parent.clientHeight) || window.innerHeight;

	box.w = Math.round(Math.max(260, Math.min(w - 16, box.w)));
	box.h = Math.round(Math.max(160, Math.min(hh - 16, box.h)));
	if (box.x === null) box.x = Math.max(8, w - box.w - 16);
	if (box.y === null) box.y = 96;
	box.x = Math.round(Math.max(60 - box.w, Math.min(w - 60, box.x)));
	box.y = Math.round(Math.max(0, Math.min(hh - 32, box.y)));
}

function drag(ev, el, mode, redraw) {
	if (ev.button !== 0) return;
	ev.preventDefault();

	const rect = el ? el.getBoundingClientRect() : null;
	const scale = rect && box.w > 0 ? rect.width / box.w || 1 : 1;
	const startX = ev.clientX;
	const startY = ev.clientY;
	const start = { x: box.x, y: box.y, w: box.w, h: box.h };

	const move = (e) => {
		const dx = (e.clientX - startX) / scale;
		const dy = (e.clientY - startY) / scale;
		if (mode === "move") {
			box.x = start.x + dx;
			box.y = start.y + dy;
		} else {
			box.w = start.w + dx;
			box.h = start.h + dy;
		}
		place(el);
		redraw();
	};
	const up = () => {
		document.removeEventListener("mousemove", move);
		document.removeEventListener("mouseup", up);
		saveBox();
	};

	document.addEventListener("mousemove", move);
	document.addEventListener("mouseup", up);
}

const S = {
	panel: () => ({
		position: "fixed",
		left: `${box.x}px`,
		top: `${box.y}px`,
		width: `${box.w}px`,
		height: `${box.h}px`,
		display: "flex",
		flexDirection: "column",
		background: "rgba(0,0,0,0.82)",
		border: "1px solid rgba(255,255,255,0.2)",
		borderRadius: "4px",
		color: "#fff",
		fontSize: "12px",
		lineHeight: "1.5",
		userSelect: "none",
	}),
	header: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "8px",
		padding: "5px 8px",
		borderBottom: "1px solid rgba(255,255,255,0.2)",
		fontWeight: "bold",
		cursor: "move",
	},
	grip: {
		position: "absolute",
		right: 0,
		bottom: 0,
		width: "16px",
		height: "16px",
		cursor: "nwse-resize",
		background:
			"linear-gradient(135deg, transparent 55%, rgba(255,255,255,0.35) 55%, " +
			"rgba(255,255,255,0.35) 65%, transparent 65%, transparent 75%, " +
			"rgba(255,255,255,0.35) 75%, rgba(255,255,255,0.35) 85%, transparent 85%)",
	},
	list: { flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 0 10px 0" },
	section: {
		padding: "8px 8px 1px 8px",
		color: ACCENT,
		fontWeight: "bold",
	},
	sectionNote: {
		padding: "0 8px 3px 8px",
		color: "rgba(255,255,255,0.4)",
		fontSize: "10px",
		lineHeight: "1.35",
	},
	row: {
		display: "flex",
		alignItems: "center",
		flexWrap: "wrap",
		gap: "3px",
		padding: "2px 8px",
	},
	swatch: (color) => ({
		width: "8px",
		height: "8px",
		flexShrink: 0,
		background: color,
		border: "1px solid rgba(255,255,255,0.35)",
		marginRight: "3px",
	}),
	join: { color: "rgba(255,255,255,0.45)", margin: "0 2px" },
	arrow: { color: ACCENT, margin: "0 4px" },
	chance: { color: ACCENT, fontWeight: "bold", fontSize: "10px", marginLeft: "3px" },
	note: {
		color: "rgba(255,255,255,0.4)",
		fontStyle: "italic",
		fontSize: "10px",
		marginLeft: "6px",
	},
	empty: { padding: "10px 8px", color: "rgba(255,255,255,0.5)", lineHeight: "1.6" },
	footer: {
		padding: "4px 8px",
		borderTop: "1px solid rgba(255,255,255,0.15)",
		color: "rgba(255,255,255,0.45)",
		fontSize: "10px",
		flexShrink: 0,
	},
};

function Token({ info }) {
	return h(
		"span",
		{ style: { display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" } },
		h("span", { style: S.swatch(info.color) }),
		h("span", null, info.name),
		info.chance !== undefined && info.chance < 1
			? h("span", { style: S.chance }, `${Math.round(info.chance * 100)}%`)
			: null,
	);
}

function Row({ row }) {
	const parts = [];
	row.in.forEach((info, i) => {
		if (i) parts.push(h("span", { key: `p${i}`, style: S.join }, "+"));
		parts.push(h(Token, { key: `i${i}`, info }));
	});
	parts.push(h("span", { key: "arrow", style: S.arrow }, "→"));
	row.out.forEach((info, i) => {
		if (i) parts.push(h("span", { key: `q${i}`, style: S.join }, "+"));
		parts.push(h(Token, { key: `o${i}`, info }));
	});
	if (row.note) parts.push(h("span", { key: "note", style: S.note }, row.note));
	return h("div", { style: S.row }, parts);
}

function Panel() {
	const [, setTick] = useState(0);
	const ref = useRef(null);
	const redraw = () => setTick((n) => n + 1);

	useEffect(() => {
		const id = setInterval(redraw, 500);
		return () => clearInterval(id);
	}, []);

	if (!visible) return null;
	place(ref.current);

	loadSeen();
	const all = build();

	let known = 0;
	let total = 0;
	const sections = [];
	for (const group of all) {
		const rows = group.rows.filter((row) => isKnown(row, group));
		total += group.rows.length;
		known += rows.length;
		if (rows.length) sections.push({ ...group, rows });
	}

	const body = sections.length
		? h(
				"div",
				{ style: S.list },
				sections.map((group, gi) =>
					h(
						"div",
						{ key: `g${gi}` },
						h("div", { style: S.section }, group.section),
						group.note ? h("div", { style: S.sectionNote }, group.note) : null,
						group.rows.map((row, ri) => h(Row, { key: `r${ri}`, row })),
					),
				),
			)
		: h(
				"div",
				{ style: S.empty },
				"Nothing recorded yet.",
				h("div", { style: { marginTop: "6px" } }, "A recipe is written down once you have seen everything it makes. Go and make something."),
			);

	return h(
		"div",
		{ ref, style: S.panel() },
		h(
			"div",
			{
				style: S.header,
				onMouseDown: (e) => drag(e, ref.current, "move", redraw),
				title: "Drag to move",
			},
			h("span", null, "Recipe Logbook"),
			h("span", { style: { color: ACCENT, fontWeight: "normal" } }, `${known} / ${total}`),
		),
		body,
		h(
			"div",
			{ style: S.footer },
			total - known > 0
				? `${total - known} still undiscovered`
				: "Everything in this build is recorded.",
		),
		h("div", {
			style: S.grip,
			onMouseDown: (e) => drag(e, ref.current, "size", redraw),
			title: "Drag to resize",
		}),
	);
}

// --- wiring up --------------------------------------------------------------

function mount() {
	try {
		api.ui.inject("panel", Panel);
		console.log("[recipe-logbook] panel injected");
		return true;
	} catch (err) {
		return false;
	}
}

if (!mount()) {
	api.events.on("game:ready", () => {
		mount();
	});
	console.log("[recipe-logbook] UI not ready at load — hooked game:ready");
}

try {
	api.input.registerBinding("RecipeLogbookPanel", ["KeyK"], {
		displayNameKey: "Toggle Recipe Logbook",
		category: "Recipe Logbook",
		handlers: {
			down: () => {
				visible = !visible;
				api.ui.overlays.update("global");
			},
		},
	});
} catch (err) {
	console.log("[recipe-logbook] could not register the key binding — API moved?");
}

// Discovery runs whether or not the panel is open — you should not have to hold
// the book open to write in it.
let sampleErrorLogged = false;

try {
	api.triggers.register("recipe-logbook:discover", {
		interval: 500,
		callback: () => {
			try {
				if (!state || !state.store) return;
				loadSeen();
				sampleMachines();
				sampleViewport();
			} catch (err) {
				if (!sampleErrorLogged) {
					sampleErrorLogged = true;
					console.log("[recipe-logbook] discovery sampling failed:", err && err.message);
				}
			}
		},
	});
} catch (err) {
	console.log("[recipe-logbook] could not register the discovery tick — API moved?");
}
