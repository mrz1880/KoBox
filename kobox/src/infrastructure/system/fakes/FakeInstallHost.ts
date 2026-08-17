import type {
  ArtifactFetchPort,
  ArchiveLayout,
  InstallHostPort,
} from '../../../domain/installation/ports.js';
import type { ManagedFilesPort, RenderedFile } from '../../../domain/shared/files.js';

// One in-memory filesystem behind BOTH ManagedFilesPort and InstallHostPort
// (plus the artifact fetch), mirroring reality where all three touch the same
// disk — the guarded-apply rollback logic is only testable this way.
export class FakeInstallHost implements ManagedFilesPort, InstallHostPort, ArtifactFetchPort {
  private readonly files = new Map<string, RenderedFile>();
  readonly dirs = new Map<string, string>();
  readonly preseeded: string[] = [];
  readonly postconfSettings: Record<string, string> = {};
  readonly postmapped: string[] = [];
  readonly symlinks = new Map<string, string>();
  readonly quotaActivated: string[] = [];
  readonly serviceAccounts = new Set<string>();
  readonly ownership = new Map<string, { owner: string; group: string; mode: string }>();
  readonly fetched: [string, string][] = [];
  readonly extracted: [string, string][] = [];
  sysctlApplies = 0;
  private readonly mounts = new Map<string, readonly string[]>();

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

  hostname(): Promise<string> {
    return Promise.resolve('kobox-test');
  }

  pathExists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path) || this.dirs.has(path));
  }

  readFile(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path)?.content);
  }

  removeFile(path: string): Promise<void> {
    this.files.delete(path);
    return Promise.resolve();
  }

  ensureDir(path: string, mode: string): Promise<void> {
    this.dirs.set(path, mode);
    return Promise.resolve();
  }

  readonly chowned: { path: string; owner: string; group: string }[] = [];

  chown(path: string, owner: string, group: string): Promise<void> {
    this.chowned.push({ path, owner, group });
    return Promise.resolve();
  }

  ensureFile(file: RenderedFile): Promise<boolean> {
    if (this.files.has(file.path)) {
      return Promise.resolve(false);
    }
    this.files.set(file.path, file);
    return Promise.resolve(true);
  }

  ensureSymlink(linkPath: string, target: string): Promise<boolean> {
    if (this.symlinks.has(linkPath)) {
      return Promise.resolve(false);
    }
    this.symlinks.set(linkPath, target);
    return Promise.resolve(true);
  }

  extractTarGz(archive: string, destDir: string, _layout: ArchiveLayout): Promise<void> {
    this.extracted.push([archive, destDir]);
    return Promise.resolve();
  }

  applySysctl(): Promise<void> {
    this.sysctlApplies += 1;
    return Promise.resolve();
  }

  postconf(settings: Readonly<Record<string, string>>): Promise<void> {
    Object.assign(this.postconfSettings, settings);
    return Promise.resolve();
  }

  postmap(path: string): Promise<void> {
    this.postmapped.push(path);
    return Promise.resolve();
  }

  preseedDebconf(selections: readonly string[]): Promise<void> {
    this.preseeded.push(...selections);
    return Promise.resolve();
  }

  setMountOptions(mountPoint: string, options: readonly string[]): void {
    this.mounts.set(mountPoint, options);
  }

  mountOptions(mountPoint: string): Promise<readonly string[]> {
    return Promise.resolve(this.mounts.get(mountPoint) ?? []);
  }

  activateQuota(mountPoint: string): Promise<void> {
    this.quotaActivated.push(mountPoint);
    return Promise.resolve();
  }

  ensureServiceAccount(name: string): Promise<void> {
    this.serviceAccounts.add(name);
    return Promise.resolve();
  }

  setOwnership(path: string, owner: string, group: string, mode: string): Promise<void> {
    this.ownership.set(path, { owner, group, mode });
    return Promise.resolve();
  }

  fetchVerified(url: string, sha256: string, destPath: string): Promise<void> {
    this.fetched.push([url, sha256]);
    this.files.set(destPath, {
      path: destPath,
      content: `ARTIFACT:${url}`,
      mode: '0644',
      owner: 'root',
      group: 'root',
    });
    return Promise.resolve();
  }
}
