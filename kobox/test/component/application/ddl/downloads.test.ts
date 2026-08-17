import { beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '../../../../src/application/jobs/contract.js';
import type { ClaimedJob, JobQueuePort } from '../../../../src/application/jobs/JobQueuePort.js';
import { PollDebridDownloads } from '../../../../src/application/ddl/PollDebridDownloads.js';
import { RequestDebridDownload } from '../../../../src/application/ddl/RequestDebridDownload.js';
import {
  NO_DEBRID_ACCOUNT,
  StartDebridDownload,
} from '../../../../src/application/ddl/StartDebridDownload.js';
import { DirectUrl } from '../../../../src/domain/ddl/DirectUrl.js';
import { DownloadGid } from '../../../../src/domain/ddl/DownloadGid.js';
import { FilehosterLink } from '../../../../src/domain/ddl/FilehosterLink.js';
import { DebridApiKey } from '../../../../src/domain/ddl/DebridApiKey.js';
import type {
  DebridCredentialsPort,
  DebridPort,
  DebridResult,
  DownloaderPort,
  DownloadPlacementPort,
  DownloadState,
} from '../../../../src/domain/ddl/ports.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryDebridDownloadRepository } from '../../../../src/infrastructure/persistence/InMemoryDebridDownloadRepository.js';

const GID = DownloadGid.parse('2089b05ecca3d829');

class FakeDebrid implements DebridPort {
  result: DebridResult = { direct: DirectUrl.parse('https://cdn.example/f.mkv'), filename: 'f.mkv' };
  failWith: Error | undefined;
  readonly usedKeys: string[] = [];
  unlock(_link: FilehosterLink, apiKey: DebridApiKey): Promise<DebridResult> {
    this.usedKeys.push(apiKey.reveal());
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve(this.result);
  }
}

// each user brings their own key; undefined = no account configured
class FakeCredentials implements DebridCredentialsPort {
  private readonly keys = new Map<string, DebridApiKey>();
  set(username: string, key: string): void {
    this.keys.set(username, DebridApiKey.parse(key));
  }
  forUser(username: Username): Promise<DebridApiKey | undefined> {
    return Promise.resolve(this.keys.get(username.value));
  }
}

class FakeDownloader implements DownloaderPort {
  readonly added: { url: string; dir: string }[] = [];
  state: DownloadState = { state: 'active' };
  addUri(url: DirectUrl, dir: string): Promise<DownloadGid> {
    this.added.push({ url: url.value, dir });
    return Promise.resolve(GID);
  }
  status(): Promise<DownloadState> {
    return Promise.resolve(this.state);
  }
}

class FakePlacement implements DownloadPlacementPort {
  readonly placed: { staged: string; username: string }[] = [];
  rejectFor: string | undefined;
  place(staged: string, username: Username, category: Label): Promise<string> {
    this.placed.push({ staged, username: username.value });
    if (this.rejectFor === username.value) {
      return Promise.reject(new Error('ENOENT: staged file already gone'));
    }
    return Promise.resolve(`/home/${username.value}/rtorrent/complete/${category.value}/Movie.mkv`);
  }
}

class RecordingQueue implements JobQueuePort {
  readonly jobs: Job[] = [];
  enqueue(job: Job): Promise<number> {
    this.jobs.push(job);
    return Promise.resolve(this.jobs.length);
  }
  enqueueUnique(job: Job): Promise<number | undefined> {
    return this.enqueue(job);
  }
  claimNextPending(): Promise<ClaimedJob | undefined> {
    return Promise.resolve(undefined);
  }
  markDone(): Promise<void> {
    return Promise.resolve();
  }
  markFailed(): Promise<void> {
    return Promise.resolve();
  }
  recoverStale(): Promise<number> {
    return Promise.resolve(0);
  }
}

const alice = Username.parse('alice');
const link = FilehosterLink.parse('https://1fichier.example/abc');
const now = (): string => '2026-07-26 12:00:00';

let repo: InMemoryDebridDownloadRepository;
let debrid: FakeDebrid;
let downloader: FakeDownloader;
let placement: FakePlacement;
let credentials: FakeCredentials;
let queue: RecordingQueue;

beforeEach(() => {
  repo = new InMemoryDebridDownloadRepository();
  debrid = new FakeDebrid();
  downloader = new FakeDownloader();
  placement = new FakePlacement();
  credentials = new FakeCredentials();
  credentials.set('alice', 'ALICEKEYALICEKEY');
  credentials.set('bob', 'BOBKEYBOBKEYBOBKEY');
  queue = new RecordingQueue();
});

describe('RequestDebridDownload', () => {
  it('should_persist_a_pending_row_and_enqueue_a_job', async () => {
    const uc = new RequestDebridDownload({ repo, queue, clock: now });

    const id = await uc.execute({ username: alice, category: Label.parse('films'), link });

    const saved = await repo.findById(id);
    expect(saved?.status).toBe('pending');
    expect(saved?.username.value).toBe('alice');
    expect(queue.jobs).toEqual([{ type: 'debrid-download', payload: { downloadId: id } }]);
  });
});

describe('StartDebridDownload', () => {
  function start() {
    return new StartDebridDownload({ repo, debrid, credentials, downloader, stagingBase: '/var/lib/kobox-aria2' });
  }

  it('should_unlock_add_to_aria2_and_record_the_gid', async () => {
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: alice,
      category: Label.parse('films'),
      link,
    });

    await start().execute({ downloadId: id });

    const saved = await repo.findById(id);
    expect(saved?.status).toBe('downloading');
    expect(saved?.gid?.value).toBe('2089b05ecca3d829');
    // per-user staging dir, direct URL from the debrid unlock
    expect(downloader.added).toEqual([
      { url: 'https://cdn.example/f.mkv', dir: '/var/lib/kobox-aria2/alice' },
    ]);
  });

  it('should_mark_the_row_failed_when_the_debrid_unlock_fails', async () => {
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: alice,
      category: Label.parse('films'),
      link,
    });
    debrid.failWith = new Error('host not supported');

    await start().execute({ downloadId: id });

    const saved = await repo.findById(id);
    expect(saved?.status).toBe('failed');
    expect(saved?.error).toContain('host not supported');
  });

  it('should_unlock_with_the_requesting_users_own_key', async () => {
    const bob = Username.parse('bob');
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: bob,
      category: Label.parse('films'),
      link,
    });

    await start().execute({ downloadId: id });

    // bob's key, not alice's and not a shared instance one
    expect(debrid.usedKeys).toEqual(['BOBKEYBOBKEYBOBKEY']);
  });

  it('should_fail_the_row_actionably_when_the_user_has_no_debrid_account', async () => {
    const stranger = Username.parse('nokey');
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: stranger,
      category: Label.parse('films'),
      link,
    });

    await start().execute({ downloadId: id });

    const saved = await repo.findById(id);
    expect(saved?.status).toBe('failed');
    expect(saved?.error).toBe(NO_DEBRID_ACCOUNT);
    // no account is never fatal: the API was never called, nothing threw
    expect(debrid.usedKeys).toHaveLength(0);
    expect(downloader.added).toHaveLength(0);
  });

  it('should_be_idempotent_and_skip_a_non_pending_row', async () => {
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: alice,
      category: Label.parse('films'),
      link,
    });
    await start().execute({ downloadId: id }); // -> downloading

    await start().execute({ downloadId: id }); // no-op

    expect(downloader.added).toHaveLength(1);
  });
});

describe('PollDebridDownloads', () => {
  async function anActiveDownload(): Promise<number> {
    const id = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: alice,
      category: Label.parse('films'),
      link,
    });
    await new StartDebridDownload({
      repo,
      debrid,
      credentials,
      downloader,
      stagingBase: '/var/lib/kobox-aria2',
    }).execute({ downloadId: id });
    return id;
  }

  function poll() {
    return new PollDebridDownloads({ repo, downloader, placement });
  }

  it('should_place_the_file_and_complete_on_a_finished_download', async () => {
    const id = await anActiveDownload();
    downloader.state = { state: 'complete', filePath: '/var/lib/kobox-aria2/alice/Movie.mkv' };

    await poll().execute();

    expect(placement.placed).toEqual([{ staged: '/var/lib/kobox-aria2/alice/Movie.mkv', username: 'alice' }]);
    const saved = await repo.findById(id);
    expect(saved?.status).toBe('done');
    expect(saved?.filename).toBe('Movie.mkv');
  });

  it('should_fail_the_row_on_an_aria2_error', async () => {
    const id = await anActiveDownload();
    downloader.state = { state: 'error', message: 'connection timed out' };

    await poll().execute();

    expect((await repo.findById(id))?.status).toBe('failed');
    expect(placement.placed).toHaveLength(0);
  });

  it('should_leave_a_still_running_download_alone', async () => {
    const id = await anActiveDownload();
    downloader.state = { state: 'active' };

    await poll().execute();

    expect((await repo.findById(id))?.status).toBe('downloading');
  });

  it('should_isolate_a_failing_row_and_still_advance_the_rest_of_the_batch', async () => {
    // two finished downloads; placement wedges on the first (its staged file is
    // gone after a mid-run crash). The failure must fail just that row, not
    // abort the loop and starve the second.
    const bob = Username.parse('bob');
    const aliceId = await anActiveDownload();
    const bobId = await new RequestDebridDownload({ repo, queue, clock: now }).execute({
      username: bob,
      category: Label.parse('series'),
      link,
    });
    await new StartDebridDownload({
      repo,
      debrid,
      credentials,
      downloader,
      stagingBase: '/var/lib/kobox-aria2',
    }).execute({ downloadId: bobId });
    downloader.state = { state: 'complete', filePath: '/var/lib/kobox-aria2/x/Movie.mkv' };
    placement.rejectFor = 'alice';

    await poll().execute();

    expect((await repo.findById(aliceId))?.status).toBe('failed');
    expect((await repo.findById(bobId))?.status).toBe('done'); // not starved
    expect(placement.placed.map((p) => p.username)).toEqual(
      expect.arrayContaining(['alice', 'bob']),
    );
  });
});
