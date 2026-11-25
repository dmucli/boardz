#!/usr/bin/env python3
"""Summarise one run of scenario_play_swipe.py.

    analyze_swipe.py <run-directory> [label] [--each]

Reads <run>/probe-events.json and <run>/events.json. Per phase, for the swipes
that changed the climb:

  bare board   The incoming board was on screen before its holds were. Counted when the
               holds painted after the swipe began; the time is how long it was bare.
               "at finger-up" and "at settle" count the swipes where the holds were still
               missing at those two moments.
  not mounted  No board was holding the incoming climb when the swipe began. With one
               spare board (before the three-board carousel) that means it was showing
               the OTHER neighbour's holds; with three it means the page was missing.
  fling        Finger-up to the outgoing board being off screen, or to the next swipe
               taking the fling over, whichever came first (UI thread).
  at rest      Finger-up to the carousel being at rest with the new climb in the middle.
               The one-spare-board carousel ignored touches for all of it.
  JS caught up Finger-up to the JS thread having rendered the new climb, as the UI thread
               saw it. Until then a second swipe the same way has no page to go to.
  uncovered    The board in the middle painted its holds this long AFTER the carousel
               uncovered it. Read on the JS thread, so an upper bound; 0 or less is clean.
               Absent when the board was already painted as a neighbour.
  dropped      Swipes far or fast enough to change the climb that did nothing: finger-up
               while the carousel ignored touches, or no page mounted to go to.
  took over    Swipes that began while the last fling was still running and carried on
               from where it was.
  UI frames    Frame callbacks the UI thread ran from a swipe starting until 0.2 s after
               the carousel came to rest, the interval it was running at, and how many it
               missed (an interval of two or more). Split into frames missed while a board
               was moving, which is on screen, and frames missed with the picture still:
               at rest, or after the incoming board has stopped in the middle and only the
               outgoing board's tail is left to leave.

--each prints one line per swipe.

Times are milliseconds. UI-thread instants use that thread's clock; anything
painted is stamped when the JS thread heard about it, which is later than the
paint by however busy the JS thread was.
"""
import json, statistics, sys

arguments = [argument for argument in sys.argv[1:] if not argument.startswith("--")]
run = arguments[0]
label = arguments[1] if len(arguments) > 1 else run.rstrip("/").rsplit("/", 1)[-1]
each = "--each" in sys.argv
events = json.load(open(run + "/probe-events.json"))
try:
    marks = json.load(open(run + "/events.json"))
except FileNotFoundError:
    marks = []


def at(event):
    """When it happened: the UI thread's clock for a UI instant, the JS thread's otherwise."""
    return event.get("uiWallMs", event["wallMs"])


events.sort(key=at)


def describe(values, unit=""):
    values = sorted(value for value in values if value is not None)
    if not values:
        return "n=0"
    p90 = values[min(len(values) - 1, int(round(0.9 * (len(values) - 1))))]
    return f"median {round(statistics.median(values))}{unit}, p90 {round(p90)}{unit}, max {round(values[-1])}{unit} (n={len(values)})"


def first(name, after, before=None, **match):
    for event in events:
        moment = at(event)
        if moment < after or event["name"] != name:
            continue
        if before is not None and moment > before:
            return None
        if all(event.get(key) == value for key, value in match.items()):
            return event
    return None


def phase_of(moment):
    current = None
    for mark in marks:
        if mark["wall"] > moment:
            break
        if mark["event"].endswith("-start"):
            current = mark["event"][: -len("-start")]
        elif mark["event"].endswith("-end"):
            current = None
    return current


def phase_group(phase):
    """close-slow-3 -> close-slow; slow-forward stays."""
    if phase is None:
        return "outside a phase"
    head = phase.rsplit("-", 1)
    return head[0] if head[-1].isdigit() else phase


# --- Which climbs had a board mounted, and whether its holds had painted, at any moment ---
# `carousel-render` lists the climbs the carousel has boards for (`boards`; before the
# three-board carousel, the current climb and the one spare `peek`). An `overlay-painted`
# from one of those boards (surface `play` or `full`) says that climb's holds are up.
board_timeline = []  # (moment, {frames id: painted})
mounted = {}
for event in events:
    if event["name"] == "carousel-render":
        listed = event["boards"].split(",") if "boards" in event else [event.get("current", ""), event.get("peek", "")]
        listed = [frames for frames in listed if frames]
        if set(listed) != set(mounted):
            mounted = {frames: mounted.get(frames, False) for frames in listed}
            board_timeline.append((at(event), dict(mounted)))
    elif event["name"] == "overlay-painted" and event.get("surface") in ("play", "full"):
        frames = event.get("frames")
        if frames in mounted and not mounted[frames]:
            mounted[frames] = True
            board_timeline.append((at(event), dict(mounted)))


def boards_at(moment):
    state = {}
    for when, snapshot in board_timeline:
        if when > moment:
            break
        state = snapshot
    return state


def ready_after(moment, target):
    """The first moment at or after `moment` when a board held `target` with its holds painted."""
    if boards_at(moment).get(target):
        return moment
    for when, snapshot in board_timeline:
        if when > moment and snapshot.get(target):
            return when
    return None


def carousel_before(moment):
    latest = None
    for event in events:
        if at(event) > moment:
            break
        if event["name"] == "carousel-render":
            latest = event
    return latest


# --- Swipes -------------------------------------------------------------------
swipes, cancelled = [], []
for release in (event for event in events if event["name"] == "swipe-release"):
    released = at(release)
    begin = None
    for event in events:
        if at(event) > released:
            break
        if event["name"] == "swipe-begin":
            begin = event
    if release.get("commit") == "none":
        cancelled.append(release)
        continue
    direction = release["commit"]
    began = at(begin) if begin else released
    settled = first("swipe-settled", released, before=released + 3000)
    taken_over = first("swipe-taken-over", released, before=released + 3000)
    landed = min((at(event) for event in (settled, taken_over) if event), default=None)
    commit = first("swipe-commit-js", released, before=released + 3000)
    commit_done = first("swipe-commit-js-done", at(commit)) if commit else None
    # "At rest": the UI thread has the new climb in the middle and the offset back at 0.
    reset_ui = first("swipe-reset-ui", landed, before=landed + 3000) if landed is not None else None
    caught_up = first("swipe-js-caught-up", released, before=released + 3000) or reset_ui
    resting = carousel_before(began)
    target = (resting or {}).get("next" if direction == "next" else "previous", "")
    mounted_at_begin = boards_at(began)
    ready = ready_after(began, target) if target else None
    play_paint = first("overlay-painted", at(commit), before=at(commit) + 3000, surface="play", frames=target) if commit and target else None
    incoming_paint = first("overlay-painted", began, surface="full", frames=target) if target else None
    window_end = at(reset_ui) if reset_ui else released + 1500
    incoming_in_window = incoming_paint is not None and at(incoming_paint) <= window_end + 400
    if mounted_at_begin.get(target):
        incoming_source = "already up"
    elif incoming_in_window:
        incoming_source = str(incoming_paint.get("cacheType"))
    else:
        incoming_source = "never painted"
    swipes.append({
        "phase": phase_of(released),
        "direction": direction,
        "began": began,
        "released": released,
        "finger": released - began,
        "took_over": bool(begin and begin.get("tookOver")),
        "fling": landed - released if landed is not None else None,
        "js_lag": at(commit) - released if commit else None,
        "commit_js": at(commit_done) - at(commit) if commit_done else None,
        "rest": at(reset_ui) - released if reset_ui else None,
        "caught_up": at(caught_up) - released if caught_up else None,
        "not_mounted": target not in mounted_at_begin,
        "bare": None if ready is None else ready - began,
        "never_ready": ready is None or (reset_ui is not None and ready > at(reset_ui)),
        "bare_at_release": ready is None or ready > released,
        "bare_at_settle": ready is None or (landed is not None and ready > landed),
        "peek_cache": incoming_source,
        "peek_index_hit": incoming_paint.get("indexHit") if incoming_in_window else None,
        "uncovered": at(play_paint) - at(reset_ui) if play_paint and reset_ui else None,
        "play_cache": (play_paint or {}).get("cacheType"),
        "drawer_renders": sum(1 for event in events if event["name"] == "render" and event.get("c") == "PlayDrawer"
                              and began <= at(event) <= max(window_end, at(caught_up) if caught_up else 0) + 100),
    })

# A swipe that would have changed the climb and did nothing. Two ways: finger-up while the
# carousel ignored touches (`swipe-dropped`), or the page that way was not mounted yet
# because the JS thread was still behind (`swipe-blocked` with jsBehind).
dropped = [event for event in events if (event["name"] == "swipe-dropped" and event.get("wouldCommit") != "none")
           or (event["name"] == "swipe-blocked" and event.get("jsBehind"))]
ui_sessions = [event for event in events if event["name"] == "ui-frames"]


# How far the incoming board travels to reach the middle, in points. The carousel reports it;
# 358 is the Kilter 12x12 on an iPhone 13 Pro, for runs recorded before it did.
slide_width = next((event["slide"] for event in events if event["name"] == "carousel-render" and event.get("slide")), 358)


def board_moving(value):
    """Whether a board is in motion on screen with the swipe's offset at `value`.

    Between 0 and the board's own width, yes: the outgoing board is leaving and the
    incoming one is arriving. At 0 the carousel is at rest. Past the board's width the
    incoming board has stopped in the middle and the outgoing one is off the board's
    area, so the picture is still while the fling finishes.
    """
    return 0 < abs(value) < slide_width


def frame_stats(sessions):
    intervals, missed_moving, missed_resting = [], 0, 0
    for session in sessions:
        own = [float(value) for value in session.get("intervals", "").split(",") if value]
        if not own:
            continue
        intervals += own
        nominal = statistics.median(own)
        values = [float(value) for value in session.get("values", "").split(",") if value]
        for index, interval in enumerate(own):
            missed = max(0, round(interval / nominal) - 1)
            if not missed:
                continue
            # Interval `index` runs from sample `index` to sample `index + 1`, the frame that came late.
            ends = values[index:index + 2]
            if session.get("label") == "swipe" and any(board_moving(value) for value in ends):
                missed_moving += missed
            else:
                missed_resting += missed
    if not intervals:
        return None
    nominal = statistics.median(intervals)
    late = [interval for interval in intervals if interval > nominal * 1.5]
    return {"frames": len(intervals), "nominal": nominal, "missed": missed_moving + missed_resting,
            "missedMoving": missed_moving, "missedResting": missed_resting, "late": len(late), "worst": max(intervals)}


def print_frames(title, sessions):
    stats = frame_stats(sessions)
    if not stats:
        return
    where = (f" ({stats['missedMoving']} while a board was moving, {stats['missedResting']} with the picture still)"
             if stats["missed"] and any(session.get("label") == "swipe" for session in sessions) else "")
    print(f"   {title}: {stats['frames']} frame callbacks at {stats['nominal']:.1f} ms ({1000 / stats['nominal']:.0f} Hz), "
          f"{stats['missed']} missed{where}, worst {stats['worst']:.0f} ms")


print(f"== {label}: {len(swipes)} swipes changed the climb, {len(cancelled)} sprang back, {len(dropped)} dropped")
try:
    conditions = json.load(open(run + "/conditions.json"))
    temperatures = [conditions[when].get("batteryCelsius") for when in ("before", "after")]
    print(f"   battery {temperatures[0]} C before, {temperatures[1]} C after" + ("  <-- HOT: expect 60 Hz and a slow CPU" if max(value or 0 for value in temperatures) >= 45 else ""))
except FileNotFoundError:
    pass
queue_sizes = sorted({event.get("queue") for event in events if event["name"] == "swipe-reset-js"} - {None})
limited = next((event for event in events if event["name"] == "queue-limited"), None)
print(f"   queue length at each hand-off: {queue_sizes}" + (f" (cut down from {limited['from']} for this launch)" if limited else ""))

phases = []
for swipe in swipes:
    if swipe["phase"] not in phases:
        phases.append(swipe["phase"])
summary = {"swipes": swipes, "phases": {}}
for phase in phases:
    group = [swipe for swipe in swipes if swipe["phase"] == phase]
    start = next((mark["wall"] for mark in marks if mark["event"] == f"{phase}-start"), None)
    end = next((mark["wall"] for mark in marks if mark["event"] == f"{phase}-end"), None)
    in_phase = lambda event: start is not None and end is not None and start <= at(event) <= end + 1500
    phase_dropped = [event for event in dropped if in_phase(event)]
    bare = [swipe for swipe in group if swipe["bare"] is None or swipe["bare"] > 0]
    print(f"-- {phase}: {len(group)} swipes")
    gaps = sorted(round(later["began"] - earlier["released"]) for earlier, later in zip(group, group[1:]))
    if gaps:
        print(f"   finger-up to the next swipe starting: {describe(gaps, ' ms')}")
    print(f"   bare board: {len(bare)} of {len(group)} swipes; bare for {describe([swipe['bare'] for swipe in bare], ' ms')}")
    print(f"      holds still missing at finger-up: {sum(swipe['bare_at_release'] for swipe in group)}, "
          f"at settle: {sum(swipe['bare_at_settle'] for swipe in group)}, never before the hand-off: {sum(swipe['never_ready'] for swipe in group)}")
    caches = {}
    for swipe in group:
        key = swipe["peek_cache"] if swipe["peek_index_hit"] is not False else f"{swipe['peek_cache']}, had to render"
        caches[key] = caches.get(key, 0) + 1
    print(f"      where the incoming holds came from: {caches}")
    print(f"   no board held the incoming climb at the start: {sum(swipe['not_mounted'] for swipe in group)} of {len(group)}")
    print(f"   fling {describe([swipe['fling'] for swipe in group], ' ms')}; took over the last fling: {sum(swipe['took_over'] for swipe in group)}")
    print(f"   at rest after finger-up {describe([swipe['rest'] for swipe in group], ' ms')}")
    print(f"   JS caught up after finger-up {describe([swipe['caught_up'] for swipe in group], ' ms')}; it started {describe([swipe['js_lag'] for swipe in group], ' ms')} after finger-up and took {describe([swipe['commit_js'] for swipe in group], ' ms')} to ask for the climb")
    print(f"   uncovered before its holds {describe([swipe['uncovered'] for swipe in group], ' ms')}; middle board holds from {sorted({str(swipe['play_cache']) for swipe in group})}")
    print(f"   whole-drawer renders per swipe {describe([swipe['drawer_renders'] for swipe in group])}")
    print(f"   dropped: {len(phase_dropped)}")
    phase_sessions = [session for session in ui_sessions if session.get("label") == "swipe" and in_phase({"wallMs": session["startedWallMs"], "name": ""})]
    print_frames("UI frames", phase_sessions)
    stalls = [event["gapMs"] for event in events if event["name"] == "js-frame-gap" and in_phase(event)]
    summary["phases"][str(phase)] = {"dropped": len(phase_dropped), "frames": frame_stats(phase_sessions), "jsStallMs": sum(stalls)}
    print(f"   JS stalls of 34 ms or more: {len(stalls)}, total {sum(stalls)} ms" + (f", worst {max(stalls)} ms" if stalls else ""))
    if each:
        for swipe in group:
            print(f"      {swipe['direction']:8} finger {round(swipe['finger'])} fling {swipe['fling']} rest {swipe['rest']} caught-up {swipe['caught_up']} "
                  f"bare {swipe['bare']} incoming {swipe['peek_cache']} uncovered {swipe['uncovered']} renders {swipe['drawer_renders']}"
                  + (" took-over" if swipe["took_over"] else ""))

renders = [event for event in events if event["name"] == "overlay-render"]
if renders:
    by_surface = {}
    for event in renders:
        by_surface.setdefault(event.get("surface"), []).append(event)
    for surface, group in by_surface.items():
        print(f"   native renders [{surface}]: {len(group)}, native {describe([event['nativeMs'] for event in group], ' ms')}, queued {describe([event['queueMs'] for event in group], ' ms')}")

# The same numbers for a script to add up across runs.
summary["frames"] = frame_stats([session for session in ui_sessions if session.get("label") == "swipe"])
json.dump(summary, open(run + "/swipe-summary.json", "w"), indent=1)

# --- The pull-down close -------------------------------------------------------
releases = [event for event in events if event["name"] == "dismiss-release" and event.get("translateY", 0) > 0]
if releases:
    print(f"== {label}: pull-down close, {len(releases)} releases")
groups = {}
for release in releases:
    released = at(release)
    kind = phase_group(phase_of(released))
    session = None
    for candidate in ui_sessions:
        if candidate.get("label") != "dismiss":
            continue
        if candidate["startedWallMs"] <= released:
            session = candidate
    values = [float(value) for value in (session or {}).get("values", "").split(",") if value]
    intervals = [float(value) for value in (session or {}).get("intervals", "").split(",") if value]
    frame = release.get("uiFrame", -1)
    after_values = values[frame:] if 0 <= frame < len(values) else []
    after_intervals = intervals[max(0, frame - 1):] if 0 <= frame <= len(intervals) else []
    nominal = statistics.median(intervals) if intervals else None
    # A plateau: consecutive frames after finger-up in which the surface did not move, before it got where it was going.
    plateau, run_length = 0, 0
    destination = release.get("height", 0) if release.get("committed") else 0
    for previous, value in zip(after_values, after_values[1:]):
        # The last few pixels of a spring move less than a pixel a frame; that is its tail, not a stall.
        arriving = abs(value - destination) < 12
        if abs(value - previous) < 0.5 and not arriving:
            run_length += 1
            plateau = max(plateau, run_length)
        else:
            run_length = 0
    settled = first("dismiss-settled", released, before=released + 3000) if release.get("committed") else None
    complete = first("dismiss-complete-js", at(settled), before=at(settled) + 3000) if settled else None
    route = first("dismiss-route-dismiss-js", at(complete), before=at(complete) + 3000) if complete else None
    unmounted = first("play-route-unmounted", at(route), before=at(route) + 5000) if route else None
    home = None
    if not release.get("committed") and after_values and nominal:
        steps = next((index for index, value in enumerate(after_values) if value == 0), None)
        home = None if steps is None else sum(after_intervals[:steps])
    groups.setdefault(kind, []).append({
        "committed": release.get("committed"),
        "at": release.get("translateY"),
        "velocity": release.get("velocityY"),
        "settle": at(settled) - released if settled else None,
        "home": home,
        "js": at(complete) - at(settled) if complete else None,
        "remove": at(unmounted) - at(settled) if unmounted else None,
        "missed": sum(max(0, round(interval / nominal) - 1) for interval in after_intervals) if nominal else None,
        "frames": len(after_intervals),
        "worst": max(after_intervals) if after_intervals else None,
        "nominal": nominal,
        "plateau": plateau,
    })
for kind, group in groups.items():
    closed = sum(1 for item in group if item["committed"])
    print(f"-- {kind}: {len(group)} releases, {closed} closed; let go at {describe([item['at'] for item in group], ' px')}, moving {describe([item['velocity'] for item in group], ' px/s')}")
    if closed:
        print(f"   finger-up to off screen {describe([item['settle'] for item in group], ' ms')}; then the JS thread hears {describe([item['js'] for item in group], ' ms')}, route gone {describe([item['remove'] for item in group], ' ms')}")
    else:
        print(f"   finger-up to back in place {describe([item['home'] for item in group], ' ms')}")
    nominals = [item["nominal"] for item in group if item["nominal"]]
    if nominals:
        print(f"   UI frames after finger-up: {sum(item['frames'] for item in group)} at {statistics.median(nominals):.1f} ms, "
              f"missed {sum(item['missed'] or 0 for item in group)}, worst interval {max(item['worst'] or 0 for item in group):.0f} ms, "
              f"longest stand-still {max(item['plateau'] for item in group)} frames")

# --- Opening the drawer --------------------------------------------------------
# From the play route mounting, not from the tap: the queue bar has no probe. Compare
# builds with it; for the tap-to-holds number use scenario_list_and_drawer.py.
opens = []
for mounted_event in (event for event in events if event["name"] == "play-route-mounted"):
    opened = at(mounted_event)
    measured = first("play-board-measured", opened, before=opened + 3000)
    painted = first("overlay-painted", opened, before=opened + 3000, surface="play")
    neighbours = [event for event in events if event["name"] == "overlay-painted" and event.get("surface") == "full"
                  and opened <= at(event) <= opened + 3000]
    opens.append({
        "measured": at(measured) - opened if measured else None,
        "painted": at(painted) - opened if painted else None,
        "cache": (painted or {}).get("cacheType"),
        "neighbours": max((at(event) - opened for event in neighbours), default=None),
    })
if opens:
    sources = {}
    for item in opens:
        sources[str(item["cache"])] = sources.get(str(item["cache"]), 0) + 1
    print(f"== {label}: the drawer opened {len(opens)} times")
    print(f"   route mounted to board measured {describe([item['measured'] for item in opens], ' ms')}")
    print(f"   route mounted to the board's holds painted {describe([item['painted'] for item in opens], ' ms')}; holds from {sources}")
    print(f"   route mounted to the last neighbour's holds painted {describe([item['neighbours'] for item in opens], ' ms')}")

stalls = [event["gapMs"] for event in events if event["name"] == "js-frame-gap"]
print(f"== whole run: JS stalls of 34 ms or more: {len(stalls)}, total {sum(stalls)} ms")
print_frames("all swipe UI frames", [session for session in ui_sessions if session.get("label") == "swipe"])
print_frames("all close UI frames", [session for session in ui_sessions if session.get("label") == "dismiss"])
