import type { Page } from '@playwright/test';
import type { AcceptanceAssertion } from './oracles.js';

export async function assertRenderedArtifact(
  page: Page, bytes: Uint8Array, assertion: Extract<AcceptanceAssertion, { source: 'artifact' }>,
): Promise<void> {
  const vectorOnly = assertion.format === 'svg' && assertion.vectorOnly === true;
  const outlineText = assertion.format === 'svg' && assertion.outlineText === true;
  if (!assertion.samples && !vectorOnly && !outlineText) return;
  await page.evaluate(async ({ encoded, format, vectorOnly, outlineText, samples }) => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (format === 'svg') {
      const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml');
      if (document.documentElement.localName !== 'svg' || document.querySelector('parsererror')) {
        throw new Error('The downloaded file is not a valid SVG document.');
      }
      if (vectorOnly && (document.querySelector('image, foreignObject') ||
          !document.querySelector('path, rect, circle, ellipse, polygon, polyline, line, use'))) {
        throw new Error('The downloaded design does not retain vector artwork.');
      }
      if (outlineText && document.querySelector('text')) {
        throw new Error('Exported text remains text while Outline text is selected.');
      }
    }
    const image = new Image();
    const url = URL.createObjectURL(new Blob([bytes], { type: format === 'svg' ? 'image/svg+xml' : 'image/png' }));
    try {
      image.src = url;
      await image.decode();
      const width = 320;
      const height = Math.min(640, Math.max(1, Math.round(width * image.naturalHeight / image.naturalWidth)));
      const context = new OffscreenCanvas(width, height).getContext('2d')!;
      context.drawImage(image, 0, 0, width, height);
      for (const sample of samples ?? []) {
        const [x, y, w, h] = sample.region;
        const wanted = [0, 2, 4].map(offset => Number.parseInt(sample.color.slice(offset, offset + 2), 16));
        const pixels = context.getImageData(Math.floor(x * width), Math.floor(y * height),
          Math.max(1, Math.floor(w * width)), Math.max(1, Math.floor(h * height))).data;
        let found = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3]! >= 245 && wanted.every((value, channel) => Math.abs(pixels[i + channel]! - value) <= 12)) found++;
        }
        if (found < sample.minPixels) {
          throw new Error('Downloaded ' + format.toUpperCase() + ' renders ' + found + ' pixels of #' + sample.color
            + ' in the expected region, expected at least ' + sample.minPixels + '.');
        }
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }, { encoded: Buffer.from(bytes).toString('base64'), format: assertion.format,
    vectorOnly, outlineText, samples: assertion.samples });
}
