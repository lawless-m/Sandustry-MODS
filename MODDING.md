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
