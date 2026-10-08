import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.string().default('postgresql://syncguard:syncguard@localhost:5432/syncguard'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PM_URL: z.string().url().default('http://localhost:8002'),
  LEASE_SECONDS: z.coerce.number().int().min(1).default(10),
  MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  POLL_SECONDS: z.coerce.number().min(0.1).default(5),
  ENABLE_FAULTS: z.enum(['true', 'false']).default('false'),
  FAULT_POINT: z.string().default(''),
});
export type Settings = z.infer<typeof schema>;
export const loadSettings = (env: NodeJS.ProcessEnv = process.env): Settings => schema.parse(env);
