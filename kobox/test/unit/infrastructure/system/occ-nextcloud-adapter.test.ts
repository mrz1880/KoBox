import { describe, expect, it } from 'vitest';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../../../src/infrastructure/system/CommandRunner.js';
import { Password } from '../../../../src/domain/user/Password.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { OccNextcloudAdapter } from '../../../../src/infrastructure/system/OccNextcloudAdapter.js';

class RecordingRunner implements CommandRunner {
  readonly calls: CommandRequest[] = [];

  constructor(private readonly knownUsers: readonly string[] = []) {}

  run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    // occ user:info exits 1 for an account Nextcloud does not know
    const [subcommand, user] = request.args.slice(5);
    const unknown = subcommand === 'user:info' && !this.knownUsers.includes(user ?? '');
    return Promise.resolve({ stdout: '', stderr: '', exitCode: unknown ? 1 : 0 });
  }

  occArgs(): string[] {
    // runuser -u www-data -- php <occ> ...: keep what follows the occ path
    return this.calls.map((call) => call.args.slice(5).join(' '));
  }
}

const alice = Username.parse('alice');
const password = Password.parse('correct horse battery');

describe('OccNextcloudAdapter', () => {
  it('should_trust_the_public_name_and_answer_under_nextcloud_over_https', async () => {
    const runner = new RecordingRunner();

    await new OccNextcloudAdapter(runner).serveAt({ host: 'box.example.org', port: 8189 });

    // occ refuses root: every call runs as the web server user
    expect(runner.calls.every((call) => call.command === 'runuser')).toBe(true);
    expect(runner.calls.every((call) => call.args.slice(0, 2).join(' ') === '-u www-data')).toBe(true);
    expect(runner.occArgs()).toEqual([
      'config:system:set trusted_domains 0 --value=localhost',
      'config:system:set trusted_domains 1 --value=box.example.org',
      'config:system:set overwritewebroot --value=/nextcloud',
      'config:system:set overwriteprotocol --value=https',
      'config:system:set overwrite.cli.url --value=https://box.example.org:8189/nextcloud',
    ]);
  });

  it('should_create_a_member_on_the_first_password_without_it_reaching_argv', async () => {
    const runner = new RecordingRunner();

    await new OccNextcloudAdapter(runner).setUserPassword(alice, password);

    expect(runner.occArgs()).toEqual(['user:info alice', 'user:add --password-from-env alice']);
    expect(runner.calls.at(-1)?.env).toEqual({ OC_PASS: password.reveal() });
  });

  it('should_reset_the_password_of_a_member_nextcloud_already_knows', async () => {
    const runner = new RecordingRunner(['alice']);

    await new OccNextcloudAdapter(runner).setUserPassword(alice, password);

    expect(runner.occArgs()).toEqual([
      'user:info alice',
      'user:resetpassword --password-from-env alice',
    ]);
    expect(runner.calls.at(-1)?.env).toEqual({ OC_PASS: password.reveal() });
  });

  it('should_take_an_account_that_is_already_gone_as_deleted', async () => {
    const runner = new RecordingRunner();

    await new OccNextcloudAdapter(runner).deleteUser(alice);

    expect(runner.occArgs()).toEqual(['user:info alice']);
  });
});

// saml:config:set exits 1 for a provider that does not exist yet
class SamlProviderRunner extends RecordingRunner {
  private providerExists: boolean;

  constructor(providerExists: boolean) {
    super();
    this.providerExists = providerExists;
  }

  override run(request: CommandRequest): Promise<CommandResult> {
    this.calls.push(request);
    const subcommand = request.args[5];
    if (subcommand === 'saml:config:create') {
      this.providerExists = true;
    }
    const missing = subcommand === 'saml:config:set' && !this.providerExists;
    return Promise.resolve({ stdout: '', stderr: '', exitCode: missing ? 1 : 0 });
  }
}

describe('opening Nextcloud from the portal session', () => {
  it('should_open_sessions_from_the_variable_create_no_account_and_keep_the_sign_in_page', async () => {
    const runner = new SamlProviderRunner(true);

    await new OccNextcloudAdapter(runner).trustPortalSignIn('KOBOX_PORTAL_USER');

    expect(runner.occArgs()).toEqual([
      'config:app:set user_saml type --value=environment-variable',
      'config:app:set user_saml general-require_provisioned_account --value=1',
      'config:app:set user_saml general-nextcloud_login_form --value=1',
      'saml:config:set --general-uid_mapping=KOBOX_PORTAL_USER 1',
    ]);
  });

  // the app reads its settings from provider 1, which a fresh install lacks
  it('should_create_the_provider_the_app_reads_on_a_fresh_install', async () => {
    const runner = new SamlProviderRunner(false);

    await new OccNextcloudAdapter(runner).trustPortalSignIn('KOBOX_PORTAL_USER');

    expect(runner.occArgs().slice(3)).toEqual([
      'saml:config:set --general-uid_mapping=KOBOX_PORTAL_USER 1',
      'saml:config:create',
      'saml:config:set --general-uid_mapping=KOBOX_PORTAL_USER 1',
    ]);
  });
});
