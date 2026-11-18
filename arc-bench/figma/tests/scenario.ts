import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createEntryUrl, readObservation, REPO_ROOT, renameSelectedLayer } from './driver.js';
import { assertParentEligibility, assertSelectionTargets, requireBaseUrl, type ObserveObject, type ObserveSnapshot } from './oracles.js';

type Name = string | RegExp;
export type LayerReference = string | ObserveObject;
type ClickOptions = NonNullable<Parameters<Locator['click']>[0]>;
type DragOptions = {
  button?: 'left' | 'middle' | 'right';
  modifiers?: string[];
  target?: Locator;
  via?: Array<{ x: number; y: number }>;
};

export interface Program {
  requirement: string;
  name: string;
  entry?: 'home';
  run(scenario: Scenario): Promise<void>;
}

export class Scenario {
  readonly baseURL = requireBaseUrl(process.env.BASE_URL);
  readonly worksetId: string;
  readonly entryURL: string;
  private readonly layerIds = new Map<string, string>();
  private observation?: ObserveSnapshot;

  constructor(public page: Page, readonly testInfo: TestInfo, readonly seed: string) {
    this.worksetId = testInfo.testId + '-' + randomUUID();
    this.entryURL = createEntryUrl(this.baseURL, seed, this.worksetId);
  }

  role(role: Parameters<Page['getByRole']>[0], name: Name, scope: Page | Locator = this.page): Locator {
    return scope.getByRole(role, { name, exact: typeof name === 'string' });
  }

  button(name: Name): Locator { return this.role('button', name); }
  field(name: Name): Locator { return this.role('textbox', name); }
  canvas(): Locator { return this.role('region', 'Design canvas'); }
  async press(key: string): Promise<void> { await this.page.keyboard.press(key); }

  // A scenario label identifies an observed layer; it never changes the user's document.
  async bindSelected(label: string): Promise<ObserveObject> {
    const layer = await this.selected();
    this.layerIds.set(label, layer.id);
    return layer;
  }

  private layerId(reference: LayerReference): string | undefined {
    return typeof reference === 'string' ? this.layerIds.get(reference) : reference.id;
  }

  lookup(snapshot: ObserveSnapshot, reference: LayerReference): ObserveObject {
    const id = this.layerId(reference);
    const matches = snapshot.objects.filter(layer => id ? layer.id === id : layer.name === reference);
    expect(matches, 'One editable layer for ' + (typeof reference === 'string' ? reference : reference.id)).toHaveLength(1);
    return matches[0]!;
  }

  layerName(reference: LayerReference): string {
    if (typeof reference === 'string' && !this.layerIds.has(reference)) return reference;
    if (!this.observation) throw new Error('Observe the document before locating a tracked layer.');
    const name = this.lookup(this.observation, reference).name;
    if (!name) throw new Error('The tracked layer has no observable name.');
    return name;
  }

  asset(reference: LayerReference): Locator {
    return this.page.getByTestId('asset:' + this.layerName(reference));
  }

  layer(reference: LayerReference): Locator { return this.layerLocator(reference, 'layer'); }
  layerLabel(reference: LayerReference): Locator { return this.layerLocator(reference, 'layer-name'); }

  private layerLocator(reference: LayerReference, kind: 'layer' | 'layer-name'): Locator {
    const id = this.layerId(reference);
    const snapshot = this.observation;
    if (!id || !snapshot) return this.page.getByTestId(kind + ':' + this.layerName(reference));
    const target = this.lookup(snapshot, reference);
    const pageLayers = snapshot.objects.filter(layer => layer.pageId === target.pageId);
    const parents = new Map(pageLayers.map(layer => [layer.id, layer]));
    const rowName = (layer: ObserveObject): string => {
      let parent = layer.parentId && parents.get(layer.parentId);
      let instance: ObserveObject | undefined;
      for (let index = 0; parent && index < pageLayers.length; index++) {
        if (parent.type === 'instance') instance = parent;
        parent = parent.parentId && parents.get(parent.parentId);
      }
      const name = layer.name ?? '';
      return instance?.name && !name.includes('/') ? instance.name + '/' + name : name;
    };
    const name = rowName(target);
    const locator = this.page.getByTestId(kind + ':' + name);
    if (pageLayers.filter(layer => rowName(layer) === name).length === 1) return locator;

    // Layers shows frontmost siblings first and each expanded parent's children below its row.
    const ordered: ObserveObject[] = [];
    const walk = (parentId: string | null) => {
      for (const layer of pageLayers.filter(candidate => candidate.parentId === parentId)
        .sort((a, b) => b.siblingIndex - a.siblingIndex)) {
        ordered.push(layer);
        walk(layer.id);
      }
    };
    walk(null);
    const index = ordered.filter(layer => rowName(layer) === name).findIndex(layer => layer.id === id);
    if (index < 0) throw new Error('The tracked layer is outside the observed Layers tree.');
    return locator.nth(index);
  }

  async select(reference: LayerReference): Promise<void> {
    if (this.layerId(reference)) await this.obs();
    await this.layer(reference).click();
  }

  async set(name: Name, value: string | number, key = 'Enter'): Promise<void> {
    const input = this.field(name);
    await input.fill(String(value));
    await input.press(key);
  }

  async point(x: number, y: number, options: ClickOptions = {}): Promise<void> {
    await this.canvas().click({ ...options, position: { x, y } });
  }

  async drag(x1: number, y1: number, x2: number, y2: number, options: DragOptions = {}): Promise<void> {
    const target = options.target ?? this.canvas();
    await expect(target).toBeVisible();
    const bounds = await target.boundingBox();
    if (!bounds) throw new Error('The drag target has no visible bounds.');
    const modifiers = (options.modifiers ?? []).map(key =>
      key === 'ControlOrMeta' ? (process.platform === 'darwin' ? 'Meta' : 'Control') : key);
    const { mouse, keyboard } = this.page;
    const button = options.button ?? 'left';
    for (const key of modifiers) await keyboard.down(key);
    try {
      await mouse.move(bounds.x + x1, bounds.y + y1);
      await mouse.down({ button });
      try {
        for (const point of options.via ?? []) {
          await mouse.move(bounds.x + point.x, bounds.y + point.y, { steps: 12 });
        }
        await mouse.move(bounds.x + x2, bounds.y + y2, { steps: 12 });
      } finally {
        await mouse.up({ button });
      }
    } finally {
      for (const key of modifiers.reverse()) await keyboard.up(key);
    }
  }

  async obs(): Promise<ObserveSnapshot> {
    this.observation = await readObservation(this.page);
    return this.observation;
  }

  async object(reference: LayerReference): Promise<ObserveObject> { return this.lookup(await this.obs(), reference); }

  async selected(): Promise<ObserveObject> {
    const selected = (await this.obs()).objects.filter(layer => layer.selected);
    expect(selected, 'Exactly one layer selected').toHaveLength(1);
    return selected[0]!;
  }

  async check(assert: (snapshot: ObserveSnapshot) => unknown): Promise<void> {
    await expect(async () => {
      const snapshot = await this.obs();
      assertParentEligibility(snapshot);
      assertSelectionTargets(snapshot);
      await assert(snapshot);
    })
      .toPass({ timeout: 8_000, intervals: [100, 250, 500, 1_000] });
  }

  async rename(value: string): Promise<void> {
    await renameSelectedLayer(this.page, value);
    await this.obs();
  }

  async reopen(): Promise<void> {
    const url = this.page.url();
    const context = this.page.context();
    await this.page.close();
    this.page = await context.newPage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async file(button: Name | Locator, fixture: string): Promise<void> {
    const file = path.resolve(REPO_ROOT, fixture);
    if (!file.startsWith(REPO_ROOT + path.sep)) throw new Error('Fixture must be inside the task.');
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser'), this.target(button).click(),
    ]);
    await chooser.setFiles(file);
  }

  async download(button: Name | Locator, filename: string): Promise<Buffer> {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(filename) || filename.includes('..')) {
      throw new Error('Download requires a simple file name.');
    }
    const [download] = await Promise.all([
      this.page.waitForEvent('download'), this.target(button).click(),
    ]);
    const output = this.testInfo.outputPath(filename);
    await download.saveAs(output);
    await this.testInfo.attach(filename, { path: output });
    return readFile(output);
  }

  private target(button: Name | Locator): Locator {
    return typeof button === 'object' && !(button instanceof RegExp) ? button : this.button(button);
  }

  async capture(label: string): Promise<void> {
    await this.testInfo.attach(label + '.png', { body: await this.page.screenshot(), contentType: 'image/png' });
    const observation = await this.obs().catch(() => undefined);
    if (observation) {
      await this.testInfo.attach(label + '.json', { body: JSON.stringify(observation, null, 2), contentType: 'application/json' });
      // Other captures can occur while a drag preview is still in progress.
      if (label === 'final') {
        assertParentEligibility(observation);
        assertSelectionTargets(observation);
      }
    }
  }

  async pixel(x: number, y: number): Promise<number[]> {
    const screenshot = await this.canvas().screenshot({ scale: 'css' });
    return this.page.evaluate(async ({ png, x, y }) => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: 'image/png' }));
      try {
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) throw new Error('Sample lies outside the viewport.');
        const context = new OffscreenCanvas(1, 1).getContext('2d')!;
        context.drawImage(image, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      } finally {
        image.close();
      }
    }, { png: screenshot.toString('base64'), x, y });
  }
}

export async function runProgram(page: Page, testInfo: TestInfo, seed: string, program: Program): Promise<void> {
  const scenario = new Scenario(page, testInfo, seed);
  await page.goto(program.entry === 'home' ? scenario.baseURL : scenario.entryURL, { waitUntil: 'domcontentloaded' });
  if (program.entry !== 'home') {
    await scenario.check(snapshot => {
      expect(snapshot.document.seed).toBe(seed);
      expect(snapshot.document.worksetId).toBe(scenario.worksetId);
    });
  }
  try {
    await program.run(scenario);
    await scenario.capture('final');
  } catch (error) {
    try { await scenario.capture('failed'); } catch { /* Preserve the original product assertion. */ }
    throw error;
  }
}
