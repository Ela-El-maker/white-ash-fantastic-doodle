import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { config } from '../config.js';
import { ProbeMetadata } from '../types.js';

export class ProcessingCancelledError extends Error {
  constructor(message = 'Processing cancelled') {
    super(message);
    this.name = 'ProcessingCancelledError';
  }
}

export class FfmpegMediaEngine {
  async preflight(): Promise<void> {
    await this.assertBinary(config.ffprobePath, 'ffprobe');
    await this.assertBinary(config.ffmpegPath, 'ffmpeg');
  }

  async probe(inputPath: string, abortSignal?: AbortSignal): Promise<ProbeMetadata> {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height',
      '-of', 'json',
      inputPath,
    ];

    const { stdout } = await this.runCommand(config.ffprobePath, args, abortSignal);
    const parsed = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };

    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    const duration = parsed.format?.duration ? Number(parsed.format.duration) : null;

    return {
      duration: Number.isFinite(duration) ? duration : null,
      width: videoStream?.width ?? null,
      height: videoStream?.height ?? null,
      codecVideo: videoStream?.codec_name ?? null,
      codecAudio: audioStream?.codec_name ?? null,
    };
  }

  async transcodeToPlayback(
    inputPath: string,
    outputPath: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `scale=-2:'min(${config.maxHeight},ih)'`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-profile:v', 'main',
      '-level', '3.1',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputPath,
    ];

    await this.runCommand(config.ffmpegPath, args, abortSignal);
  }

  async generateThumbnail(
    inputPath: string,
    thumbnailPath: string,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const args = [
      '-y',
      '-ss', '00:00:01.000',
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      thumbnailPath,
    ];

    await this.runCommand(config.ffmpegPath, args, abortSignal);
  }

  async statBitrateKbps(filePath: string, durationSeconds: number | null): Promise<number> {
    const stats = await fs.stat(filePath);
    if (!durationSeconds || durationSeconds <= 0) {
      return 0;
    }

    return Math.max(1, Math.round((stats.size * 8) / durationSeconds / 1000));
  }

  private async assertBinary(binaryPath: string, binaryLabel: string): Promise<void> {
    try {
      await this.runCommand(binaryPath, ['-version']);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to execute ${binaryLabel} at "${binaryPath}": ${details}`);
    }
  }

  private runCommand(
    command: string,
    args: string[],
    abortSignal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let aborted = false;
      let child: ReturnType<typeof spawn> | null = null;

      const onAbort = () => {
        aborted = true;
        if (child && !child.killed) {
          child.kill('SIGKILL');
        }
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          return reject(new ProcessingCancelledError());
        }

        abortSignal.addEventListener('abort', onAbort, { once: true });
      }

      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (!child.stdout || !child.stderr) {
        reject(new Error(`Failed to capture process output for ${command}`));
        return;
      }

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }

        if (aborted) {
          reject(new ProcessingCancelledError());
          return;
        }

        if (code !== 0) {
          reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
          return;
        }

        resolve({ stdout, stderr });
      });
    });
  }
}
