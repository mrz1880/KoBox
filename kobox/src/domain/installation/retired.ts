// What a component KoBox no longer ships left on a box that ran it: a unit to
// stop, the files it was configured with and the directories it wrote into.
// KoBox never removes a package (an operator may use it for something else),
// so a retired service is described by what KoBox itself put there.
export interface RetiredService {
  readonly unit: string;
  readonly unitFile: string;
  readonly files: readonly string[];
  readonly dirs: readonly string[];
}

export const RETIRED_SERVICES: readonly RetiredService[] = [
  // The download engine behind debrid downloads, retired because AllDebrid
  // refuses a datacenter address. Its package and its kobox-aria2 service
  // account stay: a nologin account owning nothing is harmless, and removing a
  // user is not something an upgrade should do behind an operator's back.
  {
    unit: 'kobox-aria2',
    unitFile: '/etc/systemd/system/kobox-aria2.service',
    files: ['/etc/kobox/aria2.conf'],
    // where it staged downloads, partial files included
    dirs: ['/var/lib/kobox-aria2'],
  },
];
