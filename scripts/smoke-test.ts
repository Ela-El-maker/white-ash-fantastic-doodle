import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const samplePath = path.join(process.cwd(), 'data', 'sample-input.mp4');
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4000';

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function exec(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function ensureSampleVideo(): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH ?? ffmpegStatic;
  if (!ffmpegPath) {
    throw new Error('Unable to generate sample video: ffmpeg binary not available.');
  }

  const ffprobePath = process.env.FFPROBE_PATH ?? ffprobeStatic.path;
  if (!ffprobePath) {
    throw new Error('Unable to generate sample video: ffprobe binary not available.');
  }

  await fs.mkdir(path.dirname(samplePath), { recursive: true });
  await fs.rm(samplePath, { force: true });
  await exec(ffmpegPath, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=24',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=44100',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    samplePath,
  ]);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  await ensureSampleVideo();

  const form = new FormData();
  const bytes = await fs.readFile(samplePath);
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'sample-input.mp4');

  const uploadResponse = await fetch(`${baseUrl}/assets/upload`, {
    method: 'POST',
    body: form,
  });

  const uploadJson = await uploadResponse.json() as { assetId: string; kind: string; status: string };
  assert(uploadResponse.status === 202, `Expected 202 from upload, got ${uploadResponse.status}`);
  assert(uploadJson.kind === 'video', `Expected video kind from upload, got ${uploadJson.kind}`);
  assert(uploadJson.status === 'queued', `Expected queued upload status, got ${uploadJson.status}`);
  assert(Boolean(uploadJson.assetId), 'Upload response is missing assetId');

  let terminalState: string | null = null;
  let terminalPayload: Record<string, unknown> | null = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(500);
    const statusResponse = await fetch(`${baseUrl}/assets/${uploadJson.assetId}`);
    const statusJson = await statusResponse.json() as Record<string, unknown>;

    if (statusJson.status === 'ready' || statusJson.status === 'failed') {
      terminalState = String(statusJson.status);
      terminalPayload = statusJson;
      break;
    }
  }

  assert(terminalState !== null, 'Asset did not reach terminal state within timeout.');
  assert(terminalState === 'ready', `Expected terminal ready state, got ${terminalState}`);
  assert(terminalPayload, 'Missing terminal payload.');
  assert(terminalPayload.kind === 'video', `Expected video kind in terminal payload, got ${String(terminalPayload.kind)}`);
  assert(typeof terminalPayload.originalUrl === 'string', 'Expected originalUrl in terminal payload.');
  assert(typeof terminalPayload.thumbnailUrl === 'string', 'Expected thumbnailUrl in terminal payload.');
  assert(Array.isArray(terminalPayload.renditions), 'Expected renditions array in terminal payload.');
  assert((terminalPayload.renditions as unknown[]).length > 0, 'Expected at least one rendition.');
  assert(typeof terminalPayload.durationSeconds === 'number', 'Expected durationSeconds number in terminal payload.');

  const playbackUrl = String(terminalPayload.originalUrl);
  const thumbUrl = String(terminalPayload.thumbnailUrl);
  const [playbackResponse, thumbnailResponse] = await Promise.all([
    fetch(playbackUrl),
    fetch(thumbUrl),
  ]);
  assert(playbackResponse.status === 200, `Expected playback URL 200, got ${playbackResponse.status}`);
  assert(thumbnailResponse.status === 200, `Expected thumbnail URL 200, got ${thumbnailResponse.status}`);

  console.log('smoke-test:pass', {
    assetId: uploadJson.assetId,
    playbackUrl,
    thumbUrl,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
