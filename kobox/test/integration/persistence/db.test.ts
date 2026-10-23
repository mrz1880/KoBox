import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KoboxDatabase } from '../../../src/infrastructure/persistence/db.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kobox-db-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('KoboxDatabase', () => {
  it('should_open_on_a_fresh_box_where_its_directory_does_not_exist_yet', () => {
    // `kobox install` is the first thing to open the database on a new box,
    // before the kobox-core component has made /var/lib/kobox
    const path = join(dir, 'var/lib/kobox/kobox.db');

    const db = KoboxDatabase.open(path);
    db.close();

    expect(existsSync(path)).toBe(true);
  });
});
