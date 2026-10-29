import type { DebridApiKey } from '../../domain/ddl/DebridApiKey.js';
import type { FilehosterLink } from '../../domain/ddl/FilehosterLink.js';
import type { DebridPort, DebridResult } from '../../domain/ddl/ports.js';

interface WarnLog {
  warn(details: { readonly reason: string }, message: string): void;
}

// Writes every refused unlock to the worker log. The failed line shows the
// member why, but removing it erases that message: the log keeps the code
// AllDebrid answered. Only the error message is logged, never the link or the
// key, and the adapter already words its errors without the key.
export class LoggedDebrid implements DebridPort {
  constructor(
    private readonly debrid: DebridPort,
    private readonly log: WarnLog,
  ) {}

  async unlock(link: FilehosterLink, apiKey: DebridApiKey): Promise<DebridResult> {
    try {
      return await this.debrid.unlock(link, apiKey);
    } catch (error) {
      this.log.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        'debrid unlock failed',
      );
      throw error;
    }
  }
}
