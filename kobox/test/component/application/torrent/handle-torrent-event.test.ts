import { beforeEach, describe, expect, it } from 'vitest';
import { HandleTorrentEvent } from '../../../../src/application/torrent/HandleTorrentEvent.js';
import { InfoHash } from '../../../../src/domain/torrent/InfoHash.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import type { ContentRecyclerPort, TorrentMetainfo } from '../../../../src/domain/torrent/ports.js';
import { RecyclingMode } from '../../../../src/domain/torrent/RecyclingMode.js';
import { Torrent } from '../../../../src/domain/torrent/Torrent.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { InMemoryMailOutbox } from '../../../../src/infrastructure/persistence/InMemoryMailOutbox.js';
import { InMemoryTorrentInstanceRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentInstanceRepository.js';
import { InMemoryTorrentRepository } from '../../../../src/infrastructure/persistence/InMemoryTorrentRepository.js';
import { InMemoryUserRepository } from '../../../../src/infrastructure/persistence/InMemoryUserRepository.js';
import { FakeAnnouncerSink } from '../../../../src/infrastructure/system/fakes/FakeAnnouncerSink.js';
import { FakeFileIndex } from '../../../../src/infrastructure/system/fakes/FakeFileIndex.js';
import { FakeRtorrentControl } from '../../../../src/infrastructure/system/fakes/FakeRtorrentControl.js';
import { FakeTorrentFiling } from '../../../../src/infrastructure/system/fakes/FakeTorrentFiling.js';
import { FakeTorrentMetainfo } from '../../../../src/infrastructure/system/fakes/FakeTorrentMetainfo.js';
import { FakeUserScriptRunner } from '../../../../src/infrastructure/system/fakes/FakeUserScriptRunner.js';
import { aUser } from '../../../builders/UserBuilder.js';

const alice = Username.parse('alice');
const HASH = InfoHash.parse('a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0');
const TORRENT_FILE = '/home/alice/rtorrent/torrents/x.torrent';

class NoRecycling implements ContentRecyclerPort {
  replicate(): Promise<void> {
    return Promise.resolve();
  }
}

class UnreachableOutbox extends InMemoryMailOutbox {
  override enqueue(): Promise<number> {
    return Promise.reject(new Error('database locked'));
  }
}

let instances: InMemoryTorrentInstanceRepository;
let torrents: InMemoryTorrentRepository;
let meta: FakeTorrentMetainfo;
let control: FakeRtorrentControl;
let scripts: FakeUserScriptRunner;
let announcers: FakeAnnouncerSink;
let outbox: InMemoryMailOutbox;
let handleEvent: HandleTorrentEvent;
let deps: ConstructorParameters<typeof HandleTorrentEvent>[0];

beforeEach(async () => {
  instances = new InMemoryTorrentInstanceRepository();
  torrents = new InMemoryTorrentRepository();
  meta = new FakeTorrentMetainfo();
  control = new FakeRtorrentControl();
  scripts = new FakeUserScriptRunner();
  announcers = new FakeAnnouncerSink();
  outbox = new InMemoryMailOutbox();
  const users = new InMemoryUserRepository();
  await users.save(aUser().build());
  await instances.save(
    TorrentInstance.provision({
      username: alice,
      scgiPort: ScgiPort.parse(51101),
      rtorrentPort: RtorrentPort.parse(45001),
    }).instance,
  );
  deps = {
    instances,
    torrents,
    metainfo: meta,
    control,
    scripts,
    announcers,
    users,
    outbox,
    clock: () => '2026-08-17 12:00:00',
    recycler: new NoRecycling(),
    filing: new FakeTorrentFiling(),
    fileIndex: new FakeFileIndex(),
  };
  handleEvent = new HandleTorrentEvent(deps);
});

function metainfo(overrides: Partial<TorrentMetainfo>): TorrentMetainfo {
  return { infoHash: HASH, name: 'x', isPrivate: false, announcers: [], ...overrides };
}

describe('HandleTorrentEvent', () => {
  it('should_explain_the_removal_of_a_public_torrent_in_plain_words', async () => {
    meta.preload(TORRENT_FILE, metainfo({ isPrivate: false }));

    await handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      name: 'Some Public Release',
      torrentFile: TORRENT_FILE,
    });

    const [mail] = await outbox.listRecent(1);
    expect(mail?.subject).toBe('A torrent was removed from your seedbox');
    expect(mail?.body).toBe(
      [
        '"Some Public Release" has been taken out of your seedbox.',
        '',
        'It announces to a public tracker, and this seedbox only carries private',
        'ones. Public trackers are watched by anti-piracy monitors, which puts the',
        'whole machine at risk, so the rule applies to everybody.',
        '',
        'Nothing else of yours was touched, and no files were deleted. If you think',
        'this torrent is private, tell an admin: they can check and, if they agree,',
        'allow public trackers on your account.',
      ].join('\n'),
    );
  });

  it('should_publish_nothing_for_a_torrent_without_announcers', async () => {
    // a trackerless (DHT only) torrent teaches nothing about trackers
    meta.preload(TORRENT_FILE, metainfo({ isPrivate: true, announcers: [] }));

    await handleEvent.execute({
      username: alice,
      event: 'inserted_new',
      infoHash: HASH,
      torrentFile: TORRENT_FILE,
    });

    expect(announcers.publications).toEqual([]);
    expect((await torrents.findByInfoHash(alice, HASH))?.state.value).toBe('loaded');
  });

  it('should_ignore_a_stray_finish_of_a_rejected_torrent', async () => {
    // a rejected torrent was stopped and closed: it must not come back as completed
    await torrents.upsert(alice, Torrent.load({ infoHash: HASH, name: 'x' }).reject());

    await handleEvent.execute({
      username: alice,
      event: 'finished',
      infoHash: HASH,
      name: 'x',
      basePath: '/home/alice/rtorrent/complete/x',
    });

    expect((await torrents.findByInfoHash(alice, HASH))?.state.value).toBe('rejected');
    expect(scripts.runs).toEqual([]);
  });

  it('should_record_a_finish_it_never_saw_inserted_with_its_label', async () => {
    await handleEvent.execute({
      username: alice,
      event: 'finished',
      infoHash: HASH,
      name: 'x',
      basePath: '/home/alice/rtorrent/complete/films/x',
      label: Label.parse('films'),
    });

    const torrent = await torrents.findByInfoHash(alice, HASH);
    expect(torrent?.state.value).toBe('completed');
    expect(torrent?.label?.value).toBe('films');
  });

  it('should_record_an_unlabelled_finish_without_a_label', async () => {
    await handleEvent.execute({ username: alice, event: 'finished', infoHash: HASH, name: 'x' });

    expect((await torrents.findByInfoHash(alice, HASH))?.label).toBeUndefined();
  });

  it('should_complete_with_an_empty_tree_and_pass_empty_arguments_when_rtorrent_gave_no_paths', async () => {
    await handleEvent.execute({ username: alice, event: 'finished', infoHash: HASH });

    expect((await torrents.findByInfoHash(alice, HASH))?.tree).toBe('');
    expect(scripts.runs).toEqual([
      { username: 'alice', basePath: '', directory: '', label: '', name: HASH.value },
    ]);
  });

  it('should_keep_the_tree_it_already_knew_when_the_finish_carries_no_path', async () => {
    await torrents.upsert(
      alice,
      Torrent.load({ infoHash: HASH, name: 'Known' }).complete('/home/alice/rtorrent/complete/Known'),
    );

    await handleEvent.execute({ username: alice, event: 'finished', infoHash: HASH });

    const torrent = await torrents.findByInfoHash(alice, HASH);
    expect(torrent?.tree).toBe('/home/alice/rtorrent/complete/Known');
    expect(scripts.runs[0]?.name).toBe('Known');
  });
  describe('best-effort steps that must never fail the event', () => {
    const failing = (): Promise<never> => Promise.reject(new Error('down'));

    it('should_keep_an_admitted_torrent_when_filing_it_away_fails', async () => {
      const dropped = '/home/alice/rtorrent/watch/x.torrent';
      meta.preload(dropped, metainfo({ isPrivate: true }));
      const handler = new HandleTorrentEvent({ ...deps, filing: { file: failing } });

      await expect(
        handler.execute({ username: alice, event: 'inserted_new', infoHash: HASH, torrentFile: dropped }),
      ).resolves.toBeUndefined();
      expect((await torrents.findByInfoHash(alice, HASH))?.state.value).toBe('loaded');
    });

    it('should_keep_an_admitted_torrent_when_recycling_fails', async () => {
      const bob = Username.parse('bob');
      const instance = await instances.findByUsername(alice);
      if (instance === undefined) throw new Error('alice should be provisioned');
      await instances.save(instance.setRecycling(RecyclingMode.copy));
      await torrents.upsert(
        bob,
        Torrent.load({ infoHash: HASH, name: 'x' }).complete('/home/bob/rtorrent/complete/x'),
      );
      meta.preload(TORRENT_FILE, metainfo({ isPrivate: true }));
      const handler = new HandleTorrentEvent({ ...deps, recycler: { replicate: failing } });

      await expect(
        handler.execute({
          username: alice,
          event: 'inserted_new',
          infoHash: HASH,
          torrentFile: TORRENT_FILE,
          directory: '/home/alice/rtorrent/complete',
        }),
      ).resolves.toBeUndefined();
      expect((await torrents.findByInfoHash(alice, HASH))?.state.value).toBe('loaded');
    });

    it('should_keep_the_rejection_when_the_removal_mail_cannot_be_queued', async () => {
      meta.preload(TORRENT_FILE, metainfo({ isPrivate: false }));
      const handler = new HandleTorrentEvent({ ...deps, outbox: new UnreachableOutbox() });

      await expect(
        handler.execute({ username: alice, event: 'inserted_new', infoHash: HASH, torrentFile: TORRENT_FILE }),
      ).resolves.toBeUndefined();
      expect((await torrents.findByInfoHash(alice, HASH))?.state.value).toBe('rejected');
    });
  });
});
