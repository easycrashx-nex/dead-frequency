# DEAD FREQUENCY — implementation contract

A Windows 3D FPS extraction shooter: offline solo and private two-player cooperative raids. German interface. Industrial coastal exclusion zone at warm sunset, olive concrete, orange industrial accents, teal shadows. Twelve-minute repeatable raids on a 300×300 metre map. Extraction sends loot into a personal intake; manual stash, local real-time market and mailbox. GitHub Releases provide automatic verified updates. Internet co-op uses a temporary cloudflared tunnel; LAN mode connects directly. Current implementation and tests take precedence over historical notes below.

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
