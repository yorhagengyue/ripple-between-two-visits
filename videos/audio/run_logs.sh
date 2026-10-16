#!/bin/bash
# The sound pass for every source segment of edl-v3.json (600-753 is the sober part: no sound words, logged anyway).
# Story 0-205 is split at the chapter boundaries so the passes run in parallel; out/log-A-B.json each.
R=D:/ripple-c2/film/promo
RANGES="127:187 27:65 85:115 65:85 187:205 0:15 15:27 115:127 205:209.4 210:215.6 220.4:226.4 230.6:237 237:239 291.5:300.5 305.5:315.1 319.6:322 322:323.5 324:340 341.3:350 351.4:360 362.4:370 430:440 600:753"
mkdir -p $R/audio/logs
echo $RANGES | tr ' ' '\n' | xargs -P ${P:-6} -I{} bash -c 'r={}; a=${r%%:*}; b=${r##*:}; node D:/ripple-c2/film/promo/render.mjs --log=$a:$b --out=out/log-$a-$b.json > D:/ripple-c2/film/promo/audio/logs/log-$a-$b.txt 2>&1; echo "done $r: $(tail -1 D:/ripple-c2/film/promo/audio/logs/log-$a-$b.txt)"'
echo ALL DONE
