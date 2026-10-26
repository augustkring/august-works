#!/bin/bash
source /workspace/v10-preparation/env.sh
export PATH=/workspace/v10-preparation/pinned-bin:$PATH
exec 9>/workspace/v10-preparation/v10-pg-tests.lock
flock 9
stem=/workspace/v10-preparation/current-integrated-types-r21-20261026
python3 /workspace/v10-preparation/snapshot-current-source-for-dependency-check.py "$stem-source-pins.json" > "$stem-snapshot.log" 2>&1 || exit 1
result=0
for package in server packages/adapter-utils packages/paperclip-runner; do
 name=${package##*/}
 (cd "/workspace/v10-dep-qualification/$package" && node node_modules/typescript/bin/tsc --noEmit --singleThreaded) > "$stem-$name.log" 2>&1
 code=$?
 echo "$code" > "$stem-$name.exit"
 if [ "$code" != 0 ]; then result=1; fi
done
echo "$result" > "$stem.exit"
exit "$result"
