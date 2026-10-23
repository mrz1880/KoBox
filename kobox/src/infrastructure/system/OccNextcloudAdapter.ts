import type { NextcloudPort } from '../../domain/installation/NextcloudPort.js';
import type { Username } from '../../domain/user/Username.js';
import { runOrThrow, type CommandRunner } from './CommandRunner.js';

const WEB_USER = 'www-data';
const OCC = '/var/www/nextcloud/occ';

// occ takes its arguments as argv, never as a shell line, so a member's name
// reaches it as one token whatever it contains. The Username value object has
// already refused anything odd, and this keeps that guarantee end to end.
export class OccNextcloudAdapter implements NextcloudPort {
  constructor(private readonly runner: CommandRunner) {}

  private occ(args: readonly string[], env?: Readonly<Record<string, string>>) {
    return {
      command: 'runuser',
      args: ['-u', WEB_USER, '--', 'php', OCC, ...args],
      ...(env !== undefined && { env }),
    };
  }

  async isInstalled(): Promise<boolean> {
    const result = await this.runner.run(this.occ(['status', '--output=json']));
    return result.exitCode === 0 && result.stdout.includes('"installed":true');
  }

  async install(adminUser: string, adminPassword: string): Promise<void> {
    // occ offers --password-from-env for user:add but nothing equivalent for
    // maintenance:install, so this one password does travel in argv. It is
    // visible in /proc for the life of a short root-only process, once, on a
    // box being installed. Worth writing down rather than leaving to be
    // rediscovered as a surprise.
    await runOrThrow(
      this.runner,
      this.occ([
        'maintenance:install',
        '--database=sqlite',
        `--admin-user=${adminUser}`,
        `--admin-pass=${adminPassword}`,
        '--data-dir=/var/lib/nextcloud/data',
      ]),
    );
  }

  async enableApp(app: string): Promise<void> {
    await runOrThrow(this.runner, this.occ(['app:enable', app]));
  }

  async serveAt(address: { readonly host: string; readonly port: number }): Promise<void> {
    const settings: readonly (readonly string[])[] = [
      // index 0 stays localhost: occ and the box itself still reach it that way
      ['trusted_domains', '0', '--value=localhost'],
      ['trusted_domains', '1', `--value=${address.host}`],
      ['overwritewebroot', '--value=/nextcloud'],
      ['overwriteprotocol', '--value=https'],
      ['overwrite.cli.url', `--value=https://${address.host}:${String(address.port)}/nextcloud`],
    ];
    for (const setting of settings) {
      await runOrThrow(this.runner, this.occ(['config:system:set', ...setting]));
    }
  }

  async hasUser(username: Username): Promise<boolean> {
    const info = await this.runner.run(this.occ(['user:info', username.value]));
    return info.exitCode === 0;
  }

  async ensureUser(username: Username, password: string): Promise<void> {
    if (await this.hasUser(username)) {
      return;
    }
    await runOrThrow(
      this.runner,
      this.occ(['user:add', '--password-from-env', username.value], {
        OC_PASS: password,
      }),
    );
  }

  async deleteUser(username: Username): Promise<void> {
    await runOrThrow(this.runner, this.occ(['user:delete', username.value]));
  }

  async setAdmin(username: Username, admin: boolean): Promise<void> {
    await runOrThrow(
      this.runner,
      this.occ([admin ? 'group:adduser' : 'group:removeuser', 'admin', username.value]),
    );
  }

  async ensureLocalMount(username: Username, label: string, absolutePath: string): Promise<void> {
    const listed = await this.runner.run(this.occ(['files_external:list', '--output=json']));
    if (listed.exitCode === 0 && listed.stdout.includes(`"${label}"`)) {
      return;
    }
    const created = await this.runner.run(
      this.occ(['files_external:create', `/${label}`, 'local', 'null::null', '--output=json']),
    );
    const mountId = created.stdout.trim();
    if (mountId === '') {
      return;
    }
    await runOrThrow(
      this.runner,
      this.occ(['files_external:config', mountId, 'datadir', absolutePath]),
    );
    await runOrThrow(this.runner, this.occ(['files_external:applicable', mountId, '--add-user', username.value]));
  }
}
