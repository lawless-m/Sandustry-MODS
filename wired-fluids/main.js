/** @format */

// Wired Fluids — put Pumps and Liquid Vents on the signal network.
// Same shape as Electric131's Wired Pyro, which does this for heat cannons.

const api = sandkit.api;

// Core structure names, resolved via the game's lowercase alias map
// (bundle: Fe = { ..., pipe: ev.Pipe, pump: ev.Pump, liquidvent: ev.LiquidVent }).
const FLUID_TYPES = ["pump", "liquidvent"];

function applySignalInput(structure, input) {
	// No wires attached -> behave exactly as vanilla (always running).
	// Wired -> follow the combined signal state.
	const on = input.inputCount === 0 || input.combined;
	api.structures.processing.setEnabledAt(structure.x, structure.y, on);
}

for (const structureType of FLUID_TYPES) {
	api.signals.targets.register(structureType, applySignalInput);
}
