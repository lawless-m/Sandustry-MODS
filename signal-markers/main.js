/** @format */

// Signal Markers — a HUD panel listing every Signal Lamp with its name and
// state, and pinned ones marked on the minimap.
//
//   L                    show / hide the panel (rebindable in Options > Controls)
//   click a row          name that lamp (blank clears it)
//   Label mode + click   name the lamp you click in the world
//   pin a row            mark that lamp on the minimap, lit or not
//
// Names and pins are stored in the save, keyed by cell, so they survive a reload.
//
// ---------------------------------------------------------------------------
// Supported vs not
//
// The UI half is entirely first-party:
//     api.ui.inject(id, Component)     mounts a React component on the HUD
//     api.ui.prompt(...)               a modal resolving to the typed string
//     api.input.registerBinding(...)   a real, rebindable key
//     api.storage.ensure(ns)           lives in state.store, i.e. the save file
//
// The lamp half is not. Reading a receiver's state, and hooking a click on a
// structure, both need state.session.mods.signals, which api.signals does not
// expose (it offers only targets.register). Same private door wired-cells uses,
// same guards: a game update turns this into a log line, not a crash.
//
// Note what we do NOT do: api.signals.targets.register("signalLamp", ...) is a
// Map.set on receiverApply, so registering it would evict the base game's own
// lamp handler and the lamps would stop lighting up. Read the state; never
// re-register the type.
//
// The minimap is a PIXI canvas whose projection lives in module-private vars, so
// nothing can draw on it from outside. What it does do, every frame, is render
// two marker layers — FH.progression.getWaypoints(state) and
// FH.portals.getMarkers(state). Waypoints live at storyProgression.waypoints,
// which api.storage.ensure reaches by name, so a pinned lamp joins that layer.
// Every waypoint is drawn in the game's objective yellow with no label, so the
// marker cannot carry the lamp's name or colour — it is present or it is not.
// That single bit tracks PINNED, not lit: a lamp gone dark is exactly the one
// you need to walk to, so hiding it when it goes OFF would take the marker away
// at the moment it became useful. Read the state in the panel, find it on the map.
//
// Those waypoints are saved state, so ours are stripped on "store:save" (which
// fires before postMessage structured-clones the store) and rebuilt on the next
// tick. Your saves never carry them.
//
// Styling is inline rather than Tailwind classes: the game's CSS is compiled
// from its own markup, so only the utilities it happens to use exist. w-2 and
// right-4 are not among them.
// ---------------------------------------------------------------------------

const { state, api, engine, react } = sandkit;
const { createElement: h, useState, useEffect, useRef } = react;
const FH = engine && engine.api;

const LAMP = "signalLamp";
const NS = "signal-markers";
const WIRE_ON = "#ffd400"; // the signal wires' own yellow

// --- names ------------------------------------------------------------------

function bag() {
	const b = api.storage.ensure(NS);
	if (!b.names) b.names = {};
	if (!b.pins) b.pins = {};
	return b;
}

const names = () => bag().names;
const pins = () => bag().pins;

const cell = (x, y) => `${x},${y}`;

// --- lamp state -------------------------------------------------------------

function signals() {
	const session = state && state.session;
	const mods = session && session.mods;
	return (mods && mods.signals) || null;
}

// A lamp is a receiver; it is lit when any incoming link is on — which is
// exactly what the engine's own getCombinedAt does.
function isOn(sig, x, y) {
	const incoming =
		sig.incomingByReceiver && sig.incomingByReceiver.get(cell(x, y));
	if (!incoming) return false;
	for (let i = 0; i < incoming.length; i++) {
		if (incoming[i].on) return true;
	}
	return false;
}

function lamps() {
	const sig = signals();
	const structures = state && state.store && state.store.structures;
	if (!sig || !structures) return [];

	const saved = names();
	const pinned = pins();
	const rows = [];
	for (let i = 0; i < structures.length; i++) {
		const s = structures[i];
		if (s.type !== LAMP) continue;
		const key = cell(s.x, s.y);
		rows.push({
			x: s.x,
			y: s.y,
			name: saved[key] || "",
			pinned: !!pinned[key],
			on: isOn(sig, s.x, s.y),
		});
	}

	// Named first, alphabetically; the rest by position.
	rows.sort((a, b) => {
		if (!!a.name !== !!b.name) return a.name ? -1 : 1;
		if (a.name) return a.name.localeCompare(b.name);
		return a.y - b.y || a.x - b.x;
	});
	return rows;
}

// --- renaming ---------------------------------------------------------------

async function rename(x, y) {
	const saved = names();
	const key = cell(x, y);
	const answer = await api.ui.prompt(
		`Name for the lamp at ${x}, ${y} (blank to clear)`,
		saved[key] || "",
		"Reactor vent",
		"Signal Lamp",
	);
	if (answer === null || answer === undefined) return;

	const trimmed = String(answer).trim();
	if (trimmed) saved[key] = trimmed;
	else delete saved[key];
	api.ui.overlays.update("global");
}

// --- minimap markers -------------------------------------------------------
//
// The minimap draws every entry in storyProgression.waypoints as a pulsing
// yellow ring, and an arrow at the edge when it is off screen. A pinned lamp
// keeps its marker whatever its state — pin it and you can find it again.

const MARK = "signal-markers:";

function waypoints() {
	const prog = api.storage.ensure("storyProgression");
	if (!prog.waypoints) prog.waypoints = [];
	return prog.waypoints;
}

const LEGACY_MARK = "signal-lamps:"; // this mod's name before 1.1.0
const isOurs = (w) =>
	typeof w.id === "string" && (w.id.startsWith(MARK) || w.id.startsWith(LEGACY_MARK));

function stripMarkers() {
	const list = waypoints();
	for (let i = list.length - 1; i >= 0; i--) {
		if (isOurs(list[i])) list.splice(i, 1);
	}
}

function syncMarkers() {
	const list = waypoints();

	const wanted = new Map();
	for (const lamp of lamps()) {
		if (lamp.pinned) wanted.set(MARK + cell(lamp.x, lamp.y), lamp);
	}

	for (let i = list.length - 1; i >= 0; i--) {
		if (!isOurs(list[i])) continue;
		if (wanted.has(list[i].id)) wanted.delete(list[i].id); // already marked
		else {
			console.log(`[signal-markers] marker off ${list[i].id.slice(MARK.length)}`);
			list.splice(i, 1);
		}
	}
	if (wanted.size === 0) return;

	// Waypoints are positioned in world pixels; a structure sits on the snap
	// grid, so half a structure over puts the marker on its middle.
	const { cellSize, snapGridCellSize } = api.rendering.getGridMetrics();
	const middle = (snapGridCellSize * cellSize) / 2;

	for (const [id, lamp] of wanted) {
		console.log(`[signal-markers] marker on ${lamp.x},${lamp.y}`);
		list.push({
			id,
			position: {
				x: lamp.x * cellSize + middle,
				y: lamp.y * cellSize + middle,
			},
			radius: 0,
			label: lamp.name || `Signal Lamp (${lamp.x}, ${lamp.y})`,
			active: true,
			isHelper: false, // helper waypoints drive story triggers by proximity
			showOnMap: true,
		});
	}
}

function setPinned(x, y, on) {
	const pinned = pins();
	if (on) pinned[cell(x, y)] = true;
	else delete pinned[cell(x, y)];
	console.log(`[signal-markers] pin ${x},${y} = ${on}`);
	syncMarkers();
	api.ui.overlays.update("global");
}

// --- label mode -------------------------------------------------------------
//
// The signals module hooks "action:intercept" and, for any structure type in
// interactableHandlers, runs the handler and cancels the click. That buys us
// the hover outline and the click for free — but it swallows every click on a
// lamp, so the handler is only registered while label mode is on.

let labelling = false;

function setLabelling(on) {
	const sig = signals();
	if (!sig || !sig.interactableHandlers) return;

	labelling = on;
	if (on) {
		sig.interactableHandlers.set(LAMP, (_state, structure) => {
			rename(structure.x, structure.y);
		});
		api.ui.toast("Label mode: click a Signal Lamp to name it.", {
			duration: 4000,
		});
	} else {
		sig.interactableHandlers.delete(LAMP);
	}
	api.ui.overlays.update("global");
}

// --- the panel --------------------------------------------------------------

let visible = false;

// --- moving and sizing the panel --------------------------------------------
//
// Kept in localStorage, not the save: where you like your windows is a property
// of your screen, not of the world. x/y start null and resolve to the top right
// on the first render, once there is a container to measure.

const LAYOUT_KEY = "signal-markers:layout";
const box = { x: null, y: null, w: 300, h: 340 };

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

// Clamp against the overlay container, whose clientWidth is in the same units
// as our style values even if the HUD is scaled. A fixed element has no
// offsetParent, so measure the wrapper the runtime puts us in.
function place(el) {
	const parent = el && el.parentElement;
	const w = (parent && parent.clientWidth) || window.innerWidth;
	const h = (parent && parent.clientHeight) || window.innerHeight;

	box.w = Math.round(Math.max(220, Math.min(w - 16, box.w)));
	box.h = Math.round(Math.max(140, Math.min(h - 16, box.h)));
	if (box.x === null) box.x = Math.max(8, w - box.w - 16);
	if (box.y === null) box.y = 96;
	// Always leave a grabbable strip of the header on screen.
	box.x = Math.round(Math.max(60 - box.w, Math.min(w - 60, box.x)));
	box.y = Math.round(Math.max(0, Math.min(h - 32, box.y)));
}

function drag(ev, el, mode, redraw) {
	if (ev.button !== 0) return;
	ev.preventDefault();

	// If the HUD is scaled, a client pixel is not a style pixel. Measure.
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
		background: "rgba(0,0,0,0.8)",
		border: "1px solid rgba(255,255,255,0.2)",
		borderRadius: "4px",
		color: "#fff",
		fontSize: "13px",
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
	button: (active) => ({
		padding: "1px 6px",
		fontSize: "11px",
		color: "#fff",
		background: active ? "rgba(255,255,255,0.25)" : "transparent",
		border: "1px solid rgba(255,255,255,0.25)",
		borderRadius: "3px",
		cursor: "pointer",
	}),
	list: { flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 0" },
	row: (hover) => ({
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		gap: "12px",
		padding: "3px 8px",
		cursor: "pointer",
		background: hover ? "rgba(255,255,255,0.1)" : "transparent",
	}),
	dot: (on) => ({
		width: "8px",
		height: "8px",
		flexShrink: 0,
		borderRadius: "50%",
		background: on ? WIRE_ON : "rgba(255,255,255,0.2)",
	}),
	label: (named) => ({
		overflow: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
		color: named ? "#fff" : "rgba(255,255,255,0.5)",
	}),
	statusText: (on) => ({ flexShrink: 0, color: on ? WIRE_ON : "rgba(255,255,255,0.4)" }),
	pin: (pinned) => ({
		flexShrink: 0,
		padding: "0 4px",
		fontSize: "12px",
		lineHeight: "16px",
		color: "#fff",
		background: pinned ? "rgba(255,212,0,0.25)" : "transparent",
		border: `1px solid ${pinned ? WIRE_ON : "rgba(255,255,255,0.25)"}`,
		borderRadius: "3px",
		cursor: "pointer",
		opacity: pinned ? 1 : 0.65,
	}),
	empty: { padding: "8px", color: "rgba(255,255,255,0.5)" },
};

function Row({ lamp }) {
	const [hover, setHover] = useState(false);
	return h(
		"div",
		{
			style: S.row(hover),
			onMouseEnter: () => setHover(true),
			onMouseLeave: () => setHover(false),
			onClick: () => rename(lamp.x, lamp.y),
			title: `${lamp.x}, ${lamp.y} — click to rename`,
		},
		h(
			"div",
			{ style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 } },
			h("span", { style: S.dot(lamp.on) }),
			h("span", { style: S.label(!!lamp.name) }, lamp.name || `(${lamp.x}, ${lamp.y})`),
		),
		h(
			"div",
			{ style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } },
			h(
				"button",
				{
					style: S.pin(lamp.pinned),
					onClick: (e) => {
						e.stopPropagation(); // the row itself renames
						setPinned(lamp.x, lamp.y, !lamp.pinned);
					},
					title: lamp.pinned
						? "Pinned — marked on the minimap, lit or not"
						: "Pin: mark on the minimap, lit or not",
				},
				"\ud83d\udccd",
			),
			h("span", { style: S.statusText(lamp.on) }, lamp.on ? "ON" : "OFF"),
		),
	);
}

function Panel() {
	const [, setTick] = useState(0);
	const ref = useRef(null);
	const redraw = () => setTick((t) => t + 1);

	useEffect(() => {
		const id = setInterval(redraw, 250);
		return () => clearInterval(id);
	}, []);

	if (!visible) return null;
	const rows = lamps();
	place(ref.current);

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
			h("span", null, `Signal Lamps (${rows.length})`),
			h(
				"button",
				{
					style: S.button(labelling),
					onMouseDown: (e) => e.stopPropagation(), // not a drag on the header
					onClick: () => setLabelling(!labelling),
					title: "Click lamps in the world to name them",
				},
				"Label",
			),
		),
		rows.length === 0
			? h("div", { style: S.empty }, "No Signal Lamps built.")
			: h(
					"div",
					{ style: S.list },
					rows.map((lamp) => h(Row, { key: cell(lamp.x, lamp.y), lamp })),
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
		console.log("[signal-markers] panel injected");
		return true;
	} catch (err) {
		return false;
	}
}

// Mods run during init, so the HUD usually does not exist yet.
if (!mount()) {
	api.events.on("game:ready", () => {
		mount();
	});
	console.log("[signal-markers] UI not ready at load — hooked game:ready");
}

try {
	api.input.registerBinding("SignalMarkersPanel", ["KeyL"], {
		displayNameKey: "Toggle Signal Markers panel",
		category: "Signal Markers",
		handlers: {
			down: () => {
				visible = !visible;
				if (!visible && labelling) setLabelling(false);
				api.ui.overlays.update("global");
			},
		},
	});
} catch (err) {
	console.log("[signal-markers] could not register the key binding — API moved?");
}

let markerErrorLogged = false;

try {
	api.triggers.register("signal-markers:markers", {
		interval: 250,
		callback: () => {
			// Runs on the game loop, which also ticks over on scenes that have no
			// store to speak of. One log line, not a stream of them.
			try {
				syncMarkers();
			} catch (err) {
				if (!markerErrorLogged) {
					markerErrorLogged = true;
					console.log("[signal-markers] marker sync failed:", err && err.message);
				}
			}
		},
	});
} catch (err) {
	console.log("[signal-markers] could not register the marker trigger — API moved?");
}

// Our markers never reach the disk: this fires before the store is cloned for
// the save, and the next tick puts them back.
api.events.on("store:save", () => {
	stripMarkers();
});

// A lamp dragged to a new cell keeps its name and its pin.
api.events.on("structures:moved", (payload) => {
	const moved = payload && payload.moved;
	if (!moved) return;

	const saved = names();
	const pinned = pins();
	const carried = [];
	for (const m of moved) {
		if (m.type !== LAMP || !m.from || !m.to) continue;
		const from = cell(m.from.x, m.from.y);
		const to = cell(m.to.x, m.to.y);
		if (saved[from]) {
			carried.push([to, saved[from], !!pinned[from]]);
			delete saved[from];
			delete pinned[from];
		} else if (pinned[from]) {
			carried.push([to, "", true]);
			delete pinned[from];
		}
	}
	for (const [to, name, pin] of carried) {
		if (name) saved[to] = name;
		if (pin) pinned[to] = true;
	}
	syncMarkers();
});

// A lamp demolished for good drops off the list at once and loses its name on
// the next load — so rebuilding one in the same spot in the same session gets
// its old name back, which is usually what you wanted.
api.events.on("game:ready", () => {
	stripMarkers(); // anything a crash left behind
	if (!FH || !FH.structures) return;

	const saved = names();
	const pinned = pins();
	for (const key of new Set([...Object.keys(saved), ...Object.keys(pinned)])) {
		const comma = key.indexOf(",");
		if (comma < 0) continue;
		const x = Number(key.slice(0, comma));
		const y = Number(key.slice(comma + 1));
		const structure = FH.structures.getAtCell(state, x, y);
		if (!structure || structure.type !== LAMP) {
			delete saved[key];
			delete pinned[key];
		}
	}
});

// Debug Console handle: __signalLamps.lamps() lists what the panel sees,
// .waypoints() what the minimap is being handed.
try {
	window.__signalLamps = {
		lamps,
		pins,
		names,
		waypoints,
		sync: syncMarkers,
		box,
		show: () => {
			visible = true;
			api.ui.overlays.update("global");
		},
	};
} catch (err) {
	/* no window? then no panel either, and the logs above will say so */
}
