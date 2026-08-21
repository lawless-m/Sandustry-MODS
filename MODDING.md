# Making another Sandustry mod

Everything needed to write a second mod without rediscovering any of it.
Verified against Sandustry on the Steam **`mods`** branch, August 2026.

---

## 0. Prerequisite: the `mods` branch

Mod support is first-party but gated. On the public branch the Mods screen just says
"Mod support is currently being tested".

Steam Library → right-click **Sandustry** → **Properties** → **Betas** → Beta Participation →
**`mods`**. No password (Steam's own branch list has no `pwdrequired` on it).

Check which branch you're on — no `betakey` means public:

```sh
grep -aA4 UserConfig ~/.local/share/Steam/steamapps/appmanifest_2764460.acf
```

Note the mods branch can be an *older* build than public, so saves made on public may not load.
Back saves up before switching.

---

## 1. Quick start

```sh
cp -r wired-fluids my-new-mod
$EDITOR my-new-mod/modinfo.json     # id, name, description; version 1.0.0
$EDITOR my-new-mod/main.js
cp something.png my-new-mod/preview.png
./install-dev.sh
```

Fully quit and relaunch the game. Mods screen → *Loaded local mods* → **Upload**.

---

## 2. Paths

| What | Where |
|---|---|
| Local mods | `~/.config/sandustry/mods/` |
| Subscribed Workshop mods | `~/.local/share/Steam/steamapps/workshop/content/2764460/<id>/` |
| Game files | `~/.local/share/Steam/steamapps/common/Sandustry/resources/app.asar` |
| Saves | `~/.config/sandustry/saves/` |
| Steam appid | `2764460` |

Discovery order: subscribed Workshop items → numeric folders under the Workshop content root →
the local mods folder.

---

## 3. `modinfo.json`

```json
{
  "manifestVersion": 1,
  "id": "author.mod-name",
  "name": "Display Name",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "main.js",
  "description": "One line — this becomes the Workshop description.",
  "author": "You",
  "loadOrder": 0
}
```

Validator rules, from `workshop-mods.js`:

- `manifestVersion` **must be exactly 1**
- `apiVersion` **must be exactly 1**
- `id` matches `^[a-zA-Z0-9_.-]+$`, is not a reserved Sandkit id, does not start with `__sandkit`
- `version` is semver-like (`1.0.0`, `1.0.0-beta.1`)
- `entry` is a relative `.js` path
- optional: `description`, `author`, `dependencies` (array of mod ids),
  **`workerEntry`** (a second entry point that runs inside the simulation worker)

---

## 4. The API

Your entry file runs with `sandkit` in scope:

```js
const api = sandkit.api;
```

Namespaces present on the api object:

```
action  constants  workerLocal  matters  elements  fire  world  items
authorization  terrains  wall  shadows  collector  cooldown  projectiles
sprites  reactions  excavation  processing  conveyors  signals  structures
```

### Signals

```js
api.signals.targets.register(structureType, (structure, input) => { ... });
// input = { combined: bool, inputCount: number, onCount: number }
```

`register` runs `resolveTypeName()` on strings, so **core structures work by lowercase alias**:

```
conveyorleft conveyorright shakerleft shakerright launcherup launcherleft
launcherright splitterleft splitterright dropper foundation
foundationangledleft foundationangledright collector filterleft filterright
slidingfoundation velocitysoaker grower soundbox pipe pump liquidvent light
gloomemitter
```

Mod-registered structures use their own string id (e.g. `heatCannonUp`).

Convention worth copying — with nothing wired, stay on, so installing your mod never silently
breaks an existing build:

```js
const on = input.inputCount === 0 || input.combined;
```

### Structure processing (on/off)

```js
api.structures.processing.setEnabledAt(x, y, bool);
api.structures.processing.isEnabledAt(x, y);
```

**Main thread only** — calling it from a `workerEntry` throws
*"Structure processing state can only be changed on the main thread."*

Structures that actually honour the flag (checked in both the bundle and the simulation worker):

- Grower, VelocitySoaker, SoundBox, Shakers
- Conveyors, including Mk2 and the filter belts
- **Pumps and Liquid Vents** (guarded on the pump tick *and* per connected vent)
- Anything registered through the generic Sandkit structure processor

Not everything does. If a structure has no tick to suppress, this call is a no-op and you need a
different lever — e.g. pumps route liquid via `structure.data.connectedVents`, so emptying that
list is an alternative way to stop one.

---

### What `sandkit` actually gives you

Bigger than it looks. From `dist/js/external-mod-runtime.js`:

```js
sandkit = { apiVersion, state, api, engine, enums, react }
sandkit.engine = { api: FH, state }   // FH = the internal framework the
                                      // game's own built-in mods use
```

So **`sandkit.state` is the live game state** and **`sandkit.engine.api` is `FH`** — you
are not limited to `sandkit.api`. `api` itself carries ~35 namespaces including
`triggers`, `schedule`, `hooks`, `storage`, `world`, `workers`, `rendering`, `player`.

`api.triggers.register(id, { interval, callback })` is the general-purpose polling
loop; interval is in ms.

### Signals: receiving is public, emitting is not

`api.signals` exposes **only** `targets.register(type, cb)`. The string `sender`
appears nowhere in the mod runtime. To make something emit you must reach
`sandkit.state.session.mods.signals` directly — unsupported, and liable to move.

Two things are needed, and missing either one fails quietly:

1. **Make it wirable.** The Signal Linker's test is exactly
   `senderTypes.has(structure.type)` plus a build-permission check.
   ```js
   signals.senderTypes.add("powerBrick");
   signals.senderOutputGetters.set("powerBrick", (state, s) => ...);
   ```
2. **Push the state.** `senderOutputGetters` is consulted **only when a link is
   created**, to seed that link's stored `on` flag. Nothing polls it afterwards —
   the engine's own senders call `setAll()` when their state changes. Register the
   getter and stop there and your wire is frozen at whatever it was when drawn.

   Links live at `signals.links["x,y"]` as arrays of `{x, y, on}` pointing at
   receivers. Set `link.on`, then `signals.dirtyReceivers.add("x,y")` for the
   receiver, and the engine re-applies on the next frame. See `wired-cells/`.

### On-screen UI

`api.ui` is fully supported and does more than it looks:

```js
api.ui.toast("plain text", { duration: 4000, cooldown, cooldownKey, variant })
api.ui.alert(message, title)                  // -> Promise
api.ui.confirm(message, title)                // -> Promise<boolean>
api.ui.prompt(message, defaultValue, placeholder, title, allowCopy)
                                              // -> Promise<string|null>, null on cancel
api.ui.inject(componentId, Component)         // a React component on the HUD;
                                              // returns an unregister function
api.ui.overlays.register("global"|"hotbar", id, () => reactNode)
api.ui.overlays.update("global")              // force a re-render
```

- **Toasts and dialogs take plain strings.** They are run through `t()`, which returns
  the key unchanged when there is no translation, so English text passes straight
  through. `api.i18n.register(locale, entries)` is there if you want real translations.
- **`inject` is the one you want for a panel.** It mounts your component inside a
  full-screen `pointer-events-none` overlay, each entry wrapped in its own
  `pointer-events-auto` div and an error boundary — so clicks reach your buttons and a
  throw blanks your panel rather than the game.
- **`sandkit.react` is the game's own React namespace** — `createElement`, `useState`,
  `useEffect` all work, and hooks survive re-renders because the component identity is
  stable. There is no JSX in a mod file; write `createElement` (aliasing it to `h` reads
  fine).
- **Nothing pushes state at your component.** It gets no props. Read `sandkit.state`
  yourself on a `setInterval` tick, and call `api.ui.overlays.update("global")` when you
  change something and want the panel to catch up at once.
- **Do not lean on Tailwind classes.** The game's CSS is compiled from the game's own
  markup, so only the utilities it happens to use exist — `w-64` and `truncate` are in,
  `right-4`, `w-2`, `py-0.5` and any arbitrary value you invent are not. Inline `style`
  objects are the reliable choice.

Keys, for a panel toggle:

```js
api.input.registerBinding("MyPanel", ["KeyL"], {
  displayNameKey: "Toggle my panel",   // plain text is fine
  category: "My Mod",
  handlers: { down: () => { ... } },   // no arguments; reach for sandkit.state
});
```

Key names are `KeyboardEvent.code` plus modifiers and mouse/wheel: `"KeyL"`,
`"Control+KeyZ"`, `"MouseRight"`, `"Alt+WheelDown"`. Already taken by the base game:
A D W S Q R T U V C X P N G B E F M, Space, Shift, Tab, Alt, Control, Escape, Backspace,
F2, F4, F5, F9, and Ctrl+C/V/X/Z/H.

### Reading and clicking signal receivers

Both need `state.session.mods.signals`, same private object as above.

- **A receiver's state** is `signals.incomingByReceiver.get("x,y")` — an array of links;
  the receiver is on if any of them has `on`. That is exactly what the engine's own
  `getCombinedAt` does.
- **Never** `api.signals.targets.register("signalLamp", cb)` to watch a base-game
  structure. `register` is a `Map.set` on `receiverApply`, so it *evicts* the game's own
  handler — lamps stop lighting up, buffers stop forwarding. Read the state instead.
- **A click on a structure** is `signals.interactableHandlers.set(type, (state, s) => ...)`.
  The signals module intercepts `action:intercept`, runs your handler and cancels the
  click, and draws a white hover outline on any interactable type. It swallows *every*
  click on that type, so register it only while your mode is active and delete it after.
  See `signal-markers/`.

### Putting a marker on the minimap

The minimap is a PIXI canvas in a `document.body` div (`[data-role="minimap-overlay"]`),
and its world→map projection lives in module-private variables — zoom, offset, buffer
size — none of which are on `state`. So **nothing can draw on it from outside**. What it
does do, every frame, is render two marker layers:

```js
ie.FH.progression.getWaypoints(e)   // pulsing yellow ring; arrow at the edge when off screen
ie.FH.portals.getMarkers(e)         // cyan diamonds
```

`getWaypoints` reads `storyProgression.waypoints`, which the public storage API reaches
by name, so anything can join that layer:

```js
const prog = api.storage.ensure("storyProgression");
(prog.waypoints ||= []).push({
  id: "my-mod:whatever",
  position: { x, y },        // world PIXELS: cell * cellSize
  radius: 0,
  label: "shown nowhere on the map",
  active: true,              // the renderer skips !active
  isHelper: false,           // helper waypoints drive story triggers by proximity
  showOnMap: true,
});
```

- `api.rendering.getGridMetrics()` gives `{ cellSize, snapGridCellSize }` — 4 and 4, so a
  structure is 16px and its middle is `cell * cellSize + 8`.
- **Every waypoint is the game's objective yellow (`0xFFFF00`) and carries no label on the
  map.** A marker is present or absent; there is no colour or text to encode state with.
  Toggling `active`, or adding and removing the entry, is the only channel you have.
- Markers show on the full Map screen (**M**) too, at double size.
- **They are saved state.** Strip yours on the `store:save` event — it fires *before* the
  store is structured-cloned into the save worker's `postMessage`, so removing them there
  keeps saves clean, and your next tick puts them back. `signal-markers/` does this.
- Give every entry an id with your mod's prefix; that is what makes cleanup, and a prune
  at `game:ready` after a crash, a one-liner.

## 5. Investigating the game yourself

This is the part that actually matters. The game is Electron; all logic is readable JavaScript.

```sh
tools/extract-asar.py            # unpacks to ./_game/
```

Files worth knowing:

| File | What's in it |
|---|---|
| `dist/js/bundle.js` | main thread: UI, structures, rendering, the api object |
| `dist/js/simulation-worker.js` | the sand/fluid simulation |
| `workshop-mods.js` | the mod loader + manifest validator |
| `local-mod-publisher.js` | the Workshop upload flow |
| `main.js` | Electron main process, paths, IPC |

It's minified but not obfuscated — names survive. Useful grep patterns:

```sh
grep -o '.\{200\}signals:{targets.\{400\}' _game/dist/js/bundle.js   # api definitions
grep -o '"ui|mods|[a-z|]*":"[^"]*"' _game/dist/js/bundle.js          # UI strings, incl. errors
grep -o 'ev\.Pump.\{300\}' _game/dist/js/simulation-worker.js        # a structure's behaviour
```

Enums live near their names — searching for `e[e.Collector=16]` finds the whole structure enum,
`e[e.Fluxite=14]` the terrain enum. Translation strings are a fast way to find a feature: search
the human-readable text, then read outwards.

**Beware `grep -oE` with several `.{200}`-style wildcards on these files** — it can hang on
catastrophic backtracking. Use Python with `str.find()` and slicing for anything non-trivial.

---

## 6. Debugging

**Options → Tools → Debug Console** opens Chromium DevTools (Steam build only).

`console.log` from your mod appears there. Prefix messages so they're findable:

```js
console.log(`[my-mod] registered ...`);
```

The loader also reports named diagnostics, e.g. `local_mod_folder_outside_root`, and manifest
errors name the offending field.

Unrelated but handy: `localStorage.setItem('debug.active','true')` then restart gives you the
game's own debug panel (spawn brush, sim controls) and `window.__debug` with `.state` and
`.config`. It suppresses achievements while enabled — set it back to `'false'` afterwards. Do
**not** press its "Unlock everything" button: that sets `integrity.cheatsUsed` permanently and
zeroes your gold, fluxite and energy.

---

## 7. Publishing

In game: Mods screen → *Loaded local mods* → **Upload**.

- **`preview.png` is required** — no file, no upload (`preview_missing`)
- The **whole folder** is uploaded as content, so keep it clean
- First upload creates the item **unlisted** (`visibility: 3`) — flip it on the Steam page
- Writes `workshop.json` = `{ "schemaVersion": 1, "publishedFileId": "..." }`

Steam fields come from the manifest:

| Steam | Manifest |
|---|---|
| Title | `name` |
| Description | `description` |
| Change note | `version` |

So bumping `version` *is* how you write a change note.

**Keep `workshop.json` in the repo.** Without it the next upload creates a *second* item instead
of updating yours. It's written into the installed copy under `~/.config/sandustry/mods/`, so copy
it back after publishing. `install-dev.sh` preserves it across reinstalls.

---

## 8. Gotchas, collected

- **Never symlink into the mods folder.** The loader `realpath()`s every candidate and silently
  rejects anything resolving outside the mods root. Copy — that's why `install-dev.sh` copies.
- **Mods are discovered at launch only.** Fully quit; a reload isn't enough.
- **`setEnabledAt` is main-thread only** and throws in a worker.
- **Not every structure honours the processing flag** — check before designing around it.
- **The whole mod folder ships** on upload.
- **First publish is unlisted**, deliberately.
- A game update will eventually break a mod; bump `version` and re-upload.
- **Don't try to sense a cell's charge with the Presence or Signal Sensor.** Tried
  and abandoned. Registering a sensor as energy `storage` did not make it report
  charge — it just **filled up with liquid copper**, and the sensor then reported
  the copper, since both sensors trigger on elements being present rather than on
  stored energy. Neither sensor ever tracked charge. If you want a charge signal,
  make the cell itself a signal sender (see `wired-cells/`).
