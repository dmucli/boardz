#!/usr/bin/env python3
"""Place the hitches in an Instruments Animation Hitches trace against a swipe run's probes.

    hitches.py <trace> <run-directory>

The UI-frame sampler in the probe build sees a frame the UI thread did not get
to run. It does not see a frame the render server presented late. Instruments
does, and this lines the two up. Record the trace while a scenario runs:

    python3 scenario_play_swipe.py <name> --no-dismiss --phases quick &
    sleep 7        # the scenario starts the app in a fresh process; attach after that
    xcrun xctrace record --template 'Animation Hitches' --device <udid> --attach Boardsesh \\
        --time-limit 22s --output <name>.trace --no-prompt

Recording slows the driver: one call of ten strokes took 12 s to return instead
of 3, though the strokes themselves landed at their usual spacing. Saving the
trace takes another two to three minutes. Only what happens inside the 22 s is
in it, so keep to one phase.

A hitch is counted "in a swipe" when it starts between a pan activating and its
fling landing, or within 20 ms before the pan activates: the first frame of a
drag is prepared before the gesture reports it.
"""
import datetime, json, re, subprocess, sys
import xml.etree.ElementTree as ET

trace, run = sys.argv[1], sys.argv[2].rstrip("/")


def export(*arguments):
    # `xctrace export` dies with SIGSEGV about every other call on Xcode 26.6, on any table. The same call then works.
    for _ in range(8):
        result = subprocess.run(["xcrun", "xctrace", "export", "--input", trace, *arguments], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout:
            return result.stdout
    raise SystemExit(f"xctrace export {' '.join(arguments)} failed eight times: {result.stderr.strip()[:200]}")


started = re.search(r"<start-date>([^<]+)</start-date>", export("--toc"))
if not started:
    raise SystemExit("The trace has no start date in its table of contents.")
trace_start_ms = datetime.datetime.fromisoformat(started.group(1)).timestamp() * 1000

node = ET.fromstring(export("--xpath", '/trace-toc/run[@number="1"]/data/table[@schema="hitches"]')).find("node")
columns = [column.find("mnemonic").text for column in node.find("schema").findall("col")]
by_id, hitches = {}, []
for row in node.findall("row"):
    cells = []
    for cell in row:
        if "ref" in cell.attrib:
            cell = by_id[cell.attrib["ref"]]
        elif "id" in cell.attrib:
            by_id[cell.attrib["id"]] = cell
        cells.append(cell)
    record = dict(zip(columns, cells))
    hitches.append({
        "at": trace_start_ms + int(record["start"].text) / 1e6,
        "ms": int(record["duration"].text) / 1e6,
        "process": record["process"].attrib.get("fmt", ""),
        "why": record["narrative-description"].text or "",
    })

events = json.load(open(run + "/probe-events.json"))


def at(event):
    return event.get("uiWallMs", event["wallMs"])


events.sort(key=at)
swipes, begun = [], None
for event in events:
    if event["name"] == "swipe-begin" and begun is None:
        begun = at(event)
    elif event["name"] in ("swipe-settled", "swipe-taken-over") and begun is not None:
        swipes.append((begun, at(event)))
        begun = None
trace_end_ms = trace_start_ms + float(re.search(r"<duration>([^<]+)</duration>", export("--toc")).group(1)) * 1000
covered = [swipe for swipe in swipes if trace_start_ms <= swipe[0] and swipe[1] <= trace_end_ms]
opens = [at(event) for event in events if event["name"] == "play-route-mounted" and trace_start_ms <= at(event) <= trace_end_ms]

print(f"{len(hitches)} hitches in {(trace_end_ms - trace_start_ms) / 1000:.1f} s, {sum(hitch['ms'] for hitch in hitches):.0f} ms in all; "
      f"the trace covers {len(covered)} swipes and {len(opens)} drawer opens")
in_swipes = 0
for hitch in hitches:
    where = "at rest"
    for index, (began, landed) in enumerate(covered):
        if began - 20 <= hitch["at"] <= landed:
            where = f"in swipe {index + 1} of {len(covered)}, {hitch['at'] - began:+.0f} ms from its start"
            in_swipes += 1
            break
    else:
        if any(0 <= hitch["at"] - opened <= 600 for opened in opens):
            where = "while the drawer opened"
    print(f"   {(hitch['at'] - trace_start_ms) / 1000:6.2f} s  {hitch['ms']:5.1f} ms  {where}  [{hitch['process']}: {hitch['why']}]")
print(f"   in swipes: {in_swipes} hitches over {len(covered)} swipes")
