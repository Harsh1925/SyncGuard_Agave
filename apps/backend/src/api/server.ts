import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import { ZodError } from 'zod';

export async function server(title: string) {
  const app = Fastify({
    logger: true,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await app.register(swagger, { openapi: { info: { title, version: '0.2.0' } } });
  await app.register(swaggerUI, { routePrefix: '/docs' });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ detail: 'Invalid input', issues: error.issues });
    const failure = (error instanceof Error ? error : new Error('Unexpected failure')) as Error & {
      code?: string;
      statusCode?: number;
    };
    if (['23505', '23503'].includes(failure.code ?? ''))
      return reply.code(409).send({ detail: 'Duplicate business identity or invalid reference' });
    if (['22003', '22P02'].includes(failure.code ?? ''))
      return reply.code(400).send({ detail: 'Invalid database input' });
    if (failure.statusCode && failure.statusCode < 500)
      return reply.code(failure.statusCode).send({ detail: failure.message });
    app.log.error(error);
    return reply.code(500).send({ detail: 'Request failed; inspect service logs' });
  });
  return app;
}
