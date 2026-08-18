import { z } from 'zod';

// aria2 JSON-RPC boundary. Responses are either {result} or {error}.
export const aria2ErrorSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
});

export const aria2GidResultSchema = z.object({ result: z.string() });

export const aria2StatusResultSchema = z.object({
  result: z.object({
    status: z.string(),
    // aria2 sends byte counts as strings, and 0 until it knows the size
    completedLength: z.string().optional(),
    totalLength: z.string().optional(),
    files: z.array(z.object({ path: z.string() })).optional(),
    errorMessage: z.string().optional(),
  }),
});
