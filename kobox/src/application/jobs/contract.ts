import { z } from 'zod';
import { INFO_HASH_PATTERN } from '../../domain/torrent/InfoHash.js';
import { LABEL_PATTERN } from '../../domain/torrent/Label.js';
import { EMAIL_PATTERN } from '../../domain/user/EmailAddress.js';
import { CRYPT_HASH_PATTERN } from '../../domain/user/HashedPassword.js';
import { USERNAME_PATTERN, Username } from '../../domain/user/Username.js';

// The privilege boundary: the unprivileged side enqueues one of these closed
// job types; the root worker re-parses (defense in depth) and reconstructs
// Value Objects, which stay authoritative over these wire-level checks.

export const JOB_TYPES = [
  'create-user',
  'delete-user',
  'change-password',
  'suspend-user',
  'resume-user',
  'provision-rtorrent',
  'deprovision-rtorrent',
  'render-rtorrent-config',
  'add-watch-dir',
  'set-sync-disabled',
  'set-allow-public-tracker',
  'torrent-event',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

const usernameField = z
  .string()
  .regex(USERNAME_PATTERN)
  .refine((raw) => !Username.RESERVED.includes(raw), { message: 'reserved username' });
const passwordHashField = z.string().min(16).regex(CRYPT_HASH_PATTERN);

const usernameOnly = z.strictObject({ username: usernameField });
const labelField = z.string().regex(LABEL_PATTERN);
const infoHashField = z.string().regex(INFO_HASH_PATTERN);
// Paths from rtorrent hooks: absolute, no traversal — the worker additionally
// re-checks them against the owning user's home before touching anything.
const absolutePathField = z
  .string()
  .min(1)
  .refine((raw) => raw.startsWith('/') && !raw.split('/').includes('..'), {
    message: 'path must be absolute without ..',
  });

export const jobPayloadSchemas = {
  'create-user': z.strictObject({
    username: usernameField,
    // case-insensitive on the wire; EmailAddress normalizes to lowercase
    email: z.string().regex(new RegExp(EMAIL_PATTERN.source, 'i')),
    accountType: z.enum(['normal', 'plex']),
    quotaBytes: z.number().int().nonnegative(),
    proxyPort: z.number().int().min(1).max(65535),
    passwordHash: passwordHashField,
  }),
  'delete-user': usernameOnly,
  'change-password': z.strictObject({
    username: usernameField,
    passwordHash: passwordHashField,
  }),
  'suspend-user': usernameOnly,
  'resume-user': usernameOnly,
  'provision-rtorrent': usernameOnly,
  'deprovision-rtorrent': usernameOnly,
  'render-rtorrent-config': usernameOnly,
  'add-watch-dir': z.strictObject({ username: usernameField, label: labelField }),
  'set-sync-disabled': z.strictObject({ username: usernameField, disabled: z.boolean() }),
  'set-allow-public-tracker': z.strictObject({ username: usernameField, allowed: z.boolean() }),
  'torrent-event': z.strictObject({
    username: usernameField,
    event: z.enum(['inserted_new', 'finished', 'erased']),
    infoHash: infoHashField,
    name: z.string().min(1).optional(),
    directory: absolutePathField.optional(),
    basePath: absolutePathField.optional(),
    torrentFile: absolutePathField.optional(),
    torrentDir: absolutePathField.optional(),
    label: labelField.optional(),
  }),
} satisfies Record<JobType, z.ZodType>;

export type JobPayload<T extends JobType> = z.infer<(typeof jobPayloadSchemas)[T]>;

export type Job = {
  [T in JobType]: { readonly type: T; readonly payload: JobPayload<T> };
}[JobType];

export class UnknownJobTypeError extends Error {
  constructor(raw: string) {
    super(`unknown job type ${JSON.stringify(raw)}`);
    this.name = 'UnknownJobTypeError';
  }
}

function isJobType(raw: string): raw is JobType {
  return (JOB_TYPES as readonly string[]).includes(raw);
}

export function parseJob(rawType: string, rawPayload: unknown): Job {
  if (!isJobType(rawType)) {
    throw new UnknownJobTypeError(rawType);
  }
  const payload = jobPayloadSchemas[rawType].parse(rawPayload);
  return { type: rawType, payload } as Job;
}
