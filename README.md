# Sandustry MODS

Steam Workshop mods for **Sandustry** (Steam appid `2764460`, game version 0.5.3).

**Writing another one? → [MODDING.md](MODDING.md)** — the full recipe: branch setup, manifest
rules, the API, how to read the game's own JavaScript, publishing, and every gotcha found the
hard way.

## Contents

| Mod | What it does | Workshop |
|---|---|---|
| `wired-fluids/` | Puts **Pumps** and **Liquid Vents** on the signal network, so circuits can switch them | [3785225389](https://steamcommunity.com/sharedfiles/filedetails/?id=3785225389) |
| `wired-cells/` | Energy cells emit a signal while they hold charge, so circuits can read them | [3785409320](https://steamcommunity.com/sharedfiles/filedetails/?id=3785409320) |
| `signal-markers/` | A HUD panel listing every **Signal Lamp** by name with its live ON/OFF state, and pinned ones marked on the minimap | not published |
| `recipe-logbook/` | A recipe book that starts empty and fills in as you play — a recipe is written down only once you have made it | [3787330564](https://steamcommunity.com/sharedfiles/filedetails/?id=3787330564) |

`tools/extract-asar.py` unpacks the game's `app.asar` into `_game/` for reference (gitignored).

## Prerequisite: the Steam `mods` branch

**Mod support is first-party and unfinished.** The game ships a full Workshop Mods screen —
browse, subscribe by item ID, install status, unsubscribe — but on the public branch it is
replaced by this message (`ui|mods|comingSoon`):

> Mod support is currently being tested and will be available soon.
>
> If you want to help test mods and provide feedback, please switch to the **"mods"** branch in
> Steam.
>
> To switch branches, right-click the game in your Steam Library, then go to Properties →
> **Game Versions & Betas** and select the suitable branch.

Check which branch you are on — no `betakey` under `UserConfig` means the default public branch:

```sh
grep -aA4 UserConfig ~/.local/share/Steam/steamapps/appmanifest_2764460.acf
```

On the public branch, subscribed Workshop items **download but are never loaded**. That is the
whole explanation for a mod appearing to do nothing.

## Fluxloader

Fluxloader is the community loader (github.com/fluxloader-team/fluxloader) that the game hooks
into. As of writing it has **no GitHub releases**, was last pushed 2026-04-21, and a Workshop
search for "fluxloader" on appid 2764460 returns **0 entries** — so it is presumably distributed
through the `mods` branch rollout rather than the public Workshop.

The base game only ever *looks* for it, and does nothing if absent
(`console.log('Fluxloader not found, starting game without mods')`). The hook:

1. On start, `main.js` calls `getWorkshopModsPath()` → `<steam>/steamapps/workshop/content/2764460`
2. `findFluxloaderMod()` scans every subfolder for a `modinfo.json` whose **`modID === "fluxloader"`**
3. If found, it `require()`s `fluxloader.bundle.js` from that folder and hands it a host API
   (window creation, ipcMain, shell, dialog, screen, paths)
4. Fluxloader then calls `startGame({ applyPatches, unmodded })` — it patches the game bundle
   through a protocol interceptor and boots the window

So **subscribe to Fluxloader on the Workshop first**. Without it, nothing here (and nothing like
Wired Pyro) runs at all — the mod folder just sits on disk unread.

Verify with:

```sh
find ~/.local/share/Steam/steamapps/workshop/content/2764460 -name modinfo.json \
  -exec grep -l fluxloader {} \;
```

## Paths

| What | Where |
|---|---|
| Workshop mods (subscribed) | `~/.local/share/Steam/steamapps/workshop/content/2764460/<publishedFileId>/` |
| **Local dev mods** | **`~/.config/sandustry/mods/`** (`userData/mods`, created at launch) |
| Game bundle (read-only ref) | `<install>/resources/app.asar` → `dist/js/bundle.js` |
| Saves | `~/.config/sandustry/saves/` |

## Mod anatomy

A mod is a plain folder. No build step, no bundler, no dependencies.

```
wired-fluids/
├── modinfo.json      # manifest
├── main.js           # entry point, plain JS, runs with `sandkit` in scope
├── preview.png       # Workshop thumbnail (optional until you publish)
└── workshop.json     # written on publish: { schemaVersion, publishedFileId }
```

`modinfo.json` fields, copied from a working published mod:

```json
{
  "manifestVersion": 1,
  "id": "author.mod-name",
  "name": "Display Name",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "main.js",
  "description": "One line.",
  "author": "You",
  "loadOrder": 0
}
```

## The API

`sandkit.api` is injected by **Fluxloader**, not the base game — grep the shipped bundle for
`sandkit.api` or `setEnabledAt` and you get zero hits. Treat Fluxloader's own source as the
reference for what `apiVersion: 1` actually exposes.

The two calls this mod uses:

```js
api.signals.targets.register(structureType, cb)   // cb(structure, { combined, inputCount, onCount })
api.structures.processing.setEnabledAt(x, y, bool)
```

Underneath, the base game's signal system is `registerSenderType` / `registerReceiverType`, and the
receiver callback really is `(state, structure, { combined, inputCount, onCount })` — so the
Fluxloader signature is a thin wrapper over it.

`structureType` accepts core structures by lowercase alias. From the bundle's alias map:

```
conveyorleft conveyorright shakerleft shakerright launcherup launcherleft launcherright
splitterleft splitterright dropper foundation foundationangledleft foundationangledright
collector filterleft filterright slidingfoundation velocitysoaker grower soundbox
pipe pump liquidvent light gloomemitter
```

Mod-registered structures use their own string id instead (e.g. `heatCannonUp`).

## Installing locally

Copy the folder into `~/.config/sandustry/mods/` — **do not symlink**. The loader calls
`realpath()` on every candidate and rejects anything resolving outside the mods root with
`local_mod_folder_outside_root`, so a symlink into this repo is silently skipped. `install-dev.sh`
copies for this reason.

Mods are scanned at launch only. Quit the game before installing.

The loader (`workshop-mods.js` in the asar) discovers mods from three places, in order:
subscribed Workshop items, a scan of numeric folders under the Workshop content root, then the
local mods folder.

## Manifest rules (from the real validator)

- `manifestVersion` must be exactly `1`
- `apiVersion` must be exactly `1`
- `id` must match `^[a-zA-Z0-9_.-]+$`, not be a reserved Sandkit id, not start with `__sandkit`
- `version` must be semver-like (`1.0.0`, `1.0.0-beta.1`)
- `entry` must be a relative `.js` path
- optional: `description`, `author`, `dependencies` (array of ids), `workerEntry` (a second
  entry point that runs in the simulation worker)

## CONFIRMED: pumps do NOT honour `setEnabledAt`

Not a risk any more — checked against the mods-branch build. `isProcessingEnabledAt` is consulted
by **Grower, VelocitySoaker, SoundBox, Shakers, conveyors** (including Mk2 and the filter belts)
and the generic Sandkit structure processor. **Pumps and Liquid Vents never call it.**

Pump flow is driven by `structure.data.connectedVents`, recomputed when the pipe network changes.
`pumpsCache` is only touched on place, remove, and network rebuild.

So `wired-fluids` will load and register its targets cleanly, and toggling will do nothing.

### Plan B

Kill the pump's output list instead of the processing flag:

- signal low → `structure.data.connectedVents = []` (pump has nowhere to push)
- signal high → trigger the pipe-network rebuild to restore it

That is the same state the game itself produces when a pump has no pipe attached, so it should be
well-behaved. The alternative is to drop the pump from `pumpsCache` and push it back, mirroring
what demolition does.

## Old note: do pumps honour `setEnabledAt`?

Wired Pyro works because heat cannons are periodic *trigger* structures — there is something to
switch off. **The base game has no generic "processing enabled" flag**; that concept belongs to
Fluxloader.

Pumps and vents are core and simulated differently:

- placing a Pump does `store.pumpsCache.push(structure)`
- demolishing one does `store.pumpsCache = store.pumpsCache.filter(...)`
- pump/vent behaviour is driven off the pipe network, with `data.connectedVents` on each pump

If `setEnabledAt` turns out to be a no-op for them, **Plan B** is to mirror what demolition does:
drop the pump out of `pumpsCache` when the signal goes low and push it back when it goes high.
That is the same code path the game already uses, so it should be well-behaved. Verify against
Fluxloader's API for the supported way to reach game state.

## Dev loop

```sh
./install-dev.sh          # symlink each mod into ~/.config/sandustry/fluxloader-mods/
```

Then restart the game. Errors surface in the Electron console — **Options → Tools → Debug Console**.

## Publishing

The game already links `steamworks.js` and exposes Workshop/UGC calls in `steam.js`
(`workshopSubscribe`, `workshop.getItem`, item metadata with `publishedFileId`, …), so publishing
goes through Steam UGC rather than a manual upload. Fluxloader is expected to drive it; on success
a `workshop.json` appears in the mod folder:

```json
{ "schemaVersion": 1, "publishedFileId": "3783134306" }
```

Keep that file — it is what makes a later publish an *update* rather than a new item.

## Reference: Wired Pyro

Electric131's mod, the whole thing, as the pattern to follow:

```js
const api = sandkit.api;
const HEAT_CANNON_TYPES = ["heatCannonUp", "heatCannonDown", "heatCannonLeft", "heatCannonRight"];

function applySignalInput(structure, input) {
	api.structures.processing.setEnabledAt(
		structure.x, structure.y,
		input.inputCount === 0 || input.combined,
	);
}

for (const structureType of HEAT_CANNON_TYPES) {
	api.signals.targets.register(structureType, applySignalInput);
}
```

Note `inputCount === 0 || combined`: with nothing wired to it the structure stays on, so adding the
mod never silently stops existing builds. Worth preserving in anything you write.
