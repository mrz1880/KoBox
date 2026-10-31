import { html, raw, type RawHtml } from '../html.js';

// Outline icons from Tabler Icons 3.19.0 (MIT License, Copyright (c) 2020-2024
// Pawel Kuna, https://tabler.io/icons), copied path for path rather than
// redrawn. The portal ships no script and no icon font, so the few it needs
// are inlined here.
const DRAWINGS = {
  download:
    '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" />',
  play: '<path d="M7 4v16l13 -8z" />',
  'tv-off':
    '<path d="M11 7h8a2 2 0 0 1 2 2v8m-1.178 2.824c-.25 .113 -.529 .176 -.822 .176h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2h2" /><path d="M16 3l-4 4l-4 -4" /><path d="M3 3l18 18" />',
} as const;

export type IconName = keyof typeof DRAWINGS;

// Decorative on its own: whatever carries it names it (aria-label), so a
// screen reader says the action once rather than reading out a drawing.
export function icon(name: IconName): RawHtml {
  return html`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${raw(DRAWINGS[name])}</svg>`;
}
