import { z } from 'zod';

// librespeed-cli --json boundary. Rates come out in Mbit/s as floats; we only
// read what we store and ignore the rest.
export const librespeedResultSchema = z.array(
  z.object({
    server: z.object({ name: z.string() }),
    download: z.number().nonnegative(),
    upload: z.number().nonnegative(),
    ping: z.number().nonnegative(),
  }),
);
