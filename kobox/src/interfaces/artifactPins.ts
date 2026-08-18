// The environment variables that pin a vendored release, mapped to install
// settings. Extracted from the composition root for one reason: nothing could
// test that wiring, and it silently went missing for Nextcloud. The component
// was written, the installer read `install.nextcloudUrl`, and no line ever put
// a value there, so it could only ever report its honest skip. The one test
// that reaches the component exercises exactly that skip, so it passed.
//
// A pure function over an environment is testable, which is the whole point.
export interface ArtifactPins {
  readonly rutorrentUrl?: string;
  readonly rutorrentSha256?: string;
  readonly nanomonUrl?: string;
  readonly nanomonSha256?: string;
  readonly speedtestUrl?: string;
  readonly speedtestSha256?: string;
  readonly nextcloudUrl?: string;
  readonly nextcloudSha256?: string;
  readonly nextcloudAdminPassword?: string;
}

const PINS: readonly (readonly [keyof ArtifactPins, string])[] = [
  ['rutorrentUrl', 'KOBOX_RUTORRENT_URL'],
  ['rutorrentSha256', 'KOBOX_RUTORRENT_SHA256'],
  ['nanomonUrl', 'KOBOX_NANOMON_URL'],
  ['nanomonSha256', 'KOBOX_NANOMON_SHA256'],
  ['speedtestUrl', 'KOBOX_SPEEDTEST_URL'],
  ['speedtestSha256', 'KOBOX_SPEEDTEST_SHA256'],
  ['nextcloudUrl', 'KOBOX_NEXTCLOUD_URL'],
  ['nextcloudSha256', 'KOBOX_NEXTCLOUD_SHA256'],
  ['nextcloudAdminPassword', 'KOBOX_NEXTCLOUD_ADMIN_PASSWORD'],
];

// An empty string is treated as absent: an unset variable and one exported to
// nothing mean the same thing to an operator, and a component that skips saying
// "not pinned" is kinder than one that fetches "".
export function artifactPinsFrom(env: Record<string, string | undefined>): ArtifactPins {
  const pins: Record<string, string> = {};
  for (const [key, variable] of PINS) {
    const value = env[variable];
    if (value !== undefined && value !== '') {
      pins[key] = value;
    }
  }
  return pins;
}
