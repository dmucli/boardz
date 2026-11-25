#!/usr/bin/env python3
"""Swiping between climbs in the play drawer, and pulling it down to close. One measured run.

    scenario_play_swipe.py <run-name> [--cold] [--queue5] [--phases slow,hard,quick,burst] [--no-dismiss] [--no-swipes]
                           [--dismissals N] [--marker <file-name>]...

Needs a build with probe/apply_swipe_probes.py applied. Fresh launch, the drawer
opened from the queue bar (which changes nothing in the queue), then:

  1. slow    four swipes on to the next climb, one every three seconds, then four back.
  2. hard    ten hard swipes forward, one driver call each (about 1.3 s apart), then ten back.
  3. quick   ten swipes forward inside ONE driver call, about 3.5 a second, then ten back.
             This is the pace of a thumb flicking through a queue.
  4. burst   the same at about 6 a second: faster than a thumb, to find where swipes
             start being lost. The probes say how far apart each one really landed.
  5. close   per round: a drag down that is let go early (springs back), a slow drag to
             about 80% open and a still release (closes), a hard flick down (closes).

Start with the current climb at least twelve from the end of the queue, and at
least twelve from its start, so every swipe has somewhere to go. The run walks
back to where it started; a swipe that was dropped is corrected at the end.

--cold     empties the hold-overlay cache at launch, so every board has to be rendered.
           With `--phases quick` the first swipes land on climbs nothing has rendered yet:
           the drawer warms three ahead, and a quick run outpaces it.
--queue5   restores the queue cut down to five climbs for this launch only. Backwards
           first, three at a time, because the current climb is the last of the five.

--marker   drops one more marker file before launch, for a build that reads a switch of its own.

The run records the battery temperature before and after in conditions.json.

The same script on two builds is the comparison. Do not change the gestures
between them.
"""
import json, os, subprocess, sys, time
import ios
from runs import Marks, run_directory

args = sys.argv[1:]
name = args[0]
directory = run_directory(name)
short_queue = "--queue5" in args
dismissals = int(args[args.index("--dismissals") + 1]) if "--dismissals" in args else 5
phases = args[args.index("--phases") + 1].split(",") if "--phases" in args else ["slow", "hard", "quick", "burst"]

# Other one-launch switches a probe build may read, by marker file name.
for index, argument in enumerate(args):
    if argument == "--marker":
        ios.push_marker(args[index + 1])
before = ios.conditions()
if before.get("batteryCelsius", 0) >= 40:
    print(f"The phone's battery is at {before['batteryCelsius']} C. Above about 45 C iOS drops the display to 60 Hz "
          "and throttles the CPU; let it cool before believing this run.")
if "--cold" in args:
    ios.push_marker("perf-probe-cold")
if short_queue:
    ios.push_marker("perf-probe-queue-5")
ios.launch()
time.sleep(9)
ios.prepare_session()
ios.require_foreground()

width, height = ios.screen_size()
marks = Marks()
# Fractions of the screen. The board sits between 26% and 71% of the height;
# the queue bar that opens the drawer is the pill above the search field.
QUEUE_BAR = (0.45, 0.872)
BOARD_Y = 0.50
LEFT, RIGHT = 0.20, 0.80
PULL_X, PULL_Y = 0.5, 0.14


def stroke(direction, duration_ms):
    """One swipe on the board: 'forward' drags right to left, to the next climb."""
    start, end = (RIGHT, LEFT) if direction == "forward" else (LEFT, RIGHT)
    return (width * start, height * BOARD_Y, width * end, height * BOARD_Y, duration_ms)


def swipes(label, direction, count, duration_ms, pause):
    marks.mark(f"{label}-start")
    for _ in range(count):
        ios.strokes([stroke(direction, duration_ms)])
        time.sleep(pause)
    marks.mark(f"{label}-end")
    time.sleep(1.5)


def burst(label, direction, count, duration_ms, gap_ms):
    marks.mark(f"{label}-start")
    ios.strokes([stroke(direction, duration_ms)] * count, gap_ms=gap_ms)
    time.sleep(3.0)
    marks.mark(f"{label}-end")
    time.sleep(1.0)


def open_drawer():
    ios.tap(width * QUEUE_BAR[0], height * QUEUE_BAR[1])
    time.sleep(3.0)


def pull(label, distance, duration_ms, hold_ms):
    marks.mark(f"{label}-start")
    ios.strokes([(width * PULL_X, height * PULL_Y, width * PULL_X, height * PULL_Y + distance, duration_ms, hold_ms)])
    time.sleep(1.8)
    marks.mark(f"{label}-end")


def net_steps():
    """How many climbs forward of the start the drawer is, from the phone's own commit events."""
    events = ios.pull_probes(directory)
    commits = [event for event in events if event["name"] == "swipe-commit-js"]
    return sum(1 if event.get("direction") == "next" else -1 for event in commits)


marks.mark("open-start")
open_drawer()
marks.mark("open-end")
ios.screenshot(os.path.join(directory, "drawer-open.png"))

if "--no-swipes" not in args:
    first, second = ("back", "forward") if short_queue else ("forward", "back")
    slow, many = (3, 3) if short_queue else (4, 10)
    for direction in (first, second):
        if "slow" in phases:
            swipes(f"slow-{direction}", direction, slow, duration_ms=250, pause=1.7)
    for direction in (first, second):
        if "hard" in phases:
            swipes(f"hard-{direction}", direction, many, duration_ms=60, pause=0.1)
    for direction in (first, second):
        if "quick" in phases:
            burst(f"quick-{direction}", direction, many, duration_ms=80, gap_ms=200)
    for direction in (first, second):
        if "burst" in phases:
            burst(f"burst-{direction}", direction, many, duration_ms=60, gap_ms=90)
    # A dropped swipe leaves the drawer short of where it began. Walk the difference back.
    time.sleep(2.0)
    offset = net_steps()
    marks.mark("correct-start")
    for _ in range(abs(offset)):
        ios.strokes([stroke("back" if offset > 0 else "forward", 250)])
        time.sleep(1.7)
    marks.mark("correct-end")
    ios.screenshot(os.path.join(directory, "after-swipes.png"))

if "--no-dismiss" not in args:
    for round_index in range(dismissals):
        pull(f"close-cancelled-{round_index}", distance=80, duration_ms=350, hold_ms=250)
        pull(f"close-slow-{round_index}", distance=height * 0.2, duration_ms=600, hold_ms=250)
        open_drawer()
        pull(f"close-flick-{round_index}", distance=height * 0.46, duration_ms=80, hold_ms=0)
        open_drawer()
    ios.screenshot(os.path.join(directory, "after-closes.png"))

marks.mark("end")
marks.save(directory)
json.dump({"before": before, "after": ios.conditions(), "arguments": args[1:]},
          open(os.path.join(directory, "conditions.json"), "w"), indent=1)
time.sleep(2.0)
ios.pull_probes(directory)
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "analyze_swipe.py"), directory, name], check=True)
