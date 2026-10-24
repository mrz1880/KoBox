import { z } from 'zod';
import { InvalidPasswordError, Password } from '../../domain/user/Password.js';

// A password typed into a form is held to the domain rule itself, not to a copy
// of its bounds: whatever Password refuses, the form refuses, with its reason.
export const passwordField = z
  .string()
  .max(1024)
  .transform((raw, ctx) => {
    try {
      return Password.parse(raw);
    } catch (error) {
      if (!(error instanceof InvalidPasswordError)) {
        throw error;
      }
      ctx.addIssue({ code: 'custom', message: error.message });
      return z.NEVER;
    }
  });
