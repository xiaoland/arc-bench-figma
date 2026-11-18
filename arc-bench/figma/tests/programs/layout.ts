import { expect, type Locator } from '@playwright/test';
import type { ObserveObject, ObserveSnapshot } from '../oracles.js';
import type { Program, Scenario } from '../scenario.js';

type Geometry = ObserveObject['geometry'];
type Axis = 'Horizontal' | 'Vertical';
type Flow = Axis | 'Grid' | 'Freeform';
const children = ['A', 'B', 'C', 'D'];

function program(requirement: string, name: string, run: Program['run']): Program {
  return { requirement, name, run };
}

function g(x: number, y: number, width: number, height: number): Geometry {
  return { x, y, width, height };
}

function visibleOptions(s: Scenario, name: string | RegExp, scope?: Locator): Locator {
  return s.role('option', name, scope).or(s.role('menuitem', name, scope)).filter({ visible: true });
}

function picker(s: Scenario, name: string | RegExp, scope?: Locator): Locator {
  return s.role('button', name, scope).or(s.role('combobox', name, scope)).filter({ visible: true });
}

async function choose(s: Scenario, name: string | RegExp, choice: string | RegExp, scope?: Locator) {
  await picker(s, name, scope).click();
  await visibleOptions(s, choice).click();
}

async function pickFlow(s: Scenario, flow: Flow) {
  // The accessible Flow control may expose the options individually or as a picker.
  const direct = s.button(flow).filter({ visible: true });
  const group = picker(s, /^(Layout direction|Flow)$/);
  await expect(direct.or(group).first()).toBeVisible();
  if (await direct.count()) await direct.click();
  else await choose(s, /^(Layout direction|Flow)$/, flow);
}

async function pickTextSize(s: Scenario, mode: 'Auto width' | 'Auto height' | 'Fixed size') {
  const direct = s.button(mode).filter({ visible: true });
  const group = picker(s, 'Text resizing');
  await expect(direct.or(group).first()).toBeVisible();
  if (await direct.count()) await direct.click();
  else await choose(s, 'Text resizing', mode);
}

async function multi(s: Scenario, names: string[]) {
  await s.select(names[0]!);
  for (const name of names.slice(1)) await s.layer(name).click({ modifiers: ['ControlOrMeta'] });
  await s.check(state => expect(new Set(state.selectionIds)).toEqual(new Set(names.map(name => s.lookup(state, name).id))));
}

async function draw(s: Scenario, type: 'Frame' | 'Rectangle', name: string, box: Geometry) {
  await s.button(type).click();
  await s.drag(box.x, box.y, box.x + box.width, box.y + box.height);
  await s.bindSelected(name);
}

async function frameWithChildren(s: Scenario, options: {
  name?: string; box?: Geometry; count?: number; childWidth?: number; childHeight?: number;
} = {}) {
  const { name = 'Container', box = g(40, 55, 300, 210), count = 2, childWidth = 40, childHeight = 40 } = options;
  await draw(s, 'Frame', name, box);
  const names = children.slice(0, count);
  for (const [index, child] of names.entries()) {
    const x = 10 + (index % 2) * (childWidth + 12);
    const y = 12 + Math.floor(index / 2) * (childHeight + 10);
    await draw(s, 'Rectangle', child, g(box.x + x, box.y + y, childWidth, childHeight));
  }
  await s.check(state => {
    for (const child of names) expect(s.lookup(state, child).parentId).toBe(s.lookup(state, name).id);
  });
  await s.select(name);
  return names;
}

async function padding(s: Scenario, x: number, y = x) {
  await s.set('Horizontal padding', String(x));
  await s.set('Vertical padding', String(y));
}

async function sizing(s: Scenario, axis: Axis, mode: 'Hug contents' | 'Fill container') {
  await choose(s, `${axis} sizing`, mode);
}

async function constraint(s: Scenario, axis: Axis, mode: string | RegExp) {
  if (!await picker(s, `${axis} constraint`).isVisible()) await s.button('Constraints').click();
  await choose(s, `${axis} constraint`, mode);
}

async function gapMenu(s: Scenario, value?: string) {
  const field = s.field('Gap');
  await field.hover();
  await picker(s, /^(Gap options|Gap menu)$/).click();
  if (value) await visibleOptions(s, value).click();
}

async function settings(s: Scenario) {
  await s.button('Auto layout settings').click();
  await expect(s.page.getByText('Auto layout settings', { exact: true })).toBeVisible();
}

async function closeSettings(s: Scenario) {
  await s.button(/^(Close|Close auto layout settings)$/).click();
}

async function automaticDistribution(s: Scenario, name: string) {
  await choose(s, 'Auto spacing', name);
}

async function createText(s: Scenario, name: string, value: string, x = 480, y = 120) {
  await s.button('Text').click();
  await s.point(x, y);
  await s.field('Text editor').fill(value);
  await s.press('Escape');
  await s.bindSelected(name);
}

async function selectTextRange(s: Scenario, start: number, end: number) {
  const editor = s.field('Text editor');
  if (!await editor.isVisible()) await s.press('Enter');
  await editor.press('ControlOrMeta+a');
  await editor.press('ArrowLeft');
  for (let index = 0; index < start; index++) await editor.press('ArrowRight');
  for (let index = start; index < end; index++) await editor.press('Shift+ArrowRight');
}

async function gridPicker(s: Scenario) {
  await picker(s, /^(Grid picker|Grid tracks|\d+\s*[×x]\s*(Auto|\d+))$/).click();
}

async function gridSettings(s: Scenario) {
  await gridPicker(s);
  await s.button(/^(Open grid settings|Grid settings)$/).click();
  await expect(s.page.getByText('Columns', { exact: true })).toBeVisible();
  await expect(s.page.getByText('Rows', { exact: true })).toBeVisible();
}

async function grid(s: Scenario, name: string, columns = 2) {
  await s.select(name);
  await pickFlow(s, 'Grid');
  await gridPicker(s);
  await s.set('Number of columns', String(columns));
  const rows = s.field('Number of rows');
  if (await rows.isEditable()) await s.set('Number of rows', 'Auto');
  if (await rows.isVisible()) await s.press('Escape');
}

function track(s: Scenario, index: number) {
  const name = new RegExp(`^Column(?: track)? ${index}$`, 'i');
  return s.role('row', name).or(s.role('group', name)).filter({ visible: true });
}

async function trackSize(s: Scenario, index: number, mode: 'Fixed' | 'Fill', value: number) {
  const row = track(s, index);
  const modeName = /^(Sizing|Track sizing|Fixed|Hug|Fill)$/;
  await choose(s, modeName, mode, row);
  const field = s.role('textbox', /^(Size|Width|Weight|fr|Column (width|weight))$/i, row)
    .or(s.role('spinbutton', /^(Size|Width|Weight|fr|Column (width|weight))$/i, row)).filter({ visible: true });
  await field.fill(String(value));
  await field.press('Enter');
}

async function geometry(s: Scenario, expected: Record<string, Geometry>) {
  await s.check(state => {
    for (const [name, box] of Object.entries(expected)) expect(s.lookup(state, name).geometry, name).toEqual(box);
  });
}

async function positions(s: Scenario, names: string[], x: number[], y?: number[]) {
  await s.check(state => {
    expect(names.map(name => s.lookup(state, name).geometry.x)).toEqual(x);
    if (y) expect(names.map(name => s.lookup(state, name).geometry.y)).toEqual(y);
  });
}

async function dimensions(s: Scenario, name: string, width: number, height?: number) {
  await s.check(state => {
    const box = s.lookup(state, name).geometry;
    expect(box.width).toBe(width);
    if (height !== undefined) expect(box.height).toBe(height);
  });
}

function relativeBox(s: Scenario, state: ObserveSnapshot, child: string, ancestor: string): Geometry {
  const object = s.lookup(state, child);
  const box = { ...object.geometry };
  const ancestorId = s.lookup(state, ancestor).id;
  let parent = object.parentId;
  while (parent !== ancestorId) {
    const container = state.objects.find(row => row.id === parent);
    if (!container) throw new Error(`${child} is outside ${ancestor}`);
    box.x += container.geometry.x;
    box.y += container.geometry.y;
    parent = container.parentId;
  }
  return box;
}

async function assertField(s: Scenario, name: string, value: string | RegExp) {
  await expect(s.field(name)).toHaveValue(value);
}

async function setDimensionLimit(s: Scenario, kind: 'Min' | 'Max', axis: 'width' | 'height', value: number) {
  const dimension = axis === 'width' ? 'Width' : 'Height';
  await choose(s, new RegExp(`^(${dimension} options|${axis === 'width' ? 'Horizontal' : 'Vertical'} sizing)$`, 'i'),
    new RegExp(`^(?:Add )?${kind}(imum)? ${axis}$`, 'i'));
  await s.set(`${kind} ${axis}`, String(value));
}

async function wrapControls(s: Scenario, counterGap: 'Between rows' | 'Between columns') {
  await expect(s.field(/^(Gap|Between objects)$/)).toBeVisible();
  await expect(s.field(counterGap)).toBeVisible();
}

async function selectScalePreset(s: Scenario, value: string) {
  await choose(s, /^(Scale presets|Scale options|Scale factor options)$/, value);
}

function scaleFactor(s: Scenario) {
  return s.field(/^(Scale factor|Scale)$/);
}

async function scaleText(s: Scenario, value: string) {
  const field = scaleFactor(s);
  await field.fill(value);
  await s.page.getByText('Scale', { exact: true }).filter({ visible: true }).click();
}

export const programs: Program[] = [
  program('FLOW-03', 'Move a child through Freeform and Auto Layout parents', async s => {
    const world = (state: ObserveSnapshot, object: ObserveObject): Geometry => {
      const box = { ...object.geometry };
      for (let parentId = object.parentId; parentId;) {
        const parent = state.objects.find(row => row.id === parentId);
        if (!parent) throw new Error('The moved child needs its observed ancestors');
        box.x += parent.geometry.x; box.y += parent.geometry.y;
        parentId = parent.parentId;
      }
      return box;
    };
    const screen = (state: ObserveSnapshot, x: number, y: number) => {
      const view = state.document.view;
      return { x: x * (view?.zoom ?? 1) + (view?.panX ?? 0),
        y: y * (view?.zoom ?? 1) + (view?.panY ?? 0) };
    };
    const create = async (tool: 'Frame' | 'Rectangle' | 'Section', name: string, box: Geometry) => {
      const state = await s.obs();
      const a = screen(state, box.x, box.y), b = screen(state, box.x + box.width, box.y + box.height);
      await s.button(tool).click();
      await s.drag(a.x, a.y, b.x, b.y);
      return s.bindSelected(name);
    };
    const layers = async (child: ObserveObject, parent: string) => {
      await s.select(child);
      await s.layer(child).dragTo(s.layer(parent), { targetPosition: { x: 55, y: 12 } });
    };
    const canvasTo = async (child: ObserveObject, x: number, y: number) => {
      await s.select(child); await s.button('Move').click();
      const state = await s.obs(), box = world(state, s.lookup(state, child));
      const from = screen(state, box.x + box.width / 2, box.y + box.height / 2);
      const to = screen(state, x, y);
      await s.drag(from.x, from.y, to.x, to.y);
    };
    const pixels = async (child: ObserveObject) => {
      const state = await s.obs(), box = world(state, s.lookup(state, child));
      const point = screen(state, box.x + box.width / 2, box.y + box.height / 2);
      await expect.poll(() => s.pixel(point.x, point.y)).toEqual([34, 170, 102, 255]);
    };
    const inspect = async (child: ObserveObject, parent: string | null, width: number,
      options: { flow?: boolean; ignore?: boolean; fill?: boolean; box?: Geometry } = {}) => {
      await s.check(state => {
        const object = s.lookup(state, child);
        expect(object).toMatchObject({ type: 'frame', parentId: parent === null ? null : s.lookup(state, parent).id,
          geometry: { width, height: 70 } });
        if (options.box) expect(object.geometry).toEqual(options.box);
        expect(object.layout?.ignore ?? false).toBe(options.ignore ?? false);
        if (options.fill) expect(object.layout?.width).toBe('fill');
        else if (object.layout?.width !== undefined) expect(object.layout.width).toBe('fixed');
        if (object.layout?.height !== undefined) expect(object.layout.height).toBe('fixed');
      });
      await expect(s.layer(child)).toHaveAttribute('aria-selected', 'true');
      await expect(s.field('Width')).toHaveValue(String(width));
      await expect(s.field('Height')).toHaveValue('70');
      if (options.flow || options.ignore) {
        await expect(s.role('checkbox', 'Ignore auto layout')).toBeChecked({ checked: options.ignore ?? false });
        if (options.flow) {
          await expect(s.field('X')).toBeDisabled();
          await expect(s.field('Y')).toBeDisabled();
        }
      }
      // An ignored child can remain outside a clipping Frame; its selected Layers
      // row, dimensions and Ignore control remain the visible mode oracle.
      if (!options.ignore) await pixels(child);
    };
    await s.button('Zoom options').click();
    await s.set('Zoom', '50');
    await create('Frame', 'Migration freeform', g(30, 50, 240, 200));
    await create('Frame', 'Migration horizontal', g(320, 50, 250, 160));
    await pickFlow(s, 'Horizontal');
    await padding(s, 10); await s.set('Gap', '10');
    await s.set('Width', '250'); await s.set('Height', '160');
    await create('Frame', 'Migration vertical', g(620, 50, 240, 220));
    await pickFlow(s, 'Vertical');
    await padding(s, 10); await s.set('Gap', '10');
    await s.set('Width', '240'); await s.set('Height', '220');
    await create('Section', 'Migration section', g(300, 340, 620, 220));
    let child = await create('Frame', 'Migration child', g(50, 70, 100, 70));
    await s.set('Fill', '22AA66');
    await s.check(state => {
      for (const [name, box] of [
        ['Migration freeform', g(30, 50, 240, 200)], ['Migration horizontal', g(320, 50, 250, 160)],
        ['Migration vertical', g(620, 50, 240, 220)], ['Migration section', g(300, 340, 620, 220)],
      ] as const) expect(s.lookup(state, name)).toMatchObject({ parentId: null, geometry: box });
      expect(s.lookup(state, 'Migration horizontal').layout?.direction).toBe('horizontal');
      expect(s.lookup(state, 'Migration vertical').layout?.direction).toBe('vertical');
      expect(s.lookup(state, child)).toMatchObject({
        parentId: s.lookup(state, 'Migration freeform').id, geometry: g(20, 20, 100, 70),
      });
    });
    await s.canvas().focus(); await s.press('Shift+1');
    await canvasTo(child, 380, 110);
    await inspect(child, 'Migration horizontal', 100, { flow: true, box: g(10, 10, 100, 70) });
    await s.capture('canvas-enters-horizontal-flow');
    await canvasTo(child, 100, 420);
    await inspect(child, null, 100, { box: g(50, 385, 100, 70) });
    await s.capture('canvas-exits-flow-at-the-release-position');
    await canvasTo(child, 380, 110);
    await inspect(child, 'Migration horizontal', 100, { flow: true, box: g(10, 10, 100, 70) });
    await layers(child, 'Migration vertical');
    await inspect(child, 'Migration vertical', 100, { flow: true, box: g(10, 10, 100, 70) });
    await s.capture('layers-enters-vertical-flow');
    const cutState = await s.obs();
    await s.canvas().focus(); await s.press('ControlOrMeta+x');
    await s.check(state => {
      expect(state.objects.some(object => object.id === child.id)).toBe(false);
      expect(state.objects.filter(object => object.parentId === s.lookup(state, 'Migration vertical').id)).toEqual([]);
    });
    await s.select('Migration freeform');
    await s.canvas().focus(); await s.press('ControlOrMeta+v');
    child = await s.bindSelected('Migration child');
    await inspect(child, 'Migration freeform', 100, { box: g(10, 10, 100, 70) });
    await s.check(state => {
      expect(state.objects).toHaveLength(cutState.objects.length);
      expect(state.objects.filter(object => object.parentId === s.lookup(state, 'Migration vertical').id)).toEqual([]);
    });
    await s.capture('cut-paste-restores-freeform-coordinates');

    await layers(child, 'Migration horizontal');
    await sizing(s, 'Horizontal', 'Fill container');
    await inspect(child, 'Migration horizontal', 230, { flow: true, fill: true, box: g(10, 10, 230, 70) });
    const sibling = await create('Rectangle', 'Migration flow sibling', g(630, 60, 60, 40));
    await s.set('Width', '60'); await s.set('Height', '40');
    await layers(child, 'Migration vertical');
    await inspect(child, 'Migration vertical', 220, { flow: true, fill: true });
    await s.check(state => {
      const object = s.lookup(state, child), other = s.lookup(state, sibling);
      expect(state.objects.filter(row => row.parentId === s.lookup(state, 'Migration vertical').id)
        .map(row => row.id).sort()).toEqual([object.id, other.id].sort());
      expect(object.geometry.x).toBe(10);
      expect(other).toMatchObject({ parentId: s.lookup(state, 'Migration vertical').id,
        geometry: { x: 10, width: 60, height: 40 } });
      const [first, second] = [object, other].sort((a, b) => a.geometry.y - b.geometry.y);
      expect(first!.geometry.y).toBe(10);
      expect(second!.geometry.y).toBe(first!.geometry.y + first!.geometry.height + 10);
    });
    await s.capture('fill-recalculates-in-the-destination-layout');
    const beforeFillExit = await s.obs(), resolved = world(beforeFillExit, s.lookup(beforeFillExit, child));
    await layers(child, 'Migration section');
    await inspect(child, 'Migration section', 220);
    await s.check(state => expect(world(state, s.lookup(state, child))).toEqual(resolved));
    await s.capture('fill-exits-to-section-as-fixed');
    await layers(child, 'Migration horizontal');
    await inspect(child, 'Migration horizontal', 220, { flow: true, box: g(10, 10, 220, 70) });
    await s.role('checkbox', 'Ignore auto layout').click();
    await s.set('X', '20'); await s.set('Y', '30');
    await layers(child, 'Migration vertical');
    await inspect(child, 'Migration vertical', 220, { ignore: true });
    await s.capture('layers-keeps-ignore-between-layouts');
    await s.set('X', '20'); await s.set('Y', '30');
    await canvasTo(child, 320 + 13 + 110, 50 + 17 + 35);
    await inspect(child, 'Migration horizontal', 220, { ignore: true, box: g(13, 17, 220, 70) });
    await s.capture('canvas-keeps-ignore-between-layouts');
    await s.canvas().focus(); await s.press('ControlOrMeta+c');
    await s.select('Migration vertical');
    await s.canvas().focus(); await s.press('ControlOrMeta+v');
    const ignoredCopy = await s.bindSelected('Ignored migration copy');
    expect(ignoredCopy.id).not.toBe(child.id);
    await inspect(ignoredCopy, 'Migration vertical', 220, { ignore: true });
    await s.capture('paste-keeps-ignore-between-layouts');
    const beforeIgnoreExit = await s.obs(), ignoredBox = world(beforeIgnoreExit, s.lookup(beforeIgnoreExit, child));
    await layers(child, 'Migration section');
    await inspect(child, 'Migration section', 220);
    await s.check(state => expect(world(state, s.lookup(state, child))).toEqual(ignoredBox));
    await layers(child, 'Migration horizontal');
    await inspect(child, 'Migration horizontal', 220, { flow: true, box: g(10, 10, 220, 70) });
    await s.check(state => {
      expect(s.lookup(state, ignoredCopy)).toMatchObject({ parentId: s.lookup(state, 'Migration vertical').id,
        layout: { ignore: true } });
      expect(state.objects.filter(row => row.parentId === s.lookup(state, 'Migration horizontal').id)
        .map(row => row.id)).toEqual([child.id]);
    });
    await s.capture('return-from-section-enters-flow');

    // Keep the incoming-flow UI oracle with this cross-entry programme. The
    // original LAY-06 declarative stages retain their published predicate identity.
    await s.select('Migration vertical');
    await sizing(s, 'Vertical', 'Hug contents');
    await s.check(state => expect(s.lookup(state, 'Migration vertical').geometry.height).toBe(60));
    await expect(s.field('Height')).toHaveValue('60');
    await s.select(child);
    await s.canvas().focus(); await s.press('ControlOrMeta+c');
    await s.select('Migration vertical');
    const beforeFlowPaste = await s.obs();
    await s.canvas().focus(); await s.press('ControlOrMeta+v');
    const incoming = await s.bindSelected('Incoming fixed flow copy');
    expect(incoming.id).not.toBe(child.id);
    await inspect(incoming, 'Migration vertical', 220, { flow: true, box: g(10, 60, 220, 70) });
    await s.check(state => {
      expect(state.objects).toHaveLength(beforeFlowPaste.objects.length + 1);
      expect(s.lookup(state, 'Migration vertical').geometry.height).toBe(140);
      expect(s.lookup(state, ignoredCopy)).toMatchObject({ parentId: s.lookup(state, 'Migration vertical').id,
        geometry: { width: 220, height: 70 }, layout: { ignore: true } });
      expect(s.lookup(state, child)).toMatchObject({ parentId: s.lookup(state, 'Migration horizontal').id,
        geometry: g(10, 10, 220, 70) });
    });
    await s.capture('fixed-paste-enters-flow-next-to-ignored-content');
    await s.select('Migration vertical');
    await expect(s.field('Height')).toHaveValue('140');
    await s.capture('hug-counts-incoming-flow-and-excludes-ignored-content');
  }),
  program('LAY-03', 'Redistribute Fill widths after Wrap changes', async s => {
    await frameWithChildren(s, { box: g(40, 55, 500, 275), childWidth: 100, childHeight: 100 });
    await pickFlow(s, 'Horizontal');
    await s.button('Wrap').click();
    await padding(s, 10);
    await s.set('Gap', '20');
    await s.set('Between rows', '20');
    await s.set('Width', '500');
    for (const name of ['A', 'B']) {
      await s.select(name);
      await sizing(s, 'Horizontal', 'Fill container');
      await setDimensionLimit(s, 'Min', 'width', 200);
    }
    await s.select('Container');
    await sizing(s, 'Vertical', 'Hug contents');
    await dimensions(s, 'Container', 500, 120);
    await geometry(s, { A: g(10, 10, 230, 100), B: g(260, 10, 230, 100) });
    const ids = await s.obs();
    await s.set('Width', '260');
    await dimensions(s, 'Container', 260, 240);
    await geometry(s, { A: g(10, 10, 240, 100), B: g(10, 130, 240, 100) });
    await s.set('Width', '500');
    await dimensions(s, 'Container', 500, 120);
    await geometry(s, { A: g(10, 10, 230, 100), B: g(260, 10, 230, 100) });
    await s.check(state => {
      for (const name of ['A', 'B']) {
        const before = s.lookup(ids, name);
        const after = s.lookup(state, name);
        expect([after.id, after.parentId, after.siblingIndex]).toEqual([before.id, before.parentId, before.siblingIndex]);
        expect(after.layout).toMatchObject({ width: 'fill', minWidth: 200 });
      }
    });
  }),
  program('LAY-01', 'Edit paired and independent padding', async s => {
    await frameWithChildren(s, { box: g(40, 55, 200, 130), count: 1 });
    await pickFlow(s, 'Vertical');
    await s.set('Width', '200');
    await padding(s, 0);
    await s.set('Gap', '0');
    await sizing(s, 'Vertical', 'Hug contents');
    await s.select('A');
    await sizing(s, 'Horizontal', 'Fill container');
    await s.select('Container');
    await padding(s, 20, 10);
    await geometry(s, { A: g(20, 10, 160, 40) });
    await dimensions(s, 'Container', 200, 60);
    const child = await s.object('A');
    await s.button('Individual padding').click();
    await s.set('Right padding', '30');
    await s.set('Bottom padding', '15');
    await geometry(s, { A: g(20, 10, 150, 40) });
    await dimensions(s, 'Container', 200, 65);
    await s.check(state => expect(s.lookup(state, 'A')).toMatchObject({ id: child.id, parentId: child.parentId }));
    await assertField(s, 'Left padding', '20');
    await assertField(s, 'Top padding', '10');
  }),
  program('LAY-04', 'Combine Scale and both-edge constraints', async s => {
    await draw(s, 'Frame', 'Container', g(40, 55, 200, 200));
    await draw(s, 'Rectangle', 'A', g(60, 85, 80, 40));
    await constraint(s, 'Horizontal', 'Scale');
    await constraint(s, 'Vertical', /^(Top and bottom|Top \+ Bottom)$/i);
    await s.select('Container');
    await s.set('Width', '400');
    await s.set('Height', '300');
    await geometry(s, { A: g(40, 30, 160, 140) });
    await s.set('Width', '200');
    await s.set('Height', '200');
    await geometry(s, { A: g(20, 30, 80, 40) });
    await s.check(state => expect(s.lookup(state, 'A').constraints).toMatchObject({ horizontal: 'scale', vertical: 'top-bottom' }));
  }),
  program('DESIGN-LAYOUT-PADDING', 'Expand and collapse independent padding', async s => {
    await s.select('Flow');
    await s.button('Individual padding').click();
    const [left, top, right, bottom] = await Promise.all(['Left', 'Top', 'Right', 'Bottom'].map(side => s.field(`${side} padding`).boundingBox()));
    if (!left || !top || !right || !bottom) throw new Error('Individual padding fields have no visible bounds');
    expect(left.x).toBeLessThan(top.x);
    expect(right.x).toBeLessThan(bottom.x);
    expect(Math.abs(left.y - top.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(right.y - bottom.y)).toBeLessThanOrEqual(1);
    expect(left.y).toBeLessThan(right.y);
    await s.set('Right padding', '30');
    await s.set('Bottom padding', '20');
    await s.button('Individual padding').click();
    await assertField(s, 'Horizontal padding', /^12,\s*30$/);
    await assertField(s, 'Vertical padding', /^12,\s*20$/);
    await s.button('Individual padding').click();
    for (const [side, value] of Object.entries({ Left: '12', Top: '12', Right: '30', Bottom: '20' })) await assertField(s, `${side} padding`, value);
  }),
  program('DESIGN-LAYOUT-SIZE', 'Show size controls for the selected layer', async s => {
    await draw(s, 'Rectangle', 'Shape', g(45, 60, 80, 45));
    await draw(s, 'Frame', 'Frame target', g(190, 60, 220, 140));
    await createText(s, 'Paragraph', 'A text box can wrap and resize. It keeps the text.');
    await s.select('Shape');
    await assertField(s, 'Width', '80');
    await assertField(s, 'Height', '45');
    await s.select('Frame target');
    await assertField(s, 'Width', '220');
    await assertField(s, 'Height', '140');
    for (const mode of ['Freeform', 'Vertical', 'Horizontal', 'Grid']) await expect(s.button(mode)).toBeVisible();
    await expect(s.button('Resize to fit')).toBeVisible();
    await expect(s.button(/^(Add auto layout|Auto layout toggle)$/i)).toBeVisible();
    await expect(s.role('checkbox', 'Clip content')).toBeChecked();
    await s.select('Paragraph');
    await pickTextSize(s, 'Auto height');
    await expect(s.field('Height')).not.toBeEditable();
    await pickTextSize(s, 'Fixed size');
    await s.set('Height', '120');
    await assertField(s, 'Height', '120');
    await s.check(state => expect(s.lookup(state, 'Paragraph').geometry.height).toBe(120));
    await s.select('Frame target');
    await assertField(s, 'Width', '220');
    await assertField(s, 'Height', '140');
    await expect(s.role('checkbox', 'Clip content')).toBeChecked();
  }),
  program('DESIGN-LAYOUT-SIZE', 'Keep size limits across selection changes', async s => {
    await frameWithChildren(s, { count: 1 });
    await pickFlow(s, 'Horizontal');
    await s.select('A');
    await sizing(s, 'Horizontal', 'Fill container');
    await s.set('Height', '40');
    await setDimensionLimit(s, 'Min', 'width', 120);
    await setDimensionLimit(s, 'Max', 'width', 240);
    await s.select('Container');
    await s.select('A');
    await expect(s.field('Min width')).toBeHidden();
    await expect(s.field('Max width')).toBeHidden();
    await s.button(/^(Width limits|Show width limits)$/i).click();
    await assertField(s, 'Min width', '120');
    await assertField(s, 'Max width', '240');
    await s.set('Width', '180');
    await choose(s, /^(Width options|Horizontal sizing)$/, 'Remove min and max');
    await dimensions(s, 'A', 180, 40);
    await assertField(s, 'Width', '180');
    await expect(s.field('Min width')).toBeHidden();
    await expect(s.field('Max width')).toBeHidden();
    await s.check(state => {
      const layout = s.lookup(state, 'A').layout;
      expect(layout?.width).toBe('fixed');
      expect(layout?.minWidth ?? null).toBeNull();
      expect(layout?.maxWidth ?? null).toBeNull();
    });
  }),
  program('DESIGN-LAYOUT-FLOW', 'Switch the complete Flow selector', async s => {
    await frameWithChildren(s);
    const checkChoices = async (choice: Flow) => {
      for (const mode of ['Freeform', 'Vertical', 'Horizontal', 'Grid']) await expect(s.button(mode)).toBeVisible();
      await expect.poll(async () => await s.button(choice).getAttribute('aria-pressed') ?? await s.button(choice).getAttribute('aria-checked')).toBe('true');
    };
    await checkChoices('Freeform');
    await pickFlow(s, 'Horizontal');
    await checkChoices('Horizontal');
    await s.button('Wrap').click();
    await wrapControls(s, 'Between rows');
    await pickFlow(s, 'Vertical');
    await checkChoices('Vertical');
    await expect(s.button('Wrap')).toBeVisible();
    await pickFlow(s, 'Grid');
    await checkChoices('Grid');
    await expect(s.button('Toggle automatic positioning')).toBeVisible();
    await gridPicker(s);
    await expect(s.field('Number of columns')).toBeVisible();
    await expect(s.field('Number of rows')).toBeVisible();
    await s.press('Escape');
    await pickFlow(s, 'Freeform');
    await checkChoices('Freeform');
    await expect(s.page.getByText('Layout', { exact: true })).toBeVisible();
    await expect(s.button('Resize to fit')).toBeVisible();
    await expect(s.role('checkbox', 'Clip content')).toBeVisible();
  }),
  program('DESIGN-LAYOUT-TEXT', 'Show all three text resizing states', async s => {
    await createText(s, 'Paragraph', 'This text is wide. Reducing the width makes the words wrap.');
    await pickTextSize(s, 'Auto width');
    await expect(s.field('Width')).not.toBeEditable();
    await expect(s.field('Height')).not.toBeEditable();
    const before = await s.object('Paragraph');
    expect(before.geometry.width).toBeGreaterThan(110);
    await pickTextSize(s, 'Auto height');
    await expect(s.field('Width')).toBeEditable();
    await expect(s.field('Height')).not.toBeEditable();
    await s.set('Width', '110');
    await s.check(state => {
      const object = s.lookup(state, 'Paragraph');
      expect(object.textSizing).toBe('auto-height');
      expect(object.geometry.width).toBe(110);
      expect(object.geometry.height).toBeGreaterThan(before.geometry.height);
    });
    await pickTextSize(s, 'Fixed size');
    await expect(s.field('Width')).toBeEditable();
    await expect(s.field('Height')).toBeEditable();
    await s.set('Height', '120');
    await s.check(state => expect(s.lookup(state, 'Paragraph')).toMatchObject({ textSizing: 'fixed', geometry: { width: 110, height: 120 } }));
  }),
  program('DESIGN-LAYOUT-AUTO', 'Show separate Wrap and spacing controls', async s => {
    await frameWithChildren(s, { count: 3 });
    await pickFlow(s, 'Horizontal');
    await s.set('Gap', '12');
    await s.button('Wrap').click();
    await wrapControls(s, 'Between rows');
    await pickFlow(s, 'Vertical');
    await wrapControls(s, 'Between columns');
    await s.button('Wrap').click();
    await expect(s.field('Between columns')).toBeHidden();
    await gapMenu(s, 'Auto');
    await assertField(s, 'Gap', 'Auto');
    const alignment = s.role('group', 'Layout alignment').or(s.role('region', 'Layout alignment')).filter({ visible: true });
    for (const label of ['Left', 'Center', 'Right']) await expect(s.role('button', label, alignment)).toBeEnabled();
    for (const label of ['Top left', 'Bottom right']) await expect(s.role('button', label, alignment)).toBeHidden();
  }),
  program('DESIGN-LAYOUT-GRID', 'Edit tracks and return to a Grid child', async s => {
    await frameWithChildren(s);
    await grid(s, 'Container');
    await gridSettings(s);
    await trackSize(s, 1, 'Fixed', 80);
    await trackSize(s, 2, 'Fill', 2);
    await s.button(/^(Close|Close grid settings)$/).click();
    await s.select('A');
    for (const name of ['Width', 'Height', 'Column span', 'Row span']) await expect(s.field(name)).toBeVisible();
    await s.select('Container');
    await gridSettings(s);
    await expect(track(s, 1)).toContainText('Fixed');
    await expect(track(s, 2)).toContainText('Fill');
    await expect(s.role('textbox', /^(Size|Width|Column width)$/i, track(s, 1))).toHaveValue('80');
    await expect(s.role('textbox', /^(Weight|fr|Column weight)$/i, track(s, 2))).toHaveValue(/^2(?:fr)?$/);
  }),
  program('DESIGN-LAYOUT-SETTINGS', 'Change Auto spacing through settings', async s => {
    const names = await frameWithChildren(s, { count: 3 });
    await pickFlow(s, 'Horizontal');
    await s.set('Width', '300');
    await padding(s, 0);
    await gapMenu(s, 'Auto');
    await settings(s);
    await automaticDistribution(s, 'Evenly');
    await positions(s, names, [45, 130, 215]);
    await automaticDistribution(s, 'Around');
    await positions(s, names, [30, 130, 230]);
    await closeSettings(s);
    await settings(s);
    await expect(picker(s, 'Auto spacing')).toContainText('Around');
    await s.check(state => expect(state.selectionIds).toEqual([s.lookup(state, 'Container').id]));
  }),
  program('LAY-07', 'Convert containers and return to Freeform', async s => {
    const names = await frameWithChildren(s, { name: 'Original Frame', box: g(40, 55, 300, 185) });
    const original = await s.object('Original Frame');
    await draw(s, 'Rectangle', 'Group A', g(415, 55, 40, 40));
    await draw(s, 'Rectangle', 'Group B', g(475, 60, 40, 40));
    await multi(s, ['Group A', 'Group B']);
    await s.press('ControlOrMeta+g');
    await s.bindSelected('Former Group');
    const grouped = await s.obs();
    expect(s.lookup(grouped, 'Former Group').type).toBe('group');
    await pickFlow(s, 'Horizontal');
    await s.check(state => {
      const container = s.lookup(state, 'Former Group');
      expect(container.type).toBe('frame');
      for (const name of ['Group A', 'Group B']) {
        expect(s.lookup(state, name)).toMatchObject({ id: s.lookup(grouped, name).id, parentId: container.id });
      }
      expect(s.lookup(state, 'Group B').geometry.x).toBeGreaterThan(s.lookup(state, 'Group A').geometry.x);
    });
    await s.select('Original Frame');
    await pickFlow(s, 'Horizontal');
    await s.check(state => expect(s.lookup(state, 'Original Frame').layout?.direction).toBe('horizontal'));
    await grid(s, 'Original Frame');
    const gridState = await s.obs();
    await pickFlow(s, 'Freeform');
    await s.check(state => {
      expect(s.lookup(state, 'Original Frame').id).toBe(original.id);
      for (const name of names) expect(s.lookup(state, name)).toMatchObject({
        parentId: original.id, geometry: s.lookup(gridState, name).geometry,
      });
    });
    await expect(s.page.getByText('Layout', { exact: true })).toBeVisible();
  }),
  program('LAY-ALIGN', 'Compare automatic spacing distributions', async s => {
    const names = await frameWithChildren(s, { count: 3 });
    await pickFlow(s, 'Horizontal');
    await s.set('Width', '300');
    await padding(s, 0);
    await gapMenu(s, 'Auto');
    const before = await s.obs();
    await settings(s);
    for (const [mode, xs] of [['Between', [0, 130, 260]], ['Evenly', [45, 130, 215]], ['Around', [30, 130, 230]]] as const) {
      await automaticDistribution(s, mode);
      await positions(s, names, [...xs]);
      await s.check(state => {
        for (const name of names) expect(s.lookup(state, name)).toMatchObject({
          geometry: { width: 40 }, siblingIndex: s.lookup(before, name).siblingIndex,
        });
      });
    }
  }),
  program('LAY-ALIGN', 'Change stacking without reordering', async s => {
    const names = await frameWithChildren(s, { count: 3 });
    for (const [index, name] of names.entries()) {
      await s.select(name);
      await s.set('Fill', ['FF0000', '00FF00', '0000FF'][index]!);
    }
    await s.select('Container');
    await pickFlow(s, 'Horizontal');
    await padding(s, 0);
    await s.set('Gap', '-30');
    const before = await s.obs();
    const parent = s.lookup(before, 'Container').geometry;
    const objects = names.map(name => s.lookup(before, name));
    const overlap = [
      Math.ceil(parent.x + Math.max(...objects.map(object => object.geometry.x)) + 6),
      Math.ceil(parent.y + Math.max(...objects.map(object => object.geometry.y)) + 10),
    ] as const;
    for (const [order, rgb] of [['First on top', [255, 0, 0]], ['Last on top', [0, 0, 255]]] as const) {
      await settings(s);
      await choose(s, 'Canvas stacking', order);
      await closeSettings(s);
      await expect.poll(async () => (await s.pixel(...overlap)).slice(0, 3)).toEqual(rgb);
      await s.check(state => {
        for (const object of objects) {
          expect(s.lookup(state, object)).toMatchObject({ siblingIndex: object.siblingIndex, geometry: object.geometry });
        }
      });
    }
  }),
  program('LAY-03', 'Wrap a vertical list into columns', async s => {
    const names = await frameWithChildren(s, { count: 3, box: g(40, 55, 300, 120) });
    await pickFlow(s, 'Vertical');
    await s.set('Height', '120');
    await padding(s, 10);
    await s.set('Gap', '10');
    await s.button('Wrap').click();
    await s.set('Between columns', '20');
    await sizing(s, 'Horizontal', 'Hug contents');
    await dimensions(s, 'Container', 120, 120);
    await geometry(s, { A: g(10, 10, 40, 40), B: g(10, 60, 40, 40), C: g(70, 10, 40, 40) });
    const before = await s.obs();
    await s.set('Height', '70');
    await dimensions(s, 'Container', 180, 70);
    await geometry(s, { A: g(10, 10, 40, 40), B: g(70, 10, 40, 40), C: g(130, 10, 40, 40) });
    await s.check(state => {
      for (const name of names) expect(s.lookup(state, name)).toMatchObject({ id: s.lookup(before, name).id, siblingIndex: s.lookup(before, name).siblingIndex });
    });
  }),
  program('LAY-GRID-TRACKS', 'Resize weighted tracks', async s => {
    await frameWithChildren(s, { box: g(40, 55, 340, 100) });
    await grid(s, 'Container');
    await s.set('Width', '340');
    await s.set('Height', '100');
    await padding(s, 10);
    await s.set('Column gap', '20');
    await gridSettings(s);
    await trackSize(s, 1, 'Fill', 1);
    await trackSize(s, 2, 'Fill', 2);
    await s.button(/^(Close|Close grid settings)$/).click();
    for (const child of ['A', 'B']) {
      await s.select(child);
      await sizing(s, 'Horizontal', 'Fill container');
    }
    await dimensions(s, 'A', 100);
    await dimensions(s, 'B', 200);
    await positions(s, ['A', 'B'], [10, 130], [10, 10]);
    await s.select('Container');
    await s.set('Width', '460');
    await dimensions(s, 'A', 140);
    await dimensions(s, 'B', 280);
    await positions(s, ['A', 'B'], [10, 170], [10, 10]);
    await gridPicker(s);
    await assertField(s, 'Number of columns', '2');
  }),
  program('LAY-GRID-TRACKS', 'Distinguish track deletion from count reduction', async s => {
    await frameWithChildren(s, { box: g(40, 75, 300, 170) });
    await grid(s, 'Container');
    await s.set('Width', '300');
    await padding(s, 0);
    await s.set('Column gap', '0');
    await gridSettings(s);
    await trackSize(s, 1, 'Fill', 1);
    await trackSize(s, 2, 'Fill', 1);
    await s.button(/^(Close|Close grid settings)$/).click();
    const before = await s.obs();
    expect(s.lookup(before, 'B').geometry.x).toBeGreaterThan(s.lookup(before, 'A').geometry.x);
    await gridPicker(s);
    await s.set('Number of columns', '1');
    await s.press('Escape');
    await s.check(state => {
      const a = s.lookup(state, 'A');
      const b = s.lookup(state, 'B');
      expect([a.id, b.id]).toEqual(['A', 'B'].map(name => s.lookup(before, name).id));
      expect(b.geometry.x).toBe(a.geometry.x);
      expect(b.geometry.y).toBeGreaterThan(a.geometry.y);
    });
    await s.press('ControlOrMeta+z');
    const initial = Object.fromEntries(['A', 'B'].map(name => [name, s.lookup(before, name).geometry]));
    await geometry(s, initial);
    await s.select('Container');
    const parent = s.lookup(before, 'Container').geometry;
    const trackLabel = { x: parent.x + 225, y: parent.y - 8 };
    await s.canvas().hover({ position: trackLabel });
    await s.point(trackLabel.x, trackLabel.y);
    await s.press('Delete');
    await s.check(state => {
      expect(state.objects.some(object => object.id === s.lookup(before, 'B').id)).toBe(false);
      expect(s.lookup(state, 'A').parentId).toBe(s.lookup(state, 'Container').id);
    });
    await s.press('ControlOrMeta+z');
    await geometry(s, initial);
    await s.check(state => expect(s.lookup(state, 'B').id).toBe(s.lookup(before, 'B').id));
    await gridPicker(s);
    await assertField(s, 'Number of columns', '2');
  }),
  program('LAY-GRID-CELLS', 'Preserve empty cells or compact the grid', async s => {
    await frameWithChildren(s, { count: 4, box: g(40, 55, 300, 210) });
    await grid(s, 'Container');
    const toggle = s.button('Toggle automatic positioning');
    const enabled = async () => await toggle.getAttribute('aria-pressed') ?? await toggle.getAttribute('aria-checked');
    if (await enabled() === 'true') await toggle.click();
    await expect.poll(enabled).toBe('false');
    const before = await s.obs();
    const b = s.lookup(before, 'B');
    const c = s.lookup(before, 'C');
    expect(b.geometry.x).toBeGreaterThan(s.lookup(before, 'A').geometry.x);
    expect(c.geometry.y).toBeGreaterThan(b.geometry.y);
    await s.select('B');
    await s.press('Delete');
    await s.check(state => {
      expect(state.objects.some(object => object.id === b.id)).toBe(false);
      expect(s.lookup(state, 'C').geometry).toEqual(c.geometry);
      expect(s.lookup(state, 'D').geometry).toEqual(s.lookup(before, 'D').geometry);
    });
    await s.select('Container');
    await toggle.click();
    await s.check(state => {
      expect(s.lookup(state, 'C')).toMatchObject({ id: c.id, geometry: { x: b.geometry.x, y: b.geometry.y } });
      expect(s.lookup(state, 'D')).toMatchObject({ id: s.lookup(before, 'D').id, geometry: { x: c.geometry.x, y: c.geometry.y } });
    });
    await gridPicker(s);
    await assertField(s, 'Number of rows', /^Auto$/i);
  }),
  program('LAY-GRID-CELLS', 'Span a nested layout across columns', async s => {
    await draw(s, 'Frame', 'Container', g(40, 55, 340, 200));
    await draw(s, 'Frame', 'Nested', g(50, 70, 140, 110));
    await draw(s, 'Rectangle', 'Inner', g(62, 85, 50, 30));
    await draw(s, 'Rectangle', 'B', g(225, 75, 40, 40));
    await s.select('Nested');
    await pickFlow(s, 'Vertical');
    await padding(s, 10);
    await s.select('Inner');
    await sizing(s, 'Horizontal', 'Fill container');
    await grid(s, 'Container');
    await s.set('Width', '340');
    await padding(s, 10);
    await s.set('Column gap', '20');
    await gridSettings(s);
    await trackSize(s, 1, 'Fill', 1);
    await trackSize(s, 2, 'Fill', 1);
    await s.button(/^(Close|Close grid settings)$/).click();
    await s.select('Nested');
    await sizing(s, 'Horizontal', 'Fill container');
    await s.set('Column span', '2');
    await dimensions(s, 'Nested', 320);
    await dimensions(s, 'Inner', 300);
    await s.select('Container');
    await s.set('Width', '440');
    await dimensions(s, 'Nested', 420);
    await dimensions(s, 'Inner', 400);
    await s.check(state => {
      expect(s.lookup(state, 'Nested').layout?.direction).toBe('vertical');
      expect(s.lookup(state, 'Inner').parentId).toBe(s.lookup(state, 'Nested').id);
      expect(s.lookup(state, 'Inner').geometry.x).toBe(10);
    });
  }),
  program('LAY-DIRECT', 'Edit opposite padding on the canvas', async s => {
    await frameWithChildren(s, { box: g(40, 60, 300, 210) });
    await pickFlow(s, 'Vertical');
    await padding(s, 10);
    const parent = (await s.object('Container')).geometry;
    await s.point(parent.x + parent.width / 2, parent.y + 5, { modifiers: ['Alt'] });
    await s.press('ControlOrMeta+a');
    await s.page.keyboard.insertText('20');
    await s.press('Enter');
    await assertField(s, 'Horizontal padding', '10');
    await assertField(s, 'Vertical padding', '20');
    await positions(s, ['A'], [10], [20]);
    await s.point(parent.x + parent.width / 2, parent.y + 5, { modifiers: ['Alt', 'Shift'] });
    await s.press('ControlOrMeta+a');
    await s.page.keyboard.insertText('12');
    await s.press('Enter');
    await assertField(s, 'Horizontal padding', '12');
    await assertField(s, 'Vertical padding', '12');
    await positions(s, ['A'], [12], [12]);
  }),
  program('DESIGN-LAYOUT-SPACING', 'Edit spacing without enabling Auto Layout', async s => {
    for (const [index, name] of ['A', 'B', 'C'].entries()) await draw(s, 'Rectangle', name, g(45 + 90 * index, 60, 40, 40));
    await multi(s, ['A', 'B', 'C']);
    await s.set('Horizontal spacing', '20');
    await assertField(s, 'Horizontal spacing', '20');
    await s.check(state => {
      const row = ['A', 'B', 'C'].map(name => s.lookup(state, name));
      for (const child of row) expect(child).toMatchObject({ parentId: null, geometry: { y: 60, width: 40, height: 40 } });
      expect(row[1]!.geometry.x - row[0]!.geometry.x).toBe(60);
      expect(row[2]!.geometry.x - row[1]!.geometry.x).toBe(60);
    });
  }),
  program('LAY-SMART', 'Rearrange freely positioned objects', async s => {
    const names = ['A', 'B', 'C'];
    for (const [index, name] of names.entries()) await draw(s, 'Rectangle', name, g(50 + 60 * index, 60, 40, 40));
    await multi(s, names);
    const before = await s.obs();
    await s.point(190, 80);
    await s.drag(190, 80, 44, 80);
    await positions(s, ['C', 'A', 'B'], [50, 110, 170]);
    await s.point(70, 80);
    await s.press('Delete');
    await s.check(state => {
      expect(state.objects.some(object => object.id === s.lookup(before, 'C').id)).toBe(false);
      expect(['A', 'B'].map(name => s.lookup(state, name).geometry.x)).toEqual([50, 110]);
    });
    await s.press('ControlOrMeta+z');
    await positions(s, ['C', 'A', 'B'], [50, 110, 170]);
    await s.check(state => {
      for (const name of names) expect(s.lookup(state, name)).toMatchObject({ id: s.lookup(before, name).id, parentId: null });
    });
  }),
  program('EDITOR-FIELD-NUMBER', 'Type and nudge a Layout value', async s => {
    await s.select('Flow');
    await pickFlow(s, 'Horizontal');
    await s.set('Width', '240');
    await s.set('Gap', '12');
    const gap = s.field('Gap');
    const appliedGap = (state: ObserveSnapshot) => {
      const left = s.lookup(state, 'Flow A').geometry;
      return s.lookup(state, 'Flow B').geometry.x - left.x - left.width;
    };
    await s.check(state => expect(appliedGap(state)).toBe(12));
    await gap.fill('24');
    await assertField(s, 'Gap', '24');
    await s.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(appliedGap(await s.obs())).toBe(12);
    await gap.press('Escape');
    await s.check(state => expect(appliedGap(state)).toBe(24));
    await gap.click();
    await gap.press('ArrowUp');
    await assertField(s, 'Gap', '25');
    await s.check(state => expect(appliedGap(state)).toBe(25));
    await gap.press('Shift+ArrowUp');
    await assertField(s, 'Gap', '35');
    await s.check(state => expect(appliedGap(state)).toBe(35));
    await gap.press('Tab');
    await expect(gap).not.toBeFocused();
    await expect(s.role('textbox', /.+/).and(s.page.locator(':focus'))).toHaveCount(1);
  }),
  program('EDITOR-FIELD-NUMBER', 'Commit a numeric draft before changing selection', async s => {
    await draw(s, 'Frame', 'Draft frame A', g(50, 70, 100, 80));
    await s.set('Fill', '2255AA');
    await draw(s, 'Rectangle', 'Draft rectangle B', g(350, 70, 41, 80));
    await s.set('Fill', 'DD6622');
    const original = await s.obs();
    const a = s.lookup(original, 'Draft frame A'), b = s.lookup(original, 'Draft rectangle B');
    expect(a.parentId).toBeNull(); expect(b.parentId).toBeNull();
    const width = s.field('Width');
    const inspect = async (aWidth: number, selected: ObserveObject) => {
      await s.check(state => {
        expect(state.objects.map(object => object.id).sort()).toEqual(original.objects.map(object => object.id).sort());
        expect(s.lookup(state, a)).toMatchObject({ type: 'frame', parentId: null,
          geometry: g(50, 70, aWidth, 80), fill: { color: '2255AA' } });
        expect(s.lookup(state, b)).toMatchObject({ type: 'rectangle', parentId: null,
          geometry: g(350, 70, 41, 80), fill: { color: 'DD6622' } });
        expect(state.selectionIds).toEqual([selected.id]);
      });
      await expect(s.layer(selected)).toHaveAttribute('aria-selected', 'true');
    };
    await s.select(a);
    await expect(width).toHaveValue('100');
    const outside = await s.pixel(220, 110);
    await width.fill('200');
    await expect(width).toBeFocused();
    await expect(width).toHaveValue('200');
    await inspect(100, a);
    await expect.poll(() => s.pixel(220, 110)).toEqual(outside);
    await s.capture('numeric-draft-keeps-the-applied-width');
    // The click itself must finish A's draft before B becomes the property target.
    await s.layer(b).click();
    await inspect(200, b);
    await expect(width).toHaveValue('41');
    await expect.poll(() => s.pixel(220, 110)).toEqual([34, 85, 170, 255]);
    await expect.poll(() => s.pixel(370, 110)).toEqual([221, 102, 34, 255]);
    await s.capture('numeric-draft-commits-to-the-old-target');
    await s.layer(a).click();
    await expect(width).toHaveValue('200');
    await width.click();
    await expect(width).toBeFocused();
    await s.press('ControlOrMeta+a');
    await width.pressSequentially('abc');
    await inspect(200, a);
    // Some numeric inputs filter letters; the oracle concerns the applied result.
    await s.layer(b).click();
    await inspect(200, b);
    await expect(width).toHaveValue('41');
    await expect.poll(() => s.pixel(220, 110)).toEqual([34, 85, 170, 255]);
    await expect.poll(() => s.pixel(370, 110)).toEqual([221, 102, 34, 255]);
    await s.layer(a).click();
    await expect(width).toHaveValue('200');
    await s.layer(b).click();
    await expect(width).toHaveValue('41');
    await inspect(200, b);
    await s.capture('invalid-numeric-draft-keeps-both-applied-values');
  }),
  program('EDITOR-FIELD-NUMBER', 'Scrub a numeric property', async s => {
    await draw(s, 'Frame', 'Scrub frame', g(50, 80, 200, 150));
    const prefix = s.page.getByText('W', { exact: true });
    await expect(prefix).toBeVisible();
    const box = await prefix.boundingBox();
    if (!box) throw new Error('Width prefix has no visible bounds');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const { mouse } = s.page;
    await mouse.move(x, y);
    await mouse.down();
    let finalWidth: number;
    try {
      await mouse.move(x + 30, y, { steps: 8 });
      await s.check(state => expect(s.lookup(state, 'Scrub frame').geometry.width).toBeGreaterThan(200));
      const increased = (await s.object('Scrub frame')).geometry.width;
      await assertField(s, 'Width', String(increased));
      await mouse.move(x + 10, y, { steps: 8 });
      await s.check(state => expect(s.lookup(state, 'Scrub frame').geometry.width).toBeLessThan(increased));
      finalWidth = (await s.object('Scrub frame')).geometry.width;
      await assertField(s, 'Width', String(finalWidth));
    } finally {
      await mouse.up();
    }
    await geometry(s, { 'Scrub frame': g(50, 80, finalWidth, 150) });
  }),
  program('EDITOR-FIELD-CHOICE', 'Choose and dismiss a field option', async s => {
    await s.select('Flow');
    await pickFlow(s, 'Horizontal');
    await s.set('Width', '240');
    await padding(s, 12);
    await s.set('Gap', '12');
    await gapMenu(s);
    await expect(visibleOptions(s, 'Auto')).toBeVisible();
    await s.press('Escape');
    await expect(visibleOptions(s, 'Auto')).toBeHidden();
    await assertField(s, 'Gap', '12');
    await positions(s, ['Flow A', 'Flow B'], [12, 94]);
    await gapMenu(s, 'Auto');
    await expect(visibleOptions(s, 'Auto')).toBeHidden();
    await assertField(s, 'Gap', 'Auto');
    await positions(s, ['Flow A', 'Flow B'], [12, 158]);
  }),
  program('DESIGN-POSITION-VALUES', 'Edit a position through its field', async s => {
    await s.select('Paint');
    const original = await s.object('Paint');
    await s.set('X', '40');
    await assertField(s, 'X', '40');
    await assertField(s, 'Y', String(original.geometry.y));
    await assertField(s, 'Width', String(original.geometry.width));
    await assertField(s, 'Height', String(original.geometry.height));
    await geometry(s, { Paint: { ...original.geometry, x: 40 } });
    await s.point(10, 35);
    await s.check(state => expect(s.lookup(state, 'Paint').selected).toBe(false));
    await s.point(180, 35);
    await s.check(state => expect(s.lookup(state, 'Paint').selected).toBe(true));
    await expect(s.layer('Paint')).toHaveAttribute('aria-selected', 'true');
  }),
  program('DESIGN-CONSTRAINTS', 'Choose separate horizontal and vertical Constraints', async s => {
    await draw(s, 'Frame', 'Parent', g(55, 140, 200, 180));
    await draw(s, 'Rectangle', 'Child', g(75, 170, 80, 40));
    await constraint(s, 'Horizontal', 'Right');
    await constraint(s, 'Vertical', 'Center');
    await s.select('Parent');
    await s.select('Child');
    await expect(picker(s, 'Horizontal constraint')).toContainText('Right');
    await expect(picker(s, 'Vertical constraint')).toContainText('Center');
    await s.select('Parent');
    await s.set('Width', '300');
    await s.set('Height', '220');
    await geometry(s, { Child: g(120, 50, 80, 40) });
    await s.check(state => {
      expect(s.lookup(state, 'Child').constraints).toEqual({ horizontal: 'right', vertical: 'center' });
      expect(s.lookup(state, 'Child').parentId).toBe(s.lookup(state, 'Parent').id);
    });
  }),
  program('DESIGN-TYPOGRAPHY-VALUES', 'Inspect formatting for a character range', async s => {
    await s.select('Paragraph');
    await s.press('Enter');
    await s.field('Text editor').fill('abcdef');
    await selectTextRange(s, 2, 4);
    await choose(s, 'Font style', 'Bold');
    for (const [from, to, style] of [[0, 2, 'Regular'], [2, 4, 'Bold'], [0, 4, 'Mixed']] as const) {
      await selectTextRange(s, from, to);
      await expect(picker(s, 'Font style')).toContainText(style);
      await expect(picker(s, 'Font family')).toContainText('Inter');
      await assertField(s, 'Font size', '12');
    }
    await choose(s, 'Font style', 'Regular');
    await s.press('Escape');
    await s.check(state => {
      const text = s.lookup(state, 'Paragraph');
      expect(text.text).toBe('abcdef');
      for (let index = 0; index < 4; index++) {
        const run = text.textRuns?.find(value => value.start <= index && index < value.end) as
          | { fontStyle?: string; font?: { style?: string } } | undefined;
        expect(run?.fontStyle ?? run?.font?.style ?? text.font?.style).toBe('Regular');
      }
    });
  }),
  program('DESIGN-TYPOGRAPHY-VALUES', 'Cancel a font preview when selecting another text layer', async s => {
    await s.select('Paragraph');
    await s.set('X', '60');
    await s.set('Y', '80');
    await createText(s, 'Other paragraph', 'A second text target', 60, 200);
    const initial = await s.obs();
    const a = s.lookup(initial, 'Paragraph'), b = s.lookup(initial, 'Other paragraph');
    const inspect = async (family: string, selected: ObserveObject) => {
      await s.check(state => {
        expect(state.objects.map(object => object.id).sort()).toEqual(initial.objects.map(object => object.id).sort());
        expect(state.selectionIds).toEqual([selected.id]);
        for (const [target, expectedFamily] of [[a, family], [b, 'Inter']] as const) {
          expect(s.lookup(state, target)).toMatchObject({ type: 'text', parentId: target.parentId,
            text: target.text, font: { family: expectedFamily, style: 'Regular', size: 12 } });
        }
      });
      await expect(s.layer(selected)).toHaveAttribute('aria-selected', 'true');
      await expect(picker(s, 'Font family')).toContainText(selected.id === a.id ? family : 'Inter');
      await expect(picker(s, 'Font style')).toContainText('Regular');
      await assertField(s, 'Font size', '12');
    };
    await inspect('Inter', b);
    // Read only screenshot pixels inside A's first line, excluding selection borders.
    // A preview may live outside the committed document observed by arcBench.
    const view = initial.document.view;
    const zoom = view?.zoom ?? 1;
    const region = { x: Math.round((a.geometry.x + 6) * zoom + (view?.panX ?? 0)),
      y: Math.round((a.geometry.y + 5) * zoom + (view?.panY ?? 0)),
      width: Math.round(160 * zoom), height: Math.round(8 * zoom) };
    const glyphPixels = async () => {
      const png = await s.canvas().screenshot({ scale: 'css' });
      return s.page.evaluate(async ({ png, region }) => {
        const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: 'image/png' }));
        try {
          if (region.x < 0 || region.y < 0 || region.x + region.width > image.width || region.y + region.height > image.height)
            throw new Error('Font preview sample lies outside the canvas viewport');
          const context = new OffscreenCanvas(region.width, region.height).getContext('2d')!;
          context.drawImage(image, -region.x, -region.y);
          return Array.from(context.getImageData(0, 0, region.width, region.height).data);
        } finally { image.close(); }
      }, { png: png.toString('base64'), region });
    };
    const appliedPixels = await glyphPixels();
    const search = s.field('Search fonts');
    for (const entry of ['hover', 'search'] as const) {
      await s.layer(a).click();
      await inspect('Inter', a);
      await expect.poll(glyphPixels).toEqual(appliedPixels);
      await picker(s, 'Font family').click();
      await expect(search).toBeVisible();
      if (entry === 'search') await search.fill('Noto Sans');
      else await visibleOptions(s, 'Noto Sans').hover();
      await expect(search).toBeVisible();
      await expect.poll(glyphPixels).not.toEqual(appliedPixels);
      await s.capture(`font-${entry}-previews-the-opening-target`);
      // This click is the dismissal trigger: no Escape or canvas focus repair.
      await s.layer(b).click();
      await expect(search).toBeHidden();
      await inspect('Inter', b);
      await expect.poll(glyphPixels).toEqual(appliedPixels);
      await s.layer(a).click();
      await inspect('Inter', a);
      await expect.poll(glyphPixels).toEqual(appliedPixels);
      await s.capture(`font-${entry}-cancels-on-selection-change`);
    }
    await picker(s, 'Font family').click();
    await visibleOptions(s, 'Noto Sans').click();
    await expect(search).toBeHidden();
    await inspect('Noto Sans', a);
    await expect.poll(glyphPixels).not.toEqual(appliedPixels);
    await s.layer(b).click();
    await inspect('Noto Sans', b);
    await expect.poll(glyphPixels).not.toEqual(appliedPixels);
    await s.layer(a).click();
    await inspect('Noto Sans', a);
    await expect.poll(glyphPixels).not.toEqual(appliedPixels);
    await s.capture('confirmed-font-survives-selection-change');
  }),
  program('DESIGN-TYPOGRAPHY-ALIGN', 'Show alignment for fixed text', async s => {
    await s.select('Paragraph');
    await pickTextSize(s, 'Fixed size');
    await s.set('X', '40');
    await s.set('Y', '40');
    await s.set('Width', '275');
    await s.set('Height', '140');
    const before = await s.object('Paragraph');
    const horizontal = s.role('group', /^(Horizontal text alignment|Text horizontal alignment)$/i);
    const vertical = s.role('group', /^(Vertical text alignment|Text vertical alignment)$/i);
    const right = s.role('button', 'Right', horizontal).or(s.button('Align text right')).filter({ visible: true });
    const bottom = s.role('button', 'Bottom', vertical).or(s.button('Align text bottom')).filter({ visible: true });
    await right.click();
    await bottom.click();
    await s.select('Text Frame');
    await s.select('Paragraph');
    for (const button of [right, bottom]) {
      await expect.poll(async () => await button.getAttribute('aria-pressed') ?? await button.getAttribute('aria-checked')).toBe('true');
    }
    await s.check(state => expect(s.lookup(state, 'Paragraph')).toMatchObject({ geometry: before.geometry, id: before.id }));
    await s.point(340, 175);
    const shot = await s.canvas().screenshot({ scale: 'css' });
    const bounds = await s.page.evaluate(async ({ data, box }) => {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
      try {
        const context = new OffscreenCanvas(box.width, box.height).getContext('2d')!;
        context.drawImage(image, -box.x, -box.y);
        const { data: pixels } = context.getImageData(0, 0, box.width, box.height);
        let minY = box.height, maxX = 0, maxY = 0, darkPixels = 0;
        for (let y = 1; y < box.height - 1; y++) {
          for (let x = 1; x < box.width - 1; x++) {
            const index = 4 * (y * box.width + x);
            if (Math.max(pixels[index]!, pixels[index + 1]!, pixels[index + 2]!) < 120) {
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
              darkPixels++;
            }
          }
        }
        return { minY, maxX, maxY, darkPixels };
      } finally {
        image.close();
      }
    }, { data: shot.toString('base64'), box: before.geometry });
    expect(bounds.darkPixels).toBeGreaterThan(20);
    expect(bounds.minY).toBeGreaterThan(before.geometry.height / 2);
    expect(bounds.maxX).toBeGreaterThan(before.geometry.width - 12);
    expect(bounds.maxY).toBeGreaterThan(before.geometry.height - 18);
  }),
  program('DESIGN-SCALE', 'Select a Scale anchor', async s => {
    await s.select('Paint');
    const before = await s.object('Paint');
    await s.press('k');
    const anchor = s.button(/^(Center anchor|Scale anchor Center|Center)$/i).filter({ visible: true });
    await anchor.click();
    await expect.poll(async () => await anchor.getAttribute('aria-pressed') ?? await anchor.getAttribute('aria-checked')).toBe('true');
    await selectScalePreset(s, '2x');
    await expect(scaleFactor(s)).toHaveValue(/^2\s*[x×]?$/);
    const box = before.geometry;
    await geometry(s, { Paint: g(box.x - box.width / 2, box.y - box.height / 2, 2 * box.width, 2 * box.height) });
    await s.button(/^(Close scale|Close)$/i).click();
    await expect(scaleFactor(s)).toBeHidden();
    await expect(s.button('Move')).toHaveAttribute('aria-pressed', 'true');
    await expect(s.layer('Paint')).toHaveAttribute('aria-selected', 'true');
  }),
  program('DESIGN-ALIGNMENT', 'Align selected layers', async s => {
    await draw(s, 'Frame', 'Parent', g(40, 55, 300, 210));
    await draw(s, 'Rectangle', 'A', g(70, 80, 60, 45));
    await draw(s, 'Rectangle', 'B', g(155, 150, 40, 30));
    await multi(s, ['A', 'B']);
    await s.button('Align left').click();
    await geometry(s, { A: g(30, 25, 60, 45), B: g(30, 95, 40, 30) });
    await s.button('Align right').click({ modifiers: ['Shift'] });
    await geometry(s, { A: g(240, 25, 60, 45), B: g(240, 95, 40, 30) });
    await geometry(s, { Parent: g(40, 55, 300, 210) });
  }),
  program('DESIGN-ROTATION', 'Rotate and flip selected layers', async s => {
    const initial = { A: g(100, 100, 60, 40), B: g(230, 170, 40, 70) };
    for (const [name, box] of Object.entries(initial)) await draw(s, 'Rectangle', name, box);
    await multi(s, ['A', 'B']);
    const before = await s.obs();
    const selected = new Set(before.selectionIds);
    await s.button(/^(Rotate 90 degrees right|Rotate right 90°?)$/i).click();
    await geometry(s, { A: g(215, 85, 60, 40), B: g(115, 215, 40, 70) });
    await s.check(state => expect(new Set(state.selectionIds)).toEqual(selected));
    await s.press('ControlOrMeta+z');
    await geometry(s, initial);
    await s.check(state => expect(new Set(state.selectionIds)).toEqual(selected));
    await s.button('Flip horizontal').click();
    await geometry(s, { A: g(210, 100, 60, 40), B: g(100, 170, 40, 70) });
    await s.check(state => expect(new Set(state.selectionIds)).toEqual(selected));
    await s.press('ControlOrMeta+z');
    await geometry(s, initial);
    await s.check(state => expect(new Set(state.selectionIds)).toEqual(selected));
  }),
  program('DESIGN-TYPOGRAPHY-LINE-HEIGHT', 'Apply and change the line-height unit', async s => {
    await s.select('Paragraph');
    await s.press('Enter');
    await s.field('Text editor').fill('First line\nSecond line');
    await s.press('Escape');
    await s.select('Paragraph');
    await pickTextSize(s, 'Auto width');
    const before = await s.object('Paragraph');
    const lineHeight = s.field('Line height');
    await lineHeight.fill('200%');
    await lineHeight.press('Escape');
    await expect(lineHeight).toHaveValue('200%');
    await s.check(state => expect(s.lookup(state, 'Paragraph')).toMatchObject({
      geometry: { height: 48 }, font: { lineHeight: { unit: 'percent', value: 200 } },
    }));
    await lineHeight.fill('16');
    await lineHeight.press('Enter');
    await expect(lineHeight).toHaveValue(/^16(?:\s*px)?$/);
    await s.check(state => expect(s.lookup(state, 'Paragraph')).toMatchObject({ geometry: { height: 32 }, font: { lineHeight: 16 } }));
    await lineHeight.fill('Auto');
    await s.page.getByText('Typography', { exact: true }).click();
    await expect(lineHeight).toHaveValue('Auto');
    await s.check(state => {
      const text = s.lookup(state, 'Paragraph');
      expect(text).toMatchObject({ id: before.id, text: 'First line\nSecond line', font: { lineHeight: 'auto' } });
      expect(text.geometry.height).toBeLessThan(48);
      expect(text.geometry.height).toBeGreaterThan(24);
    });
  }),
  program('DESIGN-SCALE', 'Edit a factor against the starting size', async s => {
    await draw(s, 'Rectangle', 'Target', g(60, 0, 160, 80));
    await s.press('k');
    await expect(scaleFactor(s)).toHaveValue(/^1\s*[x×]?$/);
    await selectScalePreset(s, '2x');
    await geometry(s, { Target: g(-20, -40, 320, 160) });
    await scaleText(s, '3');
    await geometry(s, { Target: g(-100, -80, 480, 240) });
    await scaleText(s, '3');
    await geometry(s, { Target: g(-100, -80, 480, 240) });
    await expect(scaleFactor(s)).toHaveValue(/^3\s*[x×]?$/);
  }),
  program('DESIGN-SCALE', 'Complete a Scale shortcut and start a new baseline', async s => {
    await draw(s, 'Rectangle', 'Target', g(120, 110, 160, 80));
    await s.button('Move').click();
    await s.point(200, 150);
    await s.press('k');
    await expect(scaleFactor(s)).toBeFocused();
    await s.press('ControlOrMeta+a');
    await s.press('2');
    await s.press('Enter');
    await geometry(s, { Target: g(40, 70, 320, 160) });
    await expect(scaleFactor(s)).toBeHidden();
    await expect(s.button('Move')).toHaveAttribute('aria-pressed', 'true');
    await s.press('k');
    await expect(scaleFactor(s)).toHaveValue(/^1\s*[x×]?$/);
    await assertField(s, 'Width', '320');
    await assertField(s, 'Height', '160');
    const anchor = s.button(/^(Center anchor|Scale anchor Center|Center)$/i).filter({ visible: true });
    await expect.poll(async () => await anchor.getAttribute('aria-pressed') ?? await anchor.getAttribute('aria-checked')).toBe('true');
  }),
  program('LAY-04', 'Resize a Frame that contains grouped members', async s => {
    await draw(s, 'Frame', 'Parent', g(40, 50, 200, 160));
    await draw(s, 'Rectangle', 'A', g(60, 70, 40, 20));
    await constraint(s, 'Horizontal', 'Left');
    await constraint(s, 'Vertical', 'Top');
    await draw(s, 'Rectangle', 'B', g(140, 70, 40, 20));
    await constraint(s, 'Horizontal', 'Right');
    await constraint(s, 'Vertical', 'Top');
    await multi(s, ['A', 'B']);
    await s.press('ControlOrMeta+g');
    await s.bindSelected('G');
    const before = await s.obs();
    expect(s.lookup(before, 'G').parentId).toBe(s.lookup(before, 'Parent').id);
    await s.select('Parent');
    await s.set('Width', '300');
    for (const name of ['G', 'A', 'B']) await s.select(name);
    await s.check(state => {
      expect(relativeBox(s, state, 'G', 'Parent')).toEqual(g(20, 20, 220, 20));
      expect(relativeBox(s, state, 'A', 'Parent')).toEqual(g(20, 20, 40, 20));
      expect(relativeBox(s, state, 'B', 'Parent')).toEqual(g(200, 20, 40, 20));
      for (const name of ['A', 'B']) expect(s.lookup(state, name)).toMatchObject({ parentId: s.lookup(state, 'G').id, id: s.lookup(before, name).id });
    });
  }),
  program('DESIGN-CONSTRAINTS', 'Respect dimension limits on an ignored child', async s => {
    await draw(s, 'Frame', 'Limit Frame', g(40, 55, 300, 210));
    await draw(s, 'Rectangle', 'Flow child', g(50, 65, 38, 20));
    await draw(s, 'Rectangle', 'Anchor', g(150, 65, 180, 60));
    await s.select('Limit Frame');
    await pickFlow(s, 'Vertical');
    await padding(s, 10);
    await s.set('Width', '300');
    await s.select('Anchor');
    const ignore = s.role('checkbox', 'Ignore auto layout').or(s.button('Ignore auto layout')).filter({ visible: true });
    await ignore.click();
    await s.set('X', '110');
    await s.set('Y', '10');
    await s.set('Width', '180');
    await s.set('Height', '60');
    await constraint(s, 'Horizontal', 'Right');
    await constraint(s, 'Vertical', 'Top');
    await setDimensionLimit(s, 'Min', 'width', 120);
    await setDimensionLimit(s, 'Max', 'width', 240);
    await s.select('Limit Frame');
    await sizing(s, 'Vertical', 'Hug contents');
    await dimensions(s, 'Limit Frame', 300, 40);
    await s.select('Anchor');
    await geometry(s, { Anchor: g(110, 10, 180, 60) });

    const assertChoices = async (axis: Axis, disabled: boolean) => {
      await picker(s, `${axis} constraint`).click();
      for (const name of axis === 'Horizontal' ? ['Left', 'Right', 'Center'] : ['Top', 'Bottom', 'Center']) {
        await expect(visibleOptions(s, name)).toBeEnabled();
      }
      const both = axis === 'Horizontal' ? /^(Left and right|Left \+ Right)$/i : /^(Top and bottom|Top \+ Bottom)$/i;
      for (const name of [both, 'Scale']) {
        if (disabled) await expect(visibleOptions(s, name)).toBeDisabled();
        else await expect(visibleOptions(s, name)).toBeEnabled();
      }
      await s.press('Escape');
    };
    await assertChoices('Horizontal', true);
    await assertChoices('Vertical', false);
    await choose(s, /^(Width options|Horizontal sizing)$/, 'Remove min and max');
    await assertChoices('Horizontal', false);
    await assertChoices('Vertical', false);
    await setDimensionLimit(s, 'Min', 'height', 20);
    await assertChoices('Vertical', true);
    await assertChoices('Horizontal', false);
    await dimensions(s, 'Limit Frame', 300, 40);
    await s.check(state => {
      const anchor = s.lookup(state, 'Anchor');
      expect(anchor).toMatchObject({ geometry: g(110, 10, 180, 60), layout: { ignore: true }, parentId: s.lookup(state, 'Limit Frame').id });
    });
  }),
  program('LAY-SMART', 'Duplicate and delete in a two-dimensional Smart selection', async s => {
    const initial = { A: g(50, 60, 40, 40), B: g(110, 60, 40, 40), C: g(50, 120, 40, 40), D: g(110, 120, 40, 40) };
    for (const [name, box] of Object.entries(initial)) await draw(s, 'Rectangle', name, box);
    await multi(s, ['A', 'B', 'C', 'D']);
    const before = await s.obs();
    const ids = new Set(before.objects.map(object => object.id));
    await s.point(70, 80);
    await s.press('ControlOrMeta+d');
    let copy: ObserveObject | undefined;
    await s.check(state => {
      expect(state.objects).toHaveLength(5);
      const newLayers = state.objects.filter(object => !ids.has(object.id));
      expect(newLayers).toHaveLength(1);
      copy = newLayers[0]!;
      expect(copy).toMatchObject({ parentId: null, type: 'rectangle', geometry: g(50, 120, 40, 40) });
      expect(s.lookup(state, 'C').geometry.y).toBeGreaterThan(initial.C.y);
      for (const name of Object.keys(initial)) expect(s.lookup(state, name).id).toBe(s.lookup(before, name).id);
    });
    if (!copy) throw new Error('A duplicate was not created');
    await s.point(copy.geometry.x + 20, copy.geometry.y + 20);
    await s.press('Delete');
    await geometry(s, initial);
    await s.check(state => {
      expect(state.objects).toHaveLength(4);
      expect(new Set(state.objects.map(object => object.id))).toEqual(ids);
      expect(state.objects.every(object => object.parentId === null)).toBe(true);
    });
  }),
];
