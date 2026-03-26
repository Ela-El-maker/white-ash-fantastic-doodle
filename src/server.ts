import { buildApp } from './app.js';
import { config } from './config.js';
import { InMemoryJobQueue } from './queue/in-memory-job-queue.js';
import { VideoAssetRepository } from './repository/video-asset-repository.js';
import { FfmpegMediaEngine } from './services/ffmpeg-media-engine.js';
import { VideoPipelineService } from './services/video-pipeline-service.js';

async function main(): Promise<void> {
  const repository = new VideoAssetRepository(config.repositoryPath);
  await repository.init();

  const mediaEngine = new FfmpegMediaEngine();
  const pipelineService = new VideoPipelineService(repository, mediaEngine);
  await pipelineService.init();

  const queue = new InMemoryJobQueue<string>(config.queueConcurrency, async (assetId) => {
    await pipelineService.processAsset(assetId);
  });

  const app = await buildApp({ pipelineService, queue });

  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Video pipeline service listening at ${config.baseUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
