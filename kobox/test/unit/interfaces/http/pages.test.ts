import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loginPage } from '../../../../src/interfaces/http/views/loginPage.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../golden/portal');

function expectGolden(name: string, actual: string): void {
  const goldenPath = join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(goldenPath, actual);
  }
  expect(actual).toBe(readFileSync(goldenPath, 'utf8'));
}

describe('portal pages', () => {
  it('should_render_the_login_page_golden', () => {
    const content = loginPage();

    expect(content).toContain('<meta name="viewport"');
    expectGolden('login.html.golden', content);
  });

  it('should_escape_the_error_message_on_the_login_page', () => {
    const content = loginPage('<img src=x onerror=alert(1)>');

    expect(content).not.toContain('<img src=x');
    expect(content).toContain('&lt;img src=x');
  });
});
