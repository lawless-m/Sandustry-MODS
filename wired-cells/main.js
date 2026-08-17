/** @format */

// Wired Cells — energy cells emit a signal reporting their own charge.
//
//   charge > 0  -> signal on
//   charge == 0 -> signal off
//
// Nothing else. Building a latch, hysteresis, or a generator cutoff out of that
// is the player's job, using the in-game logic gates.
//
// ---------------------------------------------------------------------------
// UNSUPPORTED — read before trusting this
//
// The mod API (external-mod-runtime.js) exposes signals as ONLY:
//     signals.targets.register(type, cb)      // receiving
// The string "sender" does not appear anywhere in that runtime, so there is no
// supported way to make something emit.
//
// But every mod is handed more than `api`:
//     sandkit = { apiVersion, state, api, engine, enums, react }
//     sandkit.engine = { api: FH, state }      // FH = the internal framework
//                                              // the game's own mods use
// So we can reach the signals runtime directly. From the engine's own code:
//
//     registerSenderType: (e, t, n) => {
//       const a = p(e);                        // p(e) = state.session.mods.signals
//       a.senderTypes.add(t);
//       n && a.senderOutputGetters.set(t, n);
//     }
//
// A sender is just: a type in a Set, plus an output getter. And the Signal
// Linker's own check for "can I start a wire here" is exactly
// senderTypes.has(structure.type) plus a build-permission test — nothing else.
//
// This is private. A game update can move it without warning; the guards below
// turn that into a log line rather than a crash.
// ---------------------------------------------------------------------------

const { state, api, engine } = sandkit;
const FH = engine && engine.api;

// Energy stores registered by the base game. powerBrick is the copper cell
// (capacity 1000); goldBattery is the small one (capacity 16).
const CELL_TYPES = ["powerBrick", "goldBattery"];

// Emit while the cell holds any charge at all. For a "full" signal instead:
//     (s.data?.storedEnergy ?? 0) >= (s.data?.maxEnergy ?? 0)
const hasCharge = (_state, structure) => {
	const data = structure && structure.data;
	return (data && data.storedEnergy ? data.storedEnergy : 0) > 0;
};

function registerSenders(s) {
	const signals =
		s && s.session && s.session.mods && s.session.mods.signals;

	if (!signals || !signals.senderTypes || !signals.senderOutputGetters) {
		return false;
	}

	for (const type of CELL_TYPES) {
		signals.senderTypes.add(type);
		signals.senderOutputGetters.set(type, hasCharge);
	}
	console.log(`[wired-cells] senders registered: ${CELL_TYPES.join(", ")}`);
	return true;
}

// Mods run during init, so the signals runtime usually does not exist yet.
// Try now; otherwise wait for game:ready, which is the same event the engine's
// own signals mod initialises on.
if (!registerSenders(state)) {
	if (FH && FH.events && typeof FH.events.on === "function") {
		FH.events.on(state, "game:ready", (s) => {
			registerSenders(s || state);
		});
		console.log("[wired-cells] signals not ready at load — hooked game:ready");
	} else {
		console.log("[wired-cells] cannot reach engine events — API moved?");
	}
}

// ---------------------------------------------------------------------------
// Emitting.
//
// senderOutputGetters is consulted ONLY when a link is created, to seed the
// link's stored `on` flag. Nothing polls it afterwards — the engine's own
// senders push their state by calling setAll() whenever it changes. So a
// registered getter alone leaves a wire stuck at whatever it was when drawn.
//
// This does the pushing. Links live at signals.links["x,y"] as arrays of
// { x, y, on } pointing at receivers; marking a receiver's "x,y" dirty is what
// makes the engine re-apply it on the next frame.
// ---------------------------------------------------------------------------

const CELLS = new Set(CELL_TYPES);

function poll() {
	const signals =
		state && state.session && state.session.mods && state.session.mods.signals;
	if (!signals || !signals.links) return;

	for (const key in signals.links) {
		const links = signals.links[key];
		if (!links || links.length === 0) continue;

		const comma = key.indexOf(",");
		if (comma < 0) continue;
		const x = Number(key.slice(0, comma));
		const y = Number(key.slice(comma + 1));

		const structure = FH.structures.getAtCell(state, x, y);
		if (!structure || !CELLS.has(structure.type)) continue;

		const on = hasCharge(state, structure);
		for (let i = 0; i < links.length; i++) {
			const link = links[i];
			if (!!link.on !== on) {
				link.on = on;
				signals.dirtyReceivers.add(`${link.x},${link.y}`);
			}
		}
	}
}

if (FH && FH.structures && api.triggers) {
	api.triggers.register("wired-cells:poll", { interval: 250, callback: poll });
	console.log("[wired-cells] polling links every 250ms");
}
