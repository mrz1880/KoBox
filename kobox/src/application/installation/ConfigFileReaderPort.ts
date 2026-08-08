import type { ConfigDocument } from '../../domain/installation/ConfigDocument.js';

export interface ConfigFileContent {
  readonly content: string;
  // true when the file was longer than the page is willing to render
  readonly truncated: boolean;
}

// Read-only, by design and by interface: there is no write, no upload and no
// delete to leave out later. A screen that can edit /etc from a browser is a
// root shell, whatever the form around it looks like.
export interface ConfigFileReaderPort {
  read(document: ConfigDocument): Promise<ConfigFileContent | undefined>;
}
