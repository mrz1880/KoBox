import { z } from 'zod';

// aria2 JSON-RPC boundary. Responses are either {result} or {error}.
export const aria2ErrorSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
});

export const aria2GidResultSchema = z.object({ result: z.string() });

export const aria2StatusResultSchema = z.object({
  result: z.object({
    status: z.string(),
    files: z.array(z.object({ path: z.string() })).optional(),
    errorMessage: z.string().optional(),
  }),
});
