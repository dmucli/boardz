# Boardz

A lean iPhone app for LED climbing boards, built on Boardsesh's shared packages and its hosted backend (`ws.boardsesh.com`). Five tabs: Home, Session, Workout, Rankings, Profile. No social features.

Boardz never edits `packages/mobile` or `packages/shared/*`. That keeps merges from upstream Boardsesh clean.

## What's in it

- **Home**: set up your board (from your Boardsesh account, or by picking the layout, size, hold sets and angle), connect to it over Bluetooth, and start a session. Your Favourites and Projects lists sit underneath.
- **Session**: drag the two thumbs on the grade scale to pick a range (a thumb at either end leaves that end open), toggle benchmarks, and tap the magnifying glass to search climb names and setters. The list header counts the climbs your filters leave. Easiest and Hardest first only list climbs someone has repeated, since the rest are mostly ungraded.
- **Climbing**: a climb fills the screen and nothing on it scrolls, so the board stays put while you swipe left or right through the list. The top bar holds the board light (tap to light the climb or switch it off), beta videos, lists, the favourite heart and Log.
- **Lists**: the heart on a climb adds it to Favourites; the list button saves it to Projects or a list of your own. Lists are kept on the phone and don't sync with boardsesh.com.
- **Workout**: nine plans. Warm-up, pyramid, ladder, volume and grade focus pick climbs by grade. On the minute, 4x4 and limit bouldering run on a timer. Free climbing is just a clock. Boardz picks the climbs, lets you swap any of them, lights each one in turn, counts down rests with beeps and logs what you do.
- **Rankings**: who has sent the most on a wall, this week, month, year or all time. Boardsesh ranks sends per wall, so the chips at the top offer your walls first, then public walls (gyms' and climbers' shared ones) with the same setup. Most walls have only a few sends logged.
- **Profile**: one page with your totals and where you rank among Boardsesh climbers, hardest send and flash, the past month compared with the month before, an activity calendar, a grade chart and your recent climbing days. Your full logbook and settings are one tap away.

Boards, in the order they were built for: MoonBoard, Tension, Kilter. Decoy, Grasshopper, So iLL, Touchstone and Woods work too, from the same Boardsesh catalogue. Spray walls don't: they're private walls on the account that made them.

### Design

Boardz follows the Graphite design system in `designsystem/`: ink, paper and hairlines, with LED light and the seven grade bands as the only colour. Start with `designsystem/readme.md`.

- Tokens live in `src/ui/theme.ts` (colours, grade bands, hold LEDs) and `src/ui/tokens.ts` (spacing, radii). Type roles are in `src/ui/Text.tsx`.
- Fonts are Geist and Geist Mono (`@expo-google-fonts`), loaded at launch. Icons are Lucide (`lucide-react-native`), imported one by one in `src/ui/icons.ts`.
- `designsystem/` is the design hand-off, kept exactly as exported, so lint and format skip it.
- Two departures from it: the main button on a screen is LED blue (`primary` in `theme.ts`) instead of ink, and grade tags are filled with their band colour instead of outlined.
- MoonBoard and Woods holds are drawn on white in light mode and black in dark mode, or on MoonBoard yellow if you pick it in Settings (`boardBackdrop` in `theme.ts`).
- The app icon is a problem on the board: start, hand and finish holds lit in green, blue and red. It's an Icon Composer document, `assets/AppIcon.icon`, so iOS 26 draws the holds in Liquid Glass and makes the dark, tinted and clear versions. Edit it with Icon Composer, which comes with Xcode (Xcode → Open Developer Tool).
- Sheets use `src/ui/Sheet.tsx`. It works around react-native-screens resizing a sheet's scroll view on iOS 26, which drew the title over the first fields; its comment explains how.

### Limits

- Sign in with email and password only. If your Boardsesh account uses Apple or Google sign-in, set a password on boardsesh.com first. Boardsesh's server only accepts Apple sign-in from its own app.
- You need a connection. Climbs, beta videos, rankings and your logbook come from `ws.boardsesh.com`, and there's no offline mode.
- Lists live on the phone. Deleting the app deletes them.
- Bluetooth has only been reviewed in code, not tested on a real board. Check it on your wall first. Woods boards take acknowledged 20-byte writes over Nordic UART, following Boardsesh's own Woods support.

## Put it on your iPhone

One-time setup:

1. Install Xcode from the Mac App Store. Open it once, then sign in with your Apple ID under Xcode → Settings → Accounts.
2. Install CocoaPods: `brew install cocoapods`.
3. Install the toolchain and dependencies from the repo root:
   ```bash
   curl -fsSL https://vite.plus | bash
   vp install
   ```
4. Create `packages/boardz/.env.local` with a bundle id of your own (it's gitignored):
   ```bash
   BOARDZ_IOS_BUNDLE_ID=com.yourname.boardz
   # Optional. Without it, Expo asks you to pick a signing team.
   BOARDZ_APPLE_TEAM_ID=ABCDE12345
   ```
5. On the iPhone, turn on Settings → Privacy & Security → Developer Mode, then plug it into the Mac.
6. Build and install. The first build takes 10–20 minutes:
   ```bash
   vp run ios:boardz:release   # Boardz, for climbing
   vp run ios:boardz           # Boardz Dev, for working on the code
   ```
   If the device picker doesn't appear, run `vp exec expo run:ios --device` (add `--configuration Release` for Boardz) from `packages/boardz` instead.

The two builds install as two apps, side by side:

| App | Build | Code | Use it for |
| --- | --- | --- | --- |
| **Boardz** | `vp run ios:boardz:release` | Built into the app | Climbing. It works anywhere, with no Mac nearby, and runs faster. A code change needs a new build. |
| **Boardz Dev** | `vp run ios:boardz` | Loaded from the dev server on your Mac | Working on the code. Start the server with `vp run dev:boardz`; changes appear on the phone as you save. Without the Mac on the same Wi-Fi it can't start. |

Boardz Dev has its own bundle id (yours plus `.dev`, set up by `plugins/with-dev-app.js`), so it keeps its own sign-in, board and lists. In Xcode, the scheme's build configuration picks the app: Debug builds Boardz Dev, Release builds Boardz.

With a free Apple ID both apps stop opening after 7 days. Build them again to reinstall. A paid developer account ($99/year) removes the limit and adds TestFlight.

### If the build fails

- **"UIScene life cycle is required for apps built with this SDK"**: Xcode 27 won't launch an app that doesn't use scenes, and Expo 57's template doesn't yet. `plugins/with-scene-lifecycle.js` adds a scene delegate. If you see this error, the `ios/` folder predates the plugin. Regenerate it with `vp exec expo prebuild --platform ios` from `packages/boardz`.
- **"plugin for module 'ExpoModulesMacros' not found"** after regenerating `ios/`: Xcode is building with stale settings. Run Product → Clean Build Folder (⇧⌘K) and build again.
- **Sign-in doesn't survive a restart in the simulator**: a build with no signing team can't use the keychain. Pick your team under Signing & Capabilities once, and put it in `.env.local` so it survives a regenerated `ios/`.
- **Changes to `app.config.ts` or `plugins/` don't show up**: they only reach the app when `ios/` is regenerated. Run `vp exec expo prebuild --platform ios` from `packages/boardz`. It rebuilds `ios/` from scratch, so anything set by hand in Xcode is lost; keep your team id in `.env.local`.

## Checks

```bash
vp run typecheck:boardz
vp run test:boardz
vp check packages/boardz
```

`test:boardz` also checks every GraphQL query Boardz sends against Boardsesh's current schema, so a backend change shows up as a failing test rather than a broken screen.

## Merging upstream Boardsesh

`git fetch upstream && git merge upstream/main`. The usual conflict is `pnpm-lock.yaml`: take upstream's copy with `git checkout --theirs pnpm-lock.yaml`, then run `vp install` to add Boardz back. Finish with `vp run typecheck:boardz` and `vp run test:boardz`. Between them they catch any shared-package API or backend query that changed.
