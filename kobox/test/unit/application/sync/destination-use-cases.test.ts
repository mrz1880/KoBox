import { describe, expect, it } from 'vitest';
import { CheckSyncDestination } from '../../../../src/application/sync/CheckSyncDestination.js';
import {
  NoDestinationToUpdateError,
  SetSyncDestination,
} from '../../../../src/application/sync/SetSyncDestination.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePassword } from '../../../../src/domain/sync/RemotePassword.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import type {
  ProbeOutcome,
  RemotePasswordOpenerPort,
  RemotePasswordSealerPort,
  RemoteProbePort,
} from '../../../../src/domain/sync/ports.js';
import { InMemorySyncDestinationRepository } from '../../../../src/infrastructure/persistence/InMemorySyncDestinationRepository.js';
import { Username } from '../../../../src/domain/user/Username.js';

const NOW = '2026-08-10 10:00:00';
const alice = Username.parse('alice');

// A reversible marker instead of real RSA: a test can then assert the portal
// stored something SEALED, and which password it sealed, without a key pair.
const SEAL = 'sealed:';

class FakeSealer implements RemotePasswordSealerPort {
  seal(password: RemotePassword): Promise<string> {
    return Promise.resolve(`${SEAL}${password.reveal()}`);
  }
}

class FakeOpener implements RemotePasswordOpenerPort {
  open(sealed: string): Promise<RemotePassword> {
    if (!sealed.startsWith(SEAL)) {
      return Promise.reject(new Error('sealed with another key'));
    }
    return Promise.resolve(RemotePassword.parse(sealed.slice(SEAL.length)));
  }
}

class RecordingProbe implements RemoteProbePort {
  readonly seen: string[] = [];

  constructor(private readonly outcome: ProbeOutcome) {}

  probe(_destination: unknown, password: RemotePassword): Promise<ProbeOutcome> {
    this.seen.push(password.reveal());
    return Promise.resolve(this.outcome);
  }
}

type Command = Parameters<SetSyncDestination['execute']>[0];

// exactOptionalPropertyTypes: "no password" means the key is ABSENT, not
// present and undefined — which is exactly the distinction the use case makes.
function withoutPassword(overrides: Partial<Command> = {}): Command {
  return {
    username: alice,
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
    ...overrides,
  };
}

function aCommand(overrides: Partial<Command> = {}): Command {
  return { ...withoutPassword(overrides), password: RemotePassword.parse('hunter2000') };
}

describe('SetSyncDestination', () => {
  it('should_store_the_password_sealed_and_never_in_the_clear', async () => {
    const destinations = new InMemorySyncDestinationRepository();
    const useCase = new SetSyncDestination({ destinations, sealer: new FakeSealer() });

    await useCase.execute(aCommand());

    // the fake seal is reversible on purpose, so this proves WHICH password was
    // sealed; that nothing readable is stored is the real cipher's job, and its
    // own test's
    const stored = await destinations.findByUsername(alice);
    expect(stored?.sealedPassword).toBe('sealed:hunter2000');
  });

  it('should_keep_the_stored_password_when_the_field_is_left_empty', async () => {
    const destinations = new InMemorySyncDestinationRepository();
    const useCase = new SetSyncDestination({ destinations, sealer: new FakeSealer() });
    await useCase.execute(aCommand());

    await useCase.execute(withoutPassword({ path: RemotePath.parse('/volume2/torrents') }));

    const stored = await destinations.findByUsername(alice);
    expect(stored?.sealedPassword).toBe('sealed:hunter2000');
    expect(stored?.path.value).toBe('/volume2/torrents');
  });

  it('should_refuse_a_first_destination_with_no_password_at_all', async () => {
    const destinations = new InMemorySyncDestinationRepository();
    const useCase = new SetSyncDestination({ destinations, sealer: new FakeSealer() });

    // there is nothing stored to keep, so "leave it alone" has no meaning
    await expect(useCase.execute(withoutPassword())).rejects.toThrow(NoDestinationToUpdateError);
  });
});

describe('CheckSyncDestination', () => {
  async function withStoredDestination(): Promise<InMemorySyncDestinationRepository> {
    const destinations = new InMemorySyncDestinationRepository();
    await new SetSyncDestination({ destinations, sealer: new FakeSealer() }).execute(aCommand());
    return destinations;
  }

  it('should_hand_the_opened_password_to_the_probe_and_record_the_verdict', async () => {
    const destinations = await withStoredDestination();
    const probe = new RecordingProbe({ ok: true, detail: 'it answered', fingerprint: 'SHA256:abc' });

    await new CheckSyncDestination({
      destinations,
      opener: new FakeOpener(),
      probe,
      clock: () => NOW,
    }).execute(alice);

    expect(probe.seen).toEqual(['hunter2000']);
    const stored = await destinations.findByUsername(alice);
    expect(stored?.lastCheck).toEqual({
      ok: true,
      at: NOW,
      detail: 'it answered',
      fingerprint: 'SHA256:abc',
    });
  });

  it('should_tell_the_member_to_retype_it_when_the_stored_password_cannot_be_opened', async () => {
    // a database restored without its host key: every sealed value is unreadable
    const destinations = await withStoredDestination();
    const stored = await destinations.findByUsername(alice);
    if (stored === undefined) {
      throw new Error('the fixture failed to store a destination');
    }
    await destinations.save(stored.withPassword('sealed-by-another-key'));

    await new CheckSyncDestination({
      destinations,
      opener: new FakeOpener(),
      probe: new RecordingProbe({ ok: true }),
      clock: () => NOW,
    }).execute(alice);

    const after = await destinations.findByUsername(alice);
    expect(after?.lastCheck?.ok).toBe(false);
    expect(after?.lastCheck?.detail).toContain('type it in again');
  });

  it('should_not_blame_the_password_when_the_probe_itself_could_not_run', async () => {
    // ssh missing, the binary refusing to start, anything the adapter throws:
    // telling a member to retype a password that is perfectly fine sends them
    // chasing the wrong thing
    const destinations = await withStoredDestination();
    const brokenProbe: RemoteProbePort = {
      probe: () => Promise.reject(new Error('sshpass: command not found')),
    };

    await new CheckSyncDestination({
      destinations,
      opener: new FakeOpener(),
      probe: brokenProbe,
      clock: () => NOW,
    }).execute(alice);

    const after = await destinations.findByUsername(alice);
    expect(after?.lastCheck?.ok).toBe(false);
    expect(after?.lastCheck?.detail).not.toContain('type it in again');
    expect(after?.lastCheck?.detail).toContain('could not run');
  });

  it('should_do_nothing_when_the_member_configured_no_destination', async () => {
    const destinations = new InMemorySyncDestinationRepository();

    await new CheckSyncDestination({
      destinations,
      opener: new FakeOpener(),
      probe: new RecordingProbe({ ok: true }),
      clock: () => NOW,
    }).execute(alice);

    expect(await destinations.findByUsername(alice)).toBeUndefined();
  });
});
