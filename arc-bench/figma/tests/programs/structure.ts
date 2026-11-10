import { expect, type Locator } from '@playwright/test';
import type { ObserveObject, ObserveSnapshot } from '../oracles.js';
import type { Program } from '../scenario.js';

type Scenario = Parameters<Program['run']>[0];
type Point = [number, number];
type Rect = [number, number, number, number];
type Tool = 'Frame' | 'Rectangle' | 'Section' | 'Text';

const program = (requirement: string, name: string, run: Program['run']): Program => ({ requirement, name, run });
const dimensions = ([x, y, width, height]: Rect) => ({ x, y, width, height });

function pagePosition(s: Scenario, state: ObserveSnapshot, name: string): Point {
  const object = s.lookup(state, name);
  let { x, y } = object.geometry;
  let parentId = object.parentId;
  const seen = new Set([object.id]);
  while (parentId) {
    expect(seen.has(parentId), `ancestor cycle at ${name}`).toBe(false);
    seen.add(parentId);
    const parent = state.objects.find(candidate => candidate.id === parentId);
    if (!parent) throw new Error(`Missing ancestor of ${name}`);
    x += parent.geometry.x;
    y += parent.geometry.y;
    parentId = parent.parentId;
  }
  return [x, y];
}

function inCanvas(state: ObserveSnapshot, x: number, y: number): Point {
  const view = state.document.view;
  return [x * (view?.zoom ?? 1) + (view?.panX ?? 0), y * (view?.zoom ?? 1) + (view?.panY ?? 0)];
}

async function draw(s: Scenario, tool: Tool, name: string, [x, y, width, height]: Rect, content?: string) {
  const shortcut = { Frame: 'f', Rectangle: 'r', Section: 'Shift+s', Text: 't' }[tool];
  const state = await s.obs();
  const [sx, sy] = inCanvas(state, x, y);
  const [ex, ey] = inCanvas(state, x + width, y + height);
  await s.press('Escape');
  await s.press(shortcut);
  await s.drag(sx, sy, ex, ey);
  if (tool === 'Text') {
    await s.role('textbox', 'Text editor').fill(content ?? name);
    await s.press('Escape');
  }
  await s.bindSelected(name);
  await expect(s.layer(name)).toBeVisible();
}

async function position(s: Scenario, name: string, rect: Rect, parent?: string | null) {
  await s.check(state => {
    const object = s.lookup(state, name);
    expect(object.geometry, `${name} geometry`).toEqual(dimensions(rect));
    if (parent !== undefined) expect(object.parentId, `${name} parent`).toBe(parent === null ? null : s.lookup(state, parent).id);
  });
}

async function absolute(s: Scenario, name: string, x: number, y: number) {
  await s.check(state => expect(pagePosition(s, state, name), `${name} page position`).toEqual([x, y]));
}

async function choose(s: Scenario, ...names: string[]) {
  await s.select(names[0]);
  for (const name of names.slice(1)) await s.layer(name).click({ modifiers: ['ControlOrMeta'] });
}

async function selected(s: Scenario, ...names: string[]) {
  await s.check(state => {
    const ids = names.map(name => s.lookup(state, name).id);
    expect([...state.selectionIds].sort()).toEqual(ids.sort());
  });
  for (const name of names) await expect(s.layer(name)).toHaveAttribute('aria-selected', 'true');
}

async function group(s: Scenario, name: string, ...members: string[]) {
  await choose(s, ...members);
  await s.press('ControlOrMeta+g');
  await s.bindSelected(name);
  await s.check(state => {
    const owner = s.lookup(state, name);
    expect(owner.type).toBe('group');
    for (const member of members) expect(s.lookup(state, member).parentId).toBe(owner.id);
  });
}

async function menu(s: Scenario, row: string, command: string | RegExp) {
  await s.layer(row).click({ button: 'right' });
  await s.role('menuitem', command).click();
}

async function dragBetween(s: Scenario, source: Locator, target: Locator, observeDrop = false) {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Layers source or drop destination is unavailable');
  const mouse = s.page.mouse;
  await mouse.move(from.x + Math.min(from.width / 2, 70), from.y + from.height / 2);
  await mouse.down();
  try {
    await mouse.move(to.x + Math.min(to.width / 2, 55), to.y + to.height / 2, { steps: 12 });
    if (observeDrop) await s.capture('before-layer-drop');
  } finally {
    await mouse.up();
  }
}

async function move(s: Scenario, name: string, dx: number, dy: number, title = false) {
  await s.select(name);
  await s.button('Move').click();
  const state = await s.obs();
  const [x, y] = pagePosition(s, state, name);
  const { width, height } = s.lookup(state, name).geometry;
  const [sx, sy] = inCanvas(state, title ? x + 12 : x + width * 0.8, title ? y - 10 : y + height * 0.8);
  const zoom = state.document.view?.zoom ?? 1;
  await s.drag(sx, sy, sx + dx * zoom, sy + dy * zoom);
}

async function resize(s: Scenario, name: string, corner: 'start' | 'end', dx: number, dy: number) {
  await s.select(name);
  const state = await s.obs();
  const [x, y] = pagePosition(s, state, name);
  const { width, height } = s.lookup(state, name).geometry;
  const [sx, sy] = inCanvas(state, x + (corner === 'end' ? width : 0), y + (corner === 'end' ? height : 0));
  const zoom = state.document.view?.zoom ?? 1;
  await s.drag(sx, sy, sx + dx * zoom, sy + dy * zoom);
}

async function pan(s: Scenario, dx: number, dy: number) {
  const box = await s.canvas().boundingBox();
  if (!box) throw new Error('Design canvas is unavailable');
  const x = Math.max(20, 20 - dx);
  const y = Math.max(20, 20 - dy);
  expect(x + dx).toBeLessThan(box.width);
  expect(y + dy).toBeLessThan(box.height);
  await s.drag(x, y, x + dx, y + dy, { button: 'middle' });
}

async function zoom(s: Scenario, value: number) {
  await s.button('Zoom options').click();
  await s.set('Zoom', String(value));
  await s.check(state => expect(state.document.view?.zoom).toBeCloseTo(value / 100));
}

async function fill(s: Scenario, name: string, value: string) {
  await s.select(name);
  await s.set('Fill', value);
  await s.check(state => expect(s.lookup(state, name).fill?.color).toBe(value));
}

async function rowButton(s: Scenario, name: string, action: RegExp) {
  const control = s.role('button', action, s.layer(name));
  await s.layer(name).hover();
  await control.click();
}

async function visibleColor(s: Scenario, x: number, y: number, hex: string) {
  const expected = hex.match(/../g)!.map(component => Number.parseInt(component, 16));
  const [cx, cy] = inCanvas(await s.obs(), x, y);
  await expect.poll(async () => (await s.pixel(cx, cy)).slice(0, 3)).toEqual(expected);
}

async function layerColor(s: Scenario, name: string, hex: string) {
  await s.select(name);
  await expect(s.field('Fill')).toHaveValue(hex);
  await s.check(state => expect(s.lookup(state, name).fill?.color).toBe(hex));
}

async function createPage(s: Scenario, name: string) {
  await s.button('Add page').click();
  await s.set('Page name', name);
  await currentPage(s, name);
}

async function currentPage(s: Scenario, name: string) {
  await expect(s.role('tab', name)).toHaveAttribute('aria-selected', 'true');
  await s.check(state => {
    const current = state.document.pages.find(page => page.id === state.document.currentPageId);
    expect(current?.name).toBe(name);
  });
}

async function reopenSaved(s: Scenario) {
  await expect(s.role('status', 'Save status')).toHaveText('Saved');
  await s.reopen();
  await expect(s.role('status', 'Save status')).toHaveText('Saved');
}

export const programs: Program[] = [
  program('GROUP-BOUNDS', 'Undo and redo a Group bounds change', async s => {
    await draw(s, 'Rectangle', 'A', [20, 20, 40, 20]);
    await draw(s, 'Rectangle', 'B', [100, 20, 40, 20]);
    const before = await s.obs();
    await group(s, 'G', 'A', 'B');
    await position(s, 'G', [20, 20, 120, 20], null);
    const initial = await s.object('G');
    await s.select('A');
    await s.set('X', '165');
    await position(s, 'G', [100, 20, 105, 20], null);
    await absolute(s, 'A', 165, 20);
    await s.press('ControlOrMeta+z');
    await position(s, 'G', [20, 20, 120, 20], null);
    await absolute(s, 'A', 20, 20);
    await s.press('ControlOrMeta+Shift+z');
    await position(s, 'G', [100, 20, 105, 20], null);
    await absolute(s, 'A', 165, 20);
    await s.select('G');
    await s.press('ControlOrMeta+Shift+g');
    await s.check(state => {
      expect(state.objects.some(object => object.id === initial.id)).toBe(false);
      for (const name of ['A', 'B']) {
        expect(s.lookup(state, name)).toMatchObject({ id: s.lookup(before, name).id, parentId: null });
      }
    });
    await s.press('ControlOrMeta+z');
    await s.check(state => expect(s.lookup(state, 'A').parentId).toBe(initial.id));
    await s.press('ControlOrMeta+Shift+z');
    await s.check(state => expect(s.lookup(state, 'A').parentId).toBeNull());
  }),

  program('SECTION-REMOVE', 'Delete content or keep it after Section removal', async s => {
    await draw(s, 'Section', 'S', [35, 55, 300, 240]);
    await draw(s, 'Frame', 'F', [75, 100, 100, 80]);
    await draw(s, 'Rectangle', 'Member', [200, 150, 45, 32]);
    const before = await s.obs();
    const ids = ['S', 'F', 'Member'].map(name => s.lookup(before, name).id);
    await s.select('S');
    await s.press('Backspace');
    await s.check(state => expect(state.objects.filter(object => ids.includes(object.id))).toHaveLength(0));
    await s.press('ControlOrMeta+z');
    await position(s, 'F', [40, 45, 100, 80], 'S');
    await position(s, 'Member', [165, 95, 45, 32], 'S');
    await s.select('S');
    const isMac = await s.page.evaluate(() => /Mac/.test(navigator.platform));
    await s.press(isMac ? 'Meta+Backspace' : 'Control+Backspace');
    const removed = (state: ObserveSnapshot) => {
      expect(state.objects.some(object => object.id === ids[0])).toBe(false);
      expect(s.lookup(state, 'F')).toMatchObject({ id: ids[1], parentId: null, geometry: dimensions([75, 100, 100, 80]) });
      expect(s.lookup(state, 'Member')).toMatchObject({ id: ids[2], parentId: null, geometry: dimensions([200, 150, 45, 32]) });
    };
    await s.check(removed);
    await s.press('ControlOrMeta+z');
    await position(s, 'F', [40, 45, 100, 80], 'S');
    await s.press('ControlOrMeta+Shift+z');
    await s.check(removed);
    await reopenSaved(s);
    await s.check(removed);
    await fill(s, 'Member', '224466');
  }),

  program('SECTION-MEMBERS', 'Move a Frame through nested Sections', async s => {
    await draw(s, 'Section', 'A', [30, 55, 390, 300]);
    await draw(s, 'Section', 'B', [65, 110, 245, 185]);
    await draw(s, 'Frame', 'C', [475, 140, 80, 60]);
    await draw(s, 'Rectangle', 'Inside C', [485, 150, 25, 20]);
    await move(s, 'C', -355, 0);
    await position(s, 'C', [55, 30, 80, 60], 'B');
    await move(s, 'A', 24, 18, true);
    await absolute(s, 'C', 144, 158);
    await absolute(s, 'Inside C', 154, 168);
    await resize(s, 'A', 'end', 30, 20);
    await position(s, 'A', [54, 73, 420, 320], null);
    await position(s, 'C', [55, 30, 80, 60], 'B');
    await position(s, 'Inside C', [10, 10, 25, 20], 'C');
    await move(s, 'C', 375, -30);
    await position(s, 'C', [519, 128, 80, 60], null);
    await s.check(state => expect(s.lookup(state, 'B').parentId).toBe(s.lookup(state, 'A').id));
    await s.select('C');
    await expect(s.field('Width')).toHaveValue('80');
  }),

  program('SECTION-MEMBERS', 'Create a Frame inside the inner Section', async s => {
    await draw(s, 'Section', 'A', [35, 55, 390, 310]);
    await draw(s, 'Section', 'B', [65, 100, 250, 195]);
    await draw(s, 'Frame', 'C', [100, 140, 100, 80]);
    await draw(s, 'Rectangle', 'Child', [115, 155, 40, 35]);
    await position(s, 'B', [30, 45, 250, 195], 'A');
    await position(s, 'C', [35, 40, 100, 80], 'B');
    await position(s, 'Child', [15, 15, 40, 35], 'C');
    for (const name of ['A', 'B', 'C', 'Child']) await expect(s.layer(name)).toBeVisible();
    await move(s, 'A', 25, 20, true);
    await absolute(s, 'Child', 140, 175);
    await position(s, 'C', [35, 40, 100, 80], 'B');
    for (const name of ['B', 'C', 'Child']) {
      await s.select(name);
      await selected(s, name);
      await expect(s.field('Width')).toHaveValue({ B: '250', C: '100', Child: '40' }[name]!);
    }
    await fill(s, 'Child', '335577');
  }),

  program('SECTION-MEMBERS', 'Move a Frame with fields and arrow keys', async s => {
    await pan(s, 150, 150);
    await draw(s, 'Section', 'S', [-100, -100, 500, 280]);
    await draw(s, 'Frame', 'F', [430, 0, 50, 40]);
    await s.set('X', '300');
    await position(s, 'F', [300, 0, 50, 40], null);
    await s.press('ArrowLeft');
    await position(s, 'F', [399, 100, 50, 40], 'S');
    await absolute(s, 'F', 299, 0);
    await s.set('X', '600');
    await position(s, 'F', [600, 100, 50, 40], 'S');
    await absolute(s, 'F', 500, 0);
    await s.press('ArrowRight');
    await position(s, 'F', [501, 0, 50, 40], null);
  }),

  program('SECTION-BOUNDS', 'Resize a Section boundary', async s => {
    await pan(s, 170, 170);
    await draw(s, 'Section', 'S', [-100, -100, 500, 280]);
    await draw(s, 'Frame', 'F', [0, 0, 100, 80]);
    await resize(s, 'S', 'start', -30, -30);
    await position(s, 'S', [-130, -130, 530, 310], null);
    await position(s, 'F', [130, 130, 100, 80], 'S');
    await absolute(s, 'F', 0, 0);
    await s.select('F');
    await expect(s.field('X')).toHaveValue('130');
    await expect(s.field('Y')).toHaveValue('130');
  }),

  program('SECTION-BOUNDS', 'Fit populated and empty Sections', async s => {
    await pan(s, 125, 145);
    await draw(s, 'Section', 'S', [-100, -100, 650, 380]);
    await draw(s, 'Frame', 'F1', [0, 0, 100, 80]);
    await draw(s, 'Frame', 'F2', [200, 0, 100, 80]);
    await draw(s, 'Section', 'E', [30, 370, 220, 110]);
    const original = await s.obs();
    await s.select('S');
    await s.button(/Resize to fit/).click();
    await position(s, 'S', [-100, -100, 500, 280], null);
    await absolute(s, 'F1', 0, 0);
    await absolute(s, 'F2', 200, 0);
    await s.select('E');
    await s.button(/Resize to fit/).click();
    await position(s, 'E', [30, 370, 220, 110], null);
    await s.check(state => {
      for (const name of ['S', 'F1', 'F2', 'E']) expect(s.lookup(state, name).id).toBe(s.lookup(original, name).id);
      for (const name of ['F1', 'F2']) expect(s.lookup(state, name).parentId).toBe(s.lookup(state, 'S').id);
    });
  }),

  program('SECTION-BOUNDS', 'Expand a Section for a copied Frame', async s => {
    await pan(s, 60, 65);
    await draw(s, 'Section', 'S', [0, 0, 280, 40]);
    await draw(s, 'Rectangle', 'R', [0, 0, 80, 40]);
    await draw(s, 'Frame', 'F', [200, 0, 80, 40]);
    const before = await s.obs();
    await s.press('ControlOrMeta+d');
    await s.select('S');
    await position(s, 'S', [0, 0, 448, 40], null);
    await s.check(state => {
      const parentId = s.lookup(state, 'S').id;
      const ids = new Set(before.objects.map(object => object.id));
      const newFrames = state.objects.filter(object => !ids.has(object.id) && object.type === 'frame');
      expect(newFrames).toHaveLength(1);
      expect(newFrames[0]).toMatchObject({ parentId, geometry: dimensions([320, 0, 80, 40]) });
      for (const name of ['F', 'R']) {
        const { id, parentId, geometry } = s.lookup(before, name);
        expect(s.lookup(state, name)).toMatchObject({ id, parentId, geometry });
      }
    });
  }),

  program('SECTION-CONVERT', 'Convert a Group to a Section', async s => {
    await draw(s, 'Rectangle', 'A', [60, 65, 40, 25]);
    await draw(s, 'Rectangle', 'B', [160, 145, 60, 35]);
    await group(s, 'G', 'A', 'B');
    const before = await s.obs();
    await menu(s, 'G', 'Convert to section');
    const converted = await s.selected();
    expect(converted.type).toBe('section');
    expect(converted.geometry).toEqual(s.lookup(before, 'G').geometry);
    expect(converted.fill).toBeUndefined();
    expect(converted.stroke).toBeUndefined();
    expect(converted.cornerRadius ?? 0).toBe(0);
    await s.rename('Converted section');
    await position(s, 'A', [0, 0, 40, 25], 'Converted section');
    await absolute(s, 'B', 160, 145);
    await s.select('A');
    await expect(s.field('X')).toHaveValue('0');
    await expect(s.field('Y')).toHaveValue('0');
    await move(s, 'Converted section', 20, 30, true);
    await absolute(s, 'A', 80, 95);
    await absolute(s, 'B', 180, 175);
    await s.press('ControlOrMeta+z');
    await absolute(s, 'A', 60, 65);
    await absolute(s, 'B', 160, 145);
    await s.check(state => {
      for (const name of ['A', 'B']) expect(s.lookup(state, name).id).toBe(s.lookup(before, name).id);
    });
  }),

  program('GROUP-BOUNDS', 'Show member positions and recalculate Group bounds', async s => {
    await draw(s, 'Rectangle', 'A', [20, 20, 40, 20]);
    await draw(s, 'Rectangle', 'B', [100, 20, 40, 20]);
    await group(s, 'G', 'A', 'B');
    await position(s, 'G', [20, 20, 120, 20], null);
    await s.select('A');
    await expect(s.field('X')).toHaveValue('20');
    await expect(s.field('Y')).toHaveValue('20');
    await s.select('G');
    await s.set('X', '60');
    await absolute(s, 'A', 60, 20);
    await absolute(s, 'B', 140, 20);
    await s.select('B');
    await expect(s.field('X')).toHaveValue('140');
    await s.select('A');
    await expect(s.field('X')).toHaveValue('60');
    await s.set('X', '80');
    await position(s, 'G', [80, 20, 100, 20], null);
    await absolute(s, 'B', 140, 20);
    await s.press('ControlOrMeta+z');
    await position(s, 'G', [60, 20, 120, 20], null);
    await absolute(s, 'A', 60, 20);
  }),

  program('GROUP-BOUNDS', 'Recalculate bounds after membership changes', async s => {
    await draw(s, 'Frame', 'F', [0, 0, 400, 160]);
    await draw(s, 'Rectangle', 'A', [120, 20, 40, 20]);
    await draw(s, 'Rectangle', 'B', [300, 20, 40, 20]);
    await group(s, 'G', 'A', 'B');
    await draw(s, 'Rectangle', 'C', [450, 20, 40, 20]);
    const original = await s.obs();
    await position(s, 'G', [120, 20, 220, 20], 'F');
    await dragBetween(s, s.layer('C'), s.layer('G'));
    await position(s, 'G', [120, 20, 370, 20], 'F');
    await position(s, 'C', [330, 0, 40, 20], 'G');
    await dragBetween(s, s.layer('C'), s.layer('F'));
    await position(s, 'G', [120, 20, 220, 20], 'F');
    await position(s, 'C', [450, 20, 40, 20], 'F');
    await absolute(s, 'C', 450, 20);
    await s.select('B');
    await s.press('Backspace');
    await position(s, 'G', [120, 20, 40, 20], 'F');
    await dragBetween(s, s.layer('A'), s.layer('F'));
    await expect(s.layer('G')).toBeHidden();
    await s.check(state => {
      expect(state.objects.some(object => object.id === s.lookup(original, 'G').id)).toBe(false);
      expect(s.lookup(state, 'A').parentId).toBe(s.lookup(state, 'F').id);
    });
    await s.press('ControlOrMeta+z');
    await position(s, 'G', [120, 20, 40, 20], 'F');
    await s.check(state => {
      expect(s.lookup(state, 'G').id).toBe(s.lookup(original, 'G').id);
      expect(s.lookup(state, 'A').id).toBe(s.lookup(original, 'A').id);
      expect(s.lookup(state, 'A').parentId).toBe(s.lookup(state, 'G').id);
      expect(pagePosition(s, state, 'A')).toEqual([120, 20]);
      expect(s.lookup(state, 'C').geometry).toEqual(dimensions([450, 20, 40, 20]));
      expect(state.objects.some(object => object.id === s.lookup(original, 'B').id)).toBe(false);
    });
  }),

  program('GROUP-BOUNDS', 'Show bounds of visible Group members', async s => {
    await draw(s, 'Rectangle', 'A', [120, 20, 40, 20]);
    await draw(s, 'Rectangle', 'B', [225, 90, 40, 20]);
    await group(s, 'G', 'A', 'B');
    await position(s, 'G', [120, 20, 145, 90], null);
    await rowButton(s, 'B', /Hide/);
    await position(s, 'G', [120, 20, 40, 20], null);
    await rowButton(s, 'A', /Hide/);
    await s.select('G');
    await expect(s.layer('G')).toBeVisible();
    for (const axis of ['Width', 'Height']) {
      const field = s.field(axis);
      await expect.poll(() => field.evaluate(element => {
        const input = element as HTMLInputElement;
        return input.value || input.placeholder || input.textContent;
      })).toBe('Mixed');
    }
    const selectedImage = await s.canvas().screenshot();
    await s.point(400, 200);
    expect(await s.canvas().screenshot(), 'no selection outline when every member is hidden').toEqual(selectedImage);
    await rowButton(s, 'B', /Show/);
    await s.select('G');
    await s.set('X', '300');
    await rowButton(s, 'A', /Show/);
    await absolute(s, 'A', 195, 20);
    await absolute(s, 'B', 300, 90);
    await position(s, 'G', [195, 20, 145, 90], null);
  }),

  program('GROUP-FILL', 'Edit the common Fill of Group members', async s => {
    await draw(s, 'Rectangle', 'A', [20, 20, 40, 30]);
    await draw(s, 'Rectangle', 'B', [120, 20, 40, 30]);
    const background = await s.pixel(90, 35);
    await group(s, 'G', 'A', 'B');
    const grouped = await s.obs();
    await s.set('Fill', 'FF0000');
    await layerColor(s, 'A', 'FF0000');
    await layerColor(s, 'B', 'FF0000');
    await visibleColor(s, 40, 35, 'FF0000');
    await visibleColor(s, 140, 35, 'FF0000');
    expect(await s.pixel(90, 35)).toEqual(background);
    await s.check(state => {
      for (const name of ['A', 'B']) {
        const { id, parentId, geometry } = s.lookup(grouped, name);
        expect(s.lookup(state, name)).toMatchObject({ id, parentId, geometry });
      }
    });
  }),

  program('GROUP-FILL', 'Edit one mixed color, then replace all fills', async s => {
    await draw(s, 'Rectangle', 'A', [20, 20, 40, 30]);
    await s.set('Fill', 'FF0000');
    await draw(s, 'Rectangle', 'B', [120, 20, 40, 30]);
    const background = await s.pixel(90, 35);
    await draw(s, 'Rectangle', 'Temporary member', [63, 20, 18, 20]);
    await group(s, 'Inner', 'A', 'Temporary member');
    await s.select('Temporary member');
    await s.press('Backspace');
    await group(s, 'Outer', 'Inner', 'B');
    const original = await s.obs();
    const colors = s.role('region', 'Selection colors');
    const red = await inputWithValue(colors.getByRole('textbox'), 'FF0000');
    await red.fill('0000FF');
    await red.press('Enter');
    await layerColor(s, 'A', '0000FF');
    await layerColor(s, 'B', 'D9D9D9');
    await s.select('Outer');
    await s.button(/^Add Fill$/i).click();
    await s.press('Escape');
    await s.set('Fill', '00FF00');
    await layerColor(s, 'A', '00FF00');
    await layerColor(s, 'B', '00FF00');
    await visibleColor(s, 40, 35, '00FF00');
    await visibleColor(s, 140, 35, '00FF00');
    expect(await s.pixel(90, 35)).toEqual(background);
    await s.check(state => {
      for (const name of ['Outer', 'Inner', 'A', 'B']) {
        const { id, parentId, geometry } = s.lookup(original, name);
        expect(s.lookup(state, name)).toMatchObject({ id, parentId, geometry });
      }
    });
  }),

  program('GROUP-FILL', 'Keep hidden member fills', async s => {
    await draw(s, 'Rectangle', 'A', [20, 20, 40, 30]);
    await draw(s, 'Rectangle', 'B', [120, 20, 40, 30]);
    await group(s, 'G', 'A', 'B');
    const original = await s.obs();
    await rowButton(s, 'B', /Hide/);
    await s.select('G');
    await s.set('Fill', 'FF0000');
    await rowButton(s, 'B', /Show/);
    await layerColor(s, 'A', 'FF0000');
    await layerColor(s, 'B', 'D9D9D9');
    await s.select('G');
    await expect(s.page.getByText('Mixed', { exact: true }).first()).toBeVisible();
    await s.check(state => {
      for (const name of ['A', 'B']) {
        const { id, parentId, geometry } = s.lookup(original, name);
        expect(s.lookup(state, name)).toMatchObject({ id, parentId, geometry, visible: true });
      }
    });
  }),

  program('VIEW-PAGES', 'Show the current page across the editor', async s => {
    await draw(s, 'Rectangle', 'Desktop mark', [45, 55, 40, 35]);
    await s.set('Fill', 'CC0000');
    await createPage(s, 'Mobile');
    await draw(s, 'Rectangle', 'Mobile mark', [125, 80, 55, 40]);
    await s.set('Fill', '0033CC');
    await createPage(s, 'Tablet');
    for (const [page, shown, hidden, fill, x, y] of [
      ['Desktop', 'Desktop mark', 'Mobile mark', 'CC0000', 60, 70],
      ['Mobile', 'Mobile mark', 'Desktop mark', '0033CC', 150, 100],
    ] as const) {
      await s.role('tab', page).click();
      await currentPage(s, page);
      await expect(s.layer(shown)).toBeVisible();
      await expect(s.layer(hidden)).toBeHidden();
      await layerColor(s, shown, fill);
      await visibleColor(s, x, y, fill);
    }
    await s.role('tab', 'Tablet').click();
    await currentPage(s, 'Tablet');
    await expect(s.layer('Desktop mark')).toBeHidden();
    await expect(s.layer('Mobile mark')).toBeHidden();
    await draw(s, 'Rectangle', 'Tablet mark', [70, 65, 50, 40]);
    await selected(s, 'Tablet mark');
    await position(s, 'Tablet mark', [70, 65, 50, 40], null);
    await s.check(state => expect(s.lookup(state, 'Tablet mark').pageId).toBe(state.document.currentPageId));
  }),

  program('VIEW-PAGES', 'Restore each page view and selection', async s => {
    await s.select('Title');
    await zoom(s, 150);
    await pan(s, 34, 27);
    const desktop = await s.obs();
    await s.role('tab', 'Mobile').click();
    await draw(s, 'Rectangle', 'Mobile mark', [80, 90, 40, 30]);
    await zoom(s, 75);
    await pan(s, -31, 28);
    const mobile = await s.obs();
    for (const [page, mark, previous] of [['Desktop', 'Title', desktop], ['Mobile', 'Mobile mark', mobile]] as const) {
      await s.role('tab', page).click();
      await currentPage(s, page);
      await selected(s, mark);
      await s.check(state => {
        expect(state.document.view).toEqual(previous.document.view);
        expect(s.lookup(state, mark)).toMatchObject({ ...s.lookup(previous, mark) });
      });
      if (page === 'Mobile') await expect(s.field('Width')).toHaveValue('40');
      else await expect(s.field('Font size')).toHaveValue('16');
    }
  }),

  program('VIEW-LAYERS', 'Expand and collapse a container', async s => {
    await s.select('Title');
    const before = await s.obs();
    const row = s.layer('Nested');
    for (const name of ['Red', 'Blue', 'Title']) await expect(s.layer(name)).toBeVisible();
    await s.role('button', /Collapse/, row).click();
    await expect(row).toBeVisible();
    for (const name of ['Red', 'Blue', 'Title']) await expect(s.layer(name)).toBeHidden();
    await expect(s.layer('Workspace')).toBeVisible();
    await s.check(state => expect(state.selectionIds).toEqual([s.lookup(before, 'Title').id]));
    await s.role('button', /Expand/, row).click();
    for (const name of ['Red', 'Blue', 'Title']) await expect(s.layer(name)).toBeVisible();
    await selected(s, 'Title');
    await expect(s.field('Font size')).toBeVisible();
    await s.check(state => {
      for (const name of ['Red', 'Blue', 'Title']) {
        const baseline = s.lookup(before, name);
        expect(s.lookup(state, name)).toMatchObject({
          id: baseline.id, parentId: baseline.parentId, geometry: baseline.geometry,
        });
      }
    });
  }),

  program('VIEW-LAYERS', 'Select a range and individual rows', async s => {
    await s.select('Title');
    await selected(s, 'Title');
    await s.layer('Red').click({ modifiers: ['Shift'] });
    await selected(s, 'Title', 'Blue', 'Red');
    await s.layer('Blue').click({ modifiers: ['ControlOrMeta'] });
    await selected(s, 'Title', 'Red');
    await expect(s.layer('Blue')).toHaveAttribute('aria-selected', 'false');
    await expect(s.role('status', 'Selection count')).toContainText('2');
  }),

  program('VIEW-ASSETS', 'Find a component and drag an instance', async s => {
    await draw(s, 'Frame', 'Tile source', [20, 25, 140, 120]);
    await draw(s, 'Rectangle', 'Tile color', [42, 49, 40, 35]);
    await s.set('Fill', '118855');
    await s.select('Tile source');
    await s.button('Create component').click();
    const tile = await s.bindSelected('Tile component');
    await draw(s, 'Rectangle', 'Other source', [195, 25, 140, 120]);
    await s.set('Fill', '6633CC');
    await s.button('Create component').click();
    const other = await s.bindSelected('Other component');
    expect(tile.name).toBeTruthy();
    expect(other.name).toBeTruthy();
    expect(tile.name).not.toBe(other.name);
    const before = await s.obs();
    await s.button('Assets').click();
    await s.role('textbox', /Search/).fill(tile.name!);
    const card = s.asset(tile);
    await expect(card).toBeVisible();
    await expect(s.asset(other)).toBeHidden();
    await expect(card.getByText(tile.name!, { exact: true })).toBeVisible();
    const preview = await card.boundingBox();
    if (!preview) throw new Error('Asset preview has no visible bounds');
    const pixels = await imagePixels(s, card, [0, 0, Math.floor(preview.width), Math.floor(preview.height / 2)]);
    expect(pixels.some(([r, g, b]) => g - r > 48 && g - b > 18), 'the card previews the green tile content').toBe(true);
    await card.dragTo(s.canvas(), { targetPosition: { x: 425, y: 270 } });
    await s.check(state => {
      const source = s.lookup(state, 'Tile component');
      const instances = state.objects.filter(object => object.type === 'instance' && object.component?.sourceId === source.id);
      expect(instances).toHaveLength(1);
      expect(instances[0]).toMatchObject({ pageId: before.document.currentPageId, selected: true });
      expect(instances[0].geometry).toMatchObject({ width: 140, height: 120 });
    });
    const instance = await s.selected();
    expect(instance.name).toBeTruthy();
    await s.button('File').click();
    await expect(s.layer(instance)).toBeVisible();
    await expect(s.button('Instance actions')).toBeVisible();
    await s.button('Assets').click();
    await s.role('textbox', /Search/).fill(tile.name!);
    await expect(card).toBeVisible();
    await s.check(state => {
      expect(state.document.currentPageId).toBe(before.document.currentPageId);
      expect(state.objects.some(object => object.id === instance.id)).toBe(true);
    });
  }),

  program('VIEW-DESIGN', 'Show properties for each selection context', async s => {
    await draw(s, 'Frame', 'Parent', [30, 35, 200, 160]);
    await draw(s, 'Rectangle', 'Red child', [50, 55, 40, 30]);
    await s.set('Fill', 'BB0011');
    await draw(s, 'Rectangle', 'Blue child', [135, 110, 50, 35]);
    await s.set('Fill', '0022BB');
    await draw(s, 'Rectangle', 'Separate', [265, 40, 60, 45]);
    await s.set('Fill', '006633');
    await createStyle(s, 'Fill style picker', 'Color/Tree green');
    await draw(s, 'Text', 'Paragraph', [350, 115, 135, 45], 'Live text');
    await createStyle(s, 'Text style picker', 'Type/Tree body');
    await s.point(540, 250);
    await s.check(state => expect(state.selectionIds).toHaveLength(0));
    await expect(s.role('textbox', /^Page background(?: color)?$/i)).toBeVisible();
    await expect(s.role('textbox', /^Page background (?:opacity|alpha)$/i)).toBeVisible();
    await expect(s.button(/background.*(?:visibility|hide)|hide.*background/i)).toBeVisible();
    await expect(s.page.getByText(/Local styles/i).first()).toBeVisible();
    await expect(s.page.getByText(/Tree green/, { exact: false }).first()).toBeVisible();
    await expect(s.page.getByText(/Tree body/, { exact: false }).first()).toBeVisible();

    await s.select('Parent');
    await selected(s, 'Parent');
    await expect(s.field('Fill')).toHaveValue('FFFFFF');
    await expect(s.field('Width')).toHaveValue('200');
    const colors = s.role('region', 'Selection colors');
    await expect(colors).toBeVisible();
    await inputWithValue(colors.getByRole('textbox'), 'BB0011');
    await inputWithValue(colors.getByRole('textbox'), '0022BB');

    await s.select('Separate');
    await selected(s, 'Separate');
    await expect(s.button('Fill style')).toContainText('Tree green');
    await visibleColor(s, 290, 65, '006633');
    await expect(s.field('Font size')).toBeHidden();

    await s.select('Paragraph');
    await selected(s, 'Paragraph');
    const font = s.field('Font size');
    await expect(font).toBeVisible();
    await s.press('Enter');
    const editor = s.field('Text editor');
    await expect(editor).toBeFocused();
    await editor.press('ControlOrMeta+Home');
    for (let index = 0; index < 4; index++) await editor.press('Shift+ArrowRight');
    await expect(font).toBeVisible();
    await s.set('Font size', '22');
    await s.press('Escape');
    await expect(editor).toBeHidden();
    await selected(s, 'Paragraph');
    await expect(s.button('Text resizing')).toBeVisible();
    await s.check(state => {
      const text = s.lookup(state, 'Paragraph');
      expect(text.text).toBe('Live text');
      expect(text.textRuns).toEqual(expect.arrayContaining([
        expect.objectContaining({ start: 0, end: 4, font: expect.objectContaining({ size: 22 }) }),
      ]));
    });
  }),

  program('VIEW-DESIGN', 'Show mixed values and mode-dependent fields', async s => {
    await draw(s, 'Rectangle', 'A', [25, 35, 60, 40]);
    await s.set('Fill', 'FF0000');
    await draw(s, 'Rectangle', 'B', [300, 35, 90, 40]);
    await s.set('Fill', '0000FF');
    const original = await s.obs();
    await choose(s, 'A', 'B');
    await expect.poll(() => s.field('Width').evaluate(element => {
      const input = element as HTMLInputElement;
      return input.value || input.placeholder || input.textContent;
    })).toBe('Mixed');
    const colors = s.role('region', 'Selection colors');
    await inputWithValue(colors.getByRole('textbox'), 'FF0000');
    await inputWithValue(colors.getByRole('textbox'), '0000FF');
    await s.set('Width', '200');
    await s.check(state => {
      for (const name of ['A', 'B']) {
        const prior = s.lookup(original, name);
        expect(s.lookup(state, name)).toMatchObject({ id: prior.id, fill: prior.fill, geometry: { width: 200 } });
      }
    });

    await draw(s, 'Frame', 'Flow host', [30, 140, 180, 140]);
    await draw(s, 'Rectangle', 'Flow child', [60, 165, 50, 35]);
    await s.select('Flow host');
    await s.press('Shift+a');
    await s.select('Flow child');
    await expect(s.field('X')).toBeDisabled();
    await expect(s.field('Y')).toBeDisabled();
    await expect(s.role('checkbox', 'Ignore auto layout')).toBeVisible();

    await draw(s, 'Text', 'Paragraph', [280, 150, 160, 55], 'Editable content');
    await textSizing(s, 'Auto height');
    await expect.poll(() => s.field('Height').evaluate(element => {
      const input = element as HTMLInputElement;
      return input.readOnly || input.disabled || input.getAttribute('aria-readonly') === 'true';
    })).toBe(true);
    await textSizing(s, 'Fixed size');
    await s.set('Height', '120');
    await expect(s.field('Height')).toHaveValue('120');
    await s.check(state => {
      expect(s.lookup(state, 'Paragraph').geometry.height).toBe(120);
      expect(s.lookup(state, 'Paragraph').text).toBe('Editable content');
    });
  }),

  program('VIEW-DESIGN', 'Open Fill for the new selection', async s => {
    await draw(s, 'Rectangle', 'A', [25, 45, 60, 40]);
    await s.set('Fill', 'FF0000');
    await draw(s, 'Rectangle', 'B', [120, 45, 80, 60]);
    await s.set('Fill', '0000FF');
    await s.select('A');
    await s.button('Fill preview').click();
    const close = s.button('Close fill editor');
    await expect(close).toBeVisible();
    await s.select('B');
    await expect(close).toBeHidden();
    await selected(s, 'B');
    await expect(s.field('Fill')).toHaveValue('0000FF');
    await s.button('Fill preview').click();
    await expect(close).toBeVisible();
    const color = s.role('textbox', /^(?:Hex|Color value|Hex color)$/i);
    await color.fill('00AA66');
    await color.press('Enter');
    await close.click();
    await selected(s, 'B');
    await expect(s.field('Fill')).toHaveValue('00AA66');
    await s.check(state => {
      expect(s.lookup(state, 'A').fill?.color).toBe('FF0000');
      expect(s.lookup(state, 'B').fill?.color).toBe('00AA66');
    });
    await visibleColor(s, 45, 60, 'FF0000');
    await visibleColor(s, 145, 70, '00AA66');
  }),

  program('LAYERS-ORDER', 'Move a child to its outer Frame', async s => {
    const before = await s.obs();
    const red = s.lookup(before, 'Red');
    expect(red.parentId).toBe(s.lookup(before, 'Nested').id);
    const labelX = async (name: string) => {
      const box = await s.layerLabel(name).boundingBox();
      if (!box) throw new Error('Layer name has no visible bounds: ' + name);
      return box.x;
    };
    expect(await labelX('Red')).toBeGreaterThan(await labelX('Nested'));
    await dragBetween(s, s.layer('Red'), s.layer('Workspace'), true);
    await position(s, 'Red', [60, 60, 80, 60], 'Workspace');
    await absolute(s, 'Red', 60, 60);
    await s.check(state => {
      expect(s.lookup(state, 'Red').id).toBe(red.id);
      expect(s.lookup(state, 'Nested').parentId).toBe(s.lookup(state, 'Workspace').id);
    });
    await expect.poll(async () => Math.abs(await labelX('Red') - await labelX('Nested'))).toBeLessThan(2);
    await s.select('Red');
    await expect(s.field('X')).toHaveValue('60');
    await expect(s.field('Y')).toHaveValue('60');
  }),

  program('EDITOR-LAYER-MENU', 'Keep or replace the selection before a menu command', async s => {
    await choose(s, 'Title', 'Blue');
    await s.layer('Title').click({ button: 'right' });
    await expect(s.role('menuitem', /Lock/)).toBeVisible();
    await selected(s, 'Title', 'Blue');
    await s.press('Escape');
    await expect(s.role('menuitem', /Lock/)).toBeHidden();
    await s.layer('Red').click({ button: 'right' });
    await selected(s, 'Red');
    await s.role('menuitem', /Lock/).click();
    await s.check(state => {
      expect(s.lookup(state, 'Red').locked).toBe(true);
      expect(s.lookup(state, 'Blue').locked).toBe(false);
      expect(s.lookup(state, 'Title').locked).toBe(false);
    });
    await menu(s, 'Red', /Unlock|Lock\/Unlock/);
    await s.check(state => expect(s.lookup(state, 'Red').locked).toBe(false));
    await selected(s, 'Red');
  }),

  program('EDITOR-LAYER-MENU', 'Rename one layer from its context menu', async s => {
    const before = await s.object('Title');
    await menu(s, 'Title', 'Rename');
    const field = s.field('Layer name');
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Title');
    expect(await field.evaluate(element => {
      const input = element as HTMLInputElement;
      return input.value.substring(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    })).toBe('Title');
    await field.fill('Heading');
    await field.press('Enter');
    await expect(field).toBeHidden();
    await expect(s.layer('Title')).toBeHidden();
    await selected(s, 'Heading');
    await s.check(state => expect(s.lookup(state, 'Heading')).toMatchObject({ id: before.id, text: 'Draft title' }));
  }),

  program('EDITOR-LAYER-MENU', 'Apply state commands to the selected layers', async s => {
    await draw(s, 'Rectangle', 'A', [30, 40, 50, 35]);
    await draw(s, 'Rectangle', 'B', [110, 45, 55, 35]);
    await draw(s, 'Rectangle', 'C', [210, 40, 60, 35]);
    const original = await s.obs();
    await choose(s, 'A', 'B');
    const assertState = async (a: [boolean, boolean], b: [boolean, boolean]) => {
      await selected(s, 'A', 'B');
      await s.check(state => {
        for (const [name, pair] of [['A', a], ['B', b], ['C', [true, false]]] as const) {
          const [visible, locked] = pair;
          const { id, parentId, geometry } = s.lookup(original, name);
          expect(s.lookup(state, name)).toMatchObject({ visible, locked, id, parentId, geometry });
        }
      });
    };
    await rowButton(s, 'B', /Hide/);
    await rowButton(s, 'B', /^Lock/);
    await assertState([true, false], [false, true]);
    await menu(s, 'A', /Show|Hide/);
    await menu(s, 'A', /Lock/);
    await assertState([true, true], [true, true]);
    await menu(s, 'A', /Show|Hide/);
    await menu(s, 'A', /Unlock|Lock\/Unlock/);
    await assertState([false, false], [false, false]);
  }),

  program('LAYERS-LOCK', 'Lock a child and unlock its container', async s => {
    const before = await s.obs();
    await rowButton(s, 'Red', /^Lock/);
    await rowButton(s, 'Nested', /^Lock/);
    await rowButton(s, 'Nested', /^Unlock/);
    await s.check(state => {
      expect(s.lookup(state, 'Red').locked).toBe(true);
      expect(s.lookup(state, 'Nested').locked).toBe(false);
    });
    await expect(s.role('button', /^Unlock/, s.layer('Red'))).toBeVisible();
    await s.point(75, 75, { modifiers: ['ControlOrMeta'] });
    await s.check(state => expect(state.selectionIds).not.toContain(s.lookup(state, 'Red').id));
    await fill(s, 'Red', '11AA22');
    await selected(s, 'Red');
    await rowButton(s, 'Red', /^Unlock/);
    await s.point(75, 75, { modifiers: ['ControlOrMeta'] });
    await selected(s, 'Red');
    await s.drag(75, 75, 88, 87, { modifiers: ['ControlOrMeta'] });
    await absolute(s, 'Red', 73, 72);
    await s.check(state => {
      expect(s.lookup(state, 'Red')).toMatchObject({ id: s.lookup(before, 'Red').id, locked: false });
      expect(s.lookup(state, 'Blue').geometry).toEqual(s.lookup(before, 'Blue').geometry);
    });
  }),

  program('EDITOR-SECTION-COLLAPSE', 'Collapse and restore a sidebar section', async s => {
    await s.select('Title');
    await selected(s, 'Title');
    const before = await s.obs();
    const title = s.page.getByText('Layers', { exact: true });
    await title.click();
    await expect(title).toBeVisible();
    await expect(s.layer('Title')).toBeHidden();
    await expect(s.role('tab', 'Desktop')).toBeVisible();
    await title.click();
    await expect(s.layer('Workspace')).toBeVisible();
    await expect(s.layer('Nested')).toBeVisible();
    await expect(s.layer('Title')).toBeVisible();
    const pages = s.page.getByText('Pages', { exact: true });
    await pages.click();
    await expect(s.role('tab', 'Desktop')).toBeHidden();
    await expect(s.layer('Title')).toBeVisible();
    const collapsedHeader = s.role('button', /^(?:Expand pages|Desktop)$/i);
    if (await collapsedHeader.isVisible()) await collapsedHeader.click();
    else if (await pages.isVisible()) await pages.click();
    else await s.page.getByText('Desktop', { exact: true }).click();
    await currentPage(s, 'Desktop');
    await selected(s, 'Title');
    await s.check(state => expect(state.document.view).toEqual(before.document.view));
  }),

  program('EDITOR-LAYOUT', 'Continue canvas edits after panel and window resizing', async s => {
    await s.select('Select A');
    await s.press('Shift+2');
    const initial = await s.obs();
    const toolbar = s.page.getByRole('toolbar');
    const canvas = s.canvas();
    async function width() {
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Canvas viewport is unavailable');
      return box.width;
    }
    for (const [edge, delta] of [['Left panel resize', 45], ['Right panel resize', -45]] as const) {
      const before = await width();
      const separator = s.role('separator', edge);
      const box = await separator.boundingBox();
      if (!box) throw new Error(`Missing visible resize edge: ${edge}`);
      await s.drag(box.width / 2, box.height / 2, box.width / 2 + delta, box.height / 2, { target: separator });
      await expect.poll(width).toBeLessThan(before - 20);
      await s.drag(box.width / 2, box.height / 2, box.width / 2 - delta, box.height / 2, { target: separator });
      await expect.poll(width).toBeGreaterThan(before - 8);
      await selected(s, 'Select A');
    }
    const beforeWindow = await width();
    await s.page.setViewportSize({ width: 1280, height: 810 });
    await expect.poll(width).toBeLessThan(beforeWindow);
    const tools = await toolbar.boundingBox();
    if (!tools) throw new Error('Canvas tools toolbar is not visible');
    expect(tools.x + tools.width / 2).toBeCloseTo(640, -1);
    expect(810 - (tools.y + tools.height)).toBeLessThan(48);
    await selected(s, 'Select A');
    await s.check(state => {
      for (const name of ['Select A', 'Select B']) expect(s.lookup(state, name)).toMatchObject({ ...s.lookup(initial, name) });
    });

    const state = await s.obs();
    const layer = s.lookup(state, 'Select A').geometry;
    const [x, y] = inCanvas(state, layer.x + layer.width / 2, layer.y + layer.height / 2);
    const scale = state.document.view?.zoom ?? 1;
    await s.point(x, y);
    await selected(s, 'Select A');
    await s.drag(x, y, x + 16 * scale, y + 12 * scale);
    await position(s, 'Select A', [36, 32, 60, 40], null);
    await position(s, 'Select B', [140, 20, 60, 40], null);
    await expect(s.field('X')).toHaveValue('36');
    await expect(s.field('Y')).toHaveValue('32');
    await s.press('Shift+2');
    await s.check(async fitted => {
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error('Canvas viewport is unavailable');
      const [left, top] = inCanvas(fitted, 36, 32);
      const [right, bottom] = inCanvas(fitted, 96, 72);
      expect(left).toBeGreaterThanOrEqual(-1);
      expect(top).toBeGreaterThanOrEqual(-1);
      expect(right).toBeLessThanOrEqual(bounds.width + 1);
      expect(bottom).toBeLessThanOrEqual(bounds.height + 1);
    });
  }),

  program('TEXT-ALIGN', 'Align text and resize its fixed box', async s => {
    await s.select('Paragraph');
    await s.press('Enter');
    await s.field('Text editor').fill('One two three\nAlignment test');
    await s.press('Escape');
    await s.set('Line height', '20');
    await textSizing(s, 'Fixed size');
    await s.set('Width', '200');
    await s.set('Height', '100');
    const baseline = await s.object('Paragraph');
    await s.button(/^(?:Align )?Center$/i).click();
    await s.button(/^(?:Align )?Middle$/i).click();
    const centered = await textInk(s, 'Paragraph');
    expect(centered.lines).toHaveLength(2);
    for (const line of centered.lines) expect(Math.abs((line.left + line.right) / 2 - 100)).toBeLessThan(9);
    expect(Math.abs((centered.lines[0].top + centered.lines[1].bottom) / 2 - 50)).toBeLessThan(10);
    await s.button(/^(?:Align )?Right$/i).click();
    await s.button(/^(?:Align )?Bottom$/i).click();
    const rightBottom = await textInk(s, 'Paragraph');
    expect(rightBottom.lines).toHaveLength(2);
    for (const line of rightBottom.lines) expect(line.right).toBeGreaterThan(187);
    expect(rightBottom.lines[1].bottom).toBeGreaterThan(87);
    await s.set('Width', '300');
    await s.set('Height', '120');
    await position(s, 'Paragraph', [baseline.geometry.x, baseline.geometry.y, 300, 120], null);
    const resized = await textInk(s, 'Paragraph');
    expect(resized.lines).toHaveLength(2);
    for (const line of resized.lines) expect(line.right).toBeGreaterThan(287);
    expect(resized.lines[1].bottom).toBeGreaterThan(107);
    await expect(s.button(/^(?:Align )?Right$/i)).toHaveAttribute('aria-pressed', 'true');
    await expect(s.button(/^(?:Align )?Bottom$/i)).toHaveAttribute('aria-pressed', 'true');
    await expect(s.field('Line height')).toHaveValue(/20(?:\s*px)?/);
    await s.check(state => {
      const paragraph = s.lookup(state, 'Paragraph');
      expect(paragraph.id).toBe(baseline.id);
      expect(paragraph.text).toBe('One two three\nAlignment test');
      expect(paragraph.font).toEqual(baseline.font);
      expect(paragraph.textSizing).toBe('fixed');
    });
  }),

  program('CANVAS-FILL-STACK', 'Reorder, hide, and remove fills', async s => {
    await draw(s, 'Rectangle', 'Paint target', [40, 50, 110, 80]);
    await s.set('Fill', '0000FF');
    await s.set('Fill opacity', '100');
    const layer = await s.object('Paint target');
    const colors = s.page.getByRole('textbox', { name: 'Fill', exact: true });
    const opacities = s.page.getByRole('textbox', { name: 'Fill opacity', exact: true });
    await s.button(/^Add Fill$/i).click();
    await s.press('Escape');
    await expect(colors).toHaveCount(2);
    await colors.nth(0).fill('FF0000');
    await colors.nth(0).press('Enter');
    await opacities.nth(0).fill('100');
    await opacities.nth(0).press('Enter');
    const assertRows = async (values: string[]) => {
      await expect(colors).toHaveCount(values.length);
      for (const [index, value] of values.entries()) {
        await expect(colors.nth(index)).toHaveValue(value);
        await expect(opacities.nth(index)).toHaveValue('100');
      }
    };
    await assertRows(['FF0000', '0000FF']);
    await visibleColor(s, 80, 80, 'FF0000');
    const toggles = s.page.getByRole('button', { name: /Toggle paint visibility|^(?:Hide|Show) fill$/i });
    await toggles.nth(0).click();
    await visibleColor(s, 80, 80, '0000FF');
    await assertRows(['FF0000', '0000FF']);
    await toggles.nth(0).click();
    await visibleColor(s, 80, 80, 'FF0000');
    const handles = s.page.getByRole('button', { name: /(?:Reorder|Drag) fill/i }).or(s.page.getByTitle('Reorder'));
    await expect(handles).toHaveCount(2);
    const lower = await handles.nth(1).boundingBox();
    if (!lower) throw new Error('Lower paint reorder handle has no bounds');
    await handles.nth(0).dragTo(handles.nth(1), { targetPosition: { x: lower.width / 2, y: lower.height - 2 } });
    await assertRows(['0000FF', 'FF0000']);
    await visibleColor(s, 80, 80, '0000FF');
    await s.page.getByRole('button', { name: /^Remove fill$/i }).nth(0).click();
    await assertRows(['FF0000']);
    await visibleColor(s, 80, 80, 'FF0000');
    await s.check(state => expect(s.lookup(state, 'Paint target')).toMatchObject({ id: layer.id, geometry: layer.geometry }));
  }),

  program('CANVAS-FILL-SOLID', 'Apply the same paint to different object regions', async s => {
    await draw(s, 'Frame', 'Frame sample', [335, 35, 100, 65]);
    await draw(s, 'Text', 'Text sample', [475, 45, 100, 55], 'Paint text');
    await s.point(620, 195);
    const canvasBackground = (await s.pixel(620, 195)).slice(0, 3);
    const baseline = await s.obs();
    for (const name of ['Frame sample', 'Paint', 'Text sample']) {
      await fill(s, name, 'FF0000');
      await s.set('Fill opacity', '60');
      await s.check(state => {
        const old = s.lookup(baseline, name);
        const current = s.lookup(state, name);
        expect(current).toMatchObject({ id: old.id, geometry: old.geometry, fill: { color: 'FF0000', opacity: 0.6 } });
        if (old.text !== undefined) expect(current.text).toBe(old.text);
      });
    }
    await s.point(620, 195);
    const color = [255, 0, 0].map((channel, index) => Math.round(0.6 * channel + 0.4 * canvasBackground[index]));
    for (const [x, y] of [[370, 60], [45, 40]]) {
      const actual = await s.pixel(x, y);
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(actual[channel] - color[channel])).toBeLessThanOrEqual(2);
    }
    const pixels = await canvasPixels(s, [475, 45, 100, 55]);
    expect(pixels.filter(([r, g, b]) => r - g > 100 && r - b > 100).length).toBeGreaterThan(15);
    expect(pixels.filter(([r, g, b]) => r === canvasBackground[0] && g === canvasBackground[1] && b === canvasBackground[2]).length).toBeGreaterThan(100);
  }),

  program('CANVAS-MEASURE', 'Measure a gap across zoom levels', async s => {
    await s.select('Select A');
    const initial = await s.obs();
    for (const scale of [1, 2]) {
      if (scale === 2) {
        await zoom(s, 200);
        const [left, top] = inCanvas(await s.obs(), 20, 20);
        await pan(s, 85 - left, 85 - top);
      }
      const state = await s.obs();
      const [left, center] = inCanvas(state, 80, 40);
      const [right] = inCanvas(state, 140, 40);
      const [x, y] = inCanvas(state, 165, 40);
      const box = await s.canvas().boundingBox();
      if (!box) throw new Error('Design canvas is unavailable');
      const y0 = Math.max(0, Math.floor(center - 31));
      const width = Math.floor(right - left) - 6;
      const area: Rect = [Math.floor(left + 3), y0, width, Math.floor(center + 32) - y0];
      const columns = async () => redColumns(await canvasPixels(s, area), width);
      expect((right - left) / scale).toBeCloseTo(60);
      const before = await columns();
      await s.page.keyboard.down('Alt');
      try {
        await s.page.mouse.move(box.x + x, box.y + y);
        await expect.poll(columns).toBeGreaterThan(before + width * 0.75);
        const label = s.canvas().getByRole('status', { name: /distance|measurement/i });
        if (await label.count()) await expect(label).toContainText(/\b60\b/);
        await expect.poll(async () => measurementBadge(await canvasPixels(s, area), width))
          .toBe(true);
        await selected(s, 'Select A');
        await s.capture(`measurement-${scale}x`);
      } finally {
        await s.page.keyboard.up('Alt');
      }
      await expect.poll(columns).toBe(before);
    }
    await s.check(state => {
      for (const name of ['Select A', 'Select B']) expect(s.lookup(state, name).geometry).toEqual(s.lookup(initial, name).geometry);
    });
  }),

  program('CANVAS-RULERS', 'Place, move, and remove ruler guides', async s => {
    await guideWorkspace(s, 600, 400);
    const workspace = await s.object('Workspace');
    await placeGuide(s, 'vertical', 200, 110);
    await placeGuide(s, 'horizontal', 300, 130);
    await selectGuide(s, 200, 100, 'Workspace', 'X', '100');
    await closeGuides(s);
    await dragGuide(s, 200, 105, 220, 105);
    await selectGuide(s, 220, 105, 'Workspace', 'X', '120');
    await expect(s.field('Y')).toHaveValue('80');
    await reopenSaved(s);
    await selectGuide(s, 220, 100, 'Workspace', 'X', '120');
    await expect(s.field('Y')).toHaveValue('80');
    await closeGuides(s);
    await selectGuide(s, 280, 130, 'Workspace', 'Y', '80');
    await s.press('Delete');
    await expect(guideTitle(s, 'Workspace')).toBeHidden();
    await selectGuide(s, 220, 100, 'Workspace', 'X', '120');
    await expect(s.field('Y')).toHaveCount(0);
    await s.check(state => expect(s.lookup(state, 'Workspace')).toMatchObject({ id: workspace.id, geometry: workspace.geometry }));
  }),

  program('CANVAS-RULERS', 'Place and transfer a guide between owners', async s => {
    await guideWorkspace(s, 300, 200);
    await s.point(615, 325);
    await s.check(state => expect(state.selectionIds).toHaveLength(0));
    await placeGuide(s, 'vertical', 160, 100);
    await selectGuide(s, 160, 105, 'Workspace', 'X', '60');
    await closeGuides(s);
    await s.select('Workspace');
    await dragGuide(s, 160, 105, 200, 300);
    await selectGuide(s, 200, 305, 'Page', 'X', '200');
    await closeGuides(s);
    await s.select('Workspace');
    await s.set('X', '150');
    await selectGuide(s, 200, 305, 'Page', 'X', '200');
    await closeGuides(s);
    await dragGuide(s, 200, 305, 220, 100);
    await selectGuide(s, 220, 105, 'Workspace', 'X', '70');
    await position(s, 'Workspace', [150, 50, 300, 200], null);
  }),

  program('EDITOR-GUIDES-POSITIONS', 'Add a guide and commit or cancel its position', async s => {
    await guideWorkspace(s, 300, 200);
    await placeGuide(s, 'vertical', 160, 110);
    await selectGuide(s, 160, 105, 'Workspace', 'X', '60');
    await s.set('X', '90');
    await expect(s.field('X')).toHaveValue('90');
    await s.set('X', '110', 'Escape');
    await expect(s.field('X')).toHaveValue('90');
    await expect(s.field('X')).toBeFocused();
    const add = s.page.getByRole('button', { name: /^Add(?: horizontal)? guide$/i });
    const horizontal = add.filter({ hasText: 'Horizontal' });
    if (await horizontal.count()) await horizontal.click();
    else if (await add.count() === 1) await add.click();
    else await add.nth(1).click();
    await expect(s.field('Y')).toHaveValue('0');
    await s.set('Y', '80', 'Tab');
    await expect(s.field('Y')).toHaveValue('80');
    await expect(s.page.getByRole('button', { name: /^Remove guide$/i }).last()).toBeFocused();
    await closeGuides(s);
    await selectGuide(s, 190, 105, 'Workspace', 'X', '90');
    await closeGuides(s);
    await selectGuide(s, 270, 130, 'Workspace', 'Y', '80');
    await position(s, 'Workspace', [100, 50, 300, 200], null);
  }),

  program('EDITOR-GUIDES-POSITIONS', 'Keep the owner when editing outside its bounds', async s => {
    await guideWorkspace(s, 300, 200);
    const prior = await s.obs();
    await placeGuide(s, 'vertical', 160, 110);
    await selectGuide(s, 160, 105, 'Workspace', 'X', '60');
    const field = s.field('X');
    await field.fill('-20');
    await s.page.getByText('Vertical', { exact: true }).click();
    await expect(field).toHaveValue('-20');
    await field.press('ArrowUp');
    await expect(field).toHaveValue('-19');
    await field.press('Shift+ArrowUp');
    await expect(field).toHaveValue('-9');
    await field.press('Enter');
    await closeGuides(s);
    await selectGuide(s, 91, 105, 'Workspace', 'X', '-9');
    await s.check(state => {
      for (const name of ['Workspace', 'Nested', 'Red', 'Blue', 'Title']) {
        expect(s.lookup(state, name).geometry).toEqual(s.lookup(prior, name).geometry);
      }
    });
  }),

  program('EDITOR-GUIDES-REMOVE', 'Remove one guide or all guides of its owner', async s => {
    await guideWorkspace(s, 300, 200);
    await placeGuide(s, 'vertical', 180, 310);
    await placeGuide(s, 'vertical', 140, 105);
    // The page guide at 180 and the Frame guide at 180 overlap. Select the
    // other Frame guide first so the panel exposes both Frame rows.
    await placeGuide(s, 'vertical', 180, 100);
    await placeGuide(s, 'horizontal', 245, 100);
    await selectGuide(s, 140, 120, 'Workspace', 'X', '40', 0);
    const remove = s.page.getByRole('button', { name: /^Remove guide$/i }).first();
    await s.field('X').first().hover();
    await remove.click();
    await expect(guideTitle(s, 'Workspace')).toBeHidden();
    // Move the owner so the remaining Frame and Page lines are independently
    // selectable while retaining their respective local and page coordinates.
    await s.select('Workspace');
    await s.set('X', '130');
    await selectGuide(s, 210, 130, 'Workspace', 'X', '80');
    await expect(s.page.getByText('Guide 1', { exact: true }).first()).toBeVisible();
    await expect(s.field('Y')).toHaveValue('50');
    await s.button('More').click();
    await s.role('menuitem', /Remove all guides/i).click();
    await expect(guideTitle(s, 'Workspace')).toBeHidden();
    await selectGuide(s, 180, 310, 'Page', 'X', '180');
    await expect(s.field('Y')).toHaveCount(0);
    await closeGuides(s);
    await s.point(245, 100);
    await expect(guideTitle(s, 'Workspace')).toBeHidden();
  }),
];

async function inputWithValue(inputs: Locator, value: string): Promise<Locator> {
  let matching: Locator | undefined;
  await expect(async () => {
    const matches: Locator[] = [];
    for (const input of await inputs.all()) {
      if (await input.isVisible() && (await input.inputValue()).replace(/^#/, '').toUpperCase() === value) matches.push(input);
    }
    expect(matches, `visible color field ${value}`).toHaveLength(1);
    [matching] = matches;
  }).toPass({ timeout: 8_000 });
  return matching!;
}

async function textSizing(s: Scenario, value: string) {
  await s.button('Text resizing').click();
  await s.role('option', value).click();
}

async function createStyle(s: Scenario, picker: string, name: string) {
  await s.button(picker).click();
  await s.button('Create style').click();
  await s.set('Style name', name);
  await s.button('Create style confirm').click();
}

function canvasPixels(s: Scenario, rect: Rect): Promise<number[][]> {
  return imagePixels(s, s.canvas(), rect);
}

async function imagePixels(s: Scenario, locator: Locator, [x, y, width, height]: Rect): Promise<number[][]> {
  const bytes = await locator.screenshot({ scale: 'css' });
  return s.page.evaluate(async ({ png, x, y, width, height }) => {
    const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
      const context = new OffscreenCanvas(width, height).getContext('2d');
      if (!context) throw new Error('Screenshot decoder is unavailable');
      context.drawImage(image, -x, -y);
      const { data } = context.getImageData(0, 0, width, height);
      return Array.from({ length: width * height }, (_, i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]);
    } finally {
      image.close();
    }
  }, { png: bytes.toString('base64'), x, y, width, height });
}

function measurementRed(pixel?: number[]) {
  if (!pixel) return false;
  const [r, g, b, a] = pixel;
  return a > 0 && r > 130 && r - g > 55 && r - b > 45;
}

function redColumns(pixels: number[][], width: number) {
  const red = new Set<number>();
  for (const [index, pixel] of pixels.entries()) {
    if (measurementRed(pixel)) red.add(index % width);
  }
  return red.size;
}

function measurementBadge(pixels: number[][], width: number) {
  // A line alone cannot contain light glyph ink enclosed vertically by a red label.
  let ink = 0;
  for (let i = width * 4; i < pixels.length - width * 4; i++) {
    const [r, g, b, a] = pixels[i];
    if (a > 230 && Math.min(r, g, b) > 205 &&
        [1, 2, 3, 4].some(d => measurementRed(pixels[i - d * width])) &&
        [1, 2, 3, 4].some(d => measurementRed(pixels[i + d * width]))) ink++;
  }
  return ink >= 5;
}

async function textInk(s: Scenario, name: string) {
  const state = await s.obs();
  const layer = s.lookup(state, name);
  const [x, y] = inCanvas(state, ...pagePosition(s, state, name));
  const { width, height } = layer.geometry;
  const pixels = await canvasPixels(s, [Math.floor(x), Math.floor(y), width, height]);
  const lines: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  let band: (typeof lines)[number] | undefined;
  for (let row = 1; row < height - 1; row++) {
    let left = width;
    let right = -1;
    for (let column = 1; column < width - 1; column++) {
      const [r, g, b, a] = pixels[row * width + column];
      if (a > 0 && Math.max(r, g, b) < 110) {
        left = Math.min(left, column);
        right = column;
      }
    }
    if (right < 0) {
      band = undefined;
      continue;
    }
    if (!band) {
      band = { left, top: row, right, bottom: row };
      lines.push(band);
    } else {
      band.left = Math.min(band.left, left);
      band.right = Math.max(band.right, right);
      band.bottom = row;
    }
  }
  return { lines };
}

async function guideWorkspace(s: Scenario, width: number, height: number) {
  await s.select('Workspace');
  await s.set('X', 100);
  await s.set('Y', 50);
  if ((await s.object('Workspace')).geometry.width !== width) await s.set('Width', width);
  if ((await s.object('Workspace')).geometry.height !== height) await s.set('Height', height);
  await position(s, 'Workspace', [100, 50, width, height], null);
  await s.press('Shift+r');
}

async function placeGuide(s: Scenario, axis: 'vertical' | 'horizontal', pageX: number, pageY: number) {
  const [x, y] = inCanvas(await s.obs(), pageX, pageY);
  await s.drag(axis === 'vertical' ? 8 : x, axis === 'horizontal' ? 8 : y, x, y);
}

function guideTitle(s: Scenario, owner: string) {
  return s.page.getByText(new RegExp(`^${owner} Ruler Guides$`, 'i'));
}

async function selectGuide(s: Scenario, x: number, y: number, owner: string, axis: 'X' | 'Y', value: string, row?: number) {
  await s.point(...inCanvas(await s.obs(), x, y));
  await expect(guideTitle(s, owner)).toBeVisible();
  const input = row === undefined ? s.field(axis) : s.field(axis).nth(row);
  await expect(input).toHaveValue(value);
}

async function closeGuides(s: Scenario) {
  await s.button(/^Close(?: Ruler Guides)?$/i).click();
}

async function dragGuide(s: Scenario, x: number, y: number, toX: number, toY: number) {
  const state = await s.obs();
  await s.drag(...inCanvas(state, x, y), ...inCanvas(state, toX, toY));
}
