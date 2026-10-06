#!/bin/sh
# Builds Boardz for the App Store and uploads it to TestFlight.
#
#   sh scripts/testflight.sh            build and upload
#   sh scripts/testflight.sh --no-upload  build and save the .ipa in ios/build/testflight/export
#
# Needs Xcode signed in (Settings → Accounts) to a paid developer account on the
# team in .env.local, and an app in App Store Connect with this bundle id.
# Xcode creates the distribution certificate and profile if they're missing, and
# picks the next free build number on upload, so nothing has to be bumped by hand.
set -eu
cd "$(dirname "$0")/.."

destination=upload
if [ "${1:-}" = "--no-upload" ]; then destination=export; fi

if [ ! -d ios/Boardz.xcworkspace ]; then
  echo "No iOS project yet. Run 'vp exec expo prebuild --platform ios' in packages/boardz first." >&2
  exit 1
fi

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
team=$(sed -n 's/^BOARDZ_APPLE_TEAM_ID=//p' .env.local 2>/dev/null | head -n 1)
out=ios/build/testflight
rm -rf "$out"
mkdir -p "$out"

cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$destination</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><true/>
  <key>uploadSymbols</key><true/>
  ${team:+<key>teamID</key><string>$team</string>}
</dict>
</plist>
PLIST

xcodebuild -workspace ios/Boardz.xcworkspace -scheme Boardz -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$out/Boardz.xcarchive" \
  -allowProvisioningUpdates archive

xcodebuild -exportArchive -archivePath "$out/Boardz.xcarchive" \
  -exportOptionsPlist "$out/ExportOptions.plist" -exportPath "$out/export" \
  -allowProvisioningUpdates

if [ "$destination" = upload ]; then
  echo "Uploaded. It shows in App Store Connect → TestFlight once Apple has processed it, usually within 30 minutes."
else
  echo "Built $out/export/Boardz.ipa (not uploaded)."
fi
