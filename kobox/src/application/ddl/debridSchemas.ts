import { z } from 'zod';

// AllDebrid v4 /link/unlock boundary. We only read `link` (+ optional
// `filename`); extra fields are ignored. Success and error are a discriminated
// union on `status`.
export const alldebridUnlockSchema = z.union([
  z.object({
    status: z.literal('success'),
    data: z.object({ link: z.string(), filename: z.string().optional() }),
  }),
  z.object({
    status: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type AllDebridUnlock = z.infer<typeof alldebridUnlockSchema>;
