import { describe, expect, it } from 'vitest';
import { MediaFile, MediaPath } from '../../../../src/domain/media/MediaFile.js';
import { Username } from '../../../../src/domain/user/Username.js';
import { MediaOrder } from '../../../../src/interfaces/http/views/mediaOrder.js';

const file = (path: string, sizeBytes = 1): MediaFile =>
  MediaFile.record({
    username: Username.parse('alice'),
    path: MediaPath.parse(path),
    sizeBytes,
    indexedAt: '2026-07-25 10:00:00',
  });

const names = (files: readonly MediaFile[]): string[] => files.map((one) => one.path.name);

describe('MediaOrder', () => {
  // episode 2 comes before episode 10, and case does not split the list
  it('should_list_by_name_the_way_a_person_counts_by_default', () => {
    const files = [file('series/show.E10.mkv'), file('series/Show.E2.mkv'), file('series/Show.E1.mkv')];

    expect(names(MediaOrder.fromQuery({}).sorted(files))).toEqual([
      'Show.E1.mkv',
      'Show.E2.mkv',
      'show.E10.mkv',
    ]);
  });

  // clicking the column already sorted on turns it around; another column
  // starts the way people want it: names A to Z, the biggest files first
  it.each([
    [{}, 'name', 'sort=name&order=desc'],
    [{}, 'size', 'sort=size&order=desc'],
    [{ sort: 'size', order: 'desc' }, 'size', 'sort=size&order=asc'],
    [{ sort: 'size', order: 'desc' }, 'name', 'sort=name&order=asc'],
  ] as const)('should_link_from_%o_to_%s_with_%s', (query, column, link) => {
    expect(MediaOrder.fromQuery(query).linkFor(column)).toBe(link);
  });
});
