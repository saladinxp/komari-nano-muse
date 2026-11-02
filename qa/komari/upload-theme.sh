#!/bin/bash
# Upload a theme zip to the local Komari through the chunked admin API and activate it.
set -e
Z=$1; S=$2; B=http://127.0.0.1:25774
SIZE=$(stat -c %s "$Z"); rm -rf "$S/chunks" && mkdir -p "$S/chunks" && split -b 5242880 -d -a 3 "$Z" "$S/chunks/c"
ID=$(curl -sS -b "$S/cookies.txt" -H 'Content-Type: application/json' -d "{\"purpose\":\"theme\",\"size\":$SIZE,\"filename\":\"$(basename "$Z")\"}" $B/api/admin/upload/init | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['upload_id'])")
i=0; for f in $(ls "$S"/chunks/c* | sort); do curl -sS -o /dev/null -b "$S/cookies.txt" -F upload_id=$ID -F chunk_index=$i -F chunk_data=@$f $B/api/admin/upload/chunk; i=$((i+1)); done
curl -sS -b "$S/cookies.txt" -H 'Content-Type: application/json' -d "{\"upload_id\":\"$ID\"}" $B/api/admin/upload/merge | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['message'], d['data'].get('version'))"
curl -sS -b "$S/cookies.txt" "$B/api/admin/theme/set?theme=NanoMuse" | python3 -c "import json,sys; print(json.load(sys.stdin)['message'])"
