import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import JSZip from 'jszip';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:4000';
const samplePath = path.join(process.cwd(), 'data', 'sample-input.mp4');
const sampleImagePath = path.join(process.cwd(), 'data', 'sample-image.png');
const samplePdfPath = path.join(process.cwd(), 'data', 'sample.pdf');
const sampleZipPath = path.join(process.cwd(), 'data', 'sample.zip');
const sampleDocxPath = path.join(process.cwd(), 'data', 'sample.docx');
const sampleXlsxPath = path.join(process.cwd(), 'data', 'sample.xlsx');
const sampleSupplementaryPath = path.join(process.cwd(), 'data', 'sample-resource.bin');
const corruptPdfPath = path.join(process.cwd(), 'data', 'corrupt.pdf');
const invalidDocxPath = path.join(process.cwd(), 'data', 'invalid.docx');
const invalidXlsxPath = path.join(process.cwd(), 'data', 'invalid.xlsx');

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

async function ensureSampleFiles(): Promise<void> {
  await fs.mkdir(path.dirname(sampleImagePath), { recursive: true });

  const png1x1 = Buffer.from(
    '89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE0000000C49444154789C63F8FFFF3F0005FE02FEA7B5A1D90000000049454E44AE426082',
    'hex',
  );
  await fs.writeFile(sampleImagePath, png1x1);

  const minimalPdf = createMinimalPdf();
  await fs.writeFile(samplePdfPath, minimalPdf);

  const zipLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0]);
  await fs.writeFile(sampleZipPath, zipLike);

  const commonOffice = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
  };

  const docxZip = new JSZip();
  docxZip.file('[Content_Types].xml', commonOffice['[Content_Types].xml']);
  docxZip.file('_rels/.rels', commonOffice['_rels/.rels']);
  docxZip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p /></w:body></w:document>');
  await fs.writeFile(sampleDocxPath, await docxZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const xlsxZip = new JSZip();
  xlsxZip.file('[Content_Types].xml', commonOffice['[Content_Types].xml']);
  xlsxZip.file('_rels/.rels', commonOffice['_rels/.rels']);
  xlsxZip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"></workbook>');
  await fs.writeFile(sampleXlsxPath, await xlsxZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  await fs.writeFile(invalidDocxPath, zipLike);
  await fs.writeFile(invalidXlsxPath, zipLike);

  const supplementary = Buffer.from('supplementary resource bytes', 'utf8');
  await fs.writeFile(sampleSupplementaryPath, supplementary);

  await fs.writeFile(corruptPdfPath, Buffer.from('not-a-real-pdf', 'utf8'));
}

function createMinimalPdf(): Buffer {
  const streamContent = 'BT /F1 18 Tf 72 100 Td (Hello PDF) Tj ET';
  const object1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const object2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const object3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 300 144] /Contents 4 0 R >>\nendobj\n';
  const object4 = `4 0 obj\n<< /Length ${Buffer.byteLength(streamContent, 'ascii')} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  const object5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  const objects = [object1, object2, object3, object4, object5];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const objectText of objects) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += objectText;
  }

  const xrefOffset = Buffer.byteLength(body, 'ascii');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'ascii');
}

async function healthCheck(): Promise<void> {
  const response = await fetch(`${baseUrl}/health`);
  assert(response.status === 200, `Health check failed: ${response.status}`);
}

async function uploadFile(
  filePath: string,
  mimeType: string,
  filename: string,
  route: '/assets/upload' | '/video/upload' = '/assets/upload',
): Promise<{ status: number; body: Record<string, unknown> }> {
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), filename);

  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    body: form,
  });
  const body = await response.json() as Record<string, unknown>;

  return { status: response.status, body };
}

async function pollTerminal(assetId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 60; i += 1) {
    await wait(500);
    const response = await fetch(`${baseUrl}/assets/${assetId}`);
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
  assert(upload.body.kind === 'video', `Expected video kind, got ${String(upload.body.kind)}`);
  assert(upload.body.status === 'queued', `Expected queued, got ${String(upload.body.status)}`);
  const assetId = String(upload.body.assetId ?? '');
  assert(assetId.length > 0, 'Expected assetId from happy path upload');

  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'ready', `Expected ready terminal, got ${String(terminal.status)}`);
  assert(terminal.kind === 'video', `Expected terminal kind video, got ${String(terminal.kind)}`);
  assert(typeof terminal.originalUrl === 'string', 'Expected originalUrl for ready asset');
  assert(typeof terminal.thumbnailUrl === 'string', 'Expected thumbnailUrl for ready asset');
  assert(typeof terminal.durationSeconds === 'number', 'Expected durationSeconds for ready asset');
  assert(Array.isArray(terminal.renditions), 'Expected renditions array for ready asset');
  assert((terminal.renditions as unknown[]).length > 0, 'Expected non-empty renditions for ready asset');

  const [playback, thumb, download] = await Promise.all([
    fetch(String(terminal.originalUrl)),
    fetch(String(terminal.thumbnailUrl)),
    fetch(String(terminal.downloadUrl)),
  ]);
  assert(playback.status === 200, `Expected video URL 200, got ${playback.status}`);
  assert(thumb.status === 200, `Expected thumb URL 200, got ${thumb.status}`);
  assert(download.status === 200, `Expected video download URL 200, got ${download.status}`);
}

async function testImagePipeline(): Promise<void> {
  const upload = await uploadFile(sampleImagePath, 'image/png', 'cover.png');
  assert(upload.status === 202, `Image upload expected 202, got ${upload.status}`);
  assert(upload.body.kind === 'image', `Image upload expected image kind, got ${String(upload.body.kind)}`);

  const assetId = String(upload.body.assetId ?? '');
  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'ready', `Image terminal expected ready, got ${String(terminal.status)}`);
  assert(terminal.kind === 'image', `Image terminal expected image kind, got ${String(terminal.kind)}`);
  assert(typeof terminal.width === 'number', 'Image terminal expected width');
  assert(typeof terminal.height === 'number', 'Image terminal expected height');
  assert(typeof terminal.originalUrl === 'string', 'Image terminal expected originalUrl');
  assert(typeof terminal.thumbnailUrl === 'string', 'Image terminal expected thumbnailUrl');

  const [original, thumb, download] = await Promise.all([
    fetch(String(terminal.originalUrl)),
    fetch(String(terminal.thumbnailUrl)),
    fetch(String(terminal.downloadUrl)),
  ]);
  assert(original.status === 200, `Image original expected 200, got ${original.status}`);
  assert(thumb.status === 200, `Image thumb expected 200, got ${thumb.status}`);
  assert(download.status === 200, `Image download expected 200, got ${download.status}`);
}

async function testPdfPipeline(): Promise<void> {
  const upload = await uploadFile(samplePdfPath, 'application/pdf', 'notes.pdf');
  assert(upload.status === 202, `PDF upload expected 202, got ${upload.status}`);
  assert(upload.body.kind === 'pdf', `PDF upload expected pdf kind, got ${String(upload.body.kind)}`);

  const assetId = String(upload.body.assetId ?? '');
  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'ready', `PDF terminal expected ready, got ${String(terminal.status)}`);
  assert(terminal.kind === 'pdf', `PDF terminal expected pdf kind, got ${String(terminal.kind)}`);
  assert(typeof terminal.previewUrl === 'string', 'PDF terminal expected previewUrl');
  assert(typeof terminal.thumbnailUrl === 'string', 'PDF terminal expected thumbnailUrl');
  assert(typeof terminal.downloadUrl === 'string', 'PDF terminal expected downloadUrl');
  assert(typeof terminal.pageCount === 'number' || terminal.pageCount === null, 'PDF terminal expected pageCount or null');

  const inlineResponse = await fetch(String(terminal.previewUrl));
  assert(inlineResponse.status === 200, `PDF inline expected 200, got ${inlineResponse.status}`);
  const inlineDisposition = inlineResponse.headers.get('content-disposition') ?? '';
  assert(inlineDisposition.startsWith('inline'), 'PDF inline endpoint should use inline Content-Disposition');

  const downloadResponse = await fetch(String(terminal.downloadUrl));
  assert(downloadResponse.status === 200, `PDF download expected 200, got ${downloadResponse.status}`);
  const downloadDisposition = downloadResponse.headers.get('content-disposition') ?? '';
  assert(downloadDisposition.startsWith('attachment'), 'PDF download endpoint should use attachment Content-Disposition');

  const thumbnailResponse = await fetch(String(terminal.thumbnailUrl));
  assert(thumbnailResponse.status === 200, `PDF thumbnail expected 200, got ${thumbnailResponse.status}`);
  const thumbnailType = thumbnailResponse.headers.get('content-type') ?? '';
  assert(thumbnailType.includes('image/jpeg'), `PDF thumbnail expected image/jpeg, got ${thumbnailType}`);
}

async function testFileKinds(): Promise<void> {
  const cases: Array<{ filePath: string; mime: string; name: string; expectedKind: string }> = [
    {
      filePath: sampleDocxPath,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'worksheet.docx',
      expectedKind: 'document',
    },
    {
      filePath: sampleXlsxPath,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: 'grades.xlsx',
      expectedKind: 'spreadsheet',
    },
    {
      filePath: sampleZipPath,
      mime: 'application/zip',
      name: 'starter-files.zip',
      expectedKind: 'archive',
    },
    {
      filePath: sampleSupplementaryPath,
      mime: 'application/octet-stream',
      name: 'resource.bin',
      expectedKind: 'supplementary',
    },
  ];

  for (const testCase of cases) {
    const upload = await uploadFile(testCase.filePath, testCase.mime, testCase.name);
    assert(upload.status === 202, `${testCase.name} expected 202, got ${upload.status}`);
    assert(upload.body.kind === testCase.expectedKind, `${testCase.name} expected ${testCase.expectedKind}`);

    const terminal = await pollTerminal(String(upload.body.assetId ?? ''));
    assert(terminal.status === 'ready', `${testCase.name} expected ready, got ${String(terminal.status)}`);
    assert(terminal.kind === testCase.expectedKind, `${testCase.name} terminal kind mismatch`);
    assert(typeof terminal.downloadUrl === 'string', `${testCase.name} expected downloadUrl`);

    const download = await fetch(String(terminal.downloadUrl));
    assert(download.status === 200, `${testCase.name} download expected 200, got ${download.status}`);
  }
}

async function testInvalidMimeType(): Promise<void> {
  const upload = await uploadFile(samplePath, 'text/plain', 'wrong-type.mp4');
  assert(upload.status === 415, `Invalid MIME expected 415, got ${upload.status}`);
  assert(upload.body.status === 'failed', `Invalid MIME expected failed body status, got ${String(upload.body.status)}`);
}

async function testSignatureMismatch(): Promise<void> {
  const upload = await uploadFile(corruptPdfPath, 'application/pdf', 'corrupt.pdf');
  assert(upload.status === 415, `Signature mismatch expected 415, got ${upload.status}`);
  assert(upload.body.status === 'failed', `Signature mismatch expected failed body status, got ${String(upload.body.status)}`);
}

async function testInvalidOfficePackage(): Promise<void> {
  const invalidDocx = await uploadFile(
    invalidDocxPath,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'invalid.docx',
  );
  assert(invalidDocx.status === 415, `Invalid DOCX package expected 415, got ${invalidDocx.status}`);

  const invalidXlsx = await uploadFile(
    invalidXlsxPath,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'invalid.xlsx',
  );
  assert(invalidXlsx.status === 415, `Invalid XLSX package expected 415, got ${invalidXlsx.status}`);
}

async function testCorruptVideo(): Promise<void> {
  const corruptPath = path.join(process.cwd(), 'data', 'corrupt.mp4');
  const fakeMp4 = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from('isom', 'ascii'),
    Buffer.from('00000000', 'hex'),
    Buffer.from('this-is-not-a-real-mp4', 'utf8'),
  ]);
  await fs.writeFile(corruptPath, fakeMp4);

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
  const response = await fetch(`${baseUrl}/assets/upload`, {
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

  const deleteResponse = await fetch(`${baseUrl}/assets/${assetId}`, {
    method: 'DELETE',
  });
  assert(deleteResponse.status === 204, `Delete expected 204, got ${deleteResponse.status}`);

  const getResponse = await fetch(`${baseUrl}/assets/${assetId}`);
  assert(getResponse.status === 404, `Deleted asset GET expected 404, got ${getResponse.status}`);
}

async function testVideoCompatibility(): Promise<void> {
  const upload = await uploadFile(samplePath, 'video/mp4', 'legacy.mp4', '/video/upload');
  assert(upload.status === 202, `Legacy /video/upload expected 202, got ${upload.status}`);
  const assetId = String(upload.body.assetId ?? '');

  const terminal = await pollTerminal(assetId);
  assert(terminal.status === 'ready', `Legacy video expected ready in generic poll, got ${String(terminal.status)}`);

  const legacyGet = await fetch(`${baseUrl}/video/${assetId}`);
  assert(legacyGet.status === 200, `Legacy /video/:id expected 200, got ${legacyGet.status}`);
  const legacyBody = await legacyGet.json() as Record<string, unknown>;
  assert(typeof legacyBody.playbackUrl === 'string', 'Legacy response expected playbackUrl');
  assert(typeof legacyBody.thumbnailUrl === 'string', 'Legacy response expected thumbnailUrl');

  const wrongType = await uploadFile(sampleImagePath, 'image/png', 'image.png', '/video/upload');
  assert(wrongType.status === 415, `Legacy /video/upload image expected 415, got ${wrongType.status}`);
}

async function main(): Promise<void> {
  await ensureSampleVideo();
  await ensureSampleFiles();
  await healthCheck();

  await testHappyPath();
  await testImagePipeline();
  await testPdfPipeline();
  await testFileKinds();
  await testInvalidMimeType();
  await testSignatureMismatch();
  await testInvalidOfficePackage();
  await testCorruptVideo();
  await testMissingFile();
  await testDelete();
  await testVideoCompatibility();

  console.log('contract-test:pass');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
