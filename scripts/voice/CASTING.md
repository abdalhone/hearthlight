# Casting the cutscene voices

The author gave three reference voices, all their own and all synthetic (nobody real is
cloned): **the Void** (made with Chatterbox from a computer-generated reference), and **the
goth girl** and **Bro** (made with ElevenLabs). Their words: "here is voices to use instead
of the one you have … and only put voices for cutscenes". Every cutscene voice comes from one
of them. Conditioning clips are in `refs/` (`refs.py` makes them: the speech of each file,
gaps shortened, at most 10 s; Bro's scream is left out — an old man is not conditioned on a
shout).

How a voice becomes another person: the reference is reshaped first (`refShape`: pitch with
formants kept, vocal-tract size — formants down is bigger or older, up is smaller — and
pace), and Chatterbox is conditioned on the reshaped clip, so it speaks natively in the new
voice instead of an effect being pasted over the old one. Chatterbox's `exaggeration` (how
much feeling) and `cfg` (lower is slower and calmer) set the manner; light shaping after the
cut (`fx`) adds age (a waver), roughness (grit) and colour (EQ).

Nobody could listen while casting, so every choice was measured
(`$PY scripts/voice/cast.py audition`): a real line per character rendered exactly as the
full render would, then its median pitch (F0) and range, speaking rate, brightness
(spectral centroid), how close Chatterbox came to the character's reference, and, for every
pair of characters, how alike they sound — the cosine between Chatterbox's own voice-encoder
embeddings of the finished clips (two takes of the same voice measure about 0.9; different
people about 0.5–0.8).

## The cast

| who | from | shaping | why |
|---|---|---|---|
| **Narrator — the Void** | the Void, 3 semitones up (pitch and formants) before Chatterbox hears it | Chatterbox exaggeration 0.35, cfg 0.45 (grave, unhurried); then the author's chain exactly: 3 semitones down, a layer an octave lower at -15 dB, echoes at 90 ms (0.22) and 160 ms (0.12), +2.5 dB bass, -3.5 dB at 350 Hz, +2.5 dB at 2.8 kHz, words evened out | The author's narrator, made the author's way, aimed at `void_processed.mp3`. Comparing it with `void_dry.mp3` showed the echoes at 90 and 160 ms (autocorrelation 0.19 and 0.11), the 300–420 Hz dip (about -3.8 dB) and the lift near 2.8 kHz; the amounts were set from that. It also showed the two files at the same pitch (82 Hz, sample for sample aligned): the dry file already had the 3-semitone drop. Chatterbox copies the pitch it hears (takes conditioned on the dry file came out at 87 Hz, and the chain then took them to about 70 Hz, deeper than the target), so the Void is conditioned on the dry voice raised back 3 semitones and the chain's drop lands it on the target. |
| **Lyra** | the goth girl | none (moods set the feeling: angry 0.7, surprised 0.65, happy 0.6, worried 0.55, sad 0.4 and slower) | The author's choice, without the glass ring (that was their other story). Measured: 0.91 like the reference; F0 259 Hz (the reference 251 Hz); 3.7 words a second — quick, as she is. |
| **Hess** (41, wardrunner) | the goth girl | 3.5 semitones down, formants -1.5 (bigger, lower); exaggeration 0.3, cfg 0.6 (flat, clipped); a little low-mid warmth, treble -1 dB | "Mm. Then we climb.": low, terse, outdoors. F0 146 Hz. **0.53 like Lyra** — the furthest from her. |
| **Wenna** (76, beekeeper) | the goth girl | 3.5 semitones down, formants +0.5 (small, thin, bent), 5 % quicker; a 14-cent waver, high-pass 170 Hz, +2.5 dB at 1.8 kHz (a sharp edge) | Quick, blunt, old: women's voices lower with age and thin out. F0 169 Hz, the brightest voice (1690 Hz). **0.60 like Lyra**. |
| **Sister Aveline** (61) | the goth girl | 5 semitones down, formants -2.4 (a larger, warmer voice), 10 % slower; exaggeration 0.3, cfg 0.3 (measured, with pauses); +1.5 dB bass, treble -1.5 dB; the chapel's room where she is in the chapel | Measured and kind, "in images". F0 184 Hz, 2.9 words a second. **0.66 like Lyra**. Chatterbox's own built-in voice was tried for her (the brief allowed it): it measured just as close to Lyra (0.70) and at 116 Hz it is a man's register, so it was not used. |
| **Maren** (63, in memory) | the goth girl | 2.5 semitones down, formants -2 (a bigger voice); exaggeration 0.6 (lively — "a laugh like a kettle"); heard remembered: a muffle (low-pass 4.2 kHz) and a small room | She only speaks in Lyra's stories. F0 222 Hz. **0.53 like Lyra**. |
| **Hobb** (79, lamplighter) | Bro | 2 semitones down, formants -0.4, 10 % slower; exaggeration 0.3, cfg 0.3 (slow, mild); a 10-cent waver, 5 % slower again, top rolled off at 7.5 kHz | The brief: "old Hobb slower and a little lower with a faint waver". F0 100 Hz, 2.3 words a second (the slowest man). |
| **Varek One-Eye** (36, bandit chief) | Bro | 5 semitones down, formants -2.2 (big chest); exaggeration 0.45; then 2.5 more semitones down, grit 0.4, +2.5 dB at 2.8 kHz (cutting), +1.5 dB bass | "Rougher and lower". The first try (exaggeration 0.55) came out shouted at 170 Hz; calmer and lowered after the cut, he is the deepest and roughest man. |
| **Corran** (77, ferryman) | Bro | 2 semitones up, formants +0.5 (thin, old), 10 % slower; exaggeration 0.45, cfg 0.3; an 18-cent waver (the strongest), grit 0.3, top rolled off at 6 kHz | Slow and humming, sixty years of water glare: old men's voices rise and thin, which also sets him apart from Hobb (F0 141 vs 100 Hz). |

## How alike they sound (voice-encoder cosine, finished clips; final audition)

| | nearest other voice | to Lyra |
|---|---|---|
| Lyra | Aveline 0.66 | — |
| Hess | Wenna 0.90 | 0.53 |
| Wenna | Hess 0.90 | 0.60 |
| Aveline | Wenna 0.68 | 0.66 |
| Maren | Hess 0.73 | 0.53 |
| Hobb | Varek 0.87 | — |
| Varek | Hobb 0.87 | — |
| Corran | Hobb 0.83 | — |
| Narrator | Hobb 0.74 | 0.64 |

Every woman measures 0.53–0.66 like Lyra, against 0.91 for Lyra's own takes: none of them
sounds like her. Hess and Wenna stay close to each other on this meter (both are the goth
girl lowered 3.5 semitones), but they are 2 semitones of vocal tract, 23 Hz of pitch, a
waver and a sharp edge apart, and they never share a scene. The three men all come from one
young man's voice; they are set apart by pitch (Hobb 100 Hz, Corran 141 Hz, Varek lowest
after the cut), pace and texture (Hobb mild, Corran wavering and rough, Varek gritty and
cutting), and also never share a scene.

History: the first cast (Hess -3/-1.2, Wenna -2/-0.6, Aveline -4/-1.6) had Aveline at 0.70
like Lyra and Hobb and Corran at 0.90 alike; Aveline went lower and bigger, Corran up and
thinner, Varek lower.
