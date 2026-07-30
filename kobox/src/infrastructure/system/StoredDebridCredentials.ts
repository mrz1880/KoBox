import type { DebridApiKey } from '../../domain/ddl/DebridApiKey.js';
import type {
  DebridAccountRepository,
  DebridCredentialsPort,
  DebridKeyDecryptorPort,
} from '../../domain/ddl/ports.js';
import type { Username } from '../../domain/user/Username.js';

// Turns the stored ciphertext into a usable key. Worker-side only: it needs the
// decryptor, which needs the root-only private PEM. No row = no account, which
// is a normal state (undefined), not an error.
export class StoredDebridCredentials implements DebridCredentialsPort {
  constructor(
    private readonly accounts: DebridAccountRepository,
    private readonly decryptor: DebridKeyDecryptorPort,
  ) {}

  async forUser(username: Username): Promise<DebridApiKey | undefined> {
    const sealed = await this.accounts.findEncrypted(username);
    if (sealed === undefined) {
      return undefined;
    }
    return this.decryptor.decrypt(sealed);
  }
}
