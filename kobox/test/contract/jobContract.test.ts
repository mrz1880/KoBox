import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JOB_TYPES, jobPayloadSchemas, parseJob } from '../../src/application/jobs/contract.js';

const HASH = '$6$testsalt$0123456789abcdefghijklmnopqrstuv';

describe('job contract', () => {
  it('should_expose_a_closed_set_of_job_types', () => {
    expect(JOB_TYPES).toEqual([
      'create-user',
      'delete-user',
      'change-password',
      'suspend-user',
      'resume-user',
    ]);
  });

  it('should_parse_a_valid_create_user_job', () => {
    const job = parseJob('create-user', {
      username: 'alice',
      email: 'alice@example.org',
      accountType: 'normal',
      quotaBytes: 412 * 1024 ** 3,
      proxyPort: 8080,
      passwordHash: HASH,
    });

    expect(job.type).toBe('create-user');
    if (job.type === 'create-user') {
      expect(job.payload.username).toBe('alice');
    }
  });

  it('should_reject_unknown_job_types', () => {
    expect(() => parseJob('rm-rf', { username: 'alice' })).toThrow(/unknown job type/);
  });

  it('should_reject_payloads_violating_domain_invariants', () => {
    expect(() => parseJob('suspend-user', { username: 'Tony Z; rm -rf /' })).toThrow();
    expect(() => parseJob('suspend-user', { username: 'root' })).toThrow();
    expect(() =>
      parseJob('change-password', { username: 'alice', passwordHash: 'plaintext' }),
    ).toThrow();
    expect(() =>
      parseJob('create-user', {
        username: 'alice',
        email: 'not-an-email',
        accountType: 'normal',
        quotaBytes: 1,
        proxyPort: 8080,
        passwordHash: HASH,
      }),
    ).toThrow();
  });

  // Breaking-change detector: if a payload schema changes shape, this snapshot
  // moves and the diff must be acknowledged in review (web<->worker contract).
  it('should_keep_the_wire_contract_stable', () => {
    const shapes = Object.fromEntries(
      JOB_TYPES.map((type) => [type, z.toJSONSchema(jobPayloadSchemas[type])]),
    );
    expect(shapes).toMatchSnapshot();
  });
});
