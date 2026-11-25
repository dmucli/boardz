#!/usr/bin/env python3
"""Film swipes between climbs in the play drawer and lay the frames out as a contact sheet.

    scenario_film_swipe.py <run-name> [--back]

The probes count boards that slid in before their holds. This is the other
half: frames of what was on screen while one did, to look at. It needs
ImageMagick (`magick`) for the sheet. Any build will do; it reads no probes.

Fresh launch, the drawer opened from the queue bar, then six swipes at the pace
of a thumb in one driver call while the screen stream is recorded. The stream
gives about 25 frames a second, so a swipe is six or seven frames: enough to see
a board arrive without its holds or with holds half faded in, not enough to see
a single missed frame. Start with at least six climbs ahead of the current one
in the queue (or behind it, with --back); the swipes are not undone.
"""
import json, os, subprocess, sys, threading, time
import ios
from runs import run_directory

name = sys.argv[1]
directory = run_directory(name)
backwards = "--back" in sys.argv
ios.launch()
time.sleep(9)
ios.prepare_session({"mjpegServerFramerate": 30, "mjpegScalingFactor": 40, "mjpegServerScreenshotQuality": 45})
ios.require_foreground()
width, height = ios.screen_size()
ios.tap(width * 0.45, height * 0.872)  # the queue bar
time.sleep(3.0)

start, end = (0.20, 0.80) if backwards else (0.80, 0.20)
stroke = (width * start, height * 0.50, width * end, height * 0.50, 80)
frames = os.path.join(directory, "frames")
recorder = threading.Thread(target=ios.record_stream, args=(frames, 6))
recorder.start()
time.sleep(0.6)
began = time.time()
ios.strokes([stroke] * 6, gap_ms=200)
recorder.join()
stamps = json.load(open(os.path.join(frames, "stamps.json")))
print(len(stamps), "frames; the driver call began", round(0.6, 2), "s into the recording and took", round(time.time() - began, 2), "s")

# The frames that changed: a swipe is the only thing moving, so keep each frame that
# differs from the one before it, and its neighbours. 48 frames to a sheet.
selected = list(range(0, len(stamps)))
listing = os.path.join(directory, "sheet.txt")
moving = []
previous = None
for index in selected:
    path = os.path.join(frames, f"f{index:05d}.jpg")
    size = os.path.getsize(path)
    if previous is not None and abs(size - previous) > 400:
        moving.append(index)
    previous = size
keep = sorted({neighbour for index in moving for neighbour in (index - 1, index, index + 1) if 0 <= neighbour < len(stamps)})[:48]
open(listing, "w").write("\n".join(os.path.join(frames, f"f{index:05d}.jpg") for index in keep))
sheet = os.path.join(directory, "sheet.jpg")
# Not check=True: montage exits non-zero when it finds no font for the labels it is not asked to draw.
subprocess.run(["magick", "montage", "@" + listing, "-tile", "12x4", "-geometry", "156x338+2+2", "-background", "#303030", sheet],
               capture_output=True)
if not os.path.exists(sheet) or os.path.getsize(sheet) == 0:
    raise SystemExit("montage wrote no sheet; the frames are in " + frames)
print(sheet, f"({len(keep)} of {len(stamps)} frames)")
