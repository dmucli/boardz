# Boardz App Store listing

Everything App Store Connect asks for, ready to paste. Field limits are in brackets.

## App Information (left column → General → App Information)

- **Name** [30]: the name you created the app with, for example `Boardz: Board Climbing`
- **Subtitle** [30]: `A simpler app for LED boards`
- **Category**: Primary **Health & Fitness**, secondary **Sports**
- **Content Rights**: "Does your app contain, show, or access third-party content?" **Yes.** Boardz shows climbs, rankings and beta video links from Boardsesh. Only confirm "I have the necessary rights" once Boardsesh has agreed (see "Before you submit" at the end).
- **Age Rating**: answer **None** or **No** to every question. Boardz has no in-app web browser, no chat, no gambling and nothing users can post. The rating comes out as **4+**.

## Pricing and Availability

- **Price**: Free
- **Availability**: all countries, or pick yours

## App Privacy (left column → App Privacy)

- **Privacy Policy URL**: `https://github.com/dmucli/boardz/blob/main/packages/boardz/PRIVACY.md`
- "Do you or your third-party partners collect data from this app?" **Yes.** Boardsesh receives your sign-in and logbook. Declare these types:

| Data type | Used for | Linked to the user | Used for tracking |
| --- | --- | --- | --- |
| Contact Info → Email Address | App Functionality | Yes | No |
| Identifiers → User ID | App Functionality | Yes | No |
| Health & Fitness → Fitness (logged climbs) | App Functionality | Yes | No |
| User Content → Other User Content (ratings and notes on climbs) | App Functionality | Yes | No |

Nothing else: no location, no contacts, no usage data, no diagnostics, no ads, no tracking.

## Version 1.0 (left column → iOS App → 1.0 Prepare for Submission)

### Promotional Text [170]

```
Pick a grade range, tap a problem and it lights up on your wall. Log your send, swipe to the next one, or let one of nine board workouts pick your climbs.
```

### Description [4000]

```
Boardz is a simpler app for LED climbing boards. It does what you need under the wall and leaves out the rest: there's no feed, no followers and no party mode.

Pick a grade range, tap a problem and it lights up on your board. Swipe to the next one. Log a flash, a send or your attempts in one tap.

FIND PROBLEMS
• Drag a grade range and see how many climbs fit
• Show only benchmarks, or only climbs you haven't sent
• Search by climb name or setter
• Colour-coded grades, in Font or V grades

CLIMB
• The board fills the screen while you climb
• Tap the bulb to light the problem over Bluetooth
• Beta videos for each climb, with the ones filmed at your angle first

TRAIN
• Nine workouts: warm-up, pyramid, ladder, volume, grade focus, on the minute, 4x4, limit bouldering and free climbing
• Boardz picks well-rated climbs with more than 50 ascents, lights each one in turn and times your rests

KEEP TRACK
• Favourites, Projects and lists of your own
• A profile with your totals, hardest sends, grade pyramid and climbing calendar
• Rankings for your wall

WORKS WITH
MoonBoard, Tension, Kilter, Decoy, Grasshopper, So iLL, Touchstone and Woods boards.

Boardz signs in with your Boardsesh account (email and password). Your logbook is your Boardsesh logbook, so it matches boardsesh.com.

Boardz is an independent, open-source app built on Boardsesh. It isn't made or endorsed by Boardsesh, Aurora Climbing, Moon Climbing or any board maker.
```

### Keywords [100]

```
bouldering,climbing,training,LED,boulder,workout,logbook,4x4,pyramid,grades,climb,benchmarks,wall
```

Board brand names are left out on purpose: Apple rejects other companies' trademarks in keywords.

### URLs

- **Support URL**: `https://github.com/dmucli/boardz/issues`
- **Marketing URL**: `https://github.com/dmucli/boardz`

### Other fields

- **Version**: `1.0`
- **Copyright**: `2026 David Mucelli`
- **Build**: pick the 1.0.0 build once it has processed
- **App Store version release**: "Manually release this version", so you choose the day

### Screenshots

Upload the files in `store/screenshots/` under **iPhone 6.9" Display**, in their numbered order. App Store Connect makes the smaller iPhone sizes from them. Boardz is iPhone-only, so no iPad screenshots are needed.

### App Review Information

- **Sign-in required**: yes. Make a Boardsesh account just for Apple's reviewer on boardsesh.com, with an email and password, and enter it here. Don't use your own.
- **Contact**: your name, phone and email
- **Notes**:

```
Boardz controls LED climbing boards (MoonBoard, Kilter, Tension and others) over Bluetooth. Without a board you can still use everything else: pick a grade range in Session, open a climb, watch beta videos, run a workout and log a climb with the demo account.

Bluetooth is only used to light holds on the board. The app never records audio: the microphone permission comes from the audio library used for workout beeps.

Accounts are Boardsesh accounts (boardsesh.com). Settings → Delete account opens Boardsesh's account settings, where the account can be deleted.
```

## Before you submit

Apple's guideline 5.2.2 says an app that uses a third-party service must be "specifically permitted to do so under the service's terms of use", and App Review can ask for proof. Boardz signs in with Boardsesh accounts and shows Boardsesh's climbs, and Boardsesh publishes no terms that allow other apps to use its servers. Ask the Boardsesh maintainers first (github.com/boardsesh/boardsesh), and keep their reply. If App Review asks, that reply is your answer, and it's also what lets you tick "I have the necessary rights" above.
