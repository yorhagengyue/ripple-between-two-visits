# Stand-in clips

Generated with Windows built-in TTS (Microsoft Zira Desktop), 16 kHz mono WAV, from the R1-R4 lines (v1-u08, v1-u09, v2-u06, v2-u08) and Dr Lim's last two lines at the D42 visit (v3-u19, his answer to the extra-tablet question; v3-u20, how to measure again and the warning line restated) in docs/plan/visits-script.md.
They are placeholders so the "play the doctor's own words" moments make sound before real recordings exist.
When SPEECH_PROVIDER=mock, utterance.clip_path points here; the UI must label them "stand-in voice".
Replace each file with the real recording (same file name) once the visits are recorded.

`sentences.json` cuts the clips whose line has two or more sentences (v2-u06, v2-u08, v3-u19, v3-u20) by sentence: each sentence's text and where it starts and ends in the clip (ms, about 120 ms of the pause either side). It was measured with ffmpeg's silencedetect by `cd web && npx tsx scripts/asr/clip-sentences.ts`; run it again whenever a clip is replaced (`--check` says whether the file is still right). An answer to a dose question quotes only the sentence that bears on it and plays that stretch (`/api/visits/<visit>/clip?u=<id>&s=<k>`; lib/asr/sentences.ts).
