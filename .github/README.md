# Boardz

Boardz is an iPhone app for LED climbing boards, made for training on your own. Pick your board, light a problem, log it, run a workout and see how you're getting on. It works with MoonBoard, Tension, Kilter, Decoy, Grasshopper, So iLL, Touchstone and Woods boards.

Boardz is an independent fork of [Boardsesh](https://github.com/boardsesh/boardsesh). It builds on Boardsesh's open-source board catalogue, Bluetooth encoders and climb search, and it signs in to the Boardsesh service, so your logbook is the same in both apps. It isn't made or endorsed by Boardsesh, Aurora Climbing, Moon Climbing or any board maker.

## Why a fork

Boardsesh is built for climbing together: party sessions, a shared queue, a feed, comments. Boardz keeps what you use alone at your wall and leaves the rest out. It's about 13,000 lines of TypeScript, where Boardsesh's mobile app is about 235,000.

## What's in it

There are five tabs.

- **Home** shows your board and its Bluetooth connection, starts a session, and keeps your Favourites and Projects lists a tap away.
- **Session** lists the board's climbs. Drag a grade range, keep to benchmarks, and search climb names and setters; the header counts what your filters leave.
- **Workout** has nine plans. Warm-up, pyramid, ladder, volume and grade focus pick climbs by grade. On the minute, 4x4 and limit bouldering run on a timer. Free climbing is just a clock.
- **Rankings** shows who has sent the most on a wall: yours, or public walls with the same setup.
- **Profile** has your totals, top grades, grade pyramid, climbing calendar and full logbook.

Open a climb and it fills the screen. The holds glow in your board's own LED colours, and nothing scrolls, so the wall stays put while you swipe left and right through the list. From the top bar you light the climb on your board, watch beta videos, save it to a list or log how it went.

## Status

Boardz is a personal project. It runs on iPhone, it isn't on the App Store, and you build it yourself with Xcode. The Bluetooth code follows Boardsesh's own encoders, but it hasn't been tried on every kind of board yet, so check it on yours.

## Build it

The app lives in [`packages/boardz`](../packages/boardz). Its [README](../packages/boardz/README.md) has the full steps, including signing with a free Apple ID. In short, with Xcode and CocoaPods installed:

```bash
curl -fsSL https://vite.plus | bash   # the vp toolchain Boardsesh uses
vp install
echo "BOARDZ_IOS_BUNDLE_ID=com.yourname.boardz" > packages/boardz/.env.local
vp run ios:boardz                     # builds and installs on your iPhone
```

After that, `vp run dev:boardz` starts the dev server, and code changes load without a rebuild. `vp run typecheck:boardz` and `vp run test:boardz` check your work.

## How this repository is laid out

This is Boardsesh's monorepo with Boardz added. Boardz is entirely in `packages/boardz`. Everything else is Boardsesh as it is upstream, and Boardz doesn't change it apart from a few lint and formatting settings. That way Boardsesh's fixes to the shared packages arrive with a plain merge. The README at the repository root is Boardsesh's own.

In this repository, GitHub Actions is switched off and Boardsesh's Dependabot config, sponsor link and code owners are removed, since they belong to Boardsesh's own project.

## Keeping up with Boardsesh

```bash
git remote add upstream https://github.com/boardsesh/boardsesh.git   # once
git fetch upstream
git merge upstream/main
```

The usual conflict is `pnpm-lock.yaml`: take Boardsesh's copy with `git checkout --theirs pnpm-lock.yaml`, then run `vp install` to add Boardz back. If a merge brings back `.github/dependabot.yml`, `.github/FUNDING.yml` or `.github/CODEOWNERS`, delete them again. Finish with `vp run typecheck:boardz` and `vp run test:boardz`; between them they catch any shared code or backend query that changed.

## Boardsesh's servers

Boardz uses Boardsesh's hosted API at `ws.boardsesh.com` and signs in with Boardsesh accounts, email and password only. That service is run and paid for by the Boardsesh team. If Boardz is useful to you, you can [sponsor Boardsesh](https://github.com/sponsors/boardsesh).

## Licence

Apache License 2.0, the same as Boardsesh: see [LICENSE](../LICENSE). Boardsesh's code belongs to its contributors, and every change made for Boardz is in this repository's history. MoonBoard, Kilter, Tension, Decoy, Grasshopper, So iLL, Touchstone and Woods are their owners' names, used here only to say which boards Boardz works with.
