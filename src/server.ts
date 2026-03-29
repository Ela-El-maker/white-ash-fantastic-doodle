import { buildApp } from './app.js';
import { config } from './config.js';
import { InMemoryJobQueue } from './queue/in-memory-job-queue.js';
import { AssetRepository } from './repository/asset-repository.js';
import { AssetPipelineService } from './services/asset-pipeline-service.js';
import { FfmpegMediaEngine } from './services/ffmpeg-media-engine.js';
import { GenericFileProcessor } from './services/processors/generic-file-processor.js';
import { ImageProcessor } from './services/processors/image-processor.js';
import { MediaToolchain } from './services/processors/media-toolchain.js';
import { PdfProcessor } from './services/processors/pdf-processor.js';
import { VideoProcessor } from './services/processors/video-processor.js';

async function main(): Promise<void> {
  const repository = new AssetRepository(config.repositoryPath);
  await repository.init();

  const mediaEngine = new FfmpegMediaEngine();
  const mediaToolchain = new MediaToolchain();
  const pipelineService = new AssetPipelineService(repository, mediaEngine, [
    new VideoProcessor(mediaEngine),
    new ImageProcessor(mediaToolchain),
    new PdfProcessor(mediaToolchain),
    new GenericFileProcessor(),
  ]);
  await pipelineService.init();

  const queue = new InMemoryJobQueue<string>(config.queueConcurrency, async (assetId) => {
    await pipelineService.processAsset(assetId);
  });

  const app = await buildApp({ pipelineService, queue });

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Asset pipeline service listening at ${config.baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
