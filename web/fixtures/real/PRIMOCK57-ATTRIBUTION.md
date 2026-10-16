# PriMock57: attribution

Ripple uses five consultations from **PriMock57** under the **Creative Commons Attribution 4.0 International** licence (CC BY 4.0).

| | |
|---|---|
| **Title** | PriMock57: A Dataset Of Primary Care Mock Consultations |
| **Creator** | Babylon Health: Alex Papadopoulos Korfiatis, Francesco Moramarco, Radmila Sarac, Aleksandar Savkov (Papadopoulos Korfiatis et al., 2022), ACL 2022 |
| **Source** | https://github.com/babylonhealth/primock57 at commit `cd2ac707ad03cb4d2531f4ec6b90c659bf4357c5` (retrieved 2026-10-09); paper https://arxiv.org/abs/2204.00333 |
| **Licence** | CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ (the dataset's own licence file: https://github.com/babylonhealth/primock57/blob/cd2ac707ad03cb4d2531f4ec6b90c659bf4357c5/LICENSE.md) |
| **Changes** | Channels mixed into one mono track; transcripts converted to JSON; 5 of 57 consultations selected. Details below. |

## What these recordings are

Mock primary-care consultations: Babylon clinicians consulting Babylon employees who acted as patients from case cards. Not real patient data. The speech is British English, recorded as separate doctor and patient channels (16 kHz, 16-bit WAV), with utterance-level human transcripts and the clinician's own consultation note.

## The five consultations

One consultation from each of the five recording days. The complaint is the dataset's own `presenting_complaint` from the clinician's note.

| Consultation | Day | Presenting complaint | Length | Mix gain |
|---|---|---|---|---|
| `day1_consultation06` | 1 | hard to breathe | 11.0 min | 0.973268 |
| `day2_consultation02` | 2 | I have a strange swelling on my elbow | 9.0 min | 0.889827 |
| `day3_consultation08` | 3 | I have a cough and a cold | 5.7 min | 1 |
| `day4_consultation07` | 4 | I have a cold | 10.4 min | 0.944103 |
| `day5_consultation08` | 5 | I'm wheezy | 9.4 min | 0.796069 |

Per consultation we use the doctor channel and patient channel WAVs (`audio/`), the two TextGrid transcripts (`transcripts/`) and the clinician's note (`notes/`). Every file's size, sha256 and source URL is in `web/fixtures/real/primock57.manifest.json`.

## Changes we made

1. **Selection.** 5 of the 57 consultations, one per recording day; the other 52 are not used.
2. **Channel mixing.** For each consultation the doctor and patient channel WAVs are summed into one mono 16 kHz 16-bit WAV: the shorter channel is zero-padded at the end, and one gain for the whole file (the "Mix gain" column; 1 when the plain sum already fits) keeps every sample inside the 16-bit range, so no sample is clipped. Nothing else is done to the sound: no resampling, filtering, normalising, trimming or noise reduction.
3. **Transcript format.** The two Praat TextGrid transcripts of each consultation are converted into one JSON list of utterances: start and end in milliseconds, speaker taken from the channel file (doctor or patient), the transcriber tags (`<UNSURE>`, `<UNIN/>`, `<INAUDIBLE_SPEECH/>`) removed in `text` and kept in `text_raw`, and intervals with no words left out. The words themselves are not changed.

The original channel WAVs, TextGrid files and notes are kept byte for byte as downloaded (checked against the Git LFS pointers and git blob ids at the commit above).

## Where the files are

The audio is not in this repository. `node scripts/data/fetch_primock57.mjs` (run in `web/`) downloads the files into `web/.data/real/primock57/` (gitignored), verifies them and writes the derived files; `--check` re-verifies the local copies against the manifest without the network.

The script first resolves the branch `main` to the commit above and then fetches every file from that commit: the audio from `https://media.githubusercontent.com/media/babylonhealth/primock57/<commit>/audio/<file>` rather than `.../primock57/main/audio/<file>`, so a later change to `main` cannot change what a rerun gets. On the retrieval date `main` was that commit, so both addresses served the same bytes; the source URL of every file in the manifest names the commit.

## No endorsement, no warranty

Babylon Health and the dataset's authors do not endorse Ripple or this use of their data. The dataset is provided as is, without warranties (CC BY 4.0, section 5). The recordings are used only to measure speech recognition and to demonstrate the "real recording" path; they are not part of the Mr Tan story (`web/tests/unit/real/primock57-isolation.test.ts` checks that the story's files, seeded rows and replay lines carry no dataset name, id, file or sentence, and that the code and files pages are built from carry none outside the demo and this credit line).

## Credit line for screens

Every screen that plays or shows PriMock57 material carries this line (English or Chinese, matching the screen). Both links are written out so the line still gives the source and the licence where nothing can be clicked (filming mode, screenshots, print); where links work, the dataset name also links to the source and "CC BY 4.0" to the licence. The same text is exported as `CREDIT` from `web/scripts/data/fetch_primock57.mjs` and stored as `credit` in `web/fixtures/real/primock57.manifest.json`; screens read it from there instead of copying it.

> Recording: PriMock57 (Babylon Health; Papadopoulos Korfiatis et al., 2022), https://github.com/babylonhealth/primock57, licensed under CC BY 4.0, https://creativecommons.org/licenses/by/4.0/. A mock consultation, not a real patient. Doctor and patient channels mixed into one track by Ripple.

> 录音：PriMock57（Babylon Health；Papadopoulos Korfiatis 等，2022），https://github.com/babylonhealth/primock57 ，许可证 CC BY 4.0，https://creativecommons.org/licenses/by/4.0/ 。这是门诊模拟，不是真病人。医生和病人两条声道由 Ripple 混成一条。

## How to cite

```
@inproceedings{korfiatis2022primock57,
  title={PriMock57: A Dataset Of Primary Care Mock Consultations},
  author={Papadopoulos Korfiatis, Alex and Moramarco, Francesco and Sarac, Radmila and Savkov, Aleksandar},
  booktitle={Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics},
  year={2022}
}

@inproceedings{moramarco2022human,
  title={Human Evaluation and Correlation with Automatic Metrics in Consultation Note Generation},
  author={Moramarco, Francesco and Papadopoulos Korfiatis, Alex and Perera, Mark and Juric, Damir and Flann, Jack and Reiter, Ehud and Belz, Anya and Savkov, Aleksandar},
  booktitle={Proceedings of the 60th Annual Meeting of the Association for Computational Linguistics},
  year={2022}
}
```

## 中文说明

这 5 段录音来自公开数据集 PriMock57（Babylon Health，Papadopoulos Korfiatis 等，2022），许可证 CC BY 4.0。内容是门诊模拟：Babylon 的医生给扮演病人的员工看诊，不是真病人。我们做的改动：选了 5 段；把医生和病人两条声道加成一条单声道（每段一个整体增益，不削波）；把 TextGrid 逐字稿转成 JSON。原文件逐字节保留。录音不进仓库，放在 `web/.data/real/primock57/`，用 `node scripts/data/fetch_primock57.mjs` 下载。只用来测转写准确率和演示「用真录音试一次」，不混进陈先生的故事。
