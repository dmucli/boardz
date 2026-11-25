#!/usr/bin/env python3
"""Compare the phone's offline database version with the one this checkout would migrate it to.

    schema_check.py

Run it before building. If the checkout is ahead, a probe build made from it
would migrate the tester's real database, and their store build would then show
"Offline storage is paused". Hold the build back with a patch script such as
probe/apply_schema_hold.py instead.

It copies the database and its write-ahead log off the phone (about 600 MB for
two Kilter boards, 20 s over a cable), reads one row, and deletes the copy.
Exit status 0 when the versions match, 1 when they differ.
"""
import os, re, shutil, sqlite3, subprocess, sys, tempfile
import ios

root = subprocess.run(["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True).stdout.strip()
migrations = open(os.path.join(root, "packages/shared/offline-sync/src/db/migrations.ts")).read()
checkout_version = max(int(version) for version in re.findall(r"^\s+version: (\d+),$", migrations, re.M))

# Under the home directory on purpose: the copy is large, and /tmp may be a RAM disk.
scratch = tempfile.mkdtemp(prefix="probe-schema-", dir=os.path.expanduser("~/.cache"))
try:
    for name in ("boardsesh.db", "boardsesh.db-wal"):
        subprocess.run(["xcrun", "devicectl", "device", "copy", "from", "--device", ios.udid(), "--domain-type", "appDataContainer",
                        "--domain-identifier", ios.BUNDLE_ID, "--source", f"Documents/SQLite/{name}",
                        "--destination", os.path.join(scratch, name)], check=True, capture_output=True)
    database = sqlite3.connect(os.path.join(scratch, "boardsesh.db"))
    phone_version = database.execute("SELECT version FROM schema_version WHERE id = 1").fetchone()[0]
    indexes = [row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%probe%'")]
    database.close()
finally:
    shutil.rmtree(scratch, ignore_errors=True)

print(f"phone: schema version {phone_version}" + (f", probe-only indexes: {', '.join(indexes)}" if indexes else ""))
print(f"checkout: would migrate to version {checkout_version}")
if phone_version != checkout_version:
    print("They differ. Do not install a build of this checkout without holding its schema back.")
    sys.exit(1)
