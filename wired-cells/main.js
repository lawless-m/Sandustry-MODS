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
// UNSUPPORTED API — read this before trusting it
//
// sandkit.api.signals only exposes targets.register (receiving). There is no
// public way to register a *sender*, so this reaches into the signals runtime
// directly. From the engine's own registerSenderType:
//
//     registerSenderType: (e, t, n) => {
//       const a = p(e);
//       a.senderTypes.add(t);
//       n && a.senderOutputGetters.set(t, n);
//     }
//
// ...and the sibling targets.register shows p(e) is state.session.mods.signals.
// So a sender is just: a type in a Set, plus an output getter function.
//
// This is private. A game update can move or rename it without warning, and the
// guard below is what turns that into a log line instead of a crash.
//
// Why a getter should not suffer the sensor bug: the logic gates' getters compute
// fresh on each evaluation. The Presence Sensor is the odd one out — its getter
// is a lookup into a Set that is only refreshed on element movement, which is why
// it latches on and never clears. Reading data.storedEnergy is live, so there is
// nothing to go stale.
// ---------------------------------------------------------------------------

const api = sandkit.api;

// Energy stores registered by the base game. powerBrick is the copper cell
// (capacity 1000); goldBattery is the small one (capacity 16).
const CELL_TYPES = ["powerBrick", "goldBattery"];

// Emit while the cell holds any charge at all. For a "full" signal instead, use:
//     (s.data?.storedEnergy ?? 0) >= (s.data?.maxEnergy ?? 0)
const hasCharge = (state, structure) => {
	const data = structure && structure.data;
	return (data && data.storedEnergy ? data.storedEnergy : 0) > 0;
};

let registered = false;

function registerSenders(state) {
	const signals =
		state && state.session && state.session.mods && state.session.mods.signals;

	if (!signals || !signals.senderTypes || !signals.senderOutputGetters) {
		return false;
	}

	for (const type of CELL_TYPES) {
		signals.senderTypes.add(type);
		signals.senderOutputGetters.set(type, hasCharge);
	}
	return true;
}

// The signals runtime does not exist at mod load, and there is no public hook
// that hands us `state`. addProcessor's callback does, so the first tick after a
// cell exists is the earliest safe moment to register.
for (const type of CELL_TYPES) {
	api.structures.addProcessor(type, {
		intervalMs: 500,
		process: (state) => {
			if (registered) return;
			registered = registerSenders(state);
			console.log(
				registered
					? `[wired-cells] registered senders: ${CELL_TYPES.join(", ")}`
					: "[wired-cells] signals runtime not reachable — API moved?",
			);
		},
	});
}
