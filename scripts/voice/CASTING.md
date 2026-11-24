# Casting Hearthlight's voices

Every voice is a Kokoro v1.0 voice or a blend of their style vectors (`cast.json`), with
a speed and gentle shaping: a pitch shift with formants kept, a small formant shift for
size and age, a few cents of slow waver for the very old, shelving EQ, and a touch of
room for the chapel and for memories. Nothing is pushed far enough to sound like an
effect. Ages and manners are from docs/LORE.md §6 and §7.

Nobody could listen while casting, so every choice was checked by measurement
(`python scripts/voice/cast.py audition` / `check --both`): two test sentences per voice,
then median pitch and pitch range, speaking rate, harmonics-to-noise ratio (breathy or
rough voices score low), loudness and peaks, artifacts (clipping, long silences, cut-off
ends), and a timbre distance (MFCC means plus pitch) to every other cast voice. Distinct
stock Kokoro voices measure 3.2–6 from their nearest neighbour; every cast voice is at
least 3.2 from every other, so no two characters sound alike. Kokoro's quality grades
were also weighed: blends lean on the better-trained voices (heart, bella, emma, george,
fenrir, michael, puck) to steady the weaker ones.

## The cast

| who | voice | why |
|---|---|---|
| **Narrator** | bm_george 0.65 + bm_fable 0.35, British, speed 0.88, -1 st, +2 dB bass, small room, longer pauses | A warm, grave storyteller: George is the warmest, darkest British male (lowest spectral centroid, clean HNR); Fable adds the storyteller's lift. Slowed, lowered a semitone, given a little room and space between sentences. |
| **Lyra** (24) | af_heart 0.75 + af_bella 0.25, American, speed 1.07, +1.5 dB presence | Heart is Kokoro's best voice (grade A): warm, wide-ranging (8–9 semitones), natural. A quarter of Bella (A-) adds brightness and quickness for her teasing. Slightly fast because she is quick and wry; no pitch shift, so nothing artificial in the voice the author asked for. |
| Lyra at eleven (memories) | Lyra's blend, +4.5 st, formants +1.5 st, speed 1.08 | The same voice, younger: median F0 253 Hz, recognisably her. |
| **Hobb** (79) | bm_fable 0.6 + bm_lewis 0.4, British, speed 0.78, +0.5 st, formants +0.3, 12-cent waver, top rolled off at 7 kHz | Slow, mild, dry. Old men's voices thin and rise a little, hence the small upward shifts; Lewis gives the grain of age. The slowest villager. |
| **Wenna** (76) | bf_isabella 0.7 + bf_alice 0.3, British, speed 1.0, -2 st, formants -0.4, 12-cent waver | Quick, blunt and sharp: a clear, crisp British voice, lowered as women's voices lower with age, at full speed because she is never slow. |
| **Elda** (58) | bf_emma 0.8 + af_kore 0.2, British, speed 0.96, -1.5 st, +1 dB bass | "Love", "dear": Emma is the warmest British female (B-); Kore deepens it toward a stout, rosy innkeeper. |
| **Bram** (52) | am_fenrir 0.5 + am_onyx 0.5, speed 0.9, -1 st, formants -0.4, +2 dB bass | Big, gruff, short sentences: Onyx is the deepest voice (86 Hz), Fenrir gives it life. Median F0 100 Hz — the lowest villager. |
| **Pip** (9) | af_sky 0.6 + af_nova 0.4, speed 1.1, +6 st, formants +2 st | Kokoro has no children; Sky and Nova are the youngest-sounding, raised to a boy's pitch (median 218–233 Hz) with a smaller vocal tract, and quick because he is breathless. Formants moved only 2 semitones so he is not a chipmunk. |
| **Rowan** (38) | bm_daniel 0.6 + am_michael 0.4, British, speed 1.04, presence +1.5 dB | Clipped and formal: Daniel's measured British delivery, the narrowest pitch range of the men (6.7 st), with Michael's body. |
| **Mira** (26) | af_sarah 0.65 + af_nicole 0.35, speed 0.94, treble -1 dB | Soft and hesitant: a third of Nicole's breathy, close voice (alone she is a whisper with 1.5 s gaps) softens Sarah without losing clarity. |
| **Tobias** (44) | am_puck 0.7 + am_echo 0.3, speed 1.0 | Rambling "oh dear": Puck is the most animated male voice (12.8 st range). |
| **Aveline** (61) | af_kore 0.6 + bf_emma 0.4, British, speed 0.86, -1 st, chapel room, long pauses | Measured, in images, with long pauses: Kore's low, wide-ranging voice slowed, with a chapel's air and half-second pauses between sentences. |
| **Garrick** (47) | am_eric 0.5 + am_santa 0.5, speed 1.08, -0.5 st, presence | "My friend!": Santa's jolly theatrical range (13.5 st) tempered by Eric, a little fast for a salesman. |
| **Hess** (41) | af_alloy 0.8 + af_nova 0.2, speed 0.98, -0.8 st, treble -1 dB | Clipped hunter's talk: Alloy is the lowest, flattest female voice (6.4 st range, 143 Hz) — "Mm." "Wind's wrong." |
| **Sabeth** (34) | af_aoede 0.6 + bf_isabella 0.4, British phonemes, -0.5 st | Plain and warm with a western burr: Aoede's warm, open voice (highest HNR in the cast, 15 dB) with a British lean. |
| **Alder** (63) | bm_lewis 0.6 + am_puck 0.4, British, speed 0.92, +0.5 st, formants -0.2 | Formal and procedural: Lewis's deep British gravity, lifted a little so he is not Bram. |
| **Petra** (84) | bf_lily 0.6 + af_jessica 0.4, British, speed 0.95, -1 st, formants +0.4, 18-cent waver, +3 dB at 1.8 kHz | Tiny, bent, cackling, "a voice like a crow's": a smaller vocal tract, the strongest waver in the cast, and a nasal edge in the upper mids. |
| **Tilly** (17) | af_nova 0.6 + af_aoede 0.4, speed 1.1, +0.5 st | Fast, full of forge jokes: young, quick, bright. |
| **Tansy** (15) | af_river 0.6 + af_sky 0.4, speed 1.0, +1 st, formants +0.7 | Short and sarcastic: younger and smaller than Tilly, deliberately not rushed — she drawls. |
| **Corran** (77) | am_santa 0.6 + bm_lewis 0.4, British, speed 0.84, -0.5 st, 12-cent waver | Slow, humming between sentences, sixty years of water glare: the roughest voice (HNR 7) and the widest range of the old men. |
| **Wys** (20) | am_liam 0.7 + am_eric 0.3, speed 1.08, +1 st, formants +0.3 | Gangly, nervous, over-formal: Liam is the youngest male voice, nudged up and a little hurried. |
| **Maren** (63, in memory) | bf_alice 0.5 + af_kore 0.5, British, speed 0.95, -1 st, room | "A laugh like a kettle coming to the boil": an island accent somewhere between British and not, set back in a remembered room. |
| A bandit | am_adam 0.7 + am_liam 0.3, speed 1.05, -1 st, presence +2 dB | Rough and ordinary: Adam's coarse grade suits a cutthroat; Liam keeps it steady. |
| **Varek One-Eye** (36) | am_echo 0.5 + am_onyx 0.5, speed 0.95, +2.5 dB at 2.8 kHz | The chief: deep (96 Hz) and cutting, unlike Bram's warmth. |

Interjections espeak would spell out ("Hmph" as H-M-P-H) are spoken as sounds
(`LEXICON` in voicelib.py): Hmph, Hm, Mm, Mmh, Mm-hm, Tch, Shh, Pfft.

## Measurements

The first test sentence ("Well now, the lamps are lit and the road home is long. Mind your
step on the bridge tonight, will you?"), rendered, shaped and normalized; rate is the
average over both test sentences. No voice clipped (raw or finished), none had a silence
longer than 0.9 s inside a line, and every line ends at least 60 dB down.

MEASUREMENTS
