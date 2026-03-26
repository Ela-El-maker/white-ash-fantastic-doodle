# Video Pipeline Service

A realistic local video processing backend that accepts MP4 uploads, validates them, stores them, extracts metadata with `ffprobe`, transcodes them with `ffmpeg`, generates a thumbnail, and exposes production-like playback URLs.

## Stack

- Node.js + TypeScript
- Fastify
- `@fastify/multipart` for multipart uploads
- `@fastify/static` for direct asset playback URLs
- Native `ffmpeg` / `ffprobe` (env override first, bundled static fallback)
- Local filesystem storage
- Disk-backed JSON asset repository
- In-process async queue

## API Contract

### `POST /video/upload`
Multipart form upload with field `file`.

Response:

```json
{
  "assetId": "string",
  "status": "queued"
}
```

### `GET /video/:assetId`

```json
{
  "id": "string",
  "status": "queued | uploading | processing | ready | failed",
  "progress": 100,
  "playbackUrl": "http://localhost:4000/assets/{id}/video.mp4",
  "thumbnailUrl": "http://localhost:4000/assets/{id}/thumb.jpg",
  "duration": 2.02,
  "renditions": [
    {
      "url": "http://localhost:4000/assets/{id}/video.mp4",
      "width": 640,
      "height": 360,
      "bitrate": 192
    }
  ],
  "error": null
}
```

### `DELETE /video/:assetId`
Cancels active processing if needed and removes local files.

## Pipeline Stages

1. Validation
2. Ingestion
3. Metadata extraction
4. Transcoding
5. Thumbnail generation
6. Packaging/finalization
7. Ready state

## Progress Model

- validation: 0-5
- upload: 5-20
- metadata: 20-30
- transcode: 30-80
- thumbnail: 80-90
- finalize: 90-100

State machine:

- `queued -> uploading -> processing -> ready`
- any stage can transition to `failed`

## Run

```bash
npm install
npm run dev
```

Server:

```text
http://localhost:4000
```

## Environment

- `HOST` (default: `0.0.0.0`)
- `PORT` (default: `4000`)
- `BASE_URL` (default: `http://localhost:<PORT>`)
- `DATA_ROOT` (default: `<repo>/data`)
- `FFMPEG_PATH` (optional override path)
- `FFPROBE_PATH` (optional override path)
- `QUEUE_CONCURRENCY` (default: `1`)

If `FFMPEG_PATH` / `FFPROBE_PATH` are not set, the service uses bundled `ffmpeg-static` / `ffprobe-static` binaries.

## Validation Rules

- Upload field must be named `file`
- MIME type must be `video/mp4` (`415` otherwise)
- Max file size is `2MB` (`413` otherwise)
- Empty files are rejected (`400`)

## Smoke Test

Start the server, then run:

```bash
npm run test:smoke
```

The smoke script auto-generates `data/sample-input.mp4` if needed and verifies:

- upload returns `202` + `assetId`
- status reaches `ready`
- `playbackUrl` and `thumbnailUrl` return `200`

## Contract Test

Start the server, then run:

```bash
npm run test:contract
```

This validates:

- happy path upload + poll to `ready`
- invalid MIME (`415`)
- oversize upload (`413`)
- corrupt MP4 transitions to `failed`
- missing file field (`400`)
- delete flow (`204`, then `GET` -> `404`)

## Example cURL

Upload:

```bash
curl -X POST http://localhost:4000/video/upload \
  -F "file=@./data/sample-input.mp4;type=video/mp4"
```

Poll:

```bash
curl http://localhost:4000/video/<assetId>
```

## Storage Layout

```text
data/
  video-assets.json
  assets/
    <assetId>/
      original.mp4
      video.mp4
      thumb.jpg
```