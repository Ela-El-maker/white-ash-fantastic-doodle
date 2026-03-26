import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const samplePath = path.join(process.cwd(), 'data', 'sample-input.mp4');
const oversizedPath = path.join(process.cwd(), 'data', 'oversized-input.mp4');

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

async function ensureOversizedFile(): Promise<void> {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 32, 1);
  await fs.writeFile(oversizedPath, bytes);
}

async function healthCheck(): Promise<void> {
  const response = await fetch(`${baseUrl}/health`);
  assert(response.status === 200, `Health check failed: ${response.status}`);
}

async function uploadFile(
  filePath: string,
  mimeType: string,
  filename: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);

  const response = await fetch(`${baseUrl}/video/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json() as Record<string, unknown>;

  return { status: response.status, body };
}

async function pollTerminal(assetId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i += 1) {
    await wait(500);
    const response = await fetch(`${baseUrl}/video/${assetId}`);
    assert(response.status === 200, `Expected poll 200, got ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (body.status === 'ready' || body.status === 'failed') {
      return body;
    }
  }

  throw new Error(`Asset ${assetId} did not reach terminal state`);
}

async function testHappyPath(): Promise<void> {
  const upload = await uploadFile(samplePath, 'video/mp4', 'sample-input.mp4');
  assert(upload.status === 202, `Happy path upload expected 202, got ${upload.status}`);
  assert(upload.body.status === 'queued', `Expected queued, got ${String(upload.body.status)}`);
  const assetId = String(upload.body.assetId ?? '');
  assert(assetId.length > 0, 'Expected assetId from happy path upload');

  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'ready', `Expected ready terminal, got ${String(terminal.status)}`);
  assert(typeof terminal.playbackUrl === 'string', 'Expected playbackUrl for ready asset');
  assert(typeof terminal.thumbnailUrl === 'string', 'Expected thumbnailUrl for ready asset');
  assert(typeof terminal.duration === 'number', 'Expected duration for ready asset');
  assert(Array.isArray(terminal.renditions), 'Expected renditions array for ready asset');
  assert((terminal.renditions as unknown[]).length > 0, 'Expected non-empty renditions for ready asset');
}

async function testInvalidMimeType(): Promise<void> {
  const upload = await uploadFile(samplePath, 'text/plain', 'wrong-type.txt');
  assert(upload.status === 415, `Invalid MIME expected 415, got ${upload.status}`);
  assert(upload.body.status === 'failed', `Invalid MIME expected failed body status, got ${String(upload.body.status)}`);
}

async function testOversizedUpload(): Promise<void> {
  const upload = await uploadFile(oversizedPath, 'video/mp4', 'oversized.mp4');
  assert(upload.status === 413, `Oversized upload expected 413, got ${upload.status}`);
  assert(upload.body.status === 'failed', `Oversized upload expected failed body status, got ${String(upload.body.status)}`);
}

async function testCorruptVideo(): Promise<void> {
  const corruptPath = path.join(process.cwd(), 'data', 'corrupt.mp4');
  await fs.writeFile(corruptPath, Buffer.from('this-is-not-a-real-mp4'));

  const upload = await uploadFile(corruptPath, 'video/mp4', 'corrupt.mp4');
  assert(upload.status === 202, `Corrupt upload should still be accepted initially, got ${upload.status}`);

  const assetId = String(upload.body.assetId ?? '');
  assert(assetId.length > 0, 'Corrupt upload did not return assetId');

  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'failed', `Corrupt video expected failed terminal state, got ${String(terminal.status)}`);
  assert(typeof terminal.error === 'string' && terminal.error.length > 0, 'Corrupt video expected error message');
}

async function testMissingFile(): Promise<void> {
  const form = new FormData();
  const response = await fetch(`${baseUrl}/video/upload`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json() as Record<string, unknown>;

  assert(response.status === 400, `Missing file expected 400, got ${response.status}`);
  assert(body.status === 'failed', `Missing file expected failed body status, got ${String(body.status)}`);
}

async function testDelete(): Promise<void> {
  const upload = await uploadFile(samplePath, 'video/mp4', 'delete-me.mp4');
  assert(upload.status === 202, `Delete test upload expected 202, got ${upload.status}`);
  const assetId = String(upload.body.assetId ?? '');
  assert(assetId.length > 0, 'Delete test upload missing assetId');

  const deleteResponse = await fetch(`${baseUrl}/video/${assetId}`, {
    method: 'DELETE',
  });
  assert(deleteResponse.status === 204, `Delete expected 204, got ${deleteResponse.status}`);

  const getResponse = await fetch(`${baseUrl}/video/${assetId}`);
  assert(getResponse.status === 404, `Deleted asset GET expected 404, got ${getResponse.status}`);
}

async function main(): Promise<void> {
  await ensureSampleVideo();
  await ensureOversizedFile();
  await healthCheck();

  await testHappyPath();
  await testInvalidMimeType();
  await testOversizedUpload();
  await testCorruptVideo();
  await testMissingFile();
  await testDelete();

  console.log('contract-test:pass');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
