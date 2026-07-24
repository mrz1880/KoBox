export class TorrentInstanceNotFoundError extends Error {
  constructor(username: string) {
    super(`no rtorrent instance provisioned for ${username}`);
    this.name = 'TorrentInstanceNotFoundError';
  }
}
