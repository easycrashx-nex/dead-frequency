# DEAD FREQUENCY — Audio sources

These audio files use recorded source material. They are not oscillator or noise-generator approximations of gunshots or footsteps. Each listed source is published under **Creative Commons CC0 1.0 Universal**. Source pages and downloads were checked on 12 September 2026.

License: [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)

## Firearm reports

**The Free Firearm Sound Library** — created and recorded by **Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney**; preserved on OpenGameArt by bart.

- [Source and license declaration](https://opengameart.org/content/the-free-firearm-sound-library)
- [Original prepared library download](https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z)
- `smg-shot-1.ogg`, `smg-shot-2.ogg`, `smg-shot-3.ogg`: three distinct single shots from `Carl Gustav M45/G_31P.wav`. The library's master sheet identifies a Carl Gustav M45 / Swedish K, 9mm submachine gun, recorded at near distance in front of the shooter.
- `rifle-shot-1.ogg`, `rifle-shot-2.ogg`, `rifle-shot-3.ogg`: three distinct single shots from `AK-47/C_28P.wav`. The master sheet identifies an AK-47, 7.62x39, recorded at near distance in front of the shooter.

The game's VX-9 and AR-4 are fictional weapons. The recordings are used for their sound character; they do not claim to document those fictional models. Edits: single-shot extraction, mono downmix, rumble/high-frequency filtering, short natural decay with a gentle tail fade, peak normalization and Ogg Vorbis encoding. Variations come from separate recorded shots.

## Reload mechanics

**Gun reload sounds** — **SpringySpringo**.

- [Source and CC0 declaration](https://opengameart.org/content/gun-reload-sounds)
- [Original assault-rifle reload recording](https://opengameart.org/sites/default/files/assaultriflereload1_0.wav)
- `reload-out.ogg`, `reload-in.ogg`, `reload-bolt.ogg`: separate mechanical transients taken from `assaultriflereload1_0.wav` and assigned to the game's magazine removal, insertion and bolt actions.

The author identifies these as recordings of **airsoft guns**. They are recorded mechanical Foley, not recordings of a live-fire firearm's reload. Edits: transient isolation, mono downmix, filtering, short edge fades, normalization and Vorbis encoding.

## Footsteps

**Footsteps** — **GboxMikeFozzy**.

- [Source and CC0 declaration](https://opengameart.org/content/footsteps-0)
- Originals: [01](https://opengameart.org/sites/default/files/01-footstep_0.ogg), [02](https://opengameart.org/sites/default/files/02-footstep.ogg), [03](https://opengameart.org/sites/default/files/03-footstep.ogg), [04](https://opengameart.org/sites/default/files/04-footstep.ogg), [05](https://opengameart.org/sites/default/files/05-footstep.ogg), [06](https://opengameart.org/sites/default/files/06-footstep.ogg).
- `footstep-1.ogg` through `footstep-6.ogg` use the corresponding original singles.

The author recorded their own footsteps while walking through a subway, then normalized and reduced noise. Footwear is not specified. These are hard-surface footsteps, not a separately documented gravel or military-boot recording. Additional edits: mono downmix, mild filtering, edge fades, normalization and Vorbis encoding.

## Wind ambience

**Park ambiences** — **Thimras**.

- [Source and CC0 declaration](https://opengameart.org/content/park-ambiences)
- [Original field recording](https://opengameart.org/sites/default/files/park_ambience_wind.wav)
- `wind.ogg`: source seconds 30–54 of `park_ambience_wind.wav`, with a two-second cyclic crossfade creating a 22-second stereo loop.

The author recorded wind in an open field in a public park in Adelaide, South Australia, during winter, at 48 kHz. This is a field recording with its natural background ambience. Edits: segment selection, rumble/high-frequency filtering, cyclic crossfade, normalization and Vorbis encoding. No synthesized wind was added to this asset.

## Technical notes

`manifest.json` contains each file's exact source identity, edit description, decoded duration, sample rate, channel count, peak/RMS levels and SHA-256 digest. All files decode at 48 kHz. Reports and Foley are mono; ambience is stereo. Gun and Foley peaks are approximately −3.5 dBFS; wind peaks approximately −9 dBFS. Mixer volume and spatialization are handled separately by the game.

Only the selected, processed clips are distributed with the game. No account, paid library, external stream or runtime download is required.
