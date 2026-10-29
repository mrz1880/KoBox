import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ComponentName } from '../../../../src/domain/installation/ComponentName.js';
import { ConfigDocument } from '../../../../src/domain/installation/ConfigDocument.js';
import { InstallState } from '../../../../src/domain/installation/InstallState.js';
import { Version } from '../../../../src/domain/installation/Version.js';
import { Bandwidth } from '../../../../src/domain/security/Bandwidth.js';
import { DynDnsHost } from '../../../../src/domain/security/DynDnsHost.js';
import { Speedtest } from '../../../../src/domain/maintenance/speedtest.js';
import { MediaFile, MediaPath } from '../../../../src/domain/media/MediaFile.js';
import { Language } from '../../../../src/domain/portal/Language.js';
import { IpAddress } from '../../../../src/domain/shared/IpAddress.js';
import { LocalPath } from '../../../../src/domain/sync/LocalPath.js';
import { LoneFilePlacement } from '../../../../src/domain/sync/LoneFilePlacement.js';
import { RemoteAccount } from '../../../../src/domain/sync/RemoteAccount.js';
import { RemoteHost } from '../../../../src/domain/sync/RemoteHost.js';
import { RemotePath } from '../../../../src/domain/sync/RemotePath.js';
import { RemotePort } from '../../../../src/domain/sync/RemotePort.js';
import { SendHour } from '../../../../src/domain/sync/SendHour.js';
import { SyncDestination } from '../../../../src/domain/sync/SyncDestination.js';
import { SyncTransfer, type TransferState } from '../../../../src/domain/sync/SyncTransfer.js';
import { TransferBatchSize } from '../../../../src/domain/sync/TransferBatchSize.js';
import { Label } from '../../../../src/domain/torrent/Label.js';
import { RecyclingMode } from '../../../../src/domain/torrent/RecyclingMode.js';
import { SyncMode } from '../../../../src/domain/torrent/SyncMode.js';
import { TorrentInstance } from '../../../../src/domain/torrent/TorrentInstance.js';
import { WatchDir } from '../../../../src/domain/torrent/WatchDir.js';
import { Blocklist } from '../../../../src/domain/tracker/Blocklist.js';
import { BlocklistSource } from '../../../../src/domain/tracker/BlocklistSource.js';
import { BlocklistUrl } from '../../../../src/domain/tracker/BlocklistUrl.js';
import { RtorrentPort, ScgiPort } from '../../../../src/domain/user/Port.js';
import { Quota } from '../../../../src/domain/user/Quota.js';
import { SshPublicKey } from '../../../../src/domain/user/SshPublicKey.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { adminConfigPage } from '../../../../src/interfaces/http/views/adminConfigPage.js';
import {
  adminLogsPage,
  adminPackagesPage,
} from '../../../../src/interfaces/http/views/adminDiagnosticsPage.js';
import { adminDomainPage } from '../../../../src/interfaces/http/views/adminDomainPage.js';
import { adminGroupPage } from '../../../../src/interfaces/http/views/adminGroupPage.js';
import { ADMIN_GROUPS } from '../../../../src/interfaces/http/views/adminGroups.js';
import { adminMailPage } from '../../../../src/interfaces/http/views/adminMailPage.js';
import {
  adminAddressesPage,
  adminFairUsePage,
} from '../../../../src/interfaces/http/views/adminNetworkPage.js';
import { adminHealthPage, adminMailsPage } from '../../../../src/interfaces/http/views/adminOpsPage.js';
import {
  adminBlocklistsPage,
  adminTrackersPage,
} from '../../../../src/interfaces/http/views/adminTrackersPage.js';
import {
  adminUserDetailPage,
  adminUsersPage,
} from '../../../../src/interfaces/http/views/adminUsersPage.js';
import type { Reader, Viewer } from '../../../../src/interfaces/http/views/layout.js';
import { loginPage, twoStepCodePage } from '../../../../src/interfaces/http/views/loginPage.js';
import { frenchSentences, hasFrench, type Translate } from '../../../../src/interfaces/http/views/messages.js';
import {
  choosePasswordPage,
  forgotPasswordPage,
  forgotPasswordSentPage,
  invitationLinkPage,
  passwordChosenPage,
  passwordLinkClosedPage,
} from '../../../../src/interfaces/http/views/passwordLinkPages.js';
import { syncPage } from '../../../../src/interfaces/http/views/syncPage.js';
import {
  accessPage,
  adminHomePage,
  filesPage,
  mediaPage,
  mediaWatchPage,
  monitoringPage,
  passwordPage,
  rutorrentPage,
  twoStepSetupPage,
  userHomePage,
} from '../../../../src/interfaces/http/views/userPages.js';
import { aUser } from '../../../builders/UserBuilder.js';
import { TrackerBuilder } from '../../../builders/TrackerBuilder.js';
import { accessFacts, signalRow } from './viewFixtures.js';

const NOW = '2026-10-28 10:00:00';
const ED25519 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7Kk1p2vQ0Hn3xYqZ8mLsRtWuVdEfGhIjKlMnOpQrSt';
const alice = Username.parse('alice');
const films = Label.parse('films');

function media(path: string): MediaFile {
  return MediaFile.record({ username: alice, path: MediaPath.parse(path), sizeBytes: 1024 ** 3, indexedAt: NOW });
}

function destination(lastCheck?: SyncDestination['lastCheck']): SyncDestination {
  return SyncDestination.restore({
    username: alice,
    host: RemoteHost.parse('nas.example.org'),
    port: RemotePort.parse(22),
    account: RemoteAccount.parse('seedbox'),
    sealedPassword: 'sealed',
    path: RemotePath.parse('/volume1/torrents'),
    batchSize: TransferBatchSize.unlimited(),
    placement: LoneFilePlacement.besideTheOthers,
    sendHour: SendHour.default(),
    ...(lastCheck === undefined ? {} : { lastCheck }),
  });
}

function transfer(state: TransferState): SyncTransfer {
  return SyncTransfer.restore({
    id: 1,
    username: alice,
    label: films,
    source: LocalPath.parse('/home/alice/rtorrent/complete/films/Some.Film.mkv'),
    state,
    attempts: 1,
    queuedAt: NOW,
    updatedAt: NOW,
  });
}

function instance(allowPublicTracker: boolean, syncDisabled: boolean): TorrentInstance {
  return TorrentInstance.restore({
    username: alice,
    scgiPort: ScgiPort.parse(51101),
    rtorrentPort: RtorrentPort.parse(45000),
    watchDirs: [WatchDir.root()],
    allowPublicTracker,
    recycling: RecyclingMode.none,
    syncDisabled,
  });
}

function blocklist(lastUpdate?: Blocklist['lastUpdate']): Blocklist {
  return Blocklist.restore({
    source: BlocklistSource.parse('iblocklist'),
    author: 'Example Org',
    name: 'level1',
    url: BlocklistUrl.parse('https://list.example.org/?list=abc'),
    subscription: false,
    enabled: true,
    ...(lastUpdate === undefined ? {} : { lastUpdate }),
  });
}

function component(state: string): { name: ComponentName; state: InstallState; version: Version } {
  return { name: ComponentName.parse('nginx'), state: InstallState.parse(state), version: Version.parse('1.22.1') };
}

// Every page, through the branches that carry words, read by a viewer whose
// lookup writes down each key it is asked for.
function keysSentToTheCatalogue(): ReadonlySet<string> {
  const keys = new Set<string>();
  const t: Translate = (english) => {
    keys.add(english);
    return english;
  };
  const reader: Reader = { language: Language.fr, t };
  const member: Viewer = { ...reader, username: 'alice', role: 'user', csrfToken: 'csrf' };
  const admin: Viewer = { ...reader, username: 'bob', role: 'admin', csrfToken: 'csrf' };
  const user = aUser().build();

  loginPage(reader);
  twoStepCodePage(reader);
  forgotPasswordPage(reader);
  forgotPasswordSentPage(reader);
  choosePasswordPage(reader, '/password-link');
  passwordChosenPage(reader);
  passwordLinkClosedPage(reader);
  invitationLinkPage('alice', 'https://seedbox.example.org/password-link/abc', admin);

  for (const row of [
    signalRow(),
    signalRow({ suspended: true }),
    signalRow({ healthy: false }),
    signalRow({ level: 'throttled' }),
    signalRow({ level: 'alerted' }),
  ]) {
    userHomePage(user, member, row);
  }
  passwordPage(member);
  twoStepSetupPage(member, 'alice', 'JBSWY3DPEHPK3PXP');
  for (const nextcloudInstalled of [true, false]) {
    filesPage(member, {
      username: 'alice',
      nextcloudInstalled,
      nextcloudHref: '/nextcloud/',
      sftpHost: 'seedbox.example.org',
      boxInVpn: '10.0.0.1',
    });
  }
  accessPage(member, accessFacts());
  accessPage(member, accessFacts({ currentAddress: '203.0.113.20' }));
  accessPage(
    member,
    accessFacts({
      sftpHost: 'seedbox.example.org',
      hasAppToken: true,
      freshToken: 'token',
      sshKey: SshPublicKey.parse(`${ED25519} laptop@home`),
      sshKeyAddedAt: NOW,
      addresses: ['203.0.113.20'],
      hostnames: [{ host: 'myhome.example.org' }, { host: 'office.example.org', pointsAt: '203.0.113.21' }],
      hasTwoStep: true,
      currentAddress: '203.0.113.20',
      chosenLanguage: Language.fr,
    }),
  );
  mediaPage(member, [], []);
  mediaPage(member, [media('films/a.mp4'), media('films/b.mkv'), media('films/c.txt'), media('loose.mp4')], [films, Label.parse('series')]);
  mediaWatchPage(member, media('films/a.mp4'));
  rutorrentPage(member);

  syncPage({ categories: [], holding: new Set() }, undefined, [], member);
  syncPage(
    { categories: [WatchDir.labeled(films, SyncMode.scheduled), WatchDir.labeled(Label.parse('series'))], holding: new Set(['films']) },
    destination({ ok: true, at: NOW, detail: 'connected', fingerprint: 'SHA256:abc' }),
    (['waiting', 'sending', 'sent', 'failed'] as const).map(transfer),
    member,
  );
  syncPage({ categories: [], holding: new Set() }, destination(), [], member);
  syncPage({ categories: [], holding: new Set() }, destination({ ok: false, at: NOW }), [], member);

  for (const coverage of ['blocking', 'no-list-enabled', 'not-downloaded-yet'] as const) {
    adminHomePage(
      [signalRow(), signalRow({ username: 'bob', suspended: true }), signalRow({ healthy: false, level: 'alerted' })],
      coverage,
      admin,
    );
  }
  // a box where nobody sent anything has no busiest channel to scale against
  adminHomePage([signalRow({ egressBytes: 0 })], 'blocking', admin);
  for (const available of [true, false]) {
    monitoringPage(admin, available);
  }
  const [document] = ConfigDocument.all();
  adminConfigPage(undefined, undefined, admin);
  adminConfigPage(document, undefined, admin);
  adminConfigPage(document, { content: 'line', truncated: true }, admin);
  for (const group of ADMIN_GROUPS) {
    adminGroupPage(group, admin);
  }
  adminLogsPage([], admin);
  adminLogsPage([{ unit: 'kobox-portal', content: 'line', capturedAt: NOW }], admin);
  adminPackagesPage(undefined, admin);
  for (const upgradableCount of [0, 1, 2]) {
    adminPackagesPage({ listing: 'nginx', upgradableCount, checkedAt: NOW }, admin);
  }
  adminDomainPage(undefined, admin);
  adminDomainPage({ domain: 'seedbox.example.org', email: 'bob@example.org' }, admin);
  adminMailPage(undefined, admin);
  adminMailPage({ host: 'smtp.example.org', port: 587, user: 'bob', sealedPassword: 'sealed' }, admin);
  adminAddressesPage(
    [{ username: alice, ip: IpAddress.parse('203.0.113.20') }],
    [
      { username: alice, host: DynDnsHost.parse('myhome.example.org') },
      { username: alice, host: DynDnsHost.parse('office.example.org'), resolvedIp: IpAddress.parse('203.0.113.21') },
    ],
    admin,
  );
  adminFairUsePage(
    (['none', 'alerted', 'throttled'] as const).map((level) => ({
      username: 'alice',
      level,
      health: 'healthy',
      sample: { egressBytes: 1024 ** 3, ingressBytes: 1024 ** 3, sampledAt: NOW },
      events: [{ eventType: 'alerted', detailJson: '{}', createdAt: NOW }],
    })),
    admin,
  );
  for (const speedtestAvailable of [true, false]) {
    adminHealthPage(
      [
        { name: 'nginx', state: 'healthy' },
        { name: 'rtorrent', state: 'unhealthy', detail: 'down' },
      ],
      ['installed', 'failed', 'skipped', 'to_install'].map(component),
      [{ id: 1, ref: 'v1.0.0', path: '/opt/kobox/releases/v1.0.0', state: 'current', createdAt: NOW }],
      admin,
      [
        Speedtest.record({
          download: Bandwidth.mbit(100),
          upload: Bandwidth.mbit(50),
          latencyMs: 12,
          server: 'speed.example.org',
          measuredAt: NOW,
        }),
      ],
      speedtestAvailable,
    );
  }
  adminHealthPage([], [], [], admin);
  adminMailsPage(
    (['sent', 'failed', 'pending'] as const).map((status) => ({
      id: 1,
      recipient: 'alice@example.org',
      subject: 'Hello',
      body: 'Hello',
      status,
      attempts: 1,
      nextAttemptAt: NOW,
      createdAt: NOW,
    })),
    admin,
  );
  adminTrackersPage(
    [
      new TrackerBuilder().build(),
      new TrackerBuilder().withHost('plain.example.org').withProto('http', 80).build(),
      new TrackerBuilder().withHost('gone.example.org').deadTracker().build(),
    ],
    admin,
  );
  adminBlocklistsPage([blocklist(), blocklist({ status: 'ok', at: NOW }), blocklist({ status: 'failed' })], admin);
  adminUsersPage(
    [aUser().build(), aUser().withUsername('bob').suspended(), aUser().withUsername('carol').build()],
    new Map([
      ['alice', { role: 'user' as const, invited: false }],
      ['bob', { role: 'admin' as const, invited: true }],
    ]),
    admin,
  );
  adminUserDetailPage(user, admin, undefined, 'active');
  adminUserDetailPage(aUser().suspended(), admin, 'user', 'invited', instance(true, true), {
    username: alice,
    used: Quota.gib(10),
    sampledAt: NOW,
  });
  adminUserDetailPage(user, admin, 'admin', 'active', instance(false, false));
  return keys;
}

describe('the French catalogue', () => {
  // A string a page sends to t() with no French renders in English to a French
  // reader. That fallback keeps the page whole, which is also why nothing else
  // would ever notice the gap.
  it('should_have_a_french_line_for_every_string_a_page_sends_to_it', () => {
    const missing = [...keysSentToTheCatalogue()].filter((key) => !hasFrench(key)).sort();

    expect(missing).toEqual([]);
  });

  // The other way round: a line whose English no source file spells any more
  // is dead weight, and it once hid a route that built its flash with the
  // member's name inside, so the catalogue never matched. A sentence reaches
  // t() as a literal, quoted whole, so the source has to hold it whole too.
  it('should_hold_no_french_line_that_the_code_no_longer_sends', () => {
    const source = sourceFiles(SOURCE_ROOT)
      .filter((file) => file !== CATALOGUE_FILE)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const quoted = (english: string): readonly string[] => [
      `'${english.replaceAll("'", "\\'")}'`,
      `"${english}"`,
      `\`${english}\``,
    ];

    const orphans = frenchSentences().filter(
      (english) => !quoted(english).some((literal) => source.includes(literal)),
    );

    expect(orphans).toEqual([]);
  });
});

const SOURCE_ROOT = 'src';
const CATALOGUE_FILE = join(SOURCE_ROOT, 'interfaces', 'http', 'views', 'messages.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
}
