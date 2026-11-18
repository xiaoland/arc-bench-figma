import { expect, type Locator } from '@playwright/test';
import type { ObserveObject, ObserveSnapshot } from '../oracles.js';
import type { LayerReference, Program } from '../scenario.js';

type Scene = Parameters<Program['run']>[0];
type Geometry = ObserveObject['geometry'];
type Point = [number, number];
type Shape = 'Frame' | 'Rectangle' | 'Ellipse' | 'Line' | 'Arrow' | 'Section';

function byId(snapshot: ObserveSnapshot, id: string): ObserveObject {
  const object = snapshot.objects.find((layer) => layer.id === id);
  expect(object, `continuing layer ${id}`).toBeDefined();
  return object!;
}

function world(snapshot: ObserveSnapshot, object: ObserveObject): Geometry {
  let { x, y, width, height } = object.geometry;
  const visited = new Set([object.id]);
  let parentId = object.parentId;
  while (parentId) {
    expect(visited.has(parentId), 'acyclic layer ownership').toBe(false);
    visited.add(parentId);
    const parent = byId(snapshot, parentId);
    x += parent.geometry.x;
    y += parent.geometry.y;
    parentId = parent.parentId;
  }
  return { x, y, width, height };
}

function screen(snapshot: ObserveSnapshot, point: Point): Point {
  const view = snapshot.document.view;
  const zoom = view?.zoom ?? 1;
  return [point[0] * zoom + (view?.panX ?? 0), point[1] * zoom + (view?.panY ?? 0)];
}

function box(x: number, y: number, width: number, height: number): Geometry {
  return { x, y, width, height };
}

function shifted(geometry: Geometry, dx: number, dy: number): Geometry {
  return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
}

function children(snapshot: ObserveSnapshot, parentId: string) {
  return snapshot.objects.filter((object) => object.parentId === parentId);
}

function sameChildren(snapshot: ObserveSnapshot, parentId: string, ...ids: string[]) {
  expect(children(snapshot, parentId).map((object) => object.id).sort()).toEqual([...ids].sort());
}

async function focus(s: Scene) {
  await s.canvas().focus();
}

async function tool(s: Scene, label: Shape | 'Text' | 'Move') {
  const button = s.button(label);
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  const shortcut = { Frame: 'f', Rectangle: 'r', Ellipse: 'o', Line: 'l', Arrow: 'Shift+l',
    Section: 'Shift+s', Text: 't', Move: 'v' }[label];
  await focus(s);
  await s.press(shortcut);
  await expect(button).toBeVisible();
}

async function create(s: Scene, type: Shape, a: Point, b?: Point, name?: string): Promise<ObserveObject> {
  const before = new Set((await s.obs()).objects.map((layer) => layer.id));
  await tool(s, type);
  if (b) await s.drag(...a, ...b);
  else await s.point(...a);
  let createdId = '';
  await s.check((snapshot) => {
    const created = snapshot.objects.filter((layer) => layer.selected && !before.has(layer.id));
    expect(created, `create an editable ${type}`).toHaveLength(1);
    expect(created[0]!.type).toBe(type.toLowerCase());
    createdId = created[0]!.id;
  });
  if (name) await s.bindSelected(name);
  const created = byId(await s.obs(), createdId);
  await expect(s.layer(created)).toHaveAttribute('aria-selected', 'true');
  return created;
}

async function writeText(s: Scene, value: string) {
  await s.field('Text editor').fill(value);
  await s.press('Escape');
}

async function createText(s: Scene, a: Point, value: string, b?: Point, name?: string) {
  await tool(s, 'Text');
  if (b) await s.drag(...a, ...b);
  else await s.point(...a);
  await writeText(s, value);
  if (name) await s.bindSelected(name);
  const object = await s.selected();
  expect(object.type).toBe('text');
  expect(object.text).toBe(value);
  return object;
}

async function editText(s: Scene, name: LayerReference, value: string) {
  await s.select(name);
  await focus(s);
  await s.press('Enter');
  await writeText(s, value);
}

async function undo(s: Scene) {
  await focus(s);
  await s.press('ControlOrMeta+z');
}

async function redo(s: Scene) {
  await focus(s);
  await s.press('ControlOrMeta+Shift+z');
}

async function command(s: Scene, row: LayerReference, name: string) {
  await s.layer(row).click({ button: 'right' });
  await s.role('menuitem', name).click();
}

async function selectMany(s: Scene, ...names: LayerReference[]) {
  await s.select(names[0]!);
  for (const name of names.slice(1)) await s.layer(name).click({ modifiers: ['ControlOrMeta'] });
  const snapshot = await s.obs();
  expect(snapshot.selectionIds.slice().sort()).toEqual(names.map((name) => s.lookup(snapshot, name).id).sort());
}

async function dragBetweenRows(s: Scene, source: Locator, destination: Locator, targetY: number) {
  const a = await source.boundingBox();
  const b = await destination.boundingBox();
  if (!a || !b) throw new Error('Layers drag needs two visible rows');
  const mouse = s.page.mouse;
  await mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await mouse.down();
  try {
    await mouse.move(b.x + b.width / 2, b.y + b.height * targetY, { steps: 12 });
  } finally {
    await mouse.up();
  }
}

async function zoom(s: Scene, value: string) {
  await s.button('Zoom options').click();
  await s.set('Zoom', value);
  await s.press('Escape');
}

async function dragCenter(s: Scene, name: LayerReference, dx: number, dy: number) {
  const snapshot = await s.obs();
  const g = world(snapshot, s.lookup(snapshot, name));
  const start = screen(snapshot, [g.x + g.width / 2, g.y + g.height / 2]);
  const scale = snapshot.document.view?.zoom ?? 1;
  await s.drag(...start, start[0] + dx * scale, start[1] + dy * scale);
}

async function geometryIs(s: Scene, id: string, expected: Geometry) {
  await s.check((snapshot) => expect(byId(snapshot, id).geometry).toEqual(expected));
}

async function focusedAndSelected(input: Locator) {
  await expect(input).toBeFocused();
  expect(await input.evaluate((node) => {
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      return node.selectionStart === 0 && node.selectionEnd === node.value.length;
    }
    const selection = node.ownerDocument.getSelection();
    return selection?.toString() === node.textContent;
  })).toBe(true);
}

async function textboxHasText(input: Locator, text: string) {
  await expect.poll(() => input.evaluate((node) =>
    node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.textContent))
    .toBe(text);
}

function closeColor(pixel: number[], color: [number, number, number], tolerance = 16) {
  expect(pixel.slice(0, 3).every((channel, index) => Math.abs(channel - color[index]!) <= tolerance),
    `rendered color ${pixel.slice(0, 3)} resembles ${color}`).toBe(true);
}

function endpointName(value: unknown) {
  return String(value).toLowerCase().replace(/[\s_-]+/g, '');
}

const factorName = /^(Scale|(?:Scale )?Factor)$/i;

async function scale(s: Scene, anchor: 'Center' | 'Top left', factor?: number) {
  await focus(s);
  await s.press('k');
  const anchorName = anchor === 'Center'
    ? /^(?:Scale )?(?:anchor )?center(?: anchor)?$/i
    : /^(?:Scale )?(?:anchor )?top[- ]left(?: anchor)?$/i;
  await s.button(anchorName).or(s.role('radio', anchorName)).click();
  if (factor !== undefined) await s.set(factorName, String(factor) + 'x');
}

const program = (requirement: string, name: string, run: Program['run']): Program => ({ requirement, name, run });

export const programs: Program[] = [
  program('CREATE-02', 'Create and edit different shape types', async (s) => {
    const frame = await create(s, 'Frame', [20, 20], [420, 300], 'Shape frame');
    const rect = await create(s, 'Rectangle', [50, 60], [130, 120], 'Shape box');
    const ellipse = await create(s, 'Ellipse', [170, 60], [240, 130], 'Shape oval');
    const line = await create(s, 'Line', [70, 180], [190, 230], 'Shape line');
    const before = await s.obs();
    sameChildren(before, frame.id, rect.id, ellipse.id, line.id);
    expect(rect.geometry).toEqual(box(30, 40, 80, 60));
    expect(ellipse.geometry).toEqual(box(150, 40, 70, 70));
    expect(line.geometry.width).toBeCloseTo(130, 1);
    await s.select(rect);
    await s.set('Width', '100');
    await s.set('Fill', 'EA2244');
    await s.check((snapshot) => {
      const edited = byId(snapshot, rect.id);
      expect(edited.type).toBe('rectangle');
      expect(edited.fill?.color).toBe('EA2244');
      expect(edited.geometry).toEqual(box(30, 40, 100, 60));
      for (const shape of [ellipse, line]) {
        const original = byId(before, shape.id);
        expect(byId(snapshot, shape.id)).toMatchObject({
          parentId: original.parentId, geometry: original.geometry, type: original.type,
        });
        expect(byId(snapshot, shape.id).fill).toEqual(original.fill);
        expect(byId(snapshot, shape.id).stroke).toEqual(original.stroke);
      }
    });
    closeColor(await s.pixel(82, 83), [234, 34, 68]);
  }),

  program('CREATE-03', 'Create text by click and drag', async (s) => {
    const click = await createText(s, [70, 70], 'First draft', undefined, 'Click text');
    expect(click.textSizing).toBe('auto-width');
    await editText(s, click, 'Revised text');
    await s.check((snapshot) => expect(byId(snapshot, click.id).text).toBe('Revised text'));
    const drag = await createText(s, [100, 150], 'Fixed body', [300, 230], 'Text label');
    expect(drag.textSizing).toBe('fixed');
    expect(drag.geometry).toEqual(box(100, 150, 200, 80));
    await s.rename('Text label');
    await expect(s.layer('Text label')).toBeVisible();
    await editText(s, 'Text label', 'Updated body');
    await s.check((snapshot) => {
      const layer = byId(snapshot, drag.id);
      expect(layer.name).toBe('Text label');
      expect(layer.text).toBe('Updated body');
      expect(layer.geometry).toEqual(drag.geometry);
    });
    const section = await create(s, 'Section', [360, 250], [620, 390], 'Text section');
    expect(section.parentId).toBeNull();
    expect(section.geometry).toEqual(box(360, 250, 260, 140));
    sameChildren(await s.obs(), section.id);
    const sectionText = await createText(s, [390, 285], 'Section text', undefined, 'Section text');
    expect(sectionText.parentId).toBe(section.id);
    expect(sectionText.textSizing).toBe('auto-width');
    await expect(s.layer(section)).toBeVisible();
    await expect(s.layer(sectionText)).toHaveAttribute('aria-selected', 'true');
    await s.check((snapshot) => {
      const text = byId(snapshot, sectionText.id);
      expect(text).toMatchObject({ type: 'text', parentId: section.id, text: 'Section text' });
      expect(text.geometry.x).toBeGreaterThanOrEqual(0);
      expect(text.geometry.y).toBeGreaterThanOrEqual(0);
      expect(text.geometry.x + text.geometry.width).toBeLessThanOrEqual(section.geometry.width);
      expect(text.geometry.y + text.geometry.height).toBeLessThanOrEqual(section.geometry.height);
    });
    await focus(s);
    await s.press('Enter');
    await expect(s.field('Text editor')).toBeVisible();
    await textboxHasText(s.field('Text editor'), 'Section text');
    await s.press('Escape');
    await s.capture('text-created-in-section-open-area');
  }),

  program('EDIT-06', 'Move and copy an ordinary subtree', async (s) => {
    const source = await create(s, 'Frame', [20, 60], [275, 340], 'Source frame');
    const target = await create(s, 'Frame', [340, 60], [625, 350], 'Target frame');
    const branch = await create(s, 'Frame', [50, 100], [230, 250], 'Branch frame');
    const title = await createText(s, [70, 122], 'Original branch', undefined, 'Branch title');
    const shape = await create(s, 'Rectangle', [80, 165], [120, 200], 'Branch shape');
    expect(branch.parentId).toBe(source.id);
    await dragBetweenRows(s, s.layer('Branch frame'), s.layer('Target frame'), 0.5);
    await s.check((snapshot) => {
      expect(byId(snapshot, branch.id).parentId).toBe(target.id);
      sameChildren(snapshot, branch.id, title.id, shape.id);
      expect(children(snapshot, source.id)).toHaveLength(0);
    });
    const before = await s.obs();
    await s.select(target);
    await s.drag(580, 305, 605, 330);
    await s.check((snapshot) =>
      expect(world(snapshot, byId(snapshot, title.id))).toEqual(shifted(world(before, byId(before, title.id)), 25, 25)));
    const originalTree = await s.obs();
    const originalIds = new Set(originalTree.objects.map(object => object.id));
    await s.select(target);
    await focus(s);
    await s.press('ControlOrMeta+c');
    await s.check(snapshot => expect(snapshot.selectionIds).toEqual([target.id]));
    const pasteTree = async (label: string, parentId: string | null) => {
      const ids = new Set((await s.obs()).objects.map(object => object.id));
      await focus(s);
      await s.press('ControlOrMeta+v');
      const root = await s.bindSelected(label);
      await s.check(snapshot => {
        const added = snapshot.objects.filter(object => !ids.has(object.id));
        expect(added).toHaveLength(4);
        expect(added.map(object => object.id)).toContain(root.id);
        expect(byId(snapshot, root.id)).toMatchObject({ type: 'frame', parentId,
          pageId: target.pageId, geometry: { width: target.geometry.width, height: target.geometry.height } });
        const copiedBranch = children(snapshot, root.id);
        expect(copiedBranch).toHaveLength(1);
        expect(copiedBranch[0]).toMatchObject({ type: 'frame', geometry: byId(originalTree, branch.id).geometry });
        const content = children(snapshot, copiedBranch[0]!.id);
        expect(content).toHaveLength(2);
        const copiedTitle = content.find(object => object.type === 'text');
        const copiedRectangle = content.find(object => object.type === 'rectangle');
        expect(copiedTitle).toMatchObject({ text: 'Original branch', geometry: byId(originalTree, title.id).geometry });
        expect(copiedRectangle).toMatchObject({ geometry: byId(originalTree, shape.id).geometry });
        expect(added.every(object => !originalIds.has(object.id))).toBe(true);
        expect(added.every(object => object.component === undefined)).toBe(true);
        for (const original of originalTree.objects) {
          const current = byId(snapshot, original.id);
          expect(current).toMatchObject({ type: original.type, parentId: original.parentId, geometry: original.geometry });
          if (original.text !== undefined) expect(current.text).toBe(original.text);
        }
      });
      await expect(s.layer(root)).toHaveAttribute('aria-selected', 'true');
      await expect(s.field('Width')).toHaveValue(String(target.geometry.width));
      await expect(s.field('Height')).toHaveValue(String(target.geometry.height));
      return root;
    };
    const pageCopy = await pasteTree('Page sibling copy', null);
    await s.capture('paste-unchanged-page-frame-selection-creates-sibling');
    await s.select(source);
    const containedCopy = await pasteTree('Explicit container copy', source.id);
    await s.check(snapshot => sameChildren(snapshot, source.id, containedCopy.id));
    await s.capture('paste-into-a-different-selected-frame');
    // Remove these placement contrasts before the original independent-edit path.
    await s.press('Backspace');
    await s.select(pageCopy);
    await focus(s);
    await s.press('Backspace');
    await s.check(snapshot => expect(snapshot.objects.map(object => object.id).sort()).toEqual([...originalIds].sort()));
    await s.select(branch);
    await focus(s);
    await s.press('ControlOrMeta+d');
    const duplicate = await s.selected();
    expect(duplicate.id).not.toBe(branch.id);
    let copyText = children(await s.obs(), duplicate.id).find((object) => object.type === 'text')!;
    expect(copyText.text).toBe('Original branch');
    expect(copyText.id).not.toBe(title.id);
    const copiedShape = children(await s.obs(), duplicate.id).find((object) => object.type === 'rectangle')!;
    expect(copiedShape.id).not.toBe(shape.id);
    const duplicatePosition = duplicate.geometry;
    const expand = s.role('button', /Expand/, s.layer(duplicate));
    if (await expand.isVisible()) await expand.click();
    await s.select(copyText);
    expect((await s.selected()).id).toBe(copyText.id);
    await focus(s);
    await s.press('Enter');
    await writeText(s, 'Copied branch');
    await s.check((snapshot) => {
      expect(byId(snapshot, title.id).text).toBe('Original branch');
      copyText = byId(snapshot, copyText.id);
      expect(copyText.text).toBe('Copied branch');
      expect(copyText.component).toBeUndefined();
    });
    await s.press('Shift+Enter');
    expect((await s.selected()).id).toBe(duplicate.id);
    await s.press('Backspace');
    await s.check((snapshot) => expect(snapshot.objects.some((object) => object.id === duplicate.id)).toBe(false));
    await undo(s);
    await s.check((snapshot) => {
      expect(byId(snapshot, duplicate.id).geometry).toEqual(duplicatePosition);
      sameChildren(snapshot, duplicate.id, copyText.id, copiedShape.id);
      expect(byId(snapshot, copyText.id).text).toBe('Copied branch');
    });
  }),

  program('EDIT-11', 'Use temporary Hand from a selected layer', async (s) => {
    await s.select('Red');
    await tool(s, 'Move');
    const before = await s.obs();
    const red = s.lookup(before, 'Red');
    await focus(s);
    await s.page.keyboard.down('Space');
    try {
      await s.drag(80, 80, 120, 110);
    } finally {
      await s.page.keyboard.up('Space');
    }
    await s.check((snapshot) => {
      expect(snapshot.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
      expect(byId(snapshot, red.id).geometry).toEqual(red.geometry);
      expect(byId(snapshot, red.id).parentId).toBe(red.parentId);
      expect(snapshot.selectionIds).toEqual([red.id]);
    });
    await expect(s.button('Move')).toBeVisible();
    await s.drag(120, 110, 140, 120);
    await geometryIs(s, red.id, shifted(red.geometry, 20, 10));
    await expect(s.layer('Red')).toHaveAttribute('aria-selected', 'true');
    await expect(s.field('X')).toHaveValue('40');
    await expect(s.field('Y')).toHaveValue('30');
  }),

  program('EDIT-11', 'Select and drag after scroll and zoom', async (s) => {
    await s.select('Red');
    const before = await s.obs();
    const red = s.lookup(before, 'Red');
    await s.canvas().hover({ position: { x: 100, y: 90 } });
    await s.page.mouse.wheel(-28, -24);
    await s.check((snapshot) => expect(snapshot.document.view).not.toEqual(before.document.view));
    const afterScroll = await s.obs();
    const zoomKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await s.page.keyboard.down(zoomKey);
    try {
      await s.page.mouse.wheel(0, -120);
    } finally {
      await s.page.keyboard.up(zoomKey);
    }
    await s.check((snapshot) => {
      expect(snapshot.document.view?.zoom).not.toBe(afterScroll.document.view?.zoom);
      expect(byId(snapshot, red.id).geometry).toEqual(red.geometry);
      expect(byId(snapshot, red.id).parentId).toBe(red.parentId);
    });
    const current = await s.obs();
    const p = screen(current, [80, 80]);
    await s.point(...p, { modifiers: ['ControlOrMeta'] });
    expect((await s.selected()).id).toBe(red.id);
    const scale = current.document.view!.zoom!;
    await s.drag(...p, p[0] + 20 * scale, p[1] + 10 * scale);
    await geometryIs(s, red.id, shifted(red.geometry, 20, 10));
    await expect(s.layer('Red')).toHaveAttribute('aria-selected', 'true');
  }),

  program('EDIT-08', 'Commit and cancel Chinese text composition', async (s) => {
    await s.select('Paragraph');
    await focus(s);
    await s.press('Enter');
    const editor = s.field('Text editor');
    await editor.fill('Draft');
    await editor.press('End');
    const before = await s.obs();
    const paragraph = s.lookup(before, 'Paragraph');
    const cdp = await s.page.context().newCDPSession(s.page);
    try {
      // Chromium drives the platform-to-browser composition boundary here.
      // The test supplies the chosen candidate and cannot evaluate OS candidate ranking.
      await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 });
      await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: '你好' });
      await textboxHasText(editor, 'Draft你好');
      await cdp.send('Input.imeSetComposition', { text: 'ni hao', selectionStart: 6, selectionEnd: 6 });
      await editor.press('Escape');
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      await expect(editor).toBeFocused();
      await textboxHasText(editor, 'Draft你好');
      await cdp.send('Input.insertText', { text: 'ni hao' });
      await editor.press('Space');
      await textboxHasText(editor, 'Draft你好ni hao ');
    } finally {
      await cdp.detach();
    }
    await s.press('Escape');
    await s.check((snapshot) => {
      const layer = byId(snapshot, paragraph.id);
      expect(layer.text).toBe('Draft你好ni hao ');
      expect(layer.geometry.x).toBe(paragraph.geometry.x);
      expect(layer.geometry.y).toBe(paragraph.geometry.y);
      expect(snapshot.document.view).toEqual(before.document.view);
    });
    await s.select('Paragraph');
    await focus(s);
    await s.press('Enter');
    await textboxHasText(editor, 'Draft你好ni hao ');
  }),

  program('CREATE-01', 'Click to create top-level and nested Frames', async (s) => {
    const parent = await create(s, 'Frame', [180, 150], undefined, 'Outer');
    expect(parent.parentId).toBeNull();
    expect(parent.geometry).toMatchObject({ width: 100, height: 100 });
    await expect(s.field('Width')).toHaveValue('100');
    await expect(s.field('Height')).toHaveValue('100');
    const origin = parent.geometry;
    const child = await create(s, 'Frame', [origin.x + 50, origin.y + 50], undefined, 'Inner');
    expect(child.parentId).toBe(parent.id);
    expect(child.geometry).toMatchObject({ width: 100, height: 100 });
    await expect(s.field('Width')).toHaveValue('100');
    await expect(s.field('Height')).toHaveValue('100');
    await expect(s.button('Move')).toBeVisible();
    await s.select('Outer');
    await expect(s.layer('Outer')).toHaveAttribute('aria-selected', 'true');
    await s.drag(origin.x + 10, origin.y + 10, origin.x + 22, origin.y + 19);
    await geometryIs(s, parent.id, shifted(origin, 12, 9));
    await s.select('Inner');
    await s.set('Width', '108');
    await geometryIs(s, child.id, { ...child.geometry, width: 108 });
  }),

  program('CREATE-04', 'Move a Group and edit a member', async (s) => {
    const a = await create(s, 'Rectangle', [50, 90], [110, 130], 'Group A');
    const b = await create(s, 'Ellipse', [175, 95], [215, 145], 'Group B');
    await selectMany(s, a, b);
    await command(s, b, 'Group selection');
    await s.bindSelected('Test group');
    const group = await s.selected();
    expect(group.type).toBe('group');
    await s.check((snapshot) => {
      sameChildren(snapshot, group.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(a.geometry);
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(b.geometry);
    });
    await s.point(60, 104);
    expect((await s.selected()).id).toBe(group.id);
    await s.drag(60, 104, 90, 124);
    const groupMoved = await s.obs();
    expect(world(groupMoved, byId(groupMoved, a.id))).toEqual(shifted(a.geometry, 30, 20));
    expect(world(groupMoved, byId(groupMoved, b.id))).toEqual(shifted(b.geometry, 30, 20));
    await s.select(a);
    await dragCenter(s, a, -20, 10);
    const memberMoved = await s.obs();
    const movedA = world(memberMoved, byId(memberMoved, a.id));
    const movedB = world(memberMoved, byId(memberMoved, b.id));
    expect(movedA).toEqual(shifted(a.geometry, 10, 30));
    expect(movedB).toEqual(shifted(b.geometry, 30, 20));
    expect(byId(memberMoved, group.id).geometry).toEqual(box(60, 115, 185, 50));
    await s.select('Test group');
    await command(s, 'Test group', 'Ungroup');
    await s.check((snapshot) => {
      expect(snapshot.objects.some((object) => object.id === group.id)).toBe(false);
      expect(byId(snapshot, a.id)).toMatchObject({ parentId: null, type: 'rectangle', geometry: movedA });
      expect(byId(snapshot, b.id)).toMatchObject({ parentId: null, type: 'ellipse', geometry: movedB });
    });
    await s.select(a);
    await s.set('Width', '64');
    await geometryIs(s, a.id, { ...movedA, width: 64 });
  }),

  program('CREATE-05', 'Create a Section and organize content', async (s) => {
    const frame = await create(s, 'Frame', [420, 140], [535, 250], 'Section card');
    const content = await create(s, 'Rectangle', [445, 165], [482, 207], 'Card content');
    const outer = await create(s, 'Section', [80, 100], [390, 325]);
    await s.check((snapshot) => {
      expect(byId(snapshot, frame.id).parentId).toBeNull();
      expect(byId(snapshot, outer.id).parentId).toBeNull();
      expect(world(snapshot, byId(snapshot, frame.id))).toEqual(frame.geometry);
    });
    await tool(s, 'Move');
    const titlePoint: Point = [outer.geometry.x + 30, outer.geometry.y - 9];
    await s.point(...titlePoint, { clickCount: 2 });
    const title = s.field('Layer name');
    await title.fill('Region');
    await title.press('Enter');
    await expect(s.layer('Region')).toBeVisible();
    await s.drag(...titlePoint, titlePoint[0] + 180, titlePoint[1] + 25);
    await s.check((snapshot) => {
      expect(byId(snapshot, outer.id).geometry).toEqual(shifted(outer.geometry, 180, 25));
      expect(byId(snapshot, frame.id).parentId).toBe(outer.id);
      expect(byId(snapshot, content.id).parentId).toBe(frame.id);
      expect(world(snapshot, byId(snapshot, frame.id))).toEqual(frame.geometry);
      expect(world(snapshot, byId(snapshot, content.id))).toEqual(box(445, 165, 37, 42));
    });
    await undo(s);
    await s.check(snapshot => {
      expect(byId(snapshot, outer.id).geometry).toEqual(outer.geometry);
      expect(byId(snapshot, frame.id)).toMatchObject({ parentId: null, geometry: frame.geometry });
      expect(byId(snapshot, content.id).parentId).toBe(frame.id);
      expect(world(snapshot, byId(snapshot, content.id))).toEqual(box(445, 165, 37, 42));
    });
    await redo(s);
    await s.check(snapshot => {
      expect(byId(snapshot, outer.id).geometry).toEqual(shifted(outer.geometry, 180, 25));
      expect(byId(snapshot, frame.id).parentId).toBe(outer.id);
      expect(world(snapshot, byId(snapshot, frame.id))).toEqual(frame.geometry);
    });
    await s.select('Region');
    const originalWidth = (await s.object('Region')).geometry.width;
    await s.set('Width', String(originalWidth + 40));
    await s.check((snapshot) => {
      expect(byId(snapshot, outer.id).geometry.width).toBe(originalWidth + 40);
      expect(world(snapshot, byId(snapshot, frame.id))).toEqual(frame.geometry);
    });
    const nested = await create(s, 'Section', [300, 170], [385, 260], 'Nested region');
    expect(nested.parentId).toBe(outer.id);
    const preMove = await s.obs();
    const outline = world(preMove, byId(preMove, outer.id));
    await tool(s, 'Move');
    await s.drag(outline.x + 30, outline.y - 9, outline.x + 50, outline.y + 1);
    await s.check((snapshot) => {
      for (const id of [frame.id, content.id, nested.id]) {
        expect(world(snapshot, byId(snapshot, id))).toEqual(shifted(world(preMove, byId(preMove, id)), 20, 10));
      }
    });
    const moved = await s.obs();
    const movedFrame = world(moved, byId(moved, frame.id));
    await s.point(movedFrame.x + 8, movedFrame.y + 8);
    expect((await s.selected()).id).toBe(frame.id);
    await s.select('Region');
    expect((await s.selected()).id).toBe(outer.id);
    await s.select(frame);
    await s.drag(movedFrame.x + 8, movedFrame.y + 8, 110, 470);
    await s.check((snapshot) => expect(byId(snapshot, frame.id).parentId).toBeNull());
    await undo(s);
    await s.check((snapshot) => {
      expect(byId(snapshot, frame.id).parentId).toBe(outer.id);
      expect(byId(snapshot, outer.id).parentId).toBeNull();
      expect(world(snapshot, byId(snapshot, frame.id))).toEqual(movedFrame);
    });
  }),

  program('FRAME-CONTENT', 'Draw a Frame around existing layers', async (s) => {
    const a = await create(s, 'Rectangle', [75, 100], [145, 155], 'Enclosed A');
    const b = await create(s, 'Ellipse', [190, 115], [270, 175], 'Enclosed B');
    const section = await create(s, 'Section', [100, 190], [200, 210], 'Enclosed section');
    expect(section.geometry).toEqual(box(100, 190, 100, 20));
    const keepSection = (snapshot: ObserveSnapshot) => {
      expect(byId(snapshot, section.id)).toMatchObject({ type: 'section', parentId: null, geometry: section.geometry });
    };
    await s.check((snapshot) => {
      keepSection(snapshot);
      for (const shape of [a, b]) expect(byId(snapshot, shape.id)).toMatchObject({ parentId: null, geometry: shape.geometry });
    });
    const frame = await create(s, 'Frame', [40, 65], [320, 220], 'Enclosure');
    expect(frame.geometry).toEqual(box(40, 65, 280, 155));
    expect(frame.parentId).toBeNull();
    await s.check((snapshot) => {
      keepSection(snapshot);
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(a.geometry);
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(b.geometry);
      expect(snapshot.selectionIds).toEqual([frame.id]);
    });
    await expect(s.layer('Enclosure')).toHaveAttribute('aria-selected', 'true');
    await expect(s.button('Move')).toBeVisible();
    const readyToMove = await s.obs();
    const titlePoint = screen(readyToMove, [frame.geometry.x + 15, frame.geometry.y - 9]);
    const zoom = readyToMove.document.view?.zoom ?? 1;
    await s.drag(...titlePoint, titlePoint[0] + 28 * zoom, titlePoint[1] + 25 * zoom);
    await s.check((snapshot) => {
      keepSection(snapshot);
      expect(byId(snapshot, frame.id).geometry).toEqual(shifted(frame.geometry, 28, 25));
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(shifted(a.geometry, 28, 25));
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(shifted(b.geometry, 28, 25));
    });
    await undo(s);
    await s.check((snapshot) => {
      keepSection(snapshot);
      expect(byId(snapshot, frame.id).geometry).toEqual(frame.geometry);
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(a.geometry);
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(b.geometry);
    });
    await s.select(frame);
    const readyToResize = await s.obs();
    const edgePoint = screen(readyToResize, [frame.geometry.x + frame.geometry.width,
      frame.geometry.y + frame.geometry.height / 2]);
    const edgeZoom = readyToResize.document.view?.zoom ?? 1;
    await s.drag(...edgePoint, edgePoint[0] + 20 * edgeZoom, edgePoint[1]);
    await s.check((snapshot) => {
      keepSection(snapshot);
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(byId(snapshot, frame.id).geometry).toEqual({ ...frame.geometry, width: frame.geometry.width + 20 });
    });
    await expect(s.field('Width')).toHaveValue(String(frame.geometry.width + 20));
    await undo(s);
    await s.check((snapshot) => {
      keepSection(snapshot);
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(byId(snapshot, frame.id).geometry).toEqual(frame.geometry);
    });
    await expect(s.field('Width')).toHaveValue(String(frame.geometry.width));
    await s.select(a);
    await s.set('Width', '76');
    await s.check((snapshot) => expect(byId(snapshot, a.id).geometry.width).toBe(76));
  }),

  program('CREATE-02', 'Click-create and move a rectangle and ellipse', async (s) => {
    const rect = await create(s, 'Rectangle', [140, 150], undefined, 'Click rectangle');
    expect(rect.geometry).toMatchObject({ width: 100, height: 100 });
    await expect(s.button('Move')).toBeVisible();
    await dragCenter(s, rect, 24, 18);
    await geometryIs(s, rect.id, shifted(rect.geometry, 24, 18));
    await undo(s);
    await geometryIs(s, rect.id, rect.geometry);
    const ellipse = await create(s, 'Ellipse', [340, 160], undefined, 'Click ellipse');
    expect(ellipse.geometry).toMatchObject({ width: 100, height: 100 });
    await expect(s.button('Move')).toBeVisible();
    await dragCenter(s, ellipse, 27, 21);
    await geometryIs(s, ellipse.id, shifted(ellipse.geometry, 27, 21));
    await undo(s);
    await s.check((snapshot) => {
      expect(byId(snapshot, ellipse.id).geometry).toEqual(ellipse.geometry);
      expect(byId(snapshot, rect.id).geometry).toEqual(rect.geometry);
    });
  }),

  program('EDIT-12', 'Move a layer across Frame boundaries', async (s) => {
    const a = await create(s, 'Frame', [30, 50], [240, 280], 'Origin');
    const b = await create(s, 'Frame', [320, 60], [580, 280], 'Destination');
    const shape = await create(s, 'Rectangle', [65, 85], [120, 135], 'Traveler');
    expect(shape.parentId).toBe(a.id);
    await tool(s, 'Move');
    await s.point(88, 105, { modifiers: ['ControlOrMeta'] });
    expect((await s.selected()).id).toBe(shape.id);
    await s.drag(88, 105, 388, 120);
    const target = box(45, 40, 55, 50);
    await s.check((snapshot) => {
      expect(byId(snapshot, shape.id)).toMatchObject({ parentId: b.id, geometry: target });
      expect(byId(snapshot, a.id).geometry).toEqual(a.geometry);
      expect(byId(snapshot, b.id).geometry).toEqual(b.geometry);
    });
    await expect(s.layer('Traveler')).toHaveAttribute('aria-selected', 'true');
    await expect(s.field('X')).toHaveValue('45');
    await expect(s.field('Y')).toHaveValue('40');
    await s.drag(388, 120, 388, 385);
    await s.check((snapshot) => {
      expect(byId(snapshot, shape.id)).toMatchObject({ parentId: null, geometry: box(365, 365, 55, 50) });
    });
    await undo(s);
    await s.check((snapshot) =>
      expect(byId(snapshot, shape.id)).toMatchObject({ parentId: b.id, geometry: target, type: 'rectangle' }));
  }),

  program('FRAME-CLIP', 'Toggle clipping and keep child geometry', async (s) => {
    const frame = await create(s, 'Frame', [60, 90], [160, 190], 'Clip frame');
    const child = await create(s, 'Rectangle', [140, 110], [157, 150], 'Overhang');
    await s.set('Width', '40');
    await s.set('Fill', 'F11F43');
    const baseline = box(80, 20, 40, 40);
    await s.select(frame);
    const clip = s.role('checkbox', 'Clip content');
    await expect(clip).toBeChecked();
    closeColor(await s.pixel(151, 134), [241, 31, 67]);
    const outside = await s.pixel(171, 134);
    expect(outside.slice(0, 3)).not.toEqual([241, 31, 67]);
    await clip.click();
    await expect(clip).not.toBeChecked();
    closeColor(await s.pixel(171, 134), [241, 31, 67]);
    await clip.click();
    await expect(clip).toBeChecked();
    expect((await s.pixel(171, 134)).slice(0, 3)).toEqual(outside.slice(0, 3));
    await s.select(child);
    await s.check((snapshot) => {
      expect(byId(snapshot, child.id)).toMatchObject({ parentId: frame.id, geometry: baseline, selected: true });
      expect(byId(snapshot, frame.id).geometry).toEqual(frame.geometry);
    });
    await s.set('Height', '46');
    await geometryIs(s, child.id, { ...baseline, height: 46 });
  }),

  program('SHAPE-GEOMETRY', 'Keep shape contours after geometry edits', async (s) => {
    const rect = await create(s, 'Rectangle', [30, 75], [105, 145], 'Test rectangle');
    await s.set('Fill', '22BB55');
    const ellipse = await create(s, 'Ellipse', [190, 70], [245, 120], 'Test ellipse');
    await s.set('Fill', '2D44CC');
    const line = await create(s, 'Line', [330, 80], [450, 130], 'Test line');
    const arrow = await create(s, 'Arrow', [330, 205], [450, 255], 'Test arrow');
    await s.select(ellipse);
    await s.set('Width', '160');
    await s.set('Height', '80');
    await geometryIs(s, ellipse.id, box(190, 70, 160, 80));
    closeColor(await s.pixel(270, 110), [45, 68, 204]);
    expect((await s.pixel(194, 74)).slice(0, 3)).not.toEqual([45, 68, 204]);
    await s.select(rect);
    await dragCenter(s, rect, 18, 30);
    await geometryIs(s, rect.id, box(48, 105, 75, 70));
    closeColor(await s.pixel(54, 111), [34, 187, 85]);
    const originalAngles = new Map<string, string>();
    for (const object of [line, arrow]) {
      await s.select(object);
      originalAngles.set(object.id, await s.field('Rotation').inputValue());
      await s.set('Rotation', '-30');
      await s.set('Width', '156');
      expect(parseFloat(await s.field('Rotation').inputValue())).toBeCloseTo(-30, 1);
      await s.check((snapshot) => {
        const edited = byId(snapshot, object.id);
        expect(edited.type).toBe(object.type);
        expect(edited.geometry.width).toBeCloseTo(156, 1);
        expect(edited.geometry.height).toBe(0);
        if (object.type === 'arrow') expect(edited.stroke?.endPoint).toBe(object.stroke?.endPoint);
      });
    }
    await expect(s.layer(arrow)).toHaveAttribute('aria-selected', 'true');
    await undo(s);
    await undo(s);
    await geometryIs(s, arrow.id, arrow.geometry);
    await expect(s.field('Rotation')).toHaveValue(originalAngles.get(arrow.id)!);
  }),

  program('CREATE-04', 'Group and ungroup inside a Frame', async (s) => {
    const frame = await create(s, 'Frame', [40, 65], [460, 300], 'Host frame');
    const a = await create(s, 'Rectangle', [75, 110], [125, 156], 'Frame A');
    const b = await create(s, 'Ellipse', [190, 120], [245, 175], 'Frame B');
    const baseline = await s.obs();
    await selectMany(s, a, b);
    await command(s, b, 'Group selection');
    await s.bindSelected('Inner group');
    const group = await s.selected();
    expect(group.parentId).toBe(frame.id);
    await s.check((snapshot) => {
      sameChildren(snapshot, group.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(world(baseline, a));
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(world(baseline, b));
    });
    await s.select(frame);
    await s.drag(370, 250, 400, 270);
    const moved = await s.obs();
    for (const object of [a, b]) {
      expect(world(moved, byId(moved, object.id))).toEqual(shifted(world(baseline, object), 30, 20));
    }
    await s.select('Inner group');
    await command(s, 'Inner group', 'Ungroup');
    const assertUngrouped = (snapshot: ObserveSnapshot) => {
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(snapshot.objects.some((object) => object.id === group.id)).toBe(false);
      for (const object of [a, b]) {
        expect(world(snapshot, byId(snapshot, object.id))).toEqual(world(moved, byId(moved, object.id)));
      }
    };
    await s.check(assertUngrouped);
    await undo(s);
    await s.check((snapshot) => {
      expect(byId(snapshot, group.id).parentId).toBe(frame.id);
      sameChildren(snapshot, group.id, a.id, b.id);
    });
    await redo(s);
    await s.check(assertUngrouped);
    await s.select(a);
    await dragCenter(s, a, 10, 16);
    await s.check((snapshot) =>
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(shifted(world(moved, byId(moved, a.id)), 10, 16)));
  }),

  program('EDIT-13', 'Scale from the center and return to Move', async (s) => {
    const rect = await create(s, 'Rectangle', [60, 0], [220, 80], 'Scaled box');
    await s.button('Add stroke').click();
    await s.set('Stroke width', '2');
    await scale(s, 'Center');
    await s.set('Width', '320');
    const scaled = box(-20, -40, 320, 160);
    await s.check((snapshot) => {
      const layer = byId(snapshot, rect.id);
      expect(layer.geometry).toEqual(scaled);
      expect(layer.stroke?.width).toBe(4);
      expect(layer.parentId).toBeNull();
    });
    const scaleValue = await s.field(factorName).inputValue();
    expect(parseFloat(scaleValue) / (scaleValue.includes('%') ? 100 : 1)).toBe(2);
    await tool(s, 'Move');
    await s.drag(140, 40, 175, 68);
    await geometryIs(s, rect.id, shifted(scaled, 35, 28));
    await undo(s);
    await geometryIs(s, rect.id, scaled);
    await undo(s);
    await s.check((snapshot) => {
      const restored = byId(snapshot, rect.id);
      expect(restored.geometry).toEqual(rect.geometry);
      expect(restored.stroke?.width).toBe(2);
    });
  }),

  program('EDIT-13', 'Scale a Frame and its children', async (s) => {
    const frame = await create(s, 'Frame', [40, 60], [220, 195], 'Scaled frame');
    const rect = await create(s, 'Rectangle', [65, 120], [135, 175], 'Stroked child');
    await s.button('Add stroke').click();
    await s.set('Stroke width', '2');
    const text = await createText(s, [55, 74], 'Scale me', [165, 104], 'Text child');
    await s.set('Font size', '12');
    await s.set('Line height', '16');
    await s.select(frame);
    const before = await s.obs();
    sameChildren(before, frame.id, rect.id, text.id);
    await scale(s, 'Top left', 2);
    await tool(s, 'Move');
    const assertScaled = (snapshot: ObserveSnapshot) => {
      expect(byId(snapshot, frame.id).geometry).toEqual(box(40, 60, 360, 270));
      sameChildren(snapshot, frame.id, rect.id, text.id);
      for (const id of [rect.id, text.id]) {
        const original = byId(before, id).geometry;
        const scaled = byId(snapshot, id).geometry;
        expect(scaled.x).toBeCloseTo(original.x * 2, 1);
        expect(scaled.y).toBeCloseTo(original.y * 2, 1);
        expect(scaled.width).toBeCloseTo(original.width * 2, 1);
        expect(scaled.height).toBeCloseTo(original.height * 2, 1);
      }
      expect(byId(snapshot, rect.id).stroke?.width).toBe(4);
      expect(byId(snapshot, text.id).font).toMatchObject({ size: 24, lineHeight: 32 });
      expect(byId(snapshot, text.id).text).toBe('Scale me');
    };
    await s.check(assertScaled);
    await s.select(text);
    await focus(s);
    await s.press('Enter');
    await expect(s.field('Text editor')).toBeVisible();
    await s.press('Escape');
    await undo(s);
    await s.check((snapshot) => {
      assertScaled(snapshot);
      expect(snapshot.selectionIds).toEqual([frame.id]);
    });
    await undo(s);
    await s.check((snapshot) => {
      sameChildren(snapshot, frame.id, rect.id, text.id);
      for (const id of [frame.id, rect.id, text.id]) expect(byId(snapshot, id).geometry).toEqual(byId(before, id).geometry);
      expect(byId(snapshot, rect.id).stroke?.width).toBe(2);
      expect(byId(snapshot, text.id).font).toMatchObject({ size: 12, lineHeight: 16 });
    });
  }),

  program('EDIT-04', 'Commit an expression and nudge at different zoom levels', async (s) => {
    const rect = await create(s, 'Rectangle', [20, 30], [180, 110], 'Nudge box');
    await s.set('Width', '160+40');
    await expect(s.field('Width')).toHaveValue('200');
    await geometryIs(s, rect.id, box(20, 30, 200, 80));
    await tool(s, 'Move');
    await focus(s);
    await s.press('ArrowRight');
    await geometryIs(s, rect.id, box(21, 30, 200, 80));
    await zoom(s, '50%');
    await focus(s);
    await s.press('Shift+ArrowRight');
    await geometryIs(s, rect.id, box(31, 30, 200, 80));
    await undo(s);
    await s.check((snapshot) => {
      expect(byId(snapshot, rect.id).geometry).toEqual(box(21, 30, 200, 80));
      expect(snapshot.document.view?.zoom).toBe(0.5);
      expect(snapshot.selectionIds).toEqual([rect.id]);
    });
  }),

  program('SHAPE-GEOMETRY', 'Set a diagonal Arrow length', async (s) => {
    const arrow = await create(s, 'Arrow', [60, 70], [180, 120], 'Measured arrow');
    expect(arrow.geometry.width).toBeCloseTo(130, 1);
    expect(arrow.geometry.height).toBe(0);
    expect(parseFloat(await s.field('Rotation').inputValue())).toBeCloseTo(-22.62, 1);
    expect(endpointName(arrow.stroke?.startPoint)).toBe('none');
    expect(endpointName(arrow.stroke?.endPoint)).toBe('linearrow');
    await s.point(460, 260);
    const onLine = await s.pixel(108, 90);
    const offLine = await s.pixel(108, 96);
    expect(onLine.slice(0, 3)).not.toEqual(offLine.slice(0, 3));
    await s.select(arrow);
    await s.set('Width', '260');
    await s.point(400, 300);
    await s.select(arrow);
    await expect(s.field('Width')).toHaveValue('260');
    expect(parseFloat(await s.field('Rotation').inputValue())).toBeCloseTo(-22.62, 1);
    await s.check((snapshot) => {
      const current = byId(snapshot, arrow.id);
      expect(current.geometry.width).toBeCloseTo(260, 1);
      expect(current.geometry.height).toBe(0);
      expect(endpointName(current.stroke?.startPoint)).toBe('none');
      expect(endpointName(current.stroke?.endPoint)).toBe('linearrow');
    });
    await s.point(460, 260);
    const extended = await s.pixel(252, 150);
    expect(extended.slice(0, 3)).not.toEqual((await s.pixel(252, 157)).slice(0, 3));
  }),

  program('EDIT-03', 'Use keyboard selection through Frame and Group levels', async (s) => {
    const frame = await create(s, 'Frame', [30, 60], [250, 230], 'Keyboard frame');
    const a = await create(s, 'Rectangle', [55, 90], [103, 133], 'Frame child A');
    const b = await create(s, 'Rectangle', [142, 100], [184, 153], 'Frame child B');
    const c = await create(s, 'Rectangle', [320, 100], [374, 150], 'Group child A');
    const d = await create(s, 'Rectangle', [419, 115], [470, 155], 'Group child B');
    await selectMany(s, c, d);
    await command(s, d, 'Group selection');
    await s.bindSelected('Keyboard group');
    const group = await s.selected();
    const before = await s.obs();
    const families = [
      { container: frame, members: [a, b], point: [65, 100] as Point },
      { container: group, members: [c, d], point: [328, 111] as Point },
    ];
    for (const { container, members, point } of families) {
      await s.point(550, 290);
      await s.point(...point);
      expect((await s.selected()).id).toBe(container.id);
      await s.press('Enter');
      await s.check((snapshot) => expect([...snapshot.selectionIds].sort()).toEqual(members.map((member) => member.id).sort()));
      for (const member of members) await expect(s.layer(member)).toHaveAttribute('aria-selected', 'true');
      await expect(s.role('status', 'Selection count')).toHaveText(/2/);
      await s.press('Shift+Enter');
      expect((await s.selected()).id).toBe(container.id);
    }
    const siblings = [c, d].map((object) => byId(before, object.id)).sort((l, r) => r.siblingIndex - l.siblingIndex);
    await s.select(siblings[0]!);
    await s.press('Tab');
    expect((await s.selected()).id).toBe(siblings[1]!.id);
    await s.press('Shift+Tab');
    await s.check((snapshot) => {
      expect(snapshot.selectionIds).toEqual([siblings[0]!.id]);
      for (const object of [a, b, c, d]) {
        const current = byId(snapshot, object.id);
        expect(current.geometry).toEqual(byId(before, object.id).geometry);
        expect(current.parentId).toBe(byId(before, object.id).parentId);
      }
    });
  }),

  program('EDIT-11', 'Anchor numeric zoom at the viewport center', async (s) => {
    await s.select('Select A');
    const before = await s.obs();
    const region = await s.canvas().boundingBox();
    expect(region).not.toBeNull();
    const anchor: Point = [region!.width / 2, region!.height / 2];
    const layer = s.lookup(before, 'Select A');
    const point: Point = [layer.geometry.x + layer.geometry.width / 2, layer.geometry.y + layer.geometry.height / 2];
    const baseline = screen(before, point);
    await zoom(s, '150%');
    const zoomed = await s.obs();
    expect(zoomed.document.view?.zoom).toBe(1.5);
    const projected = screen(zoomed, point);
    expect(projected[0] - anchor[0]).toBeCloseTo((baseline[0] - anchor[0]) * 1.5, 1);
    expect(projected[1] - anchor[1]).toBeCloseTo((baseline[1] - anchor[1]) * 1.5, 1);
    await zoom(s, '100%');
    await s.check((snapshot) => {
      expect(screen(snapshot, point)[0]).toBeCloseTo(baseline[0], 1);
      expect(screen(snapshot, point)[1]).toBeCloseTo(baseline[1], 1);
      expect(snapshot.selectionIds).toEqual(before.selectionIds);
      expect(byId(snapshot, layer.id).geometry).toEqual(layer.geometry);
    });
  }),

  program('EDIT-12', 'Drag an unselected layer and resize with Shift', async (s) => {
    const region = await s.canvas().boundingBox();
    expect(region).not.toBeNull();
    const center: Point = [Math.round(region!.width / 2), Math.round(region!.height / 2)];
    const a = await create(s, 'Rectangle', [center[0] - 60, center[1] - 40], [center[0] + 60, center[1] + 40], 'Drag box');
    await zoom(s, '200%');
    await s.drag(...center, center[0] + 25, center[1] + 24, { modifiers: ['Space'] });
    await s.point(20, 30);
    const baseline = await s.obs();
    expect(baseline.selectionIds).toEqual([]);
    expect(baseline.document.view?.zoom).toBe(2);
    expect(baseline.document.view?.panX).not.toBe(0);
    const g = byId(baseline, a.id).geometry;
    const start = screen(baseline, [g.x + 60, g.y + 40]);
    await s.drag(...start, start[0] + 40, start[1] + 20);
    const moved = shifted(g, 20, 10);
    await s.check((snapshot) => {
      expect(snapshot.selectionIds).toEqual([a.id]);
      expect(byId(snapshot, a.id).geometry).toEqual(moved);
    });
    const at = screen(await s.obs(), [moved.x + moved.width, moved.y + moved.height]);
    await s.drag(...at, at[0] + 66, at[1] + 34, { modifiers: ['Shift'] });
    await s.check((snapshot) => {
      const resized = byId(snapshot, a.id).geometry;
      expect(resized.width).toBeGreaterThan(120);
      expect(resized.height).toBeGreaterThan(80);
      expect(resized.width / resized.height).toBeCloseTo(1.5, 2);
    });
    await undo(s);
    await geometryIs(s, a.id, moved);
    await expect(s.field('Width')).toHaveValue('120');
    await expect(s.field('Height')).toHaveValue('80');
  }),

  program('EDIT-06', 'Duplicate ordinary layers and repeat a displacement', async (s) => {
    const a = await create(s, 'Rectangle', [45, 90], [130, 150], 'Original A');
    await focus(s);
    await s.press('ControlOrMeta+d');
    const b = await s.selected();
    expect(b.id).not.toBe(a.id);
    expect(b.geometry).toEqual(a.geometry);
    await s.press('ArrowRight');
    await geometryIs(s, b.id, shifted(b.geometry, 1, 0));
    await undo(s);
    await geometryIs(s, b.id, b.geometry);
    await s.drag(75, 112, 225, 147, { modifiers: ['Alt'] });
    const c = await s.selected();
    expect([a.id, b.id]).not.toContain(c.id);
    expect(c.geometry).toEqual(shifted(b.geometry, 150, 35));
    await s.press('ControlOrMeta+d');
    const d = await s.selected();
    expect([a.id, b.id, c.id]).not.toContain(d.id);
    expect(d.geometry).toEqual(shifted(c.geometry, 150, 35));
    await s.set('Fill', '247DD4');
    await s.check((snapshot) => {
      expect(snapshot.objects).toHaveLength(4);
      for (const layer of [a, b, c]) {
        expect(byId(snapshot, layer.id).fill).toEqual(a.fill);
        expect(byId(snapshot, layer.id).geometry).toEqual(layer.geometry);
      }
      expect(byId(snapshot, d.id).fill?.color).toBe('247DD4');
      expect(byId(snapshot, d.id).type).toBe('rectangle');
    });
    await s.select(d);
    await focus(s);
    const beforeEarlyRelease = await s.obs();
    const current = world(beforeEarlyRelease, byId(beforeEarlyRelease, d.id));
    const [sx, sy] = screen(beforeEarlyRelease, [current.x + current.width / 2, current.y + current.height / 2]);
    const zoom = beforeEarlyRelease.document.view?.zoom ?? 1;
    const canvas = await s.canvas().boundingBox();
    if (!canvas) throw new Error('The copy-release comparison needs a visible canvas');
    const { mouse, keyboard } = s.page;
    await keyboard.down('Alt');
    try {
      await mouse.move(canvas.x + sx, canvas.y + sy);
      await mouse.down();
      try {
        await mouse.move(canvas.x + sx + 100 * zoom, canvas.y + sy + 80 * zoom, { steps: 12 });
        await keyboard.up('Alt');
      } finally {
        await mouse.up();
      }
    } finally {
      await keyboard.up('Alt');
    }
    await s.check(snapshot => {
      expect(snapshot.objects.map(object => object.id).sort()).toEqual(beforeEarlyRelease.objects.map(object => object.id).sort());
      for (const layer of [a, b, c]) expect(byId(snapshot, layer.id).geometry).toEqual(layer.geometry);
      expect(byId(snapshot, d.id)).toMatchObject({ parentId: d.parentId,
        geometry: shifted(d.geometry, 100, 80), fill: { color: '247DD4' } });
    });
    await expect(s.field('X')).toHaveValue(String(d.geometry.x + 100));
    await expect(s.field('Y')).toHaveValue(String(d.geometry.y + 80));
    await s.capture('alt-released-before-pointer-up-moves-original');
  }),

  program('EDIT-07', 'Reorder overlapping siblings', async (s) => {
    const before = await s.obs();
    const red = s.lookup(before, 'Red');
    const blue = s.lookup(before, 'Blue');
    expect(red.parentId).toBe(blue.parentId);
    closeColor(await s.pixel(132, 95), [0, 0, 255]);
    const from = await s.layer('Red').boundingBox();
    const to = await s.layer('Blue').boundingBox();
    if (!from || !to) throw new Error('Both Layers rows must be visible to reorder them');
    const insertionArea = { x: to.x + 1, y: Math.max(0, to.y - 2), width: Math.min(150, to.width - 2), height: 5 };
    const normalBoundary = await s.page.screenshot({ clip: insertionArea });
    await s.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await s.page.mouse.down();
    try {
      await s.page.mouse.move(to.x + to.width / 2, to.y + 1, { steps: 12 });
      await s.capture('overlapping-layer-insertion');
      expect((await s.page.screenshot({ clip: insertionArea })).equals(normalBoundary)).toBe(false);
      const held = await s.obs();
      expect(byId(held, red.id).siblingIndex).toBe(red.siblingIndex);
      expect(byId(held, blue.id).siblingIndex).toBe(blue.siblingIndex);
    } finally {
      await s.page.mouse.up();
    }
    await s.check((snapshot) => {
      expect(byId(snapshot, red.id).siblingIndex).toBeGreaterThan(byId(snapshot, blue.id).siblingIndex);
      for (const layer of [red, blue]) {
        expect(byId(snapshot, layer.id)).toMatchObject({ parentId: layer.parentId, geometry: layer.geometry });
      }
    });
    closeColor(await s.pixel(132, 95), [255, 0, 0]);
  }),

  program('EDIT-02', 'Commit and cancel an inline layer name', async (s) => {
    const initial = await s.object('Title');
    const editor = s.field('Layer name');
    await s.page.getByTestId('layer-name:Title').dblclick();
    await focusedAndSelected(editor);
    await editor.fill('Heading');
    await editor.press('Enter');
    await expect(editor).toBeHidden();
    await expect(s.layer('Heading')).toBeVisible();
    await s.page.getByTestId('layer-name:Heading').dblclick();
    await focusedAndSelected(editor);
    await editor.fill('Temporary');
    await editor.press('Escape');
    await expect(editor).toBeHidden();
    await expect(s.layer('Temporary')).toHaveCount(0);
    await s.check((snapshot) => expect(byId(snapshot, initial.id)).toMatchObject({ name: 'Heading', text: 'Draft title' }));
  }),

  program('EDIT-11', 'Enter a zoom value and choose a preset', async (s) => {
    await s.select('Nested');
    const before = await s.obs();
    const frame = s.lookup(before, 'Nested');
    await s.button('Zoom options').click();
    const input = s.field('Zoom');
    await focusedAndSelected(input);
    await input.fill('150%');
    expect((await s.obs()).document.view?.zoom).toBe(1);
    await input.press('Enter');
    await expect(input).toBeVisible();
    await s.check((snapshot) => expect(snapshot.document.view?.zoom).toBe(1.5));
    await s.role('menuitem', '50%').click();
    await expect(input).toBeHidden();
    await s.check((snapshot) => {
      expect(snapshot.document.view?.zoom).toBe(0.5);
      expect(byId(snapshot, frame.id).geometry).toEqual(frame.geometry);
      expect(snapshot.selectionIds).toEqual([frame.id]);
    });
    await s.button('Zoom options').click();
    await focusedAndSelected(input);
    await input.fill('150');
    expect((await s.obs()).document.view?.zoom).toBe(0.5);
    await s.press('Escape');
    await expect(input).toBeHidden();
    await expect(s.role('menuitem', '50%')).toBeHidden();
    await s.check(snapshot => {
      expect(snapshot.document.view?.zoom).toBe(1.5);
      expect(snapshot.selectionIds).toEqual([frame.id]);
      for (const object of before.objects) expect(byId(snapshot, object.id).geometry).toEqual(object.geometry);
    });
    await expect(s.layer(frame)).toHaveAttribute('aria-selected', 'true');
    await s.capture('zoom-escape-commits-and-closes-menu');
    await s.press('Escape');
    await s.check(snapshot => {
      expect(snapshot.document.view?.zoom).toBe(1.5);
      expect(snapshot.selectionIds).toEqual([]);
      for (const object of before.objects) expect(byId(snapshot, object.id).geometry).toEqual(object.geometry);
    });
    await expect(s.layer(frame)).toHaveAttribute('aria-selected', 'false');
    await s.capture('second-escape-clears-layer-selection');
  }),

  program('EDIT-11', 'Pan with the middle mouse button', async (s) => {
    await s.select('Red');
    await tool(s, 'Move');
    const initial = await s.obs();
    const red = s.lookup(initial, 'Red');
    expect(red.geometry).toEqual(box(20, 20, 80, 60));
    await s.drag(80, 80, 120, 110, { button: 'middle' });
    await s.check((snapshot) => {
      expect(snapshot.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
      expect(snapshot.selectionIds).toEqual([red.id]);
      expect(byId(snapshot, red.id).geometry).toEqual(red.geometry);
    });
    await s.drag(120, 110, 140, 120);
    await s.check((snapshot) => {
      expect(byId(snapshot, red.id)).toMatchObject({ parentId: red.parentId, geometry: box(40, 30, 80, 60) });
      expect(snapshot.document.view).toMatchObject({ panX: 40, panY: 30, zoom: 1 });
      expect(snapshot.selectionIds).toEqual([red.id]);
    });
  }),

  program('EDIT-10', 'Select a partially covered shape and a nested child', async (s) => {
    const frame = await create(s, 'Frame', [300, 0], [500, 150], 'Marquee frame');
    const child = await create(s, 'Rectangle', [320, 20], [380, 60], 'Marquee child');
    expect(child.parentId).toBe(frame.id);
    await tool(s, 'Move');
    await s.point(5, 5);
    const baseline = await s.obs();
    const a = s.lookup(baseline, 'Select A');
    const b = s.lookup(baseline, 'Select B');
    await s.drag(5, 5, 40, 40);
    await s.check((snapshot) => expect(snapshot.selectionIds).toEqual([a.id]));
    await expect(s.layer('Select A')).toHaveAttribute('aria-selected', 'true');
    await s.point(5, 5);
    const blankSample = await s.pixel(313, 14);
    await s.drag(310, 10, 340, 40, { modifiers: ['ControlOrMeta'] });
    await s.check((snapshot) => {
      expect(snapshot.selectionIds).toEqual([child.id]);
      for (const object of [a, b, frame, child]) {
        expect(byId(snapshot, object.id).geometry).toEqual(byId(baseline, object.id).geometry);
      }
    });
    await expect(s.layer(child)).toHaveAttribute('aria-selected', 'true');
    expect((await s.pixel(313, 14)).slice(0, 3)).toEqual(blankSample.slice(0, 3));
    await expect(s.field('Width')).toHaveValue('60');
    await expect(s.field('Height')).toHaveValue('40');
  }),

  program('EDIT-13', 'Scale a selection around its combined center', async (s) => {
    const a = await create(s, 'Rectangle', [60, 0], [220, 80], 'Combined A');
    const b = await create(s, 'Rectangle', [300, 0], [380, 40], 'Combined B');
    await selectMany(s, a, b);
    await scale(s, 'Center', 2);
    await tool(s, 'Move');
    await s.check((snapshot) => {
      const left = byId(snapshot, a.id);
      const right = byId(snapshot, b.id);
      expect(left.geometry).toEqual(box(-100, -40, 320, 160));
      expect(right.geometry).toEqual(box(380, -40, 160, 80));
      expect(left.parentId).toBeNull();
      expect(right.parentId).toBeNull();
      expect(left.siblingIndex).toBe(a.siblingIndex);
      expect(right.siblingIndex).toBe(b.siblingIndex);
      expect(right.geometry.x - left.geometry.x - left.geometry.width).toBe(160);
      expect((left.geometry.x + right.geometry.x + right.geometry.width) / 2).toBe(220);
      expect(left.geometry.y + left.geometry.height / 2).toBe(40);
      expect(snapshot.selectionIds.slice().sort()).toEqual([a.id, b.id].sort());
    });
    await s.select(a);
    await expect(s.field('Width')).toHaveValue('320');
    await s.select(b);
    await expect(s.field('Width')).toHaveValue('160');
  }),

  program('EDIT-13', 'Scale appearance dimensions', async (s) => {
    await s.select('Paint');
    await s.set('Corner radius', '10');
    await s.button('Add stroke').click();
    await s.set('Stroke width', '2');
    await s.button('Add effect').click();
    await s.button('Drop shadow').click();
    for (const [key, value] of Object.entries({ 'Shadow X': 3, 'Shadow Y': 4,
      'Shadow blur': 6, 'Shadow spread': 2, 'Shadow opacity': 25 })) await s.set(key, String(value));
    await s.press('Escape');
    const original = await s.object('Paint');
    const firstShadow = (layer: ObserveObject) => Array.isArray(layer.shadow) ? layer.shadow[0] : layer.shadow;
    expect(firstShadow(original)).toMatchObject({ x: 3, y: 4, blur: 6, spread: 2, opacity: 0.25 });
    await scale(s, 'Top left', 2);
    await tool(s, 'Move');
    await s.check((snapshot) => {
      const object = byId(snapshot, original.id);
      expect(object.cornerRadius).toBe(20);
      expect(object.stroke?.width).toBe(4);
      expect(firstShadow(object)).toMatchObject({
        x: 6, y: 8, blur: 12, spread: 4, opacity: 0.25, color: firstShadow(original)?.color,
      });
      expect(object.fill).toEqual(original.fill);
      expect(object.stroke?.color).toBe(original.stroke?.color);
    });
    await undo(s);
    await s.check((snapshot) => {
      const object = byId(snapshot, original.id);
      expect(object.cornerRadius).toBe(10);
      expect(object.stroke?.width).toBe(2);
      expect(object.shadow).toEqual(original.shadow);
      expect(object.geometry).toEqual(original.geometry);
    });
  }),

  program('EDIT-04', 'Rotate a rectangle around its default center', async (s) => {
    const rect = await create(s, 'Rectangle', [100, 100], [220, 180], 'Rotating box');
    await s.set('Fill', '37BB39');
    await s.set('Rotation', '30');
    expect(parseFloat(await s.field('X').inputValue())).toBeCloseTo(88.04, 1);
    expect(parseFloat(await s.field('Y').inputValue())).toBeCloseTo(75.36, 1);
    await expect(s.field('Width')).toHaveValue('120');
    await expect(s.field('Height')).toHaveValue('80');
    closeColor(await s.pixel(160, 140), [55, 187, 57]);
    expect((await s.pixel(103, 103)).slice(0, 3)).not.toEqual([55, 187, 57]);
    await undo(s);
    await geometryIs(s, rect.id, rect.geometry);
    expect(parseFloat(await s.field('Rotation').inputValue())).toBe(0);
    closeColor(await s.pixel(103, 103), [55, 187, 57]);
  }),

  program('FRAME-SELECTION', 'Frame existing layers and remove the container', async (s) => {
    const a = await create(s, 'Rectangle', [20, 20], [100, 60], 'Framed A');
    const b = await create(s, 'Rectangle', [180, 50], [240, 110], 'Framed B');
    await selectMany(s, a, b);
    await command(s, b, 'Frame selection');
    await s.bindSelected('Selection frame');
    const frame = await s.selected();
    expect(frame.type).toBe('frame');
    expect(frame.geometry).toEqual(box(20, 20, 220, 90));
    expect(frame.fill).toBeUndefined();
    await expect(s.role('checkbox', 'Clip content')).not.toBeChecked();
    await s.check((snapshot) => {
      sameChildren(snapshot, frame.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(a.geometry);
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(b.geometry);
    });
    await s.drag(130, 65, 160, 85);
    await geometryIs(s, frame.id, box(50, 40, 220, 90));
    await s.point(71, 53, { modifiers: ['ControlOrMeta'] });
    expect((await s.selected()).id).toBe(a.id);
    await s.drag(71, 53, 91, 63);
    const beforeUngroup = await s.obs();
    expect(byId(beforeUngroup, a.id).geometry).toEqual(box(20, 10, 80, 40));
    expect(byId(beforeUngroup, frame.id).geometry).toEqual(box(50, 40, 220, 90));
    await s.select('Selection frame');
    await command(s, 'Selection frame', 'Ungroup');
    await s.check((snapshot) => {
      expect(snapshot.objects.some((object) => object.id === frame.id)).toBe(false);
      expect(byId(snapshot, a.id)).toMatchObject({ parentId: null, geometry: box(70, 50, 80, 40), siblingIndex: a.siblingIndex });
      expect(byId(snapshot, b.id)).toMatchObject({ parentId: null, geometry: box(210, 70, 60, 60), siblingIndex: b.siblingIndex });
    });
    await undo(s);
    await s.check((snapshot) => {
      sameChildren(snapshot, frame.id, a.id, b.id);
      for (const object of [a, b, frame]) {
        expect(byId(snapshot, object.id).geometry).toEqual(byId(beforeUngroup, object.id).geometry);
      }
    });
  }),

  program('SHAPE-GEOMETRY', 'Drag a Line endpoint', async (s) => {
    const line = await create(s, 'Line', [20, 20], [140, 70], 'Endpoint line');
    const before = line.geometry;
    expect(before.width).toBeCloseTo(130, 1);
    await tool(s, 'Move');
    await s.drag(140, 70, 180, 20);
    await s.check((snapshot) => {
      expect(byId(snapshot, line.id).geometry).toEqual(box(20, 20, 160, 0));
      expect(snapshot.selectionIds).toEqual([line.id]);
    });
    expect(parseFloat(await s.field('Rotation').inputValue())).toBe(0);
    const path = await s.pixel(150, 20);
    expect(path.slice(0, 3)).not.toEqual((await s.pixel(150, 28)).slice(0, 3));
    await undo(s);
    await geometryIs(s, line.id, before);
    expect(parseFloat(await s.field('Rotation').inputValue())).toBeCloseTo(-22.62, 1);
  }),

  program('CREATE-05', 'Wrap selected Frames in a Section', async (s) => {
    const a = await create(s, 'Frame', [0, 0], [100, 80], 'Wrap A');
    const b = await create(s, 'Frame', [200, 0], [300, 80], 'Wrap B');
    await selectMany(s, a, b);
    await command(s, b, 'Wrap in new section');
    const section = await s.selected();
    expect(section.type).toBe('section');
    expect(section.geometry).toEqual(box(-100, -100, 500, 280));
    await s.check((snapshot) => {
      sameChildren(snapshot, section.id, a.id, b.id);
      expect(world(snapshot, byId(snapshot, a.id))).toEqual(a.geometry);
      expect(world(snapshot, byId(snapshot, b.id))).toEqual(b.geometry);
    });
    await s.select(a);
    await expect(s.field('X')).toHaveValue('100');
    await expect(s.field('Y')).toHaveValue('100');
    await s.select(b);
    await expect(s.field('X')).toHaveValue('300');
    await expect(s.field('Y')).toHaveValue('100');
  }),

  program('EDIT-02', 'Commit a layer name by selecting another layer', async (s) => {
    const before = await s.obs();
    const title = s.lookup(before, 'Title');
    const blue = s.lookup(before, 'Blue');
    const editor = s.field('Layer name');
    await s.page.getByTestId('layer-name:Title').dblclick();
    await expect(editor).toBeFocused();
    await editor.fill('Heading');
    await s.layer('Blue').click();
    await expect(editor).toBeHidden();
    await expect(s.layer('Heading')).toBeVisible();
    await expect(s.layer('Blue')).toHaveAttribute('aria-selected', 'true');
    await expect(s.field('Width')).toHaveValue(String(blue.geometry.width));
    await s.check((snapshot) => {
      expect(snapshot.selectionIds).toEqual([blue.id]);
      expect(byId(snapshot, title.id)).toMatchObject({ name: 'Heading', text: 'Draft title' });
    });
  }),

  program('EDIT-06', 'Duplicate a top-level Frame and keep its subtree', async (s) => {
    const frame = await create(s, 'Frame', [100, 80], [400, 280], 'Workspace');
    const text = await createText(s, [125, 125], 'Draft title', undefined, 'Title');
    expect(text.parentId).toBe(frame.id);
    await s.select('Workspace');
    await focus(s);
    await s.press('ControlOrMeta+d');
    const copied = await s.selected();
    expect(copied.type).toBe('frame');
    expect(copied.parentId).toBeNull();
    expect(copied.id).not.toBe(frame.id);
    expect(copied.geometry.x).toBeGreaterThanOrEqual(frame.geometry.x + frame.geometry.width);
    expect(copied.geometry.y).toBe(frame.geometry.y);
    expect(copied.geometry.width).toBe(300);
    expect(copied.geometry.height).toBe(200);
    const snapshot = await s.obs();
    const contents = children(snapshot, copied.id);
    expect(contents).toHaveLength(1);
    const copyText = contents[0]!;
    expect(copyText.id).not.toBe(text.id);
    expect(copyText.text).toBe('Draft title');
    expect(copyText.geometry).toEqual(text.geometry);
    await s.select(copyText);
    expect((await s.selected()).id).toBe(copyText.id);
    await focus(s);
    await s.press('Enter');
    await writeText(s, 'Copy title');
    await s.check((updated) => {
      expect(byId(updated, text.id).text).toBe('Draft title');
      expect(byId(updated, copyText.id)).toMatchObject({ text: 'Copy title', parentId: copied.id });
      expect(byId(updated, copied.id).component).toBeUndefined();
    });
  }),

  program('FRAME-TITLE', 'Select, move, and rename a Frame from its title', async (s) => {
    const frame = await create(s, 'Frame', [40, 40], [260, 210], 'Card');
    const child = await create(s, 'Rectangle', [77, 90], [137, 125], 'Card child');
    expect(child.parentId).toBe(frame.id);
    const baseline = await s.obs();
    await tool(s, 'Move');
    await s.point(350, 250);
    expect((await s.obs()).selectionIds).toEqual([]);
    await s.point(55, 31);
    expect((await s.selected()).id).toBe(frame.id);
    await s.drag(55, 31, 75, 41);
    await s.check((snapshot) => {
      expect(byId(snapshot, frame.id).geometry).toEqual(box(60, 50, 220, 170));
      expect(world(snapshot, byId(snapshot, child.id))).toEqual(shifted(world(baseline, child), 20, 10));
    });
    await s.point(75, 41, { clickCount: 2 });
    const input = s.field('Layer name');
    await input.fill('Hero');
    await input.press('Enter');
    await expect(s.layer('Hero')).toBeVisible();
    await s.check((snapshot) => expect(byId(snapshot, frame.id).name).toBe('Hero'));
    await s.point(75, 41, { clickCount: 2 });
    await expect(input).toHaveValue('Hero');
    await input.press('Escape');
  }),
];
