import { z } from 'zod';

// AllDebrid v4 /link/unlock boundary. Success/error are a discriminated union on
// the outer `status`. On success `data` carries EITHER `link` (ready now) OR
// `delayed` (an integer id to poll — 1fichier free links, …); extra fields are
// ignored.
export const alldebridUnlockSchema = z.union([
  z.object({
    status: z.literal('success'),
    data: z.object({
      link: z.string().optional(),
      filename: z.string().optional(),
      delayed: z.number().int().optional(),
    }),
  }),
  z.object({
    status: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type AllDebridUnlock = z.infer<typeof alldebridUnlockSchema>;

// AllDebrid v4 /link/delayed boundary. The inner `data.status` is 1 (still
// processing), 2 (ready — `link` present) or 3 (generation failed).
export const alldebridDelayedSchema = z.union([
  z.object({
    status: z.literal('success'),
    data: z.object({ status: z.number().int(), link: z.string().optional() }),
  }),
  z.object({
    status: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export type AllDebridDelayed = z.infer<typeof alldebridDelayedSchema>;
