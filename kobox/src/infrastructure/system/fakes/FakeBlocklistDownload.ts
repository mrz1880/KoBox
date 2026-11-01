import type {
  BlocklistDownloadPort,
  DownloadedList,
  DownloadFailure,
} from '../../../domain/tracker/ports.js';

export class FakeBlocklistDownload implements BlocklistDownloadPort {
  private readonly byUrl = new Map<string, DownloadedList>();
  readonly requestedUrls: string[] = [];

  givenList(url: string, list: DownloadedList): void {
    this.byUrl.set(url, list);
  }

  fetch(url: string): Promise<DownloadedList | DownloadFailure> {
    this.requestedUrls.push(url);
    return Promise.resolve(this.byUrl.get(url) ?? { failure: 'no list served at that address' });
  }
}
