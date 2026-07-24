import type { RenderedFile, RtorrentConfigPort } from '../../../domain/torrent/ports.js';

export class FakeRtorrentConfig implements RtorrentConfigPort {
  private readonly files = new Map<string, RenderedFile>();

  apply(files: readonly RenderedFile[]): Promise<readonly string[]> {
    const changed: string[] = [];
    for (const file of files) {
      if (this.files.get(file.path)?.content !== file.content) {
        changed.push(file.path);
      }
      this.files.set(file.path, file);
    }
    return Promise.resolve(changed);
  }

  contentAt(path: string): string | undefined {
    return this.files.get(path)?.content;
  }

  fileAt(path: string): RenderedFile | undefined {
    return this.files.get(path);
  }
}
