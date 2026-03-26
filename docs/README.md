# Video Pipeline Notes

This service is a local backend-only video processing pipeline.

Primary docs live in the root [README](../README.md).

Quick links:

- Upload endpoint: `POST /video/upload`
- Poll endpoint: `GET /video/:assetId`
- Delete endpoint: `DELETE /video/:assetId`
- Smoke test: `npm run test:smoke`
- Contract test: `npm run test:contract`

# STEPS

1. Open terminal in project:
```bash
cd /home/ela/Work-Force/Web-App/white-ash
```

2. Install deps (once):
```bash
npm install
```

3. Start server (leave this terminal running):
```bash
npm run dev
```

4. In a second terminal, confirm service is up:
```bash
curl -s http://127.0.0.1:4000/health
```

## If you want to test `video-2.MP4` (54MB), increase upload limit first

5. Update limit in [config.ts](/home/ela/Work-Force/Web-App/white-ash/src/config.ts):
```bash
perl -0pi -e 's/maxUploadBytes:\s*2 \* 1024 \* 1024,/maxUploadBytes: 60 * 1024 * 1024,/' src/config.ts
```

6. Restart server (Ctrl+C in server terminal, then):
```bash
npm run dev
```

## Upload + verify pipeline

7. Upload file:
```bash
curl -s -X POST http://127.0.0.1:4000/video/upload \
  -F "file=@/home/ela/Work-Force/Web-App/white-ash/assets/video-2.MP4;type=video/mp4"
```

8. Copy `assetId` from response, then poll:
```bash
ASSET_ID="PUT_ASSET_ID_HERE"

while true; do
  R=$(curl -s "http://127.0.0.1:4000/video/$ASSET_ID")
  echo "$R"
  S=$(echo "$R" | jq -r '.status')
  if [ "$S" = "ready" ] || [ "$S" = "failed" ]; then
    break
  fi
  sleep 1
done
```

9. If status is `ready`, verify URLs return `200`:
```bash
PLAYBACK_URL=$(curl -s "http://127.0.0.1:4000/video/$ASSET_ID" | jq -r '.playbackUrl')
THUMB_URL=$(curl -s "http://127.0.0.1:4000/video/$ASSET_ID" | jq -r '.thumbnailUrl')

curl -I "$PLAYBACK_URL"
curl -I "$THUMB_URL"
```

10. Verify actual transcoded output codec/resolution:
```bash
ffprobe -v error \
  -show_entries stream=codec_type,codec_name,width,height \
  -show_entries format=duration \
  -of json "data/assets/$ASSET_ID/video.mp4"
```

Expected:
- video codec: `h264`
- audio codec: `aac`
- height: `<= 480`
- duration present

11. Optional cleanup:
```bash
curl -i -X DELETE "http://127.0.0.1:4000/video/$ASSET_ID"
curl -i "http://127.0.0.1:4000/video/$ASSET_ID"   # should be 404
```
