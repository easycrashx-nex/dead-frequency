# DEAD FREQUENCY — implementation contract

A Windows 3D FPS extraction shooter: offline solo and private two-player cooperative raids. German interface. A 1500×1500 metre mountainous industrial exclusion zone, with connected settlements, river crossings and accessible buildings. Thirty-minute repeatable raids. Extraction sends loot into a personal intake; manual stash, local real-time market and mailbox. GitHub Releases provide automatic verified updates. Internet co-op uses a temporary cloudflared tunnel; LAN mode connects directly. Current implementation and tests take precedence over historical notes below.

## Version 1.11 world, hardcore encounters and recovery
- User acceptance: exact 1500×1500 metre playable bounds, actual terrain heights shared by visual geometry and collision, mountains and river/bridges, all building footprints have reachable interiors, selected buildings have usable upper floors and stairs, recognizable road vehicles and walled compounds with limited entrances.
- World owner: layout.js, terrain.js, render.js and world geometry tests. Simulation owner: simulation.js, enemy-ai.js, enemies.js, coop-session.js, server/coop-server.js and domain tests. Interface owner: UI modules/style. Root owns main.js, Electron/preload, coop-client.js, resolution/recovery, documentation, packaging and native/release QA.
- Corpses are shared searchable containers with role-dependent owned weapon/attachment/equipment rewards, including rare valuable rolls; no duplicate automatic ammo/drop payout. Spawn reinforcements outside living players' proximity and current sight, bounded by active population and corpse residency. Boss and bodyguards act together while retaining genuine line-of-sight and sound investigation.
- Cooperative downed state has a 60-second bleed timer and one successful recovery opportunity per raid. A standing teammate holds interact for six seconds within reach/line-of-sight and spends one medkit only on successful revival. Release, movement out of reach or incoming damage interrupts progress. Host validates all state and consumption; fully dead operators cannot be revived.
- User-approved direction replaces the rejected terminal dashboard: a dark 3D equipment room with a large operator wearing the selected actual loadout, slim left navigation and compact right deployment controls. Reuse the game's WebGL context. Keep selected item stats and purchase/action controls visible in inventory/shop views; retain keyboard/controller operation. Support 944×561, 1280×720, 1440×900 and 2383×1423 viewports.
- GPU stability: coalesce render-resolution changes once per drawn frame, use one atomic drawing-buffer allocation and cap pixel/driver dimensions. Limit hub graphics to 30 FPS. Recover WebGL in place, regenerate generated environment resources, and preserve game state. Permit exact-document local reloads and never dispose gameplay in a cancelable beforeunload handler. Renderer crashes show a separate recovery page instead of an unusable blank window.
- Validate actual packaged Windows context loss/restore, self-reload, renderer crash, high-DPI resolution limits and sustained menus; traverse all entrances and multi-floor routes, river crossings and mountainous ground; validate corpse ownership, reinforcements/boss tactics and two-client Internet knock/revive/bleedout. Preserve prior profiles and test real 1.10.0 launcher handoff.

## Version 1.10 owned loadouts and weapon assembly
- `weapons.js` contains 32 weapons. `loadouts.js` contains 36 compatible attachments in six slots, 24 gear items in four slots and six immutable preset kits. Catalog data controls derived stats, prices, geometry identities and valid combinations. Existing eight weapon base ballistics remain unchanged.
- Profile version 3 adds `loadout` under the existing profile storage key. Custom slot references point to real stash/intake instances, never copied possessions. Equipped weapon instances contain at most one owned attachment per compatible slot; nested instance IDs participate in global save deduplication. Preserve previous credits, ordinary secured goods, market settlement and skills; former rented-weapon selection grants no free owned weapon.
- Presets charge once per raid and issue nontransferable equipment; issued parts cannot be sold, mounted in owned builds, stashed or dropped. Found gear can replace them in a raid. Scout remains free and playable after loss. Custom deployments consume only selected owned gear and priced ammunition/medkits after complete preflight.
- Montage moves parts between stash and the weapon. Player weapon stats include actual magazine, range, recoil, damage, reload, ADS timing/zoom and sound radius. Main recoil, renderer, audio and host shooting use these effective values. Suppressors reduce AI hearing range and shot audio; skill effects apply once.
- Worn backpack/carrier/plate/helmet affect capacity, armor, damage reduction and movement. Gear damage persists as condition; swapping does not refill worn armor or weapon ammunition. A plate requires a carrier. Reject capacity-reducing changes that cannot retain all carried items. Dropping the last owned weapon leaves the operator unarmed, with no fallback gun or shots.
- Raid ownership uses player/seed-namespaced IDs, including mounted parts. Successful extraction allocates unique secured IDs, preserves mounted parts/condition and restores custom selection references; manual intake storage remains required. Death or abandonment loses carried ownership. The authoritative co-op host spills nonissued equipment exactly once and refreshes the full metadata of previously existing ground instances before reusing them.
- Co-op preflights structural validity and affordability for both players before charging either. Clients select only catalog-backed owned references, never damage, capacity, armor or cost. Live equip/drop actions run on the host; replicated player gear and builds drive remote models. Preserve independent inventories and single ownership of shared loot.
- First-person, remote and editor previews share `weapon-model.js`. Cache only bounded active builds; dispose replaced geometry/materials and preview renderers. The preview draws on changes rather than adding a permanent animation loop.
- Verify native shop/editor/deployment/raid gear/extraction/death/reload flows, controller regressions, real two-client Internet play, measured frame times, clean source build/package hashes and the old released launcher handoff. Simulated Gamepad tests retain their explicit hardware-test limitation.

## Version 1.7.1 economy pacing
- `ECONOMY_BALANCE` in `economy.js` sets new loot value to 65% of its catalog basis, kill bonus 15, relay bonus 150 and trained extraction bonus 50. These credit changes do not affect XP, weapon prices, existing balances or secured inventory values.
- Containers still draw three to five unique goods, weighted per item by rarity: common 6, rare 3, epic 1. Hard-mode multiplier remains 1.35. Elite chips use the same new-loot value multiplier.
- Buyers check after 60–90 seconds then every 60 seconds. At the current quote the chance is 18%, capped at 65% for discounted goods, and zero for prices at least twice the current quote. There is no minimum chance for extreme asking prices. No listing fee is introduced; returns remain claimable, payments settle once, saved outcomes remain deterministic across offline catch-up.
- Prior credits, stash/intake and settled mail retain their values. Active offers retain their item, requested price and expiry while using the new buyer rules.

## Version 1.7 weapons and progression
- `weapons.js` is the shared catalog of eight distinct weapons: VX-9, AR-4, BR-12, SG-8, DMR-7, SR-90, MG-60 and RV-6. It controls costs, magazine/reserve, cadence, fire mode, damage, pellets, range, reload time and model identity. Kit and weapon costs are charged once on raid start.
- `progression.js` defines 24 nodes in four branches, prerequisites, two-point capstones, three starter points and one point per 250 XP. Legacy armor/backpack/weapon ranks migrate to equivalent learned nodes with compensating legacy points. Their effects are applied once. Save validation bounds values and rejects invalid graph unlocks.
- `selectWeapon(id)` and `unlockSkill(id)` are hub-only actions, locked during connection/lobby/raid. Profile stores `selectedWeapon` (null means kit default) and `progression`. Join and ready carry weapon selection; the host validates each participant's loadout and derived skills.
- Automatic weapons use held `fire`; other weapons consume a discrete `firePressed` edge. The client buffers brief presses until the 30 Hz packet; the server consumes each pending press once. Pause/focus/panel transitions clear input. One shotgun trigger consumes one shell, emits one shot event with multiple pellet endpoints and awards each kill once.
- Raid state includes `xpEarned`; XP rewards are personal (guard 50, elite 100, first trade pickup 10, extraction 150). `xpClaimed` follows items through pickup, drop, multiplayer handover and disconnect spill to prevent pickup farming.
- Player state carries actual `maxHp`, `maxStamina`, `reloadDuration`, `healDuration`, `recoilMultiplier`, `shotTimer` and `cycleDuration`. UI meters, audio and weapon animation consume effective values. The rendered camera and authoritative shot direction retain identical recoil angles.
- Package both shared catalog/progression modules into the native host, as well as the browser bundle. Preserve old releases and verify new Windows binaries, two-client Internet play, saved progress migration and automatic launcher handoff.

## Version 1.9 controller input
- `gamepad.js` is a pure standard-Gamepad snapshot adapter with radial deadzones, analog movement, shaped look axes, trigger hysteresis, edge actions, activity-based selection, neutral gates and optional haptics. Detect Sony/Xbox from exposed identifiers; `controllerPrompts` changes glyphs only. Never infer hidden physical hardware behind XInput emulation or activate an unknown raw mapping.
- Main merges one active input device into existing simulation/co-op actions. Right-stick angular speed uses elapsed seconds and separate ADS sensitivity; recoil and authoritative weapon direction remain shared. Controller raids do not require pointer lock. Mouse clicks can reacquire it. Transitions, disconnects and focus loss clear held inputs; all pending edges survive until one simulation step consumes them.
- Controller menus remain usable when `controllerEnabled` disables raid controls. UI provides visible focus, directional navigation, repeat, range/select adjustment, contextual back, tab changes and on-screen text/number entry. Preserve focus through render updates and confine it to the active dialog or field panel.
- Twelve controller options extend settings to seven categories and 67 controls. Existing profiles and bindings migrate without loss. HUD and help use the active device family; manual symbol selection covers controllers hidden by emulation drivers.
- `platform.readClipboard()` exposes only bounded plain text through a trusted renderer IPC handler and is called solely by the explicit on-screen Paste button. Do not read or send clipboard contents during connection or polling.
- Test standard Xbox/Sony/generic and unsupported mappings, deadzones, reconnect/focus neutral gates, semi-auto edges, menu navigation, native real-time performance, multiplayer analog/trigger input and automatic update preservation. Mark API-injected native gamepad QA as simulated; do not claim physical hardware or haptics validation.

## Version 1.8 tactical enemies
- `enemy-ai.js` owns tactical planning, separate visual/heard/shared memories, local contact sharing, cover/peek pairs, flanking, investigation and collision-safe navigation. Simulation injects geometry, seeded randomness and the existing shooting callback; damage, HP, accuracy, fire intervals and initial reaction floors remain at 1.7.1 values.
- Each enemy stores a serializable `ai` brain with relative timers. In co-op, every player can deliver sounds/hits into the same enemy objects; only the primary game advances their AI against all living raid participants, including after the host dies or extracts. No private per-game clock may timestamp shared contacts.
- `lastSeen` changes only on unobstructed visual observation. `lastHeard` is an approximate position. The newest usable contact guides investigation; expired contacts lead back to patrol. Cached perception never bypasses current eye and muzzle visibility checks before shooting.
- Cover candidates use shared solid geometry and reachable hiding/peeking endpoints. Routes append exact physical goals to navigation-grid paths; movement segments must remain walkable. Bound expensive route and perception work across the 33 guards.
- Co-op snapshots expose only `ai.role` and `ai.task`; private contacts, cover goals, paths and planner caches stay with the host. Renderer poses consume these public states without changing hitboxes or authoritative body direction.
- Include `enemy-ai.js` in native host package sources as well as the renderer bundle. Verify tactical behavior, real-time native performance, second-player sound propagation and the released launcher's automatic update handoff.

## Version 1.6 loot containers
- `loot-catalog.js` defines seven container types, exactly 100 new named trade items and the nine legacy items. Pools are keyed by container type; consumable ammo/medical supplies are additional and do not count toward the 100 new trade items.
- `layout.CONTAINER_SPOTS` supplies logical shared positions and solid crate dimensions, including all five interiors. Static raid loot lives in `state.containers`; `state.loot` contains dynamic backpack/enemy drops.
- Containers have shared `opened`, `searched` and one seeded item array per raid. Each player owns `activeContainerId` and `containerSearchRemaining`. Validated take actions check phase, reach, visibility, search state, item membership and capacity. Taken items cannot be claimed twice.
- `game.takeContainerItem(containerId,itemId)`, `takeAllContainerItems(containerId)` and `closeContainer()` are exposed through the authoritative co-op action path. Panels block gameplay input while simulation continues. Session death/disconnect spills container-sourced backpack items into recoverable shared ground drops.
- Include the catalog module in packaged native host sources as well as the browser bundle.

## Version 1.5 interiors
- Five existing building footprints contain accessible interiors: entry-booth, warehouse, rail-office, customs-office and south-workshop. `OBSTACLES` still describes outer map footprints; `INTERIORS` describes doors, shared solid parts and loot locations; `COLLIDERS` replaces those five monolithic boxes for physics and traces.
- Interior solid y values are box centers. Navigation ignores overhead solids and uses only geometry intersecting standing characters. Rendering consumes the same wall, ceiling and fixture dimensions; decoration must leave door openings and walkways clear.
- Doorways remain open in this release. Interior loot, shots, AI sight and movement use the existing authoritative solo/co-op simulation. Settings and player profiles retain their existing storage format.

## Version 1.4 settings
- `settings.js` defines six categories, 43 fields and 12 key bindings, bounded migration, conflict checks and category resets. Existing `dead-frequency.settings.v1` values migrate in place; profile data uses separate keys.
- `settings-ui.js` renders searchable controls with immediate persistence and a HUD preview. The utility dialog owns keyboard focus and blocks gameplay input while open.
- `main.js` applies input preferences and a render-only FPS cap. Cosmetic motion settings do not change weapon recoil or authoritative multiplayer simulation. Toggle sprint clears on exhaustion.
- Renderer and audio expose partial `setSettings` APIs. Audio category gains include active voices and reverb returns. Electron handles native fullscreen, F11 state synchronization and focus events through the narrow preload bridge.

## Version 1.3 integration
- Root owns main.js, coop-client.js, audio.js, Electron/preload/platform, packaging and release QA.
- Simulation owns simulation.js, coop-session.js, server/coop-server.js and co-op tests.
- Renderer/UI owns render.js, ui.js, coop-ui.js, style.css.
- Launcher owns launcher/* and updater tests.
- Co-op protocol1: capability token64hex at /coop?token=..., max2 clients. Join(profile,name,kit,version), ready, host start, input30Hz withmonotonicseq, action, leave. Host60Hz, snapshots20Hz. SharedAI/loot; ownplayer/raid/profile; snapshotscontainteammates,playerId,hostId,coopPhase. No clientpositions/damage accepted.
- Multiplayer menus are local; simulationcontinues. Hostclosingapplication endsconnection forboth. Results mustpersist exactlyonce. Solo remainsoffline withpausedsimulation.
- Launcher checks public easycrashx-nex/dead-frequency releases before each normalstart, automatically downloads/verifies/preparesnewversion, launchesnewEXE. Separateversions preserveexistinginstallations/saves; no updaterduringraid. Production hasnoQA mutationAPI.

## Modules and ownership
- simulation.js, layout.js, tests/simulation.test.js: simulation agent
- render.js: world/render agent (all Three.js, weapon, world and visual effects)
- ui.js, style.css: UI agent
- main.js, audio.js, index.html, package.json, Electron packaging, QA: root

## Simulation API (plain JS ESM)
`export async function createGame(saved = null)` -> game
`game.state` has:
- phase: hub | raid | paused | extracted | dead
- profile: {credits, raids, extracts, best, upgrades:{armor,backpack,weapon}}
- player: {x,y,z,yaw,pitch,hp,armor,stamina,ammo,reserve,magSize,weapon,medkits,reload,heal,grounded,moving,sprinting}; y is FEET height, camera = y+1.65 (crouch offset view only).
- raid: {timeLeft,kills,loot:[],value,capacity,extractionProgress,extractionDuration,extractionName,objectiveComplete,seed,difficulty}
- enemies: [{id,x,z,y:0,yaw,hp,kind,mode,attackFlash,dead}]
- loot: [{id,x,z,name,value,rarity,taken}]
- prompt: {kind:loot|extract|relay, text, id} or null
- result: null or {success,value,kills,reason,bonus,total}
`game.layout` exposes the map exports below.
`game.startRaid({difficulty:'normal'|'hard',kit:'scout'|'assault'})` -> bool (assault costs credits)
`game.update(dt,input)` fixed step; input {forward:-1..1,right:-1..1,yaw,pitch,sprint,crouch,jump,aim}; yaw 0 looks -Z; positive yaw turns left, Three Euler YXZ; forward positive means forward. Ground flat except low props, obstacle collision authoritative in Rapier.
`game.fire({x,y,z})` normalized aim world direction; origin player eye; returns bool. Simulation ray hits enemies, headshots and wall blocking. Ammo/fire cooldown/reload enforced here.
`game.reload()`, `game.heal()`, `game.interact()`, `game.pause(bool)`, `game.returnToHub()`, `game.buyUpgrade('armor'|'backpack'|'weapon')`, `game.getSave()`, `game.drainEvents()`.
Events array objects: {type:'shot'|'hit'|'kill'|'damage'|'loot'|'reload'|'heal'|'extract'|'death'|'relay'|'enemyShot'|'notice', ...}; shot/hit/enemyShot optionally {x,y,z,from:{x,y,z},to:{x,y,z},headshot}; notices {text}. Used by renderer/audio/UI. Result economy settles exactly once. `game.dispose()` releases Rapier.

## layout.js exports (publish first so render work can begin)
`WORLD_SIZE` (120); `OBSTACLES` [{id,kind:'building'|'container'|'barrier'|'crate'|'tank',x,z,w,d,h,color?}] axis aligned; ground at 0, meshes center y=h/2. `POIS` [{name,x,z}], `EXTRACTIONS` [{id,name,x,z,radius:4}], `RELAY` {x,z}, `SPAWN` {x,z,yaw}. Export `layout` {size,obstacles,pois,extractions,relay,spawn}. Routes must be connected, spawn has nearby safe loot and no immediate enemy fire. World can decorate collision obstacles without adding large noncolliding blockers to walkable space.

## Renderer API
`export function createRenderer(canvas,layout)` -> renderer adapter
- `update(state,dt,input)` camera and visuals (input {aim,crouch,lookDX,lookDY,time}); hub provides cinematic map backdrop; gameplay places camera at player eye. View aim pitch/yaw same as sim.
- `render()`; `resize()`; `events(events)`; `setQuality('high'|'medium'|'low')`; `dispose()`
- `canvas`; `stats()` -> {drawCalls,triangles,fps?}; optionally `getAimDirection()`.
Full Three.js world, original detailed geometry-built weapon and industrial environment with texture canvases, batched repetitive props, shadows, fog, cinematic sky; believable animated humanoid armored enemies. Use correct physically readable lighting, tasteful optional bloom. Weapon has recoil, ADS, walk/sprint bob, reload and healing feedback. Visual death corpse and loot beacon state. Minimize draw calls and allocate no per-frame geometry. No external downloads required. Camera model source is state; no gameplay mutations.

## UI API
`export function createUI(root,actions)` -> UI; actions {start({difficulty,kit}),resume(),hub(),upgrade(kind),settings({sensitivity?,volume?,quality?,fov?}),quit()?}
- `update(state,info)` throttled by root; info {locked,fps,settings:{sensitivity,volume,quality},mapOpen,inventoryOpen}; all state from simulation
- `events(events)` transient messages/hit indicator; `togglePanel('map'|'inventory'|'help')`; `closePanels()`; `dispose()`
Menu/hub over cinematic world: editorial large DEAD / FREQUENCY title, warm orange primary CTA, compact loadout/difficulty selectors, credit bank and upgrade store secondary. Main CTA SPIELEN / RAID STARTEN. German brief onboarding/controls visible on menu; pause, result, settings/help supported. HUD low chrome: objective/time top left, small compass top, ammo bottom right, health bottom left, contextual E prompt, extraction progress; center open. Optional map shows actual obstacle/poi/exfil/player data (import layout). No emoji. Use CSS only decorative UI, not world artwork. No external fonts/network dependencies. UI updates should not reset settings/selectors each frame. Basic responsive desktop support.

## Keys
WASD move; mouse look; LMB fire; RMB aim; Shift sprint; Ctrl/C crouch; Space jump; R reload; E loot/relay/call extraction; F medkit; M map; Tab inventory; Esc pause. Extraction requires staying in zone for 8 sec; leaving resets timer. Raid continues with map/inventory open (no pointer UI required); Escape pauses. On pointer lock lost pause automatically.
