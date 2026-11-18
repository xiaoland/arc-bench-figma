import { expect, type Locator, type Page } from '@playwright/test';
import type { LayerReference, Program, Scenario } from '../scenario.js';
import { assertPngDimensions, type ObserveObject, type ObserveSnapshot } from '../oracles.js';

const png = 'tests/fixtures/quadrants-120x80.png';
const replacement = 'tests/fixtures/replacement-60x120.png';
const svg = 'tests/fixtures/arrow-24.svg';

function oneChild(o: ObserveSnapshot, parent: string, type: string): ObserveObject {
  const matches = o.objects.filter(item => item.parentId === parent && item.type === type);
  expect(matches, 'child of type ' + type).toHaveLength(1);
  return matches[0]!;
}

function descendants(o: ObserveSnapshot, id: string): ObserveObject[] {
  return o.objects.filter(object => {
    let parent = object.parentId;
    for (let i = 0; parent && i < o.objects.length; i++) {
      if (parent === id) return true;
      parent = o.objects.find(candidate => candidate.id === parent)?.parentId ?? null;
    }
    return false;
  });
}

function currentPage(o: ObserveSnapshot) {
  const page = o.document.pages.find(p => p.id === o.document.currentPageId);
  expect(page, 'current document page').toBeDefined();
  return page!;
}

async function selectOnCanvas(s: Scenario, id: string) {
  const snapshot = await s.obs();
  const layer = snapshot.objects.find(candidate => candidate.id === id);
  expect(layer).toBeDefined();
  let { x, y } = layer!.geometry;
  let parent = layer!.parentId;
  for (let n = 0; parent && n < snapshot.objects.length; n++) {
    const ancestor = snapshot.objects.find(candidate => candidate.id === parent);
    expect(ancestor).toBeDefined();
    x += ancestor!.geometry.x;
    y += ancestor!.geometry.y;
    parent = ancestor!.parentId;
  }
  const view = snapshot.document.view;
  const zoom = view?.zoom ?? 1;
  await s.point((x + layer!.geometry.width / 2) * zoom + (view?.panX ?? 0),
    (y + layer!.geometry.height / 2) * zoom + (view?.panY ?? 0), { modifiers: ['ControlOrMeta'] });
  await s.check(o => expect(o.selectionIds).toEqual([id]));
}

async function item(s: Scenario, name: string) {
  const choices = s.role('option', name).or(s.role('menuitem', name))
    .or(s.role('menuitemradio', name)).or(s.role('menuitemcheckbox', name))
    .filter({ visible: true });
  await choices.click();
}

async function choose(s: Scenario, control: string | RegExp, value: string) {
  const locator = s.button(control).or(s.role('combobox', control)).filter({ visible: true });
  if (await locator.evaluate(el => el.tagName === 'SELECT')) {
    await locator.selectOption({ label: value });
  } else {
    await locator.click();
    await item(s, value);
  }
}

async function selectedControl(control: Locator, expected = true) {
  await expect.poll(() => control.evaluate(el => {
    return ['aria-pressed', 'aria-checked', 'aria-selected'].some(key => el.getAttribute(key) === 'true');
  })).toBe(expected);
}

async function editText(s: Scenario, name: LayerReference, value: string) {
  await s.select(name);
  await s.press('Enter');
  await s.field('Text editor').fill(value);
  await s.press('Escape');
  await s.check(o => expect(s.lookup(o, name).text).toBe(value));
}

async function shape(s: Scenario, tool: 'Rectangle' | 'Frame' | 'Ellipse' | 'Section', name: string,
                     x: number, y: number, w: number, h: number) {
  const control = s.button(tool);
  if (tool === 'Ellipse' && !await control.isVisible()) {
    await s.canvas().focus();
    await s.press('o');
  } else {
    await control.click();
  }
  await s.drag(x, y, x + w, y + h);
  await s.bindSelected(name);
  await s.check(o => expect(s.lookup(o, name)).toMatchObject({
    type: tool.toLowerCase(), selected: true, geometry: { width: w, height: h },
  }));
  return await s.object(name);
}

async function textLayer(s: Scenario, name: string, text: string, x: number, y: number) {
  await s.button('Text').click();
  await s.point(x, y);
  await s.field('Text editor').fill(text);
  await s.press('Escape');
  await s.bindSelected(name);
  await s.check(o => expect(s.lookup(o, name)).toMatchObject({ type: 'text', text }));
  return await s.object(name);
}

async function addPage(s: Scenario, name: string) {
  const count = (await s.obs()).document.pages.length;
  await s.button('Add page').click();
  await expect.poll(async () => (await s.obs()).document.pages.length).toBe(count + 1);
  const page = currentPage(await s.obs());
  if (!await s.field('Page name').isVisible()) await s.role('tab', page.name).dblclick();
  await s.field('Page name').fill(name);
  await s.field('Page name').press('Enter');
  await s.check(o => expect(currentPage(o).name).toBe(name));
}

async function newDesign(s: Scenario) {
  await expect(s.button('New design')).toBeVisible();
  await s.button('New design').click();
  await expect(s.canvas()).toBeVisible();
  await s.check(o => {
    expect(o.document.id).not.toBe('');
    expect(currentPage(o).name).toBe('Desktop');
    expect(o.objects).toEqual([]);
    expect(o.selectionIds).toEqual([]);
  });
  await expect(s.button('Frame')).toBeVisible();
  await expect(s.button('Rectangle')).toBeVisible();
}

async function component(s: Scenario, name: string, x: number, y: number,
                         body: string, fill: string, label = 'Label') {
  const frame = await shape(s, 'Frame', name, x, y, 140, 60);
  const text = await textLayer(s, label, body, x + 12, y + 16);
  expect(text.parentId).toBe(frame.id);
  await s.select(name);
  await s.set('Fill', fill);
  await s.button('Create component').click();
  await s.check(o => {
    const main = s.lookup(o, name);
    expect(main).toMatchObject({ id: frame.id, type: 'component', fill: { color: fill } });
    expect(oneChild(o, main.id, 'text')).toMatchObject({ id: text.id, text: body });
  });
  return await s.object(name);
}

async function openAsset(s: Scenario, name: string) {
  await s.button('Assets').click();
  await s.asset(name).click();
  await expect(s.button('Insert instance')).toBeVisible();
}

async function insertAsset(s: Scenario, name: string, alias: string) {
  await openAsset(s, name);
  await s.button('Insert instance').click();
  await s.bindSelected(alias);
  await s.check(o => expect(s.lookup(o, alias)).toMatchObject({ type: 'instance', selected: true }));
  return await s.object(alias);
}

async function makeVariants(s: Scenario, firstText: string, secondText: string) {
  const first = await component(s, 'Default source', 24, 28, firstText, '3366FF', 'Default label');
  const second = await component(s, 'Active source', 224, 28, secondText, '8B5CF6', 'Active label');
  await s.select('Default source');
  await s.layer('Active source').click({ modifiers: ['Shift'] });
  await s.button('Combine as variants').click();
  await s.bindSelected('Button states');
  const set = await s.object('Button states');
  await s.select('Button states');
  const axis = s.field('Variant property name');
  await axis.fill('State');
  await axis.press('Enter');
  for (const [name, value] of [['Default source', 'Default'], ['Active source', 'Active']]) {
    await s.select(name!);
    await s.set('State', value!);
  }
  // The variants must have matching child names for overrides to carry across them.
  const state = await s.obs();
  const defaultLabel = oneChild(state, first.id, 'text');
  const activeLabel = oneChild(state, second.id, 'text');
  expect(defaultLabel.name).toBeTruthy();
  if (activeLabel.name !== defaultLabel.name) {
    await s.select(activeLabel);
    await s.rename(defaultLabel.name!);
  }
  await s.check(o => {
    expect(s.lookup(o, 'Button states').type).toBe('component-set');
    expect(o.objects.find(node => node.id === first.id)).toMatchObject({
      parentId: set.id, component: { variant: { State: 'Default' } }, fill: { color: '3366FF' },
    });
    expect(o.objects.find(node => node.id === second.id)).toMatchObject({
      parentId: set.id, component: { variant: { State: 'Active' } }, fill: { color: '8B5CF6' },
    });
    expect(oneChild(o, first.id, 'text').text).toBe(firstText);
    expect(oneChild(o, second.id, 'text').text).toBe(secondText);
    expect(oneChild(o, first.id, 'text').name).toBe(defaultLabel.name);
    expect(oneChild(o, second.id, 'text').name).toBe(defaultLabel.name);
  });
  return { set, first, second };
}

async function defineProperty(s: Scenario, type: string, name: string, defaultValue?: string) {
  await s.button('Add property').click();
  await item(s, type);
  await s.field('Property name').or(s.field('Name')).filter({ visible: true }).fill(name);
  if (defaultValue !== undefined) await s.field('Component property default').fill(defaultValue);
  await s.button('Create property').click();
}

async function bindProperty(s: Scenario, control: string, name: string) {
  await s.button(control).click();
  await item(s, name);
}

async function openFill(s: Scenario) {
  await s.button('Fill preview').click();
}

async function openImage(s: Scenario) {
  await s.select('Image box');
  await openFill(s);
  await expect(s.button('Image mode')).toBeVisible();
}

async function imageCrop(s: Scenario) {
  await openImage(s);
  await choose(s, 'Image mode', 'Crop');
}

async function canvasShortcut(s: Scenario, key: string) {
  await s.canvas().press(key);
}

async function exportPng(s: Scenario, name: string, filename: string, w: number, h: number) {
  const bytes = await s.download('Export ' + s.layerName(name), filename);
  assertPngDimensions(bytes, w, h);
  return bytes;
}

async function imageSamples(page: Page, bytes: Buffer, mime: 'image/png' | 'image/svg+xml',
                            points: Array<[number, number]>) {
  return await page.evaluate(async ({ encoded, mime, points }) => {
    const image = new Image();
    image.src = 'data:' + mime + ';base64,' + encoded;
    await image.decode();
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
  }, { encoded: bytes.toString('base64'), mime, points });
}

async function darkPixels(page: Page, bytes: Buffer, region: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(async ({ encoded, region }) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + encoded;
    await image.decode();
    const canvas = new OffscreenCanvas(region.width, region.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, -region.x, -region.y);
    const rgba = context.getImageData(0, 0, region.width, region.height).data;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3]! > 192 && Math.max(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!) < 100) count++;
    }
    return count;
  }, { encoded: bytes.toString('base64'), region });
}

async function linear(s: Scenario, count: number) {
  await s.select('Paint');
  await openFill(s);
  await choose(s, 'Fill type', 'Linear');
  if (count === 3) await s.button('Add gradient stop').click();
  await expect(s.role('textbox', 'Stop color')).toHaveCount(count);
  return s.role('textbox', 'Stop color');
}

async function fillStylePicker(s: Scenario) {
  await s.button('Fill style picker').click();
}

async function makeStyle(s: Scenario, type: 'Color' | 'Text', name: string) {
  await s.button('Create style').click();
  const choice = s.role('menuitem', type).filter({ visible: true });
  if (await choice.isVisible()) await choice.click();
  await s.field('Style name').fill(name);
  await s.button('Create style confirm').click();
}

async function colorStyleFromFill(s: Scenario, name: string) {
  await fillStylePicker(s);
  await makeStyle(s, 'Color', name);
}

async function applyColorStyle(s: Scenario, name: string) {
  await fillStylePicker(s);
  await s.role('option', name).click();
}

async function editStyle(s: Scenario, name: string, field: string, value: string) {
  const row = s.role('option', name);
  await row.hover();
  await row.getByRole('button', { name: 'Edit style', exact: true }).click();
  await s.set(field, value);
  await s.button('Close style editor').click();
}

async function dismiss(s: Scenario) {
  await s.press('Escape');
}

export const programs: Program[] = [
  {
    requirement: 'FILE-01', name: 'Create a file and open its editor', entry: 'home',
    async run(s) {
      await newDesign(s);
      const first = (await s.obs()).document.id;
      await expect(s.role('region', 'Pages')).toBeVisible();
      await expect(s.role('tree', 'Layers')).toBeVisible();
      await expect(s.role('region', 'Design')).toBeVisible();
      await expect(s.button('File')).toBeVisible();
      await canvasShortcut(s, 'ControlOrMeta+z');
      await s.check(o => { expect(o.objects).toHaveLength(0); expect(o.selectionIds).toEqual([]); });
      await s.page.goto(s.baseURL, { waitUntil: 'domcontentloaded' });
      await newDesign(s);
      await s.check(o => expect(o.document.id).not.toBe(first));
    },
  },
  {
    requirement: 'COMP-05', name: 'Convert an existing Frame to a main component',
    async run(s) {
      const frame = await shape(s, 'Frame', 'Card source', 30, 25, 180, 100);
      const label = await textLayer(s, 'Card label', 'Before', 44, 50);
      const surface = await shape(s, 'Rectangle', 'Card surface', 44, 80, 100, 25);
      await s.select('Card source');
      await s.button('Create component').click();
      await editText(s, 'Card label', 'After');
      await s.check(o => {
        expect(s.lookup(o, 'Card source')).toMatchObject({ id: frame.id, type: 'component', parentId: null, geometry: frame.geometry });
        expect(s.lookup(o, 'Card label')).toMatchObject({ id: label.id, parentId: frame.id, text: 'After' });
        expect(s.lookup(o, 'Card surface')).toMatchObject({ id: surface.id, parentId: frame.id });
      });
      await s.button('Assets').click();
      await expect(s.asset('Card source')).toBeVisible();
      await s.button('File').click();
      await s.layer('Card source').click();
      await s.press('ControlOrMeta+d');
      const duplicated = await s.bindSelected('Duplicated card');
      await s.check(o => expect(s.lookup(o, duplicated)).toMatchObject({ type: 'instance',
        parentId: null, pageId: frame.pageId, component: { sourceId: frame.id }, geometry: frame.geometry }));
      await s.capture('main-component-first-duplicate');
      await s.layer(duplicated).click();
      await s.press('ControlOrMeta+d');
      const instanceDuplicate = await s.bindSelected('Duplicated instance');
      await s.check(o => {
        for (const instance of [duplicated, instanceDuplicate]) {
          expect(s.lookup(o, instance)).toMatchObject({ type: 'instance', parentId: null, pageId: frame.pageId,
            component: { sourceId: frame.id }, geometry: frame.geometry });
        }
      });
      await s.capture('instance-first-duplicate');
      // Clear the source's Canvas hit area before the later Alt-drag of the main component.
      await s.set('X', '520');
      await s.set('Y', '150');
      await s.select(duplicated);
      await s.set('X', '520');
      await s.set('Y', '25');
      await s.select('Card source');
      await canvasShortcut(s, 'ControlOrMeta+c');
      await canvasShortcut(s, 'ControlOrMeta+v');
      const pasted = await s.bindSelected('Pasted card');
      await s.set('X', '300');
      await s.set('Y', '25');
      await s.select('Card source');
      await s.button('Move').click();
      const snapshot = await s.obs();
      const view = snapshot.document.view;
      const zoom = view?.zoom ?? 1;
      const x = (frame.geometry.x + frame.geometry.width - 10) * zoom + (view?.panX ?? 0);
      const y = (frame.geometry.y + frame.geometry.height - 10) * zoom + (view?.panY ?? 0);
      // Commit the copy while Alt is still held: mouse-up precedes modifier-up.
      await s.drag(x, y, x + 260 * zoom, y + 160 * zoom, { modifiers: ['Alt'] });
      const dragged = await s.bindSelected('Dragged card');
      const instances = [duplicated, instanceDuplicate, pasted, dragged];
      expect(new Set([frame.id, ...instances.map(instance => instance.id)]).size).toBe(5);
      const verifyInstances = (o: ObserveSnapshot, text: string) => {
        expect(s.lookup(o, 'Card source')).toMatchObject({ id: frame.id, type: 'component', geometry: frame.geometry });
        for (const instance of instances) {
          expect(s.lookup(o, instance)).toMatchObject({ type: 'instance', parentId: null, pageId: frame.pageId,
            component: { sourceId: frame.id }, geometry: { width: 180, height: 100 } });
          expect(oneChild(o, instance.id, 'text')).toMatchObject({ text,
            geometry: s.lookup(o, 'Card label').geometry });
          expect(oneChild(o, instance.id, 'rectangle').geometry).toEqual(surface.geometry);
        }
        expect(s.lookup(o, dragged).geometry).toEqual({ ...frame.geometry,
          x: frame.geometry.x + 260, y: frame.geometry.y + 160 });
      };
      await s.check(o => verifyInstances(o, 'After'));
      await editText(s, 'Card label', 'Linked update');
      await s.check(o => verifyInstances(o, 'Linked update'));
      for (const instance of instances) {
        await s.select(instance);
        await expect(s.layer(instance)).toHaveAttribute('aria-selected', 'true');
        await expect(s.field('Width')).toHaveValue('180');
        await expect(s.field('Height')).toHaveValue('100');
        const expand = s.role('button', /Expand/, s.layer(instance));
        if (await expand.isVisible()) await expand.click();
        await s.select(oneChild(await s.obs(), instance.id, 'text'));
        await s.press('Enter');
        await expect(s.field('Text editor')).toHaveValue('Linked update');
        await s.press('Escape');
      }
      await s.capture('main-component-copy-entrypoints');
    },
  },
  {
    requirement: 'COMP-05', name: 'Insert two instances from Assets',
    async run(s) {
      const source = await component(s, 'Card source', 24, 24, 'Source text', 'D9D9D9');
      const a = await insertAsset(s, 'Card source', 'Card A');
      await s.set('X', '220');
      const b = await insertAsset(s, 'Card source', 'Card B');
      await s.set('X', '410');
      expect(a.id).not.toBe(b.id);
      const child = oneChild(await s.obs(), a.id, 'text');
      await editText(s, child, 'Only A');
      await s.select('Card source');
      await s.set('Fill', '3366FF');
      await s.check(o => {
        expect(s.lookup(o, 'Card source')).toMatchObject({ id: source.id, geometry: source.geometry, fill: { color: '3366FF' } });
        expect(s.lookup(o, 'Card A')).toMatchObject({ id: a.id, component: { sourceId: source.id }, geometry: { x: 220 }, fill: { color: '3366FF' } });
        expect(s.lookup(o, 'Card B')).toMatchObject({ id: b.id, component: { sourceId: source.id }, geometry: { x: 410 }, fill: { color: '3366FF' } });
        expect(oneChild(o, a.id, 'text').text).toBe('Only A');
        expect(oneChild(o, b.id, 'text').text).toBe('Source text');
        expect(oneChild(o, source.id, 'text').text).toBe('Source text');
      });
    },
  },
  {
    requirement: 'COMP-02', name: 'Define Text, Boolean, and Instance swap properties',
    async run(s) {
      await shape(s, 'Ellipse', 'Dot graphic', 30, 18, 18, 18);
      await s.set('Fill', '000000');
      await s.button('Create component').click();
      const dot = await s.bindSelected('Dot source');
      expect(dot.type).toBe('component');
      await shape(s, 'Rectangle', 'Square graphic', 80, 18, 22, 22);
      await s.set('Fill', '000000');
      await s.button('Create component').click();
      const square = await s.bindSelected('Square source');
      expect(square.type).toBe('component');
      const source = await component(s, 'Button source', 30, 100, 'Continue', 'D9D9D9', 'Button label');
      await s.button('Assets').click();
      await s.asset('Dot source').dragTo(s.canvas(), { targetPosition: { x: 40, y: 110 } });
      await s.bindSelected('Button icon');
      const icon = await s.object('Button icon');
      expect(icon).toMatchObject({ type: 'instance', parentId: source.id, component: { sourceId: dot.id } });
      await s.select('Button source');
      await s.button('Add property').click();
      await item(s, 'Text');
      await s.field('Property name').or(s.field('Name')).filter({ visible: true }).fill('Cancelled');
      await dismiss(s);
      await expect(s.button('Edit component property Cancelled')).toHaveCount(0);
      await defineProperty(s, 'Text', 'Label', 'Continue');
      await defineProperty(s, 'Boolean', 'Show icon');
      await defineProperty(s, 'Instance swap', 'Icon');
      await s.select('Button label');
      await bindProperty(s, 'Apply text property', 'Label');
      await s.select('Button icon');
      await bindProperty(s, 'Apply boolean property', 'Show icon');
      await bindProperty(s, 'Apply instance swap property', 'Icon');
      const a = await insertAsset(s, 'Button source', 'A');
      const b = await insertAsset(s, 'Button source', 'B');
      await s.select('A');
      await s.set('Label', 'Local A');
      await s.role('checkbox', 'Show icon').uncheck();
      await s.check(o => expect(oneChild(o, a.id, 'instance').visible).toBe(false));
      await s.role('checkbox', 'Show icon').check();
      await choose(s, 'Icon', s.layerName('Square source'));
      await s.select('Button source');
      await s.button('Edit component property Label').click();
      await s.set('Component property default', 'Source update');
      await s.check(o => {
        expect(oneChild(o, source.id, 'text').text).toBe('Source update');
        expect(oneChild(o, b.id, 'text').text).toBe('Source update');
        expect(oneChild(o, a.id, 'text').text).toBe('Local A');
        expect(oneChild(o, a.id, 'instance')).toMatchObject({ visible: true, component: { sourceId: square.id } });
        expect(oneChild(o, b.id, 'instance')).toMatchObject({ visible: true, component: { sourceId: dot.id } });
      });
    },
  },
  {
    requirement: 'COMP-03', name: 'Create and use a two-state component set',
    async run(s) {
      const { first, second } = await makeVariants(s, 'Continue', 'Continue');
      const instance = await insertAsset(s, 'Button states', 'Live button');
      expect(instance.component?.sourceId).toBe(first.id);
      const child = oneChild(await s.obs(), instance.id, 'text');
      await editText(s, child, 'Proceed');
      await s.select('Live button');
      await choose(s, 'State', 'Active');
      await s.check(o => {
        expect(s.lookup(o, 'Live button')).toMatchObject({ id: instance.id, component: { sourceId: second.id, variant: { State: 'Active' } } });
        expect(oneChild(o, instance.id, 'text').text).toBe('Proceed');
      });
      await s.button('Instance actions').click();
      await item(s, 'Reset instance');
      await s.check(o => {
        expect(oneChild(o, instance.id, 'text').text).toBe('Continue');
        expect(s.lookup(o, 'Live button').component?.variant?.State).toBe('Active');
      });
      await s.select('Active source');
      await s.set('Fill', '22C55E');
      await s.check(o => expect(s.lookup(o, 'Live button')).toMatchObject({
        id: instance.id, fill: { color: '22C55E' }, component: { sourceId: second.id },
      }));
    },
  },
  {
    requirement: 'COMP-03', name: 'Apply different rules to text and Fill overrides',
    async run(s) {
      const { second } = await makeVariants(s, 'Continue', 'Submit');
      const instance = await insertAsset(s, 'Button states', 'Live button');
      const child = oneChild(await s.obs(), instance.id, 'text');
      await editText(s, child, 'Proceed');
      await s.select('Live button');
      await s.set('Fill', 'FF0000');
      await s.check(o => expect(s.lookup(o, 'Live button').fill?.color).toBe('FF0000'));
      await choose(s, 'State', 'Active');
      await s.check(o => {
        expect(s.lookup(o, 'Live button')).toMatchObject({ fill: { color: '8B5CF6' }, component: { sourceId: second.id } });
        expect(oneChild(o, instance.id, 'text').text).toBe('Proceed');
      });
      await s.button('Instance actions').click();
      await item(s, 'Reset instance');
      await s.check(o => expect(oneChild(o, instance.id, 'text').text).toBe('Submit'));
      await s.select('Active source');
      await s.set('Fill', '3366FF');
      await s.check(o => expect(s.lookup(o, 'Live button')).toMatchObject({
        id: instance.id, fill: { color: '3366FF' }, component: { sourceId: second.id, variant: { State: 'Active' } },
      }));
    },
  },
  {
    requirement: 'ASSETS-PREVIEW', name: 'Configure a preview and insert separate instances',
    async run(s) {
      const { first, second } = await makeVariants(s, 'Source label', 'Source label');
      for (const source of [first, second]) {
        const child = oneChild(await s.obs(), source.id, 'text');
        await s.select(source);
        await defineProperty(s, 'Text', 'Label', 'Source label');
        await selectOnCanvas(s, child.id);
        await bindProperty(s, 'Apply text property', 'Label');
      }
      const freeform = await shape(s, 'Frame', 'Preview Freeform', 24, 200, 180, 100);
      const section = await shape(s, 'Section', 'Preview Section', 240, 200, 180, 100);
      const flow = await shape(s, 'Frame', 'Preview Horizontal', 460, 200, 180, 100);
      const horizontal = s.button('Horizontal').filter({ visible: true });
      if (await horizontal.count()) await horizontal.click();
      else await choose(s, /^(Layout direction|Flow)$/, 'Horizontal');
      const contexts = await s.obs();
      for (const parent of [freeform, section, flow]) expect(s.lookup(contexts, parent).parentId).toBeNull();
      const inspectInsertion = async (instance: ObserveObject, source: ObserveObject,
        variant: string, text: string, context: string) => {
        await s.check(o => {
          expect(s.lookup(o, instance)).toMatchObject({ type: 'instance', parentId: null,
            pageId: o.document.currentPageId, selected: true,
            component: { sourceId: source.id, variant: { State: variant } } });
          expect(oneChild(o, instance.id, 'text').text).toBe(text);
          for (const parent of [freeform, section, flow]) {
            expect(s.lookup(o, parent)).toMatchObject({ parentId: null,
              geometry: s.lookup(contexts, parent).geometry });
            expect(o.objects.filter(node => node.parentId === parent.id)).toEqual([]);
          }
        });
        await expect(s.field('Label')).toHaveValue(text);
        await expect(s.field('Width')).toHaveValue(String(source.geometry.width));
        await expect(s.field('Height')).toHaveValue(String(source.geometry.height));
        const state = await s.obs();
        const geometry = s.lookup(state, instance).geometry;
        const view = state.document.view;
        const zoom = view?.zoom ?? 1;
        const canvas = await s.canvas().boundingBox();
        expect(canvas).not.toBeNull();
        const x = geometry.x * zoom + (view?.panX ?? 0);
        const y = geometry.y * zoom + (view?.panY ?? 0);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + geometry.width * zoom).toBeLessThanOrEqual(canvas!.width);
        expect(y + geometry.height * zoom).toBeLessThanOrEqual(canvas!.height);
        await s.capture('details-insert-' + context);
      };
      await canvasShortcut(s, 'Escape');
      await s.check(o => expect(o.selectionIds).toEqual([]));
      await openAsset(s, 'Button states');
      const details = s.role('dialog', 'Details');
      await choose(s, 'State', 'Active');
      await s.field('Label').fill('Preview override');
      await expect(details.getByText('Preview override', { exact: true })).toBeVisible();
      await s.field('Label').press('Enter');
      await expect(details).toBeHidden();
      await s.bindSelected('Preview A');
      const a = await s.object('Preview A');
      await expect(s.field('Label')).toHaveValue('Preview override');
      await inspectInsertion(a, second, 'Active', 'Preview override', 'no-selection');
      await s.button('File').click();
      await s.select('Preview Freeform');
      await openAsset(s, 'Button states');
      await expect(s.field('Label')).toHaveValue('Source label');
      await expect(details.getByText('Default', { exact: true })).toBeVisible();
      await s.button('Insert instance').click();
      await s.bindSelected('Preview B');
      const b = await s.object('Preview B');
      await inspectInsertion(b, first, 'Default', 'Source label', 'freeform');
      const extra: ObserveObject[] = [];
      for (const [parent, context] of [[section, 'section'], [flow, 'horizontal']] as const) {
        await s.button('File').click();
        await s.select(parent);
        await openAsset(s, 'Button states');
        await expect(s.field('Label')).toHaveValue('Source label');
        await expect(details.getByText('Default', { exact: true })).toBeVisible();
        await s.button('Insert instance').click();
        await expect(details).toBeHidden();
        const instance = await s.bindSelected('Preview ' + context);
        await inspectInsertion(instance, first, 'Default', 'Source label', context);
        extra.push(instance);
      }
      expect(new Set([a, b, ...extra].map(instance => instance.id)).size).toBe(4);
      await s.button('File').click();
      await s.select('Preview A');
      await s.set('X', '440');
      await s.check(o => {
        expect(s.lookup(o, 'Preview A')).toMatchObject({
          component: { sourceId: second.id, variant: { State: 'Active' } }, geometry: { x: 440 },
        });
        expect(s.lookup(o, 'Preview B')).toMatchObject({
          component: { sourceId: first.id, variant: { State: 'Default' } }, geometry: b.geometry,
        });
        expect(oneChild(o, a.id, 'text').text).toBe('Preview override');
        expect(oneChild(o, b.id, 'text').text).toBe('Source label');
        expect(oneChild(o, second.id, 'text').text).toBe('Source label');
        for (const instance of [a, b, ...extra]) expect(s.lookup(o, instance).parentId).toBeNull();
      });
    },
  },
  {
    requirement: 'DESIGN-COMPONENT-DEFINITIONS', name: 'Create and bind a Text property',
    async run(s) {
      const main = await component(s, 'Button', 25, 24, 'Continue', 'D9D9D9');
      const label = oneChild(await s.obs(), main.id, 'text');
      await defineProperty(s, 'Text', 'Button label', 'Next');
      await expect(s.page.getByText('Not used within component', { exact: true })).toBeVisible();
      await expect(s.page.getByText('Button label', { exact: true })).toBeVisible();
      expect((await s.object('Label')).text).toBe('Continue');
      await s.select('Label');
      await bindProperty(s, 'Apply text property', 'Button label');
      await s.check(o => {
        expect(s.lookup(o, 'Button').id).toBe(main.id);
        expect(s.lookup(o, 'Label')).toMatchObject({ id: label.id, parentId: main.id, text: 'Next' });
      });
      await expect(s.button(/Apply text property.*Button label|Button label/).or(
        s.page.getByText('Button label', { exact: true }),
      ).filter({ visible: true }).first()).toBeVisible();
    },
  },
  {
    requirement: 'DESIGN-INSTANCE-VALUES', name: 'Change exposed values on an instance',
    async run(s) {
      const a = await s.object('Instance A');
      const b = await s.object('Instance B');
      const source = await s.object('Button');
      await s.select('Instance A');
      await expect(s.field('Label')).toHaveValue('Continue');
      await expect(s.role('checkbox', 'Show icon')).toBeChecked();
      await s.set('Label', 'Next');
      await s.role('checkbox', 'Show icon').uncheck();
      await s.role('tab', 'Mobile').click();
      await s.select('Instance B');
      await expect(s.field('Label')).toHaveValue('Continue');
      await expect(s.role('checkbox', 'Show icon')).toBeChecked();
      await s.role('tab', 'Desktop').click();
      await s.select('Instance A');
      await expect(s.field('Label')).toHaveValue('Next');
      await expect(s.role('checkbox', 'Show icon')).not.toBeChecked();
      await s.check(o => {
        expect(s.lookup(o, 'Instance A').component?.sourceId).toBe(source.id);
        expect(s.lookup(o, 'Instance B').component?.sourceId).toBe(source.id);
        expect(oneChild(o, a.id, 'text').text).toBe('Next');
        expect(oneChild(o, a.id, 'instance').visible).toBe(false);
        for (const id of [b.id, source.id]) {
          expect(oneChild(o, id, 'text').text).toBe('Continue');
          expect(oneChild(o, id, 'instance').visible).toBe(true);
        }
      });
    },
  },
  {
    requirement: 'DESIGN-INSTANCE-ACTIONS', name: 'Open actions for a selected instance',
    async run(s) {
      const baseline = await s.object('State instance');
      const active = await s.object('Active button');
      await s.select('State instance');
      await choose(s, 'State', 'Active');
      await s.check(o => expect(oneChild(o, baseline.id, 'text').text).toBe('Proceed'));
      await s.button('Instance actions').click();
      await item(s, 'Reset instance');
      await s.check(o => {
        expect(s.lookup(o, 'State instance')).toMatchObject({
          id: baseline.id, geometry: { x: baseline.geometry.x, y: baseline.geometry.y },
          component: { sourceId: active.id, variant: { State: 'Active' } },
        });
        expect(oneChild(o, baseline.id, 'text').text).toBe('Continue');
      });
      await expect(s.button('State')).toHaveText('Active');
    },
  },
  {
    requirement: 'COMP-CHILDREN', name: 'Receive source reparenting and undo',
    async run(s) {
      const source = await shape(s, 'Frame', 'Source', 0, 0, 200, 120);
      await s.rename('Source');
      const inner = await shape(s, 'Frame', 'Inner', 30, 20, 100, 80);
      await s.rename('Inner');
      // Create outside Inner, then use Position fields so Shape remains a direct child.
      const child = await shape(s, 'Rectangle', 'Shape', 150, 80, 40, 20);
      await s.rename('Shape');
      await s.set('X', '50');
      await s.set('Y', '40');
      await s.set('Fill', 'E11D48');
      await s.select('Source');
      await s.button('Create component').click();
      await s.button('Assets').click();
      await s.asset('Source').dragTo(s.canvas(), { targetPosition: { x: 350, y: 160 } });
      const instance = await s.bindSelected('Instance A');
      await s.rename('Instance A');
      await s.set('X', '300');
      await s.set('Y', '0');
      await s.button('File').click();
      const initial = await s.obs();
      const instanceInner = oneChild(initial, instance.id, 'frame');
      const instanceChild = oneChild(initial, instance.id, 'rectangle');
      const verify = (o: ObserveSnapshot, nested: boolean) => {
        expect(s.lookup(o, 'Source')).toMatchObject({ id: source.id, type: 'component', parentId: null,
          geometry: { x: 0, y: 0, width: 200, height: 120 } });
        expect(s.lookup(o, 'Inner')).toMatchObject({ id: inner.id, parentId: source.id,
          geometry: { x: 30, y: 20, width: 100, height: 80 } });
        expect(s.lookup(o, 'Instance A')).toMatchObject({ id: instance.id, type: 'instance', parentId: null,
          component: { sourceId: source.id }, geometry: { x: 300, y: 0, width: 200, height: 120 } });
        expect(s.lookup(o, instanceInner)).toMatchObject({ parentId: instance.id,
          geometry: { x: 30, y: 20, width: 100, height: 80 } });
        for (const [shape, parent] of [[child, nested ? inner.id : source.id],
          [instanceChild, nested ? instanceInner.id : instance.id]] as const) {
          expect(s.lookup(o, shape)).toMatchObject({ parentId: parent,
            geometry: { x: nested ? 20 : 50, y: nested ? 20 : 40, width: 40, height: 20 } });
        }
        for (const [parent, frame, shape] of [[source.id, inner.id, child.id],
          [instance.id, instanceInner.id, instanceChild.id]] as const) {
          expect(o.objects.filter(node => node.parentId === parent).map(node => node.id).sort())
            .toEqual((nested ? [frame] : [frame, shape]).sort());
          expect(o.objects.filter(node => node.parentId === frame).map(node => node.id))
            .toEqual(nested ? [shape] : []);
        }
      };
      await s.check(o => verify(o, false));
      const expand = async (reference: LayerReference) => {
        const button = s.role('button', /Expand/, s.layer(reference));
        if (await button.isVisible()) await button.click();
      };
      await expand('Source');
      await s.select('Shape');
      await s.layer('Shape').dragTo(s.layer('Inner'), { targetPosition: { x: 55, y: 12 } });
      const inspect = async (nested: boolean, label: string) => {
        await s.check(o => verify(o, nested));
        await expect(s.field('X')).toHaveValue(nested ? '20' : '50');
        await expect(s.field('Y')).toHaveValue(nested ? '20' : '40');
        // Read-only visible checks must not add a selection/page Undo step.
        const view = (await s.obs()).document.view;
        const zoom = view?.zoom ?? 1;
        for (const x of [70, 370]) {
          await expect.poll(() => s.pixel(x * zoom + (view?.panX ?? 0),
            50 * zoom + (view?.panY ?? 0))).toEqual([225, 29, 72, 255]);
        }
        await s.capture(label);
      };
      await inspect(true, 'source-reparented');
      await canvasShortcut(s, 'ControlOrMeta+z');
      await inspect(false, 'source-reparent-undone');
      await canvasShortcut(s, 'ControlOrMeta+Shift+z');
      await inspect(true, 'source-reparent-redone');
      await expand('Instance A');
      await expand(instanceInner);
      await s.select(instanceChild);
      await expect(s.layer(instanceChild)).toHaveAttribute('aria-selected', 'true');
      await expect(s.field('X')).toHaveValue('20');
      await expect(s.field('Y')).toHaveValue('20');
    },
  },
  {
    requirement: 'COMP-CHILDREN', name: 'Hide an inherited child and receive source order',
    async run(s) {
      const before = await s.object('Instance A');
      const source = await s.object('Button');
      const icon = oneChild(await s.obs(), before.id, 'instance');
      const label = oneChild(await s.obs(), before.id, 'text');
      await s.select('Instance A');
      await s.layer(icon).click({ modifiers: ['ControlOrMeta'] });
      await s.press('Delete');
      await s.check(o => {
        expect(o.objects.find(node => node.id === icon.id)?.visible).toBe(false);
        expect(oneChild(o, source.id, 'instance').visible).toBe(true);
        expect(s.lookup(o, 'Instance A').geometry.width).toBeLessThan(before.geometry.width);
      });
      await expect(s.layer(icon)).toBeVisible();
      const oldSourceLabel = await s.object('Button label');
      const oldSourceIcon = await s.object('Button icon');
      await s.layer('Button label').dragTo(s.layer('Button icon'), { targetPosition: { x: 38, y: 2 } });
      await s.check(o => {
        const sourceLabel = s.lookup(o, 'Button label');
        const sourceIcon = s.lookup(o, 'Button icon');
        expect(Math.sign(sourceLabel.siblingIndex - sourceIcon.siblingIndex))
          .toBe(-Math.sign(oldSourceLabel.siblingIndex - oldSourceIcon.siblingIndex));
        const newLabel = o.objects.find(node => node.id === label.id)!;
        const newIcon = o.objects.find(node => node.id === icon.id)!;
        expect(newLabel.parentId).toBe(before.id);
        expect(newIcon).toMatchObject({ parentId: before.id, visible: false });
        expect(Math.sign(newLabel.siblingIndex - newIcon.siblingIndex))
          .toBe(Math.sign(sourceLabel.siblingIndex - sourceIcon.siblingIndex));
      });
    },
  },
  {
    requirement: 'EDIT-03', name: 'Reach nested text and image editors by double-click',
    async run(s) {
      const frame = await shape(s, 'Frame', 'Double-click frame', 60, 70, 280, 220);
      const title = await textLayer(s, 'Title', 'Nested title', 80, 90);
      await s.rename('Title');
      await s.set('Font size', '16');
      const emptyPhotoArea = await s.pixel(140, 190);
      await s.button('Rectangle menu').click();
      await s.file(s.role('menuitem', 'Place image').or(s.role('option', 'Place image')), png);
      await s.canvas().hover({ position: { x: 140, y: 190 } });
      await expect.poll(() => s.pixel(140, 190)).not.toEqual(emptyPhotoArea);
      await s.point(140, 190);
      const photo = await s.bindSelected('Photo');
      await s.rename('Photo');
      if ((await s.object(photo)).parentId !== frame.id) {
        await s.layer(photo).dragTo(s.layer(frame), { targetPosition: { x: 55, y: 12 } });
      }
      await s.check(o => expect(s.lookup(o, photo)).toMatchObject({ type: 'rectangle', parentId: frame.id,
        geometry: { x: 20, y: 80, width: 120, height: 80 }, image: { sourceWidth: 120, sourceHeight: 80 } }));
      const separate = await shape(s, 'Rectangle', 'Separate rectangle', 380, 110, 60, 40);
      await s.select(frame);
      await s.layer(separate).click({ modifiers: ['ControlOrMeta'] });
      await s.press('ControlOrMeta+g');
      const group = await s.bindSelected('Double-click group');
      const baseline = await s.obs();
      expect(group.type).toBe('group');
      expect(s.lookup(baseline, frame).parentId).toBe(group.id);
      expect(s.lookup(baseline, separate).parentId).toBe(group.id);
      expect(s.lookup(baseline, title).parentId).toBe(frame.id);
      const editor = s.field('Text editor');
      const submit = s.button(/^(?:Submit|Submit crop|Apply crop|Apply|Done)$/i).filter({ visible: true });
      const bounds = (o: ObserveSnapshot, object: ObserveObject) => {
        const box = { ...s.lookup(o, object).geometry };
        for (let parentId = s.lookup(o, object).parentId; parentId;) {
          const parent = o.objects.find(row => row.id === parentId);
          if (!parent) throw new Error('A nested double-click needs its observed parent chain');
          box.x += parent.geometry.x; box.y += parent.geometry.y;
          parentId = parent.parentId;
        }
        return box;
      };
      const checkSelection = async (object: ObserveObject) => {
        await s.check(o => {
          expect(o.selectionIds).toEqual([object.id]);
          expect(o.objects.map(row => row.id).sort()).toEqual(baseline.objects.map(row => row.id).sort());
          for (const original of baseline.objects) {
            expect(s.lookup(o, original)).toMatchObject({ type: original.type, parentId: original.parentId,
              geometry: original.geometry });
            if (original.text !== undefined) expect(s.lookup(o, original).text).toBe(original.text);
          }
        });
        await expect(s.layer(object)).toHaveAttribute('aria-selected', 'true');
      };
      const doubleClick = async (object: ObserveObject) => {
        const state = await s.obs(), box = bounds(state, object), view = state.document.view;
        const x = object.id === title.id ? box.x + Math.min(10, box.width / 2) : box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await s.point(x * (view?.zoom ?? 1) + (view?.panX ?? 0),
          y * (view?.zoom ?? 1) + (view?.panY ?? 0), { clickCount: 2 });
      };
      await s.button('Move').click();
      await s.point(500, 350);
      await s.check(o => expect(o.selectionIds).toEqual([]));
      for (const [index, selected] of [frame, title, title].entries()) {
        await doubleClick(title);
        await checkSelection(selected);
        if (index < 2) await expect(editor).toBeHidden();
        else {
          await expect(editor).toBeVisible();
          await expect(editor).toBeFocused();
        }
        if (index === 0) {
          await expect(s.field('Width')).toHaveValue('280');
          await expect(s.field('Font size')).toBeHidden();
        } else await expect(s.field('Font size')).toHaveValue('16');
        await s.capture('nested-text-double-click-' + (index + 1));
      }
      await s.press('Escape');
      await expect(editor).toBeHidden();
      await s.point(500, 350);
      await s.check(o => expect(o.selectionIds).toEqual([]));
      for (const [index, selected] of [frame, photo, photo].entries()) {
        await doubleClick(photo);
        await checkSelection(selected);
        await expect(editor).toBeHidden();
        if (index < 2) {
          await expect(s.role('slider', 'Scale image')).toBeHidden();
          await expect(s.button('Cancel')).toBeHidden();
          await expect(s.field('Width')).toHaveValue(index === 0 ? '280' : '120');
        } else {
          await expect(s.role('slider', 'Scale image')).toBeVisible();
          await expect(s.button('Cancel')).toBeVisible();
          await expect(submit).toBeVisible();
          const state = await s.obs(), box = bounds(state, photo), view = state.document.view;
          const corners = [[box.x, box.y], [box.x + box.width, box.y],
            [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]];
          const side = 21, count = side * side, radius = Math.floor(side / 2);
          const points = corners.flatMap(([x, y]) => Array.from({ length: count }, (_, i) => [
            Math.round(x * (view?.zoom ?? 1) + (view?.panX ?? 0)) + i % side - radius,
            Math.round(y * (view?.zoom ?? 1) + (view?.panY ?? 0)) + Math.floor(i / side) - radius,
          ] as [number, number]));
          const pixels = await imageSamples(s.page, await s.canvas().screenshot({ scale: 'css' }), 'image/png', points);
          for (let corner = 0; corner < 4; corner++) {
            expect(pixels.slice(corner * count, (corner + 1) * count).some(([r, g, b, a]) =>
              a > 0 && b - r > 40 && b - g > 20), 'Crop draws a blue handle at each image corner').toBe(true);
          }
        }
        await s.capture('nested-image-double-click-' + (index + 1));
      }
      await s.button('Cancel').click();
      await checkSelection(photo);
      await expect(s.role('slider', 'Scale image')).toBeHidden();
      await expect(s.button('Cancel')).toBeHidden();
      await expect(submit).toBeHidden();
      await expect(s.field('Width')).toHaveValue('120');
      await expect(s.field('Height')).toHaveValue('80');
      await s.check(o => expect(s.lookup(o, photo).image).toMatchObject({
        mode: s.lookup(baseline, photo).image?.mode, sourceWidth: 120, sourceHeight: 80,
      }));
      await s.capture('crop-cancel-returns-to-image-selection');
    },
  },
  {
    requirement: 'ASSET-01', name: 'Create an image layer on empty canvas',
    async run(s) {
      const image = await s.object('Image box');
      const icon = await s.object('Icon frame');
      const empty = await s.pixel(320, 160);
      await s.button('Rectangle menu').click();
      await s.file(s.role('menuitem', 'Place image').or(s.role('option', 'Place image')), png);
      await expect.poll(async () => (await s.obs()).objects.length).toBe(2);
      const box = await s.canvas().boundingBox();
      expect(box).not.toBeNull();
      await s.page.mouse.move(box!.x + 320, box!.y + 160);
      await expect.poll(() => s.pixel(320, 160)).not.toEqual(empty);
      await s.point(320, 160);
      await s.check(o => {
        const added = o.objects.filter(layer => ![image.id, icon.id].includes(layer.id));
        expect(added).toHaveLength(1);
        expect(added[0]).toMatchObject({
          parentId: null, selected: true, geometry: { x: 260, y: 120, width: 120, height: 80 },
          image: { sourceWidth: 120, sourceHeight: 80 },
        });
        expect(s.lookup(o, 'Image box')).toEqual(image);
        expect(s.lookup(o, 'Icon frame')).toEqual(icon);
      });
      const imported = await s.selected();
      await openFill(s);
      await choose(s, 'Image mode', 'Fit');
      await s.check(o => expect(o.objects.find(layer => layer.id === imported.id)?.image?.mode).toBe('fit'));
    },
  },
  {
    requirement: 'ASSET-04', name: 'Keep a committed crop after replacement',
    async run(s) {
      const before = await s.object('Image box');
      await imageCrop(s);
      await s.drag(30, 40, 40, 40);
      await s.press('Enter');
      const committed = await s.object('Image box');
      expect(committed.image).toMatchObject({ mode: 'crop', cropOffsetX: 10 });
      await openImage(s);
      await s.file('Replace image', replacement);
      await s.press('Enter');
      await s.check(o => {
        const image = s.lookup(o, 'Image box');
        expect(image).toMatchObject({ id: before.id, geometry: before.geometry, image: {
          mode: 'crop', cropOffsetX: committed.image?.cropOffsetX,
          sourceWidth: 60, sourceHeight: 120,
        } });
        expect(image.image?.cropOffsetY ?? 0).toBe(committed.image?.cropOffsetY ?? 0);
      });
      await imageCrop(s);
      await s.drag(38, 38, 41, 38);
      await s.press('Enter');
      await s.check(o => expect(s.lookup(o, 'Image box').image?.cropOffsetX).toBe(13));
    },
  },
  {
    requirement: 'ASSET-02', name: 'Crop a layer boundary and distinguish apply from Cancel',
    async run(s) {
      const before = await s.object('Image box');
      await imageCrop(s);
      await s.drag(40, 0, 40, 20);
      await s.press('Enter');
      await s.check(o => expect(s.lookup(o, 'Image box')).toMatchObject({
        id: before.id, geometry: { x: 0, y: 20, width: 80, height: 60 },
        image: { sourceWidth: 120, sourceHeight: 80, mode: 'crop', cropOffsetX: 0, cropOffsetY: -10 },
      }));
      await imageCrop(s);
      await s.drag(32, 48, 42, 48);
      await s.press('Escape');
      const committed = await s.object('Image box');
      expect(committed.image).toMatchObject({ cropOffsetX: 10, mode: 'crop' });
      await imageCrop(s);
      await s.drag(42, 48, 52, 48);
      await s.button('Cancel').click();
      await s.check(o => {
        const image = s.lookup(o, 'Image box');
        expect(image.id).toBe(before.id);
        expect(image.geometry).toEqual(committed.geometry);
        expect(image.image).toEqual(committed.image);
      });
      await imageCrop(s);
      await expect(s.button('Resize to fit')).toBeVisible();
    },
  },
  {
    requirement: 'ASSET-02', name: 'Scale image content and fit the layer to the full image',
    async run(s) {
      const before = await s.object('Image box');
      await imageCrop(s);
      const scale = s.role('slider', 'Scale image');
      await scale.press('ArrowRight');
      await scale.press('ArrowRight');
      await s.check(o => {
        const image = s.lookup(o, 'Image box');
        expect(image.geometry).toEqual(before.geometry);
        expect(image.image?.cropWidth).toBeGreaterThan(120);
      });
      await s.button('Cancel').click();
      await s.check(o => expect(s.lookup(o, 'Image box').image).toEqual(before.image));
      await imageCrop(s);
      await s.button('Resize to fit').click();
      await s.press('Enter');
      await s.check(o => expect(s.lookup(o, 'Image box')).toMatchObject({
        id: before.id, geometry: { x: -20, y: 0, width: 120, height: 80 },
        image: { mode: 'crop', sourceWidth: 120, sourceHeight: 80 },
      }));
      await imageCrop(s);
      await expect(s.role('slider', 'Scale image')).toBeVisible();
    },
  },
  {
    requirement: 'PAGE-BACKGROUND', name: 'Set separate page backgrounds',
    async run(s) {
      const frame = await shape(s, 'Frame', 'White frame', 25, 25, 100, 80);
      await s.point(320, 90);
      await expect(s.button('Page background preview')).toBeVisible();
      await expect(s.button('Page background visibility')).toBeVisible();
      await s.set('Page background', 'F0F4FF');
      await expect.poll(() => s.pixel(320, 90)).toEqual([240, 244, 255, 255]);
      await expect.poll(() => s.pixel(55, 55)).toEqual([255, 255, 255, 255]);
      await addPage(s, 'Mobile');
      await expect(s.field('Page background')).toHaveValue('F0F4FF');
      await s.set('Page background', 'FFEEDD');
      await s.set('Page background opacity', '60');
      await expect(s.field('Page background')).toHaveValue('FFEEDD');
      await expect(s.field('Page background opacity')).toHaveValue(/^60%?$/);
      const mobilePixel = await s.pixel(320, 90);
      expect(mobilePixel).not.toEqual([240, 244, 255, 255]);
      await s.role('tab', 'Desktop').click();
      await s.point(320, 90);
      await expect(s.field('Page background')).toHaveValue('F0F4FF');
      await expect(s.field('Page background opacity')).toHaveValue(/^100%?$/);
      await expect.poll(() => s.pixel(320, 90)).toEqual([240, 244, 255, 255]);
      await s.check(o => expect(s.lookup(o, 'White frame')).toMatchObject({
        id: frame.id, geometry: frame.geometry, fill: { color: 'FFFFFF' },
      }));
    },
  },
  {
    requirement: 'SAVE-01', name: 'Keep edit history during canvas navigation',
    async run(s) {
      const before = await s.object('Paint');
      await s.select('Paint');
      await s.set('Fill', 'FF0000');
      await s.check(o => expect(s.lookup(o, 'Paint').fill?.color).toBe('FF0000'));
      await s.button('Move').click();
      await s.press('h');
      await s.drag(200, 160, 240, 180);
      await s.press('v');
      await s.button('Zoom options').click();
      await s.set('Zoom', '150%');
      for (const action of ['Fit selection', 'Fit all']) {
        await s.button('Zoom options').click();
        await item(s, action);
      }
      const navigated = (await s.obs()).document.view;
      expect(navigated).toBeDefined();
      await canvasShortcut(s, 'ControlOrMeta+z');
      await s.check(o => {
        expect(s.lookup(o, 'Paint')).toMatchObject({ id: before.id, geometry: before.geometry, fill: { color: 'D9D9D9' } });
        expect(o.document.view).toEqual(navigated);
      });
      await canvasShortcut(s, 'ControlOrMeta+Shift+z');
      await s.check(o => {
        expect(s.lookup(o, 'Paint')).toMatchObject({ id: before.id, geometry: before.geometry, fill: { color: 'FF0000' } });
        expect(o.document.view).toEqual(navigated);
      });
    },
  },
  {
    requirement: 'SAVE-01', name: 'Undo a selection before a document edit',
    async run(s) {
      const a = await shape(s, 'Rectangle', 'A', 30, 35, 60, 45);
      const b = await shape(s, 'Rectangle', 'B', 130, 35, 60, 45);
      await s.select('A');
      await s.set('Fill', 'FF0000');
      await s.select('B');
      await s.check(o => {
        expect(s.lookup(o, 'B').selected).toBe(true);
        expect(s.lookup(o, 'A').fill?.color).toBe('FF0000');
      });
      await s.press('ControlOrMeta+z');
      await s.check(o => expect(s.lookup(o, 'A')).toMatchObject({ selected: true, fill: { color: 'FF0000' } }));
      await s.capture('undo-selection');
      await s.press('ControlOrMeta+z');
      await s.check(o => expect(s.lookup(o, 'A')).toMatchObject({ selected: true, fill: { color: 'D9D9D9' } }));
      await s.capture('undo-document');
      await s.press('ControlOrMeta+Shift+z');
      await s.check(o => {
        expect(s.lookup(o, 'A')).toMatchObject({ id: a.id, geometry: a.geometry, fill: { color: 'FF0000' } });
        expect(s.lookup(o, 'B')).toMatchObject({ id: b.id, geometry: b.geometry });
      });
    },
  },
  {
    requirement: 'SAVE-01', name: 'Undo a page switch before a document edit',
    async run(s) {
      const a = await shape(s, 'Rectangle', 'A', 30, 35, 60, 45);
      await addPage(s, 'Mobile');
      await s.role('tab', 'Desktop').click();
      const pages = (await s.obs()).document.pages;
      await s.select('A');
      await s.set('Fill', 'FF0000');
      await s.role('tab', 'Mobile').click();
      await s.check(o => {
        expect(currentPage(o).name).toBe('Mobile');
        expect(s.lookup(o, 'A').fill?.color).toBe('FF0000');
      });
      await canvasShortcut(s, 'ControlOrMeta+z');
      await s.check(o => {
        expect(currentPage(o).name).toBe('Desktop');
        expect(s.lookup(o, 'A')).toMatchObject({ id: a.id, selected: true, fill: { color: 'FF0000' } });
      });
      await s.capture('undo-page-switch');
      await canvasShortcut(s, 'ControlOrMeta+z');
      await s.check(o => {
        expect(o.document.pages).toEqual(pages);
        expect(s.lookup(o, 'A')).toMatchObject({ id: a.id, geometry: a.geometry, fill: { color: 'D9D9D9' } });
      });
      await s.capture('undo-document');
    },
  },
  {
    requirement: 'DESIGN-EXPORT-CONFIG', name: 'Change a selected Frame export setting',
    async run(s) {
      await s.select('Export frame');
      await expect(s.button('Export format')).toHaveCount(0);
      await s.button('Add export').click();
      await choose(s, 'Export format', 'PNG');
      await expect(s.field('Export scale')).toHaveValue(/^1x?$/);
      await s.set('Export scale', '2x');
      await expect(s.button('Export format')).toHaveText('PNG');
      await expect(s.field('Export scale')).toHaveValue('2x');
      await s.capture('png-2x');
      await s.button('Remove export').click();
      await expect(s.button('Export format')).toHaveCount(0);
      await expect(s.button('Export ' + s.layerName('Export frame'))).toBeHidden();
      await expect(s.button('Add export')).toBeVisible();
    },
  },
  {
    requirement: 'DESIGN-EXPORT-PREVIEW', name: 'Expand and collapse the export preview',
    async run(s) {
      await s.select('Export frame');
      const remove = s.button('Remove export');
      while (await remove.count()) {
        const count = await remove.count();
        await remove.first().click();
        await expect(remove).toHaveCount(count - 1);
      }
      await s.button('Add export').click();
      await expect(s.field('Export scale')).toHaveValue(/^1x?$/);
      const previewButton = s.button('Preview');
      const preview = s.role('region', 'Export preview');
      await expect(preview).toBeHidden();
      await previewButton.click();
      await expect(preview).toBeVisible();
      const exportButtonBox = await s.button('Export ' + s.layerName('Export frame')).boundingBox();
      const previewBox = await preview.boundingBox();
      expect(previewBox!.y).toBeGreaterThanOrEqual(exportButtonBox!.y + exportButtonBox!.height - 1);
      const shot = await preview.screenshot({ scale: 'css' });
      const rendered = await imageSamples(s.page, shot, 'image/png', [
        [Math.round(previewBox!.width * 0.25), Math.round(previewBox!.height * 0.28)],
        [Math.round(previewBox!.width * 0.75), Math.round(previewBox!.height * 0.65)],
      ]);
      expect(rendered[0]).not.toEqual(rendered[1]);
      await s.capture('expanded-export-preview');
      await previewButton.click();
      await expect(preview).toBeHidden();
    },
  },
  {
    requirement: 'SAVE-03', name: 'Export visible overflow from an unclipped Frame',
    async run(s) {
      const frame = await shape(s, 'Frame', 'Export frame', 0, 0, 200, 120);
      // Create the child inside the Frame, then resize it beyond the bounds.
      await shape(s, 'Rectangle', 'Red child', 180, 90, 15, 20);
      await s.set('Width', '80');
      await s.set('Height', '60');
      await s.set('Fill', 'FF0000');
      const child = await s.object('Red child');
      expect(child).toMatchObject({ parentId: frame.id, geometry: { x: 180, y: 90, width: 80, height: 60 } });
      await s.select('Export frame');
      const clip = s.role('checkbox', 'Clip content');
      await expect(clip).toBeChecked();
      await s.button('Add export').click();
      const clipped = await exportPng(s, 'Export frame', 'clipped.png', 200, 120);
      expect(await imageSamples(s.page, clipped, 'image/png', [[25, 25], [195, 110]]))
        .toEqual([[255, 255, 255, 255], [255, 0, 0, 255]]);
      await clip.uncheck();
      const overflow = await exportPng(s, 'Export frame', 'overflow.png', 260, 150);
      expect(await imageSamples(s.page, overflow, 'image/png', [[25, 25], [245, 135], [230, 30]]))
        .toEqual([[255, 255, 255, 255], [255, 0, 0, 255], [0, 0, 0, 0]]);
      await s.check(o => {
        expect(s.lookup(o, 'Export frame')).toMatchObject({ id: frame.id, geometry: frame.geometry });
        expect(s.lookup(o, 'Red child')).toMatchObject({ id: child.id, parentId: frame.id, geometry: child.geometry });
      });
    },
  },
  {
    requirement: 'SAVE-03', name: 'Export the Frame outline and shadow',
    async run(s) {
      const frame = await shape(s, 'Frame', 'Export frame', 0, 0, 200, 120);
      const clip = s.role('checkbox', 'Clip content');
      await expect(clip).toBeChecked();
      await s.button('Add stroke').click();
      await s.set('Stroke color', '000000');
      await s.set('Stroke width', '10');
      await choose(s, 'Stroke alignment', 'Outside');
      await s.button('Add export').click();
      const outlined = await exportPng(s, 'Export frame', 'outside-stroke.png', 220, 140);
      expect(await imageSamples(s.page, outlined, 'image/png', [[5, 60], [110, 5], [215, 60], [110, 135], [80, 60]]))
        .toEqual([[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]]);
      await s.button('Remove stroke').click();
      await s.button('Add effect').click();
      await s.button('Drop shadow').click();
      for (const [field, value] of Object.entries({
        'Shadow X': '10', 'Shadow Y': '10', 'Shadow blur': '0', 'Shadow spread': '0',
        'Shadow opacity': '25', 'Shadow color': '000000',
      })) await s.set(field, value);
      await dismiss(s);
      const shadow = await exportPng(s, 'Export frame', 'drop-shadow.png', 210, 130);
      const pixels = await imageSamples(s.page, shadow, 'image/png', [[205, 70], [100, 125], [205, 3], [80, 60]]);
      expect(pixels.slice(0, 2).map(pixel => pixel.slice(0, 3))).toEqual([[0, 0, 0], [0, 0, 0]]);
      for (const pixel of pixels.slice(0, 2)) expect(Math.abs(pixel[3]! - 64)).toBeLessThanOrEqual(1);
      expect(pixels.slice(2)).toEqual([[0, 0, 0, 0], [255, 255, 255, 255]]);
      await s.check(o => expect(s.lookup(o, 'Export frame')).toMatchObject({ id: frame.id, geometry: frame.geometry }));
      await expect(clip).toBeChecked();
    },
  },
  {
    requirement: 'DESIGN-STYLE-PICKER', name: 'Find and apply a color Style',
    async run(s) {
      const original = await s.object('Detached');
      const bound = await s.object('Bound');
      await s.select('Detached');
      await s.button('Fill style actions').click();
      await item(s, 'Detach style');
      await s.set('Fill', 'D9D9D9');
      await s.check(o => {
        const target = s.lookup(o, 'Detached');
        expect(target.fill?.color).toBe('D9D9D9');
        expect(target.styles?.fillSourceId ?? null).toBeNull();
      });
      await fillStylePicker(s);
      await s.field('Search styles').fill('Action');
      await s.role('option', 'Color/Action').click();
      await s.check(o => {
        const target = s.lookup(o, 'Detached');
        expect(target).toMatchObject({ id: original.id, geometry: original.geometry, fill: { color: 'F43F5E' } });
        expect(bound.styles?.fillSourceId).toBeTruthy();
        expect(target.styles?.fillSourceId).toBe(bound.styles!.fillSourceId);
      });
      await expect(s.page.getByText('Color/Action', { exact: true })).toBeVisible();
    },
  },
  {
    requirement: 'DESIGN-STYLE-DEFINITION', name: 'Edit a named color definition',
    async run(s) {
      const bound = await s.object('Bound');
      const detached = await s.object('Detached');
      expect(bound.styles?.fillSourceId).toBeTruthy();
      expect(detached.styles?.fillSourceId).toBe(bound.styles?.fillSourceId);
      await s.select('Bound');
      await fillStylePicker(s);
      await editStyle(s, 'Color/Action', 'Style color', '3366FF');
      await expect(s.role('option', 'Color/Action')).toBeVisible();
      await dismiss(s);
      await s.select('Detached');
      await s.check(o => {
        for (const layer of [bound, detached]) {
          expect(s.lookup(o, layer)).toMatchObject({
            id: layer.id, geometry: layer.geometry, fill: { color: '3366FF' },
            styles: { fillSourceId: bound.styles!.fillSourceId },
          });
        }
      });
      await expect(s.page.getByText('Color/Action', { exact: true })).toBeVisible();
    },
  },
  {
    requirement: 'STYLE-03', name: 'Distinguish a Style link from a document color sample',
    async run(s) {
      const a = await shape(s, 'Rectangle', 'A', 32, 28, 80, 60);
      await s.set('Fill', 'F43F5E');
      await colorStyleFromFill(s, 'Color/Accent');
      await dismiss(s);
      const b = await shape(s, 'Rectangle', 'B', 146, 28, 80, 60);
      await openFill(s);
      await s.button('On this page').click();
      await s.button('F43F5E').click();
      await s.button('Close fill editor').click();
      const bound = await s.object('A');
      expect(bound.styles?.fillSourceId).toBeTruthy();
      expect((await s.object('B')).styles?.fillSourceId ?? null).toBeNull();
      await expect.poll(() => s.pixel(62, 58)).toEqual([244, 63, 94, 255]);
      await expect.poll(() => s.pixel(172, 58)).toEqual([244, 63, 94, 255]);
      await s.select('A');
      await fillStylePicker(s);
      await editStyle(s, 'Color/Accent', 'Style color', '3366FF');
      await dismiss(s);
      await s.select('B');
      await s.check(o => {
        expect(s.lookup(o, 'A')).toMatchObject({
          id: a.id, geometry: a.geometry, fill: { color: '3366FF' }, styles: bound.styles,
        });
        expect(s.lookup(o, 'B')).toMatchObject({ id: b.id, geometry: b.geometry, fill: { color: 'F43F5E' } });
        expect(s.lookup(o, 'B').styles?.fillSourceId ?? null).toBeNull();
      });
      await expect.poll(() => s.pixel(62, 58)).toEqual([51, 102, 255, 255]);
      await expect.poll(() => s.pixel(172, 58)).toEqual([244, 63, 94, 255]);
    },
  },
  {
    requirement: 'STYLE-03', name: 'Share a paint stack between Fill and Stroke',
    async run(s) {
      await shape(s, 'Rectangle', 'A', 30, 40, 100, 60);
      await s.set('Fill', 'F43F5E');
      await s.button('Add fill').click();
      await s.role('region', 'Fill').getByRole('textbox', { name: 'Fill', exact: true }).first().fill('3366FF');
      await s.role('region', 'Fill').getByRole('textbox', { name: 'Fill', exact: true }).first().press('Enter');
      const topOpacity = s.role('region', 'Fill').getByRole('textbox', { name: 'Fill opacity', exact: true }).first();
      await topOpacity.fill('50');
      await topOpacity.press('Enter');
      await colorStyleFromFill(s, 'Color/Stack');
      await dismiss(s);
      const originalPixel = await s.pixel(65, 67);
      const b = await shape(s, 'Rectangle', 'B', 180, 40, 100, 60);
      await s.set('Fill', '22C55E');
      await s.button('Add stroke').click();
      await s.set('Stroke color', '000000');
      await s.set('Stroke width', '5');
      await choose(s, 'Stroke alignment', 'Outside');
      await s.button('Stroke style picker').click();
      await s.role('option', 'Color/Stack').click();
      const expectStroke = async (opacity: number) => {
        await s.check(o => expect(s.lookup(o, 'B')).toMatchObject({
          id: b.id, geometry: b.geometry, fill: { color: '22C55E' },
          stroke: { width: 5, alignment: 'outside', paints: [
            { color: '3366FF', opacity }, { color: 'F43F5E', opacity: 1 },
          ] },
        }));
      };
      await expectStroke(0.5);
      await s.select('A');
      await fillStylePicker(s);
      await editStyle(s, 'Color/Stack', 'Style paint opacity', '100');
      await dismiss(s);
      await expectStroke(1);
      await expect.poll(() => s.pixel(65, 67)).toEqual([51, 102, 255, 255]);
      await s.select('B');
      await s.button('Stroke style actions').click();
      await item(s, 'Detach style');
      await s.select('A');
      await fillStylePicker(s);
      await editStyle(s, 'Color/Stack', 'Style paint opacity', '50');
      await dismiss(s);
      await expectStroke(1);
      await expect.poll(() => s.pixel(65, 67)).toEqual(originalPixel);
      await expect(s.page.getByText('Color/Stack', { exact: true })).toBeVisible();
    },
  },
  {
    requirement: 'STYLE-04', name: 'Apply and detach a text Style on one character range',
    async run(s) {
      await textLayer(s, 'Words', 'abcdef', 40, 44);
      await s.set('Font size', '12');
      await s.set('Line height', '16');
      await s.button('Text style picker').click();
      await makeStyle(s, 'Text', 'Type/A');
      await dismiss(s);
      await textLayer(s, 'Style B sample', 'sample', 160, 44);
      await s.set('Font size', '20');
      await s.set('Line height', '16');
      await s.button('Text style picker').click();
      await makeStyle(s, 'Text', 'Type/B');
      await dismiss(s);
      const before = await s.object('Words');
      await s.select('Words');
      await s.press('Enter');
      const editor = s.field('Text editor');
      await editor.press('Home');
      await editor.press('ArrowRight');
      await editor.press('ArrowRight');
      await editor.press('Shift+ArrowRight');
      await editor.press('Shift+ArrowRight');
      await s.button('Text style picker').click();
      await s.role('option', 'Type/B').click();
      await s.check(o => expect(s.lookup(o, 'Words').textRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ start: 2, end: 4, styleSourceName: 'Type/B', font: expect.objectContaining({ size: 20 }) }),
      ])));
      await s.button('Text style actions').click();
      await item(s, 'Detach style');
      await s.press('Escape');
      await s.button('Text style picker').click();
      await editStyle(s, 'Type/A', 'Style font size', '24');
      await dismiss(s);
      await s.check(o => {
        const words = s.lookup(o, 'Words');
        expect(words).toMatchObject({ id: before.id, text: 'abcdef' });
        expect(words.textRuns).toEqual(expect.arrayContaining([
          expect.objectContaining({ start: 0, end: 2, styleSourceName: 'Type/A', font: expect.objectContaining({ size: 24 }) }),
          expect.objectContaining({ start: 4, end: 6, styleSourceName: 'Type/A', font: expect.objectContaining({ size: 24 }) }),
        ]));
        const local = words.textRuns!.find(run => run.start === 2 && run.end === 4);
        expect(local).toMatchObject({ font: { size: 20, lineHeight: 16 } });
        expect((local as { styleSourceName?: string }).styleSourceName ?? null).toBeNull();
      });
    },
  },
  {
    requirement: 'STYLE-04', name: 'Keep a Text Style through a Bold shortcut',
    async run(s) {
      const layer = await textLayer(s, 'Words', 'abcdef', 40, 44);
      await s.set('Font size', '12');
      await s.set('Line height', '16');
      await s.button('Text style picker').click();
      await makeStyle(s, 'Text', 'Type/A');
      await dismiss(s);
      await s.select('Words');
      await s.press('Enter');
      const editor = s.field('Text editor');
      for (const key of ['Home', 'ArrowRight', 'ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight']) await editor.press(key);
      await editor.press('ControlOrMeta+b');
      await s.button('Text style picker').click();
      await editStyle(s, 'Type/A', 'Style font size', '20');
      await s.check(o => {
        const words = s.lookup(o, 'Words');
        expect(words).toMatchObject({ id: layer.id, text: 'abcdef' });
        for (const [start, end, style] of [[0, 2, 'Regular'], [2, 4, 'Bold'], [4, 6, 'Regular']] as const) {
          const run = words.textRuns!.find(value => value.start === start && value.end === end);
          expect(run).toMatchObject({
            styleSourceName: 'Type/A', font: { size: 20, lineHeight: 16, style },
          });
        }
      });
      const result = s.role('option', 'Type/A');
      await result.hover();
      await result.getByRole('button', { name: 'Reapply text style', exact: true }).click();
      await s.check(o => {
        const words = s.lookup(o, 'Words');
        expect(words).toMatchObject({ id: layer.id, text: 'abcdef' });
        const runs = words.textRuns ?? [];
        if (runs.length === 0) {
          expect(words.font).toMatchObject({ style: 'Regular', size: 20, lineHeight: 16 });
          expect(words.styles?.textSourceId).toBeTruthy();
        } else {
          for (let index = 0; index < 6; index++) {
            const run = runs.find(value => value.start <= index && value.end > index);
            expect(run).toMatchObject({ styleSourceName: 'Type/A', font: { style: 'Regular', size: 20, lineHeight: 16 } });
          }
        }
      });
    },
  },
  {
    requirement: 'EDITOR-CONTROL-INPUT', name: 'Keep focus while editing part of a stop color',
    async run(s) {
      const inputs = await linear(s, 2);
      const first = inputs.first();
      await first.fill('2563EB');
      await first.press('Enter');
      const before = await s.object('Paint');
      const initialStops = before.gradient?.stops as Array<{ position: number; color: string; opacity: number }>;
      await first.click();
      for (const key of ['Home', 'ArrowRight', 'ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight']) await first.press(key);
      await s.page.keyboard.insertText('99');
      await s.press('ArrowLeft');
      await s.press('ArrowRight');
      await expect(first).toHaveValue('2599EB');
      await expect(first).toBeFocused();
      await expect.poll(() => first.evaluate(el => (el as HTMLInputElement).selectionStart)).toBe(4);
      const after = await s.selected();
      expect(after.id).toBe(before.id);
      const stops = after.gradient?.stops as Array<{ position: number; color: string; opacity: number }>;
      expect(stops).toHaveLength(initialStops.length);
      expect(stops[0]?.position).toBe(initialStops[0]?.position);
      expect(stops.slice(1)).toEqual(initialStops.slice(1));
    },
  },
  {
    requirement: 'EDITOR-CONTROL-SELECT', name: 'Choose and dismiss an image mode',
    async run(s) {
      const before = await s.object('Image box');
      await openImage(s);
      await expect(s.button('Image mode')).toHaveText('Fill');
      await s.button('Image mode').click();
      await expect(s.role('option', 'Fit')).toBeVisible();
      await dismiss(s);
      await expect(s.role('option', 'Fit')).toBeHidden();
      await expect(s.button('Image mode')).toHaveText('Fill');
      await s.check(o => expect(s.lookup(o, 'Image box').image?.mode).toBe('fill'));
      await choose(s, 'Image mode', 'Fit');
      await expect(s.button('Image mode')).toHaveText('Fit');
      await s.button('Image mode').click();
      await selectedControl(s.role('option', 'Fit'));
      await dismiss(s);
      await s.check(o => expect(s.lookup(o, 'Image box')).toMatchObject({
        id: before.id, geometry: before.geometry, image: { mode: 'fit', sourceWidth: 120, sourceHeight: 80 },
      }));
    },
  },
  {
    requirement: 'EDITOR-CONTROL-ICON-BUTTON', name: 'Use an icon action without editing its neighboring field',
    async run(s) {
      await s.select('Paint');
      await s.set('Fill opacity', '60');
      const before = await s.object('Paint');
      await expect(s.field('Fill opacity')).toHaveValue(/^60%?$/);
      const painted = await s.pixel(36, 34);
      await s.button('Hide fill').click();
      await expect(s.button('Show fill')).toBeVisible();
      await expect(s.field('Fill opacity')).toHaveValue(/^60%?$/);
      await expect.poll(() => s.pixel(36, 34)).not.toEqual(painted);
      await s.button('Show fill').click();
      await expect(s.button('Hide fill')).toBeVisible();
      await expect(s.field('Fill opacity')).toHaveValue(/^60%?$/);
      await expect.poll(() => s.pixel(36, 34)).toEqual(painted);
      await s.check(o => expect(s.lookup(o, 'Paint')).toMatchObject({
        id: before.id, geometry: before.geometry, fill: { opacity: 0.6 },
      }));
    },
  },
  {
    requirement: 'EDITOR-CONTROL-CHECKBOX', name: 'Toggle Clip content from its label and checkbox',
    async run(s) {
      const frame = await shape(s, 'Frame', 'Clip demo', 130, 120, 120, 80);
      await shape(s, 'Rectangle', 'Overflow', 225, 142, 20, 35);
      await s.set('Width', '70');
      await s.set('Fill', 'FF0000');
      await s.select('Clip demo');
      const checkbox = s.role('checkbox', 'Clip content');
      await checkbox.uncheck();
      await expect.poll(() => s.pixel(280, 160)).toEqual([255, 0, 0, 255]);
      await s.page.getByText('Clip content', { exact: true }).click();
      await expect(checkbox).toBeChecked();
      await expect.poll(() => s.pixel(280, 160)).not.toEqual([255, 0, 0, 255]);
      await checkbox.focus();
      await s.press('Space');
      await expect(checkbox).not.toBeChecked();
      await expect.poll(() => s.pixel(280, 160)).toEqual([255, 0, 0, 255]);
      await s.check(o => expect(s.lookup(o, 'Overflow').parentId).toBe(frame.id));
    },
  },
  {
    requirement: 'EDITOR-CONTROL-SEGMENTED', name: 'Keep the selected Flow visible',
    async run(s) {
      await s.select('Flow');
      const choice = (name: string) => s.button(name).or(s.role('radio', name)).or(s.role('tab', name)).filter({ visible: true });
      await choice('Freeform').click();
      await selectedControl(choice('Freeform'));
      await choice('Horizontal').click();
      await selectedControl(choice('Horizontal'));
      await s.check(o => {
        const a = s.lookup(o, 'Flow A').geometry;
        const b = s.lookup(o, 'Flow B').geometry;
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
      });
      await choice('Vertical').click();
      await s.canvas().hover();
      await choice('Vertical').click();
      await s.canvas().hover();
      await selectedControl(choice('Vertical'));
      await selectedControl(choice('Horizontal'), false);
      await s.check(o => {
        const a = s.lookup(o, 'Flow A').geometry;
        const b = s.lookup(o, 'Flow B').geometry;
        expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
      });
    },
  },
  {
    requirement: 'EDITOR-CONTROL-SEARCH-PICKER', name: 'Filter a picker without losing the query',
    async run(s) {
      await s.select('Detached');
      await s.button('Fill style actions').click();
      await item(s, 'Detach style');
      await fillStylePicker(s);
      const search = s.field('Search styles').or(s.role('searchbox', 'Search styles')).filter({ visible: true });
      const result = s.role('option', 'Color/Action');
      await search.fill('Action');
      await expect(search).toBeFocused();
      await expect(result).toBeVisible();
      await search.fill('No matching style');
      await expect(search).toHaveValue('No matching style');
      await expect(search).toBeFocused();
      await expect(result).toBeHidden();
      await expect(s.page.getByText(/no (matching )?(styles|results)/i)).toBeVisible();
      await search.clear();
      await expect(search).toBeFocused();
      await expect(result).toBeVisible();
      await result.click();
      await s.check(o => {
        const target = s.lookup(o, 'Detached');
        expect(target.fill?.color).toBe('F43F5E');
        const id = s.lookup(o, 'Bound').styles?.fillSourceId;
        expect(id).toBeTruthy();
        expect(target.styles?.fillSourceId).toBe(id);
      });
    },
  },
  {
    requirement: 'EDITOR-CONTROL-MENU', name: 'Activate a command from a layer menu',
    async run(s) {
      const before = await s.object('Paint');
      await s.select('Paint');
      await s.layer('Paint').click({ button: 'right' });
      const rename = s.role('menuitem', 'Rename');
      await rename.hover();
      await rename.click();
      await expect(rename).toBeHidden();
      const editor = s.field('Layer name');
      await expect(editor).toBeFocused();
      await editor.fill('Menu renamed');
      await editor.press('Enter');
      await expect(s.layer('Menu renamed')).toHaveAttribute('aria-selected', 'true');
      await s.check(o => expect(s.lookup(o, 'Menu renamed')).toMatchObject({ id: before.id, selected: true }));
    },
  },
  {
    requirement: 'EDITOR-CONTROL-POPOVER', name: 'Return from a nested stop Color popup',
    async run(s) {
      await linear(s, 3);
      const middle = s.role('button', 'Stop color swatch').nth(1);
      const before = (await s.object('Paint')).gradient?.stops;
      await middle.click();
      const color = s.role('dialog', 'Color');
      await expect(color).toBeVisible();
      await choose(s, 'Color format', 'RGB');
      for (const channel of ['R', 'G', 'B']) await expect(color.getByRole('textbox', { name: channel, exact: true })).toBeVisible();
      await color.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(color).toBeHidden();
      await expect(s.button('Fill type')).toHaveText('Linear');
      await selectedControl(s.role('row', 'Gradient stop').nth(1));
      await s.check(o => expect(s.lookup(o, 'Paint').gradient?.stops).toEqual(before));
    },
  },
  {
    requirement: 'EDITOR-TOOLBAR', name: 'Choose a tool from a toolbar group',
    async run(s) {
      await selectedControl(s.button('Move'));
      await expect(s.button('Rectangle')).toBeVisible();
      await s.button('Rectangle menu').click();
      const names = ['Rectangle', 'Line', 'Arrow', 'Ellipse', 'Place image'];
      let previousY = -Infinity;
      for (const name of names) {
        const entry = s.role('menuitem', name).or(s.role('option', name)).or(s.role('menuitemradio', name));
        await expect(entry).toBeVisible();
        const rect = await entry.boundingBox();
        expect(rect!.y).toBeGreaterThan(previousY);
        previousY = rect!.y;
      }
      await item(s, 'Line');
      await selectedControl(s.button('Line'));
      await selectedControl(s.button('Move'), false);
      await s.button('Line menu').click();
      await selectedControl(s.role('menuitemradio', 'Line').or(s.role('option', 'Line')).or(s.role('menuitem', 'Line')));
      await dismiss(s);
      await s.button('Move').click();
      await selectedControl(s.button('Move'));
      await selectedControl(s.button('Line'), false);
    },
  },
  {
    requirement: 'FLOW-03', name: 'Switch between temporary Hand, object drag, and text input',
    async run(s) {
      const a = await s.object('Select A');
      const b = await s.object('Select B');
      await s.button('Move').click();
      await s.point(50, 40);
      await s.drag(50, 40, 90, 70, { modifiers: ['Space'] });
      await s.check(o => {
        expect(o.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
        expect(s.lookup(o, 'Select A')).toMatchObject({ id: a.id, selected: true, geometry: a.geometry });
        expect(s.lookup(o, 'Select B')).toEqual(b);
      });
      await selectedControl(s.button('Move'));
      await s.drag(90, 70, 114, 86);
      await s.check(o => {
        expect(s.lookup(o, 'Select A')).toMatchObject({
          id: a.id, parentId: a.parentId, selected: true, geometry: { x: 44, y: 36, width: 60, height: 40 },
        });
        expect(s.lookup(o, 'Select B')).toEqual(b);
        expect(o.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
      });
      await s.select('Select B');
      await s.set('Width', '80');
      await s.check(o => expect(s.lookup(o, 'Select B').geometry.width).toBe(80));
      await s.button('Move').click();
      await s.press('ControlOrMeta+z');
      await s.check(o => expect(s.lookup(o, 'Select B').geometry.width).toBe(60));
      await s.button('Text').click();
      await s.point(350, 195);
      const editor = s.field('Text editor');
      await editor.pressSequentially('Draft');
      await editor.press('Space');
      await s.press('Escape');
      await s.button('Move').click();
      await s.check(o => {
        const [draft] = o.objects.filter(node => node.type === 'text');
        expect(draft).toMatchObject({ text: 'Draft ', selected: true });
        expect(o.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
        expect(s.lookup(o, 'Select A').geometry).toEqual({ x: 44, y: 36, width: 60, height: 40 });
        expect(s.lookup(o, 'Select B').geometry).toEqual(b.geometry);
      });
      const draft = await s.selected();
      await expect(s.layer(draft)).toHaveAttribute('aria-selected', 'true');
      await expect(s.field('Font size')).toBeVisible();
    },
  },
  {
    requirement: 'EDITOR-INPUT', name: 'Route keys between Layers, text, and numeric input',
    async run(s) {
      const baseline = await s.obs();
      const paragraph = s.lookup(baseline, 'Paragraph');
      const editor = s.field('Text editor');
      expect(paragraph).toMatchObject({ type: 'text', parentId: null,
        geometry: { x: 0, y: 0, width: 275 }, font: { size: 12 },
        text: 'Review a shared workspace and turn feedback into clear next steps.' });
      await expect(editor).toBeHidden();
      await selectedControl(s.button('Move'));
      const inspect = async (x: number) => {
        await s.check(o => {
          expect(o.selectionIds).toEqual([paragraph.id]);
          expect(o.objects.map(object => object.id).sort()).toEqual(baseline.objects.map(object => object.id).sort());
          expect(s.lookup(o, paragraph)).toMatchObject({ type: paragraph.type, parentId: paragraph.parentId,
            text: paragraph.text, geometry: { ...paragraph.geometry, x }, font: { size: 12 } });
          for (const object of baseline.objects.filter(object => object.id !== paragraph.id)) {
            expect(s.lookup(o, object)).toMatchObject({ type: object.type, parentId: object.parentId,
              pageId: object.pageId, geometry: object.geometry });
            if (object.text !== undefined) expect(s.lookup(o, object).text).toBe(object.text);
          }
          expect(o.document.pages).toEqual(baseline.document.pages);
          expect(o.document.currentPageId).toBe(baseline.document.currentPageId);
          for (const [key, fallback] of [['panX', 0], ['panY', 0], ['zoom', 1]] as const) {
            expect(o.document.view?.[key] ?? fallback).toBe(baseline.document.view?.[key] ?? fallback);
          }
        });
        await expect(s.layer(paragraph)).toHaveAttribute('aria-selected', 'true');
        await expect(s.field('X')).toHaveValue(String(x));
        await expect(s.field('Width')).toHaveValue('275');
      };
      await s.layer(paragraph).click();
      await s.press('Enter');
      await expect(editor).toBeVisible();
      await expect(editor).toBeFocused();
      await s.check(o => {
        expect(o.selectionIds).toEqual([paragraph.id]);
        expect(s.lookup(o, paragraph)).toMatchObject({ text: paragraph.text, geometry: paragraph.geometry });
      });
      await s.capture('layers-enter-opens-text-edit');
      await s.press('Escape');
      await expect(editor).toBeHidden();
      await inspect(0);
      await s.press('ArrowRight');
      await inspect(1);
      await s.capture('layer-key-moves-selected-text');
      const x = s.field('X');
      await x.click();
      await expect(x).toBeFocused();
      await s.press('ArrowUp');
      await inspect(2);
      await s.capture('numeric-field-receives-arrow');
      await s.press('Escape');
      await s.press('ControlOrMeta+z');
      await inspect(1);
      await s.capture('document-undo-restores-before-field-nudge');
      await s.press('ControlOrMeta+z');
      await inspect(0);
      await s.capture('document-undo-restores-before-layer-nudge');
    },
  },
  {
    requirement: 'FLOW-03', name: 'Continue edits after panel scroll and page changes',
    async run(s) {
      // Measure the panel actually containing this public control. This reads viewport
      // geometry only and works whether a panel or a child is its scroll container.
      const scroller = (locator: Locator) => locator.evaluate(element => {
        let node: HTMLElement | null = element as HTMLElement;
        while (node) {
          if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight) {
            const bounds = node.getBoundingClientRect();
            return { top: node.scrollTop, range: node.scrollHeight - node.clientHeight,
              x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
          }
          node = node.parentElement;
        }
        return null;
      });
      const wheel = async (locator: Locator, delta: number) => {
        const region = await scroller(locator);
        expect(region, 'panel content is vertically scrollable').not.toBeNull();
        await s.page.mouse.move(region!.x, region!.y);
        await s.page.mouse.wheel(0, delta);
      };
      await s.page.setViewportSize({ width: 1440, height: 620 });
      for (const name of ['Workspace', 'Nested']) {
        const expand = s.layer(name).getByRole('button', { name: 'Expand ' + s.layerName(name), exact: true });
        if (await expand.isVisible()) await expand.click();
      }
      const oldCount = (await s.obs()).objects.length;
      await s.select('Red');
      for (let i = 0; i < 26; i++) await s.press('ControlOrMeta+d');
      await expect.poll(async () => (await s.obs()).objects.length).toBe(oldCount + 26);
      await s.select('Title');
      const before = await s.obs();
      const canvas = await s.canvas().boundingBox();
      expect(s.lookup(before, 'Title')).toMatchObject({ text: 'Draft title', font: { size: 16 } });
      expect(before.objects.filter(node => node.pageId === before.document.pages.find(p => p.name === 'Mobile')!.id)).toHaveLength(0);
      const layers = s.role('tree', 'Layers');
      const design = s.role('region', 'Design');
      await wheel(layers, 1200);
      await expect.poll(async () => (await scroller(layers))?.top).toBeGreaterThan(0);
      await wheel(layers, -1200);
      await s.select('Title');
      await wheel(design, 1200);
      await expect.poll(async () => (await scroller(design))?.top).toBeGreaterThan(0);
      await expect(s.button('Add export')).toBeInViewport();
      await wheel(design, -1200);
      await expect(s.field('Font size')).toBeInViewport();
      await s.check(o => {
        expect(o.document.view).toEqual(before.document.view);
        expect(o.objects.map(layer => ({ ...layer, selected: false })))
          .toEqual(before.objects.map(layer => ({ ...layer, selected: false })));
      });
      expect(await s.canvas().boundingBox()).toEqual(canvas);
      await expect(s.button('Move')).toBeInViewport();
      await s.set('Font size', '20');
      await s.select('Workspace');
      await expect(s.role('checkbox', 'Clip content')).toBeVisible();
      await expect(s.field('Font size')).toBeHidden();
      await s.role('tab', 'Mobile').click();
      const mobile = await shape(s, 'Rectangle', 'Mobile item', 38, 42, 90, 45);
      await s.role('tab', 'Desktop').click();
      await s.select('Title');
      await s.set('Font size', '18');
      const title = await s.object('Title');
      const nested = await s.object('Nested');
      const workspace = await s.object('Workspace');
      const view = (await s.obs()).document.view ?? {};
      const zoom = view.zoom ?? 1;
      const titleX = (title.geometry.x + nested.geometry.x + workspace.geometry.x + 12) * zoom + (view.panX ?? 0);
      const titleY = (title.geometry.y + nested.geometry.y + workspace.geometry.y + 10) * zoom + (view.panY ?? 0);
      await s.point(titleX, titleY, { modifiers: ['ControlOrMeta'] });
      await s.check(o => {
        expect(currentPage(o).name).toBe('Desktop');
        expect(s.lookup(o, 'Title')).toMatchObject({
          id: s.lookup(before, 'Title').id, parentId: nested.id, text: 'Draft title', selected: true, font: { size: 18 },
        });
        expect(s.lookup(o, 'Mobile item')).toMatchObject({ id: mobile.id, pageId: mobile.pageId });
        expect(o.document.pages.find(p => p.id === mobile.pageId)?.name).toBe('Mobile');
        for (const previous of before.objects) {
          if (previous.id === title.id) continue;
          expect(o.objects.find(candidate => candidate.id === previous.id)?.geometry).toEqual(previous.geometry);
        }
      });
      await expect(s.layer('Title')).toHaveAttribute('aria-selected', 'true');
      await expect(s.field('Font size')).toHaveValue('18');
    },
  },
  {
    requirement: 'FLOW-02', name: 'Create, reuse, maintain, reopen, and export a design', entry: 'home',
    async run(s) {
      s.testInfo.setTimeout(360_000);
      await newDesign(s);
      const documentId = (await s.obs()).document.id;
      const place = async (fixture: string, x: number, y: number) => {
        const direct = s.button('Place image');
        if (await direct.isVisible()) await s.file(direct, fixture);
        else {
          await s.button('Rectangle menu').click();
          await s.file(s.role('menuitem', 'Place image').or(s.role('option', 'Place image')), fixture);
        }
        await s.point(x, y);
      };
      const flow = async (direction: string) => {
        const segmented = s.button(direction).or(s.role('radio', direction)).filter({ visible: true });
        if (await segmented.isVisible()) await segmented.click();
        else await choose(s, 'Flow', direction);
      };
      const createList = async (name: string, w: number) => {
        const outer = await shape(s, 'Frame', name + ' page', 20, 20, w + 40, 690);
        const heading = await textLayer(s, name + ' heading', name + ' catalogue', 40, 45);
        await choose(s, 'Font family', 'Inter');
        await choose(s, 'Font style', 'Regular');
        await s.set('Font size', '14');
        await s.set('Line height', '20');
        if (name === 'Desktop') {
          await s.button('Text style picker').click();
          await makeStyle(s, 'Text', 'Type/Card');
          await dismiss(s);
        }
        await s.point(55, 55, { modifiers: ['ControlOrMeta'], clickCount: 2 });
        await s.field('Text editor').fill(name + ' catalogue ready');
        await s.press('Escape');
        const surface = await shape(s, 'Rectangle', name + ' surface', 42, 78, 120, 80);
        await s.set('Fill', 'D9D9D9');
        if (name === 'Desktop') {
          await colorStyleFromFill(s, 'Color/Card');
          await dismiss(s);
        }
        const photo = await shape(s, 'Rectangle', name + ' photo', 187, 78, 120, 80);
        await place(png, 247, 118);
        await place(svg, 80, 189);
        const icon = await s.selected();
        await s.bindSelected(name + ' icon');
        const list = await shape(s, 'Frame', name + ' list', 40, 231, w, 130);
        await flow('Horizontal');
        await s.button('Wrap').click();
        await choose(s, 'Vertical sizing', 'Hug contents');
        await s.set('Horizontal padding', '10');
        await s.set('Vertical padding', '10');
        await s.set('Gap', '20');
        await s.set(/^(Between rows|Row gap)$/i, '20');
        await s.button('Top left').click();
        await expect(s.field('Width')).toHaveValue(String(w));
        await expect(s.field('Gap')).toHaveValue('20');
        await expect(s.field(/^(Between rows|Row gap)$/i)).toHaveValue('20');
        await expect(s.field('Horizontal padding')).toHaveValue('10');
        await expect(s.field('Vertical padding')).toHaveValue('10');
        await s.check(o => {
          expect(s.lookup(o, name + ' list')).toMatchObject({ id: list.id, parentId: outer.id, geometry: { width: w } });
          expect(s.lookup(o, name + ' heading')).toMatchObject({
            id: heading.id, parentId: outer.id, type: 'text', text: name + ' catalogue ready',
          });
          expect(s.lookup(o, name + ' photo')).toMatchObject({ id: photo.id, parentId: outer.id,
            image: { sourceWidth: 120, sourceHeight: 80 },
          });
          const graphic = s.lookup(o, name + ' icon');
          expect(graphic.id).toBe(icon.id);
          expect(graphic.parentId).toBe(outer.id);
          expect([graphic, ...descendants(o, graphic.id)].some(node => node.type === 'vector')).toBe(true);
          expect(s.lookup(o, name + ' surface').id).toBe(surface.id);
        });
        return { outer, list, heading, surface, photo, icon };
      };
      const desktop = await createList('Desktop', 500);
      const source = await component(s, 'Card', 620, 34, 'Explore', 'D9D9D9', 'Card label');
      await applyColorStyle(s, 'Color/Card');
      await flow('Vertical');
      await s.set('Width', '200');
      await choose(s, 'Vertical sizing', 'Hug contents');
      await s.set('Horizontal padding', '10');
      await s.set('Vertical padding', '10');
      await s.set('Gap', '10');
      await s.select('Card label');
      await s.button('Text style picker').click();
      await s.role('option', 'Type/Card').click();
      await choose(s, 'Horizontal sizing', 'Fill container');
      await choose(s, 'Text resizing', 'Auto height');
      await s.select('Card');
      await defineProperty(s, 'Text', 'Label', 'Explore');
      await s.select('Card label');
      await bindProperty(s, 'Apply text property', 'Label');

      const addCard = async (alias: string, listId: string, x: number, y: number) => {
        await s.button('Assets').click();
        await s.asset('Card').dragTo(s.canvas(), { targetPosition: { x, y } });
        if (!await s.role('tree', 'Layers').isVisible()) await s.button('File').click();
        await s.bindSelected(alias);
        await choose(s, 'Horizontal sizing', 'Fill container');
        await s.button('Width options').click();
        await item(s, 'Add min width');
        await s.set('Min width', '200');
        await choose(s, 'Vertical sizing', 'Hug contents');
        await s.check(o => expect(s.lookup(o, alias)).toMatchObject({
          type: 'instance', parentId: listId, component: { sourceId: source.id },
          layout: { width: 'fill', minWidth: 200, height: 'hug' },
        }));
        await s.check(o => expect(s.lookup(o, alias).layout?.maxWidth ?? null).toBeNull());
        return await s.object(alias);
      };
      // Recompute rows from the published inputs, then judge actual geometry at each stage.
      const verifyList = (o: ObserveSnapshot, listRef: LayerReference, cards: ObserveObject[], expectedWidth = 500, gap = 20) => {
        const list = s.lookup(o, listRef);
        expect(list.geometry.width).toBe(expectedWidth);
        expect(list.layout?.height).toBe('hug');
        const available = expectedWidth - 20;
        const capacity = Math.floor((available + gap) / (200 + gap));
        let y = 10;
        for (let start = 0; start < cards.length; start += capacity) {
          const row = cards.slice(start, start + capacity).map(card => s.lookup(o, card));
          const width = (available - gap * (row.length - 1)) / row.length;
          let rowHeight = 0;
          for (const [column, card] of row.entries()) {
            const label = oneChild(o, card.id, 'text');
            expect(card.layout).toMatchObject({ width: 'fill', minWidth: 200, height: 'hug' });
            expect(card.layout?.maxWidth ?? null).toBeNull();
            expect(label).toMatchObject({ textSizing: 'auto-height', layout: { width: 'fill' }, font: { lineHeight: 20 } });
            expect(label.geometry).toMatchObject({ x: 10, y: 10, width: width - 20 });
            expect(label.geometry.height).toBeGreaterThanOrEqual(20);
            expect(label.geometry.height % 20).toBe(0);
            if (label.text !== 'Changed after reopening') {
              expect(label.geometry.height).toBe((label.text?.split('\n').length ?? 0) * 20);
            }
            expect(card.geometry.x).toBeCloseTo(10 + column * (width + gap), 5);
            expect(card.geometry.y).toBeCloseTo(y, 5);
            expect(card.geometry.width).toBeCloseTo(width, 5);
            expect(card.geometry.height).toBeCloseTo(label.geometry.height + 20, 5);
            rowHeight = Math.max(rowHeight, card.geometry.height);
          }
          y += rowHeight + 20;
        }
        // y contains the final row's 20 gap; replace that with the 10 bottom padding.
        expect(list.geometry.height).toBeCloseTo(y - 10, 5);
      };
      const a = await addCard('Desktop card A', desktop.list.id, 80, 253);
      const b = await addCard('Desktop card B', desktop.list.id, 155, 260);
      await s.select('Desktop card A');
      await s.set('Label', 'Only on Desktop');
      await s.check(o => {
        expect(s.lookup(o, 'Desktop card A').geometry.y).toBe(s.lookup(o, 'Desktop card B').geometry.y);
        expect(s.lookup(o, 'Desktop card B').geometry.x).toBeGreaterThan(s.lookup(o, 'Desktop card A').geometry.x);
        expect(oneChild(o, a.id, 'text')).toMatchObject({ text: 'Only on Desktop', geometry: { height: 20 } });
        verifyList(o, desktop.list, [a, b]);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(60);
      });
      const rowHeight = 60;
      await addPage(s, 'Mobile');
      const mobile = await createList('Mobile', 260);
      const m = await addCard('Mobile card', mobile.list.id, 90, 253);
      const mobileWidth = 260;
      await s.check(o => verifyList(o, mobile.list, [m], 260));
      await s.role('tab', 'Desktop').click();
      const c = await addCard('Desktop card C', desktop.list.id, 150, 259);
      await s.check(o => {
        expect(s.lookup(o, 'Desktop list').geometry.height).toBeGreaterThan(rowHeight);
        verifyList(o, desktop.list, [a, b, c]);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(120);
      });
      const shorter = 40;
      const local = oneChild(await s.obs(), a.id, 'text');
      await s.select(local);
      await choose(s, 'Horizontal sizing', 'Fill container');
      await choose(s, 'Text resizing', 'Auto height');
      await s.select('Desktop card A');
      const longText = 'Only on Desktop\nSecond line\nThird line';
      await s.set('Label', longText);
      await s.check(o => {
        expect(oneChild(o, a.id, 'text')).toMatchObject({ text: longText, geometry: { height: 60 } });
        verifyList(o, desktop.list, [a, b, c]);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(160);
        expect(s.lookup(o, 'Desktop card A').geometry.height).toBeGreaterThan(shorter);
        const cards = [a, b, c].map(card => o.objects.find(item => item.id === card.id)!.geometry);
        const lower = cards.find(card => card.y > cards[0]!.y);
        expect(lower).toBeDefined();
        expect(lower!.y).toBeGreaterThanOrEqual(cards[0]!.y + cards[0]!.height);
      });
      await s.select('Desktop list');
      await s.set('Width', '260');
      await expect(s.field('Width')).toHaveValue('260');
      await s.check(o => {
        expect(new Set([a, b, c].map(card => o.objects.find(item => item.id === card.id)!.geometry.y)).size).toBe(3);
        expect(s.lookup(o, 'Mobile list').geometry.width).toBe(mobileWidth);
        verifyList(o, desktop.list, [a, b, c], 260);
        verifyList(o, mobile.list, [m], 260);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(220);
      });
      await canvasShortcut(s, 'ControlOrMeta+z');
      await expect(s.field('Width')).toHaveValue('500');
      await s.check(o => {
        expect(s.lookup(o, 'Desktop list').geometry.width).toBe(500);
        expect(new Set([a, b, c].map(card => o.objects.find(item => item.id === card.id)!.geometry.y)).size).toBe(2);
        expect(oneChild(o, a.id, 'text').text).toBe(longText);
        verifyList(o, desktop.list, [a, b, c]);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(160);
      });
      await s.select('Card');
      await s.set('Opacity', '80');
      await fillStylePicker(s);
      await editStyle(s, 'Color/Card', 'Style color', 'E6F0FF');
      await dismiss(s);
      await s.select('Card label');
      await s.button('Text style picker').click();
      await editStyle(s, 'Type/Card', 'Style font size', '16');
      await dismiss(s);
      const styled = await s.obs();
      const fillStyle = s.lookup(styled, source).styles?.fillSourceId;
      const textStyle = s.lookup(styled, 'Card label').styles?.textSourceId;
      expect(fillStyle).toBeTruthy();
      expect(textStyle).toBeTruthy();
      const verifyShared = (o: ObserveSnapshot, fontSize = 16, opacity = 0.8, gap = 20, bText = 'Explore') => {
        expect(o.document.id).toBe(documentId);
        expect(o.document.pages.map(page => page.name)).toEqual(['Desktop', 'Mobile']);
        expect(s.lookup(o, 'Desktop list').geometry.width).toBe(500);
        expect(s.lookup(o, 'Mobile list').geometry.width).toBe(260);
        for (const page of ['Desktop', 'Mobile']) {
          const photo = s.lookup(o, page + ' photo');
          expect(photo.image).toMatchObject({ sourceWidth: 120, sourceHeight: 80 });
          const icon = s.lookup(o, page + ' icon');
          expect([icon, ...descendants(o, icon.id)].some(node => node.type === 'vector')).toBe(true);
        }
        expect(s.lookup(o, source)).toMatchObject({
          opacity, fill: { color: 'E6F0FF' }, styles: { fillSourceId: fillStyle },
          layout: { height: 'hug' }, geometry: { width: 200, height: 40 },
        });
        expect(oneChild(o, source.id, 'text')).toMatchObject({
          text: 'Explore', textSizing: 'auto-height', layout: { width: 'fill' },
          geometry: { x: 10, y: 10, width: 180, height: 20 },
          font: { family: 'Inter', style: 'Regular', size: fontSize, lineHeight: 20 },
          styles: { textSourceId: textStyle },
        });
        expect(s.lookup(o, 'Desktop surface')).toMatchObject({ styles: { fillSourceId: fillStyle }, fill: { color: 'E6F0FF' } });
        expect(s.lookup(o, 'Desktop heading')).toMatchObject({ styles: { textSourceId: textStyle }, font: { family: 'Inter', style: 'Regular', size: fontSize, lineHeight: 20 } });
        for (const instance of [a, b, c, m]) {
          expect(o.objects.find(node => node.id === instance.id)).toMatchObject({
            component: { sourceId: source.id }, opacity, fill: { color: 'E6F0FF' },
          });
          expect(oneChild(o, instance.id, 'text')).toMatchObject({ font: { family: 'Inter', style: 'Regular', size: fontSize, lineHeight: 20 }, styles: { textSourceId: textStyle } });
        }
        expect(oneChild(o, source.id, 'text').text).toBe('Explore');
        expect(oneChild(o, a.id, 'text')).toMatchObject({ text: longText, geometry: { height: 60 } });
        expect(oneChild(o, b.id, 'text').text).toBe(bText);
        expect(oneChild(o, c.id, 'text').text).toBe('Explore');
        expect(oneChild(o, m.id, 'text').text).toBe('Explore');
        verifyList(o, desktop.list, [a, b, c], 500, gap);
        expect(s.lookup(o, desktop.list).geometry.height).toBe(160);
        verifyList(o, mobile.list, [m], 260);
        expect(s.lookup(o, mobile.list).geometry.height).toBe(60);
      };
      await s.check(o => verifyShared(o));
      await expect(s.role('status', 'Save status')).toHaveText('Saved');
      await s.capture('before-close');
      await s.reopen();
      await s.check(o => verifyShared(o));
      await s.role('tab', 'Desktop').click();
      await s.select('Card');
      await s.set('Opacity', '90');
      await s.select('Desktop card B');
      await s.set('Label', 'Changed after reopening');
      await s.select('Card label');
      await s.button('Text style picker').click();
      await editStyle(s, 'Type/Card', 'Style font size', '18');
      await dismiss(s);
      const gapBefore = 20;
      await s.select('Desktop list');
      await s.set('Gap', '28');
      await expect(s.field('Gap')).toHaveValue('28');
      await expect(s.field(/^(Between rows|Row gap)$/i)).toHaveValue('20');
      await s.check(o => {
        verifyShared(o, 18, 0.9, 28, 'Changed after reopening');
        for (const instance of [a, b, c, m]) expect(o.objects.find(item => item.id === instance.id)?.opacity).toBe(0.9);
        expect(oneChild(o, b.id, 'text').text).toBe('Changed after reopening');
        expect(oneChild(o, source.id, 'text').text).toBe('Explore');
        expect(oneChild(o, a.id, 'text').text).toBe(longText);
        const ga = s.lookup(o, 'Desktop card A').geometry;
        const gb = s.lookup(o, 'Desktop card B').geometry;
        expect(gb.x - ga.x - ga.width).toBeGreaterThan(gapBefore);
      });

      await s.select('Desktop page');
      await s.button('Add export').click();
      await choose(s, 'Export format', 'PNG');
      await s.set('Export scale', '2x');
      await expect(s.field('Export scale')).toHaveValue('2x');
      const exportFrame = (await s.object('Desktop page')).geometry;
      const output = await exportPng(s, 'Desktop page', 'desktop-page.png', exportFrame.width * 2, exportFrame.height * 2);
      const sampled = await imageSamples(s.page, output, 'image/png', [[10, 10], [84, 176], [370, 136], [516, 254]]);
      expect(sampled[0]).toEqual([255, 255, 255, 255]);
      expect(sampled[1]).toEqual([230, 240, 255, 255]);
      expect(sampled[2]).not.toEqual(sampled[3]);
      expect(await darkPixels(s.page, output, { x: 36, y: 44, width: 460, height: 62 })).toBeGreaterThan(10);
      const layers = await s.obs();
      const iconRoot = s.lookup(layers, 'Desktop icon');
      const icon = [iconRoot, ...descendants(layers, iconRoot.id)].find(node => node.type === 'vector')!;
      expect(icon, 'imported icon remains editable vector content').toBeDefined();
      await s.select(icon);
      await s.set('Fill', 'E11D48');
      await s.button('Add export').click();
      await choose(s, 'Export format', 'SVG');
      const artifact = await s.download('Export ' + icon.name!, 'desktop-icon.svg');
      const vectorElements = await s.page.evaluate(source => {
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        if (doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror')) return 0;
        return doc.querySelectorAll('path, rect, circle, ellipse, line, polygon, polyline, use').length;
      }, artifact.toString('utf8'));
      expect(vectorElements).toBeGreaterThan(0);
      const iconGeometry = (await s.object(icon.name!)).geometry;
      const center = (size: number) => Math.floor(size / 2);
      expect(await imageSamples(s.page, artifact, 'image/svg+xml', [[center(iconGeometry.width), center(iconGeometry.height)]]))
        .toEqual([[225, 29, 72, 255]]);
      await editText(s, 'Desktop heading', 'Still editable after export');
      expect((await s.object('Desktop heading')).id).toBe(desktop.heading.id);
    },
  },
];
