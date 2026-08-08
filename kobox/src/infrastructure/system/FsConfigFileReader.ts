import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConfigFileContent,
  ConfigFileReaderPort,
} from '../../application/installation/ConfigFileReaderPort.js';
import type { ConfigDocument } from '../../domain/installation/ConfigDocument.js';

// Comfortably above every file KoBox renders, while still bounded: the per-user
// nginx map grows with the member list, and nothing should try to paint an
// unbounded file into a browser.
const MAX_BYTES = 256 * 1024;

export class FsConfigFileReader implements ConfigFileReaderPort {
  // `root` exists so tests can point the reader at a temp tree; on a real box
  // it stays '/' and the document's own absolute path is what is opened.
  constructor(private readonly root = '/') {}

  async read(document: ConfigDocument): Promise<ConfigFileContent | undefined> {
    // the path comes from the closed catalog, never from a request: there is no
    // user input to sanitise here because none reaches this line
    const target = join(this.root, document.path);
    let raw: Buffer;
    try {
      raw = await readFile(target);
    } catch {
      // absent (component not installed) and unreadable read the same from
      // here, and both mean the same thing to the page: nothing to show
      return undefined;
    }
    const truncated = raw.byteLength > MAX_BYTES;
    return {
      content: truncated ? raw.subarray(0, MAX_BYTES).toString('utf8') : raw.toString('utf8'),
      truncated,
    };
  }
}
