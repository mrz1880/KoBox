// rtorrent session directory of an instance. Trailing slash included because
// rtorrent's session.path.set expects a directory path ending with '/'.
export class SessionDir {
  private constructor(readonly value: string) {}

  static forHome(home: string): SessionDir {
    return new SessionDir(`${home.replace(/\/$/, '')}/rtorrent/.session/`);
  }

  toString(): string {
    return this.value;
  }
}
