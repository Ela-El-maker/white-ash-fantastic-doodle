import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const rootDir = process.cwd();
const dataRoot = process.env.DATA_ROOT ?? path.join(rootDir, 'data');
const bundledFfmpegPath = ffmpegStatic ?? undefined;
const bundledFfprobePath = ffprobeStatic.path ?? undefined;

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  dataRoot,
  assetRoot: path.join(dataRoot, 'assets'),
  repositoryPath: path.join(dataRoot, 'video-assets.json'),
  maxUploadBytes: 100 * 1024 * 1024,
  maxHeight: 480,
  ffmpegPath: process.env.FFMPEG_PATH ?? bundledFfmpegPath ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? bundledFfprobePath ?? 'ffprobe',
  queueConcurrency: Number(process.env.QUEUE_CONCURRENCY ?? 1),
};
