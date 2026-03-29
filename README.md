# Asset Pipeline Service

A local asset processing backend that supports multiple asset classes through one upload entrypoint:

- video: async media pipeline (ffprobe + ffmpeg + thumbnail)
- image: lightweight metadata + thumbnail pipeline
- pdf: previewable document pipeline with inline and download URLs
- docx/xlsx/zip/supplementary files: storage + metadata + download pipeline

## Stack

- Node.js + TypeScript
- Fastify
- `@fastify/multipart` for multipart uploads
- `@fastify/static` for direct asset playback URLs
- Native `ffmpeg` / `ffprobe` (env override first, bundled static fallback)
- `sharp` for image metadata and true thumbnail rendering
- `pdfjs-dist` + `@napi-rs/canvas` for PDF page parsing and rendered preview thumbnails
- `jszip` for DOCX/XLSX internal package validation
- Local filesystem storage
- Disk-backed JSON asset repository
- In-process async queue

## API Contract

### `POST /assets/upload`

Multipart form upload with field `file`.

Response:

```json
{
  "assetId": "string",
  "kind": "video | image | pdf | document | spreadsheet | archive | supplementary",
  "status": "queued"
}
```

### `GET /assets/:assetId`

```json
{
  "id": "string",
  "kind": "video | image | pdf | document | spreadsheet | archive | supplementary",
  "status": "queued | uploading | processing | ready | failed",
  "progress": 0,
  "originalName": "lesson.mp4",
  "mimeType": "video/mp4",
  "sizeBytes": 123456,
  "originalUrl": "http://localhost:4000/assets/{id}/video.mp4",
  "previewUrl": "http://localhost:4000/assets/{id}/video.mp4",
  "thumbnailUrl": "http://localhost:4000/assets/{id}/thumb.jpg",
  "downloadUrl": "http://localhost:4000/assets/{id}/download",
  "width": 640,
  "height": 360,
  "durationSeconds": 2.02,
  "pageCount": null,
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

### `GET /assets/:assetId/download`

Returns the processed or original file with `Content-Disposition: attachment`.

### `GET /assets/:assetId/inline`

For PDF assets, returns an inline preview response with `Content-Disposition: inline`.

### `DELETE /assets/:assetId`

Cancels active processing if needed and removes local files.

## Backward Compatibility

Legacy video endpoints remain available:

- `POST /video/upload` (video-only guard)
- `GET /video/:assetId` (legacy response shape with `playbackUrl`)
- `DELETE /video/:assetId`

## Pipeline Stages

1. Validation
2. Ingestion
3. Kind-specific processing
4. Packaging/finalization
5. Ready state

Kind-specific processing:

- video: ffprobe metadata, H.264/AAC transcode, thumbnail
- image: image metadata extraction + rendered JPEG thumbnail
- pdf: page count extraction + rendered first-page thumbnail + inline preview URL
- document/spreadsheet/archive/supplementary: storage finalization

## Progress Model

- validation: 0-5
- upload: 5-20
- processing: 20-90
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
- Extension + MIME + file signature checks are combined for classification
- DOCX/XLSX uploads must contain expected OpenXML ZIP entries (`[Content_Types].xml`, `_rels/.rels`, and kind-specific core XML)
- Max file size is `100MB` (`413` otherwise)
- Empty files are rejected (`400`)

## Smoke Test

Start the server, then run:

```bash
npm run test:smoke
```

The smoke script auto-generates `data/sample-input.mp4` if needed and verifies:

- upload returns `202` + `assetId`
- upload kind is `video`
- status reaches `ready`
- `originalUrl` and `thumbnailUrl` return `200`

## Contract Test

Start the server, then run:

```bash
npm run test:contract
```

This validates:

- video/image/pdf/docx/xlsx/zip/supplementary happy paths
- PDF inline/download/thumbnail behavior
- MIME mismatch and signature mismatch rejection (`415`)
- invalid DOCX/XLSX package structure rejection (`415`)
- corrupt MP4 transitions to `failed`
- missing file field (`400`)
- delete flow (`204`, then `GET` -> `404`)
- legacy `/video/*` compatibility

## Example cURL

Upload:

```bash
curl -X POST http://localhost:4000/assets/upload \
  -F "file=@./data/sample-input.mp4;type=video/mp4"
```

Poll:

```bash
curl http://localhost:4000/assets/<assetId>
```

Download:

```bash
curl -L http://localhost:4000/assets/<assetId>/download -o asset.bin
```

## Storage Layout

```text
data/
  asset-records.json
  assets/
    <assetId>/
      original.*
      video.mp4 | image.* | file.pdf | file.*
      thumb.*
```
