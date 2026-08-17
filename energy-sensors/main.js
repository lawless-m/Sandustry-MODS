/** @format */

// ############################################################################
// PARKED — blocked by a vanilla bug. Do not publish.
//
// This mod works: the sensors do become energy stores and they do receive
// charge. But the sensors' signal output cannot fall again.
//
// Their state is a cached Set, recomputed only on:
//     building:placed, structures:moved, structures:pasted, element:moved
// and element:moved only fires when an element crosses a tile boundary.
//
// Energy ARRIVING is elements moving in  -> fires -> sensor goes true.
// Energy DRAINING is elements consumed in place -> no movement, no event,
// no recompute -> the sensor stays true forever.
//
// Confirmed in game: the icon updates when charge arrives and never reverts on
// drain; a sensor next to nominally empty stores reads true indefinitely.
//
// Not patchable from a mod — the Set and its update function are private to the
// game's own signals mod. If the developers add invalidation on element removal,
// this file starts working unchanged.
// ############################################################################

// Energy Sensors — let the two signal sensors hold charge, so they report the
// state of a power network instead of only sensing loose elements.
//
// Why this works, with no new signal-emitting code:
//
//   * A structure's stored energy IS element pixels sitting inside its 4x4 area.
//     The engine recounts them and writes data.storedEnergy / data.maxEnergy.
//     (Same trick as the Collector: your energy total is the sum of what is
//     physically in your stores.)
//   * Both sensors already emit signals in vanilla, based on what is in their
//     own 4x4 area.
//
// So registering them as energy `storage` is enough. Their existing emit logic
// then reads the charge for free:
//
//   Presence Sensor  "at least one element inside its 4x4"  -> charge > 0
//   Signal Sensor    "its 4x4 area is full of elements"     -> charge == full
//
// Capacity is data.maxEnergy, which defaults to 16 — exactly a full 4x4, so
// "full of elements" and "fully charged" are the same condition. Small capacity
// is deliberate: the sensor should follow the network, not buffer it.
//
// What you do with the two signals is up to you — feed them into a latch built
// from the in-game gates and drive whatever you like.

const api = sandkit.api;


// Capacity is NOT the lever. A sensor holds the engine default of 16 against copper
// cells of 1000, so it fills from the first trickle wherever you put it — a fresh one
// placed in the bank comes up lit immediately. Priority tiers are what decide who gets
// served first, so that is where the discrimination has to come from.
//
// Vanilla stores (powerBrick, goldBattery) register with no priority, i.e. 0. Tiers are
// collected and sorted ascending into sandkit.mods.energyPriorities.
//
// Goal for each sensor:
//   signalSensor    ("4x4 FULL of elements") -> fill LAST  => lit means bank full
//   signalPresence  ("ANY element")          -> drain LAST => lit means bank not empty
//
// Which end of the sorted list is served first is the one thing worth testing. If these
// come out backwards, swap the two numbers.
const FULL_TIER = 1; // signalSensor
const ANY_TIER = -1; // signalPresenceSensor

api.energy.registerType("signalSensor", "storage", { priority: FULL_TIER });
api.energy.registerType("signalPresenceSensor", "storage", { priority: ANY_TIER });

console.log(
	`[energy-sensors] signalSensor tier=${FULL_TIER}, signalPresenceSensor tier=${ANY_TIER}`,
);
