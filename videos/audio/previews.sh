#!/bin/bash
# Picture (out/frames-v3, the assembled v3 cut) muxed with out/audio-v3.wav: the story, the clinic chapter, the whole film.
#   bash previews.sh [story] [clinic] [full]      (all three when no argument)
P=D:/ripple-c2/film/promo
V="-c:v libx264 -crf 26 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart"
want=${@:-story clinic full}
for w in $want; do case $w in
  story)  ffmpeg -y -loglevel error -framerate 30 -start_number 0 -i $P/out/frames-v3/f%05d.jpg -t 205 -i $P/out/audio-v3.wav \
            -map 0:v -map 1:a -frames:v 6150 $V $P/out/audio-v3-preview-story.mp4 && echo story done & ;;
  clinic) ffmpeg -y -loglevel error -framerate 30 -start_number 3810 -i $P/out/frames-v3/f%05d.jpg -ss 127 -t 60 -i $P/out/audio-v3.wav \
            -map 0:v -map 1:a -frames:v 1800 $V $P/out/audio-v3-preview-clinic.mp4 && echo clinic done & ;;
  full)   ffmpeg -y -loglevel error -framerate 30 -start_number 0 -i $P/out/frames-v3/f%05d.jpg -i $P/out/audio-v3.wav \
            -map 0:v -map 1:a -frames:v 13674 $V $P/out/audio-v3-preview-full.mp4 && echo full done & ;;
esac; done
wait
for f in $want; do echo "$f: $(ffprobe -v error -show_entries stream=codec_type,duration -of csv=p=0 $P/out/audio-v3-preview-$f.mp4 | tr '\n' ' ')"; done
