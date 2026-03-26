import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { VideoPipelineService, UserInputError } from './services/video-pipeline-service.js';
import { InMemoryJobQueue } from './queue/in-memory-job-queue.js';

export interface AppDependencies {
  pipelineService: VideoPipelineService;
  queue: InMemoryJobQueue<string>;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      files: 1,
      fileSize: config.maxUploadBytes,
    },
  });
  await app.register(fastifyStatic, {
    root: config.assetRoot,
    prefix: '/assets/',
    decorateReply: false,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/video/upload', async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new UserInputError('Missing multipart file field named file.', 400);
    }

    if (file.mimetype !== 'video/mp4') {
      throw new UserInputError('Invalid file type. Only video/mp4 is allowed.', 415);
    }

    const asset = await deps.pipelineService.createUploadTarget();
    try {
      await deps.pipelineService.ingestUpload(asset.id, file.file, file.mimetype);
      deps.queue.enqueue(asset.id);
    } catch (error) {
      await deps.pipelineService.discardAsset(asset.id);
      throw error;
    }

    return reply.code(202).send({
      assetId: asset.id,
      status: 'queued',
    });
  });

  app.get<{ Params: { assetId: string } }>('/video/:assetId', async (request, reply) => {
    const asset = deps.pipelineService.getAsset(request.params.assetId);
    if (!asset) {
      return reply.code(404).send({ message: 'Asset not found' });
    }

    return reply.send(asset);
  });

  app.delete<{ Params: { assetId: string } }>('/video/:assetId', async (request, reply) => {
    const deleted = await deps.pipelineService.cancelAndDelete(request.params.assetId);
    if (!deleted) {
      return reply.code(404).send({ message: 'Asset not found' });
    }

    return reply.code(204).send();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        status: 'failed',
        error: `File exceeds ${config.maxUploadBytes} bytes limit.`,
      });
    }

    if (error instanceof UserInputError) {
      return reply.code(error.statusCode).send({
        status: 'failed',
        error: error.message,
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      status: 'failed',
      error: 'Internal server error',
    });
  });

  return app;
}
