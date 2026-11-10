import { expect, type Locator, type Page } from '@playwright/test';
import type { ObserveObject, ObserveSnapshot } from '../oracles.js';
import type { Program } from '../scenario.js';

type Scenario = Parameters<Program['run']>[0];
type Role = Parameters<Page['getByRole']>[0];
type Name = string | RegExp;
type Paint = 'Fill' | 'Stroke';
type Stop = { position: number; color: string; opacity: number };

const role = (scope: Page | Locator, type: Role, name: Name) =>
  scope.getByRole(type, { name, exact: typeof name === 'string' });
const button = (s: Scenario, name: Name, scope: Page | Locator = s.page) => role(scope, 'button', name);
const field = (s: Scenario, name: Name, scope: Page | Locator = s.page) =>
  role(scope, 'textbox', name).or(role(scope, 'spinbutton', name));
const option = (s: Scenario, name: Name) =>
  role(s.page, 'option', name).or(role(s.page, 'menuitem', name)).or(role(s.page, 'menuitemradio', name));
const namedRegion = (s: Scenario, name: Name) =>
  role(s.page, 'region', name).or(role(s.page, 'group', name)).or(role(s.page, 'slider', name))
    .or(s.page.getByLabel(name, { exact: typeof name === 'string' }));
const fillValue = (s: Scenario) => field(s, 'Fill');
const fillAlpha = (s: Scenario) => field(s, 'Fill opacity');
const hexField = (s: Scenario) => field(s, /^(?:Hex|Hex color|Color hex)$/i);
const alphaField = (s: Scenario) => field(s, /^(?:Alpha|Color alpha)$/i);
const selectedHex = (s: Scenario) => field(s, 'Selection color');
const selectedAlpha = (s: Scenario) => field(s, 'Selection color opacity');
const selectedSwatch = (s: Scenario) => button(s, 'Selection color preview');
const removePaint = (s: Scenario, paint: Paint) => button(s, new RegExp('^Remove ' + paint + '(?: paint)?$', 'i'));
const paintSwatch = (s: Scenario, paint: Paint = 'Fill') => button(s, new RegExp('^' + paint + ' (?:preview|swatch)$', 'i'));
const stopPosition = (s: Scenario) => field(s, /^(?:Gradient )?Stop position$/i);
const stopAlpha = (s: Scenario) => field(s, /^(?:Gradient )?Stop alpha$/i);
const stopSwatches = (s: Scenario) => button(s, /^Gradient (?:start|end|stop) color (?:preview|swatch)$/i);
const stopColors = (s: Scenario) => field(s, /^Gradient (?:start|end|stop) color$/i);
const gradientStrip = (s: Scenario) => namedRegion(s, /^(?:Gradient strip|Linear gradient strip)$/i);
const midpointMarker = (s: Scenario, scope = gradientStrip(s)) =>
  role(scope, 'button', /^(?:Gradient )?Stop(?: marker)?(?: at)? 50%$/i);
const cornerDetails = (s: Scenario) => button(s, /^(?:Corner details|Individual corners)$/i);
const shadowOpen = (s: Scenario) => button(s, 'Drop shadow');
const gradientType = (s: Scenario) => button(s, /^(?:Gradient type|Linear)$/i);
const strokeAlign = (s: Scenario) => button(s, /^(?:Stroke alignment|Stroke position)$/i);
const strokeWidth = (s: Scenario) => field(s, /^(?:Stroke width|Weight)$/i);

async function put(control: Locator, value: string | number) {
  await control.fill(String(value));
  await control.press('Enter');
}

async function number(control: Locator, expected: number) {
  await expect.poll(async () => {
    const value = (await control.inputValue()).trim();
    return value ? Number(value.replace(/%$/, '')) : NaN;
  }).toBe(expected);
}

async function choose(s: Scenario, trigger: Locator, name: string) {
  await trigger.click();
  await option(s, name).click();
}

async function paintType(s: Scenario, name: 'Solid' | 'Gradient' | 'Image') {
  await button(s, name).click();
  if (name === 'Gradient') await expect(gradientType(s)).toContainText('Linear');
}

async function closePaint(s: Scenario) {
  const named = button(s, /^(?:Close fill editor|Close paint editor|Close stroke editor)$/i);
  if (await named.isVisible()) await named.click();
  else await closePopup(s);
}

async function closePopup(s: Scenario) {
  await button(s, 'Close').click();
}

async function paintColor(s: Scenario, color: string, alpha?: number) {
  await put(hexField(s), color);
  if (alpha !== undefined) await put(alphaField(s), alpha);
}

async function solidRow(s: Scenario, color: string, alpha = 100) {
  await put(fillValue(s), color);
  await put(fillAlpha(s), alpha);
}

async function expectFill(s: Scenario, name: string, color: string, alpha: number, opacity = 1) {
  await s.check(snapshot => {
    const object = s.lookup(snapshot, name);
    expect(object.fill).toMatchObject({ color });
    expect(object.fill?.opacity).toBeCloseTo(alpha);
    expect(object.opacity ?? 1).toBeCloseTo(opacity);
  });
}

function rgb(hex: string): number[] {
  return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
}

function colorNear(actual: number[], expected: number[], tolerance = 14) {
  expect(actual.length).toBeGreaterThanOrEqual(3);
  expected.forEach((value, i) => expect(Math.abs(actual[i]! - value)).toBeLessThanOrEqual(tolerance));
}

function screenPoint(snapshot: ObserveSnapshot, object: ObserveObject, x: number, y: number) {
  const view = snapshot.document.view;
  let px = object.geometry.x + x;
  let py = object.geometry.y + y;
  for (let parent = object.parentId; parent;) {
    const ancestor = snapshot.objects.find(item => item.id === parent);
    expect(ancestor, 'editable parent').toBeDefined();
    px += ancestor!.geometry.x;
    py += ancestor!.geometry.y;
    parent = ancestor!.parentId;
  }
  return { x: px * (view?.zoom ?? 1) + (view?.panX ?? 0),
           y: py * (view?.zoom ?? 1) + (view?.panY ?? 0) };
}

async function layerPixel(s: Scenario, name: string, x: number, y: number) {
  const snapshot = await s.obs();
  const position = screenPoint(snapshot, s.lookup(snapshot, name), x, y);
  return s.pixel(position.x, position.y);
}

async function expectPixel(s: Scenario, name: string, x: number, y: number, expected: string | number[]) {
  await expect(async () => {
    colorNear(await layerPixel(s, name, x, y), typeof expected === 'string' ? rgb(expected) : expected);
  }).toPass({ timeout: 5_000 });
}

async function rectangle(s: Scenario, x = 48, y = 52, w = 160, h = 100, name?: string) {
  await button(s, 'Rectangle').click();
  await s.drag(x, y, x + w, y + h);
  const object = await s.selected();
  expect(object.type).toBe('rectangle');
  if (name) await s.bindSelected(name);
  else expect(object.name).toBeTruthy();
  return name ?? object.name!;
}

async function movedPaint(s: Scenario) {
  await s.select('Paint');
  await s.set('X', '60');
  await s.set('Y', '60');
  return 'Paint';
}

async function reselectPaint(s: Scenario) {
  await s.select('Circle');
  await s.select('Paint');
}

async function prepareGradient(s: Scenario, alpha = 100, start = 'FF0000', end = '990000') {
  await put(fillAlpha(s), alpha);
  await paintSwatch(s).click();
  await paintType(s, 'Gradient');
  await put(field(s, 'Gradient start color'), start);
  await put(field(s, 'Gradient end color'), end);
  await put(stopAlpha(s).nth(0), 100);
  await put(stopAlpha(s).nth(1), 100);
}

async function assertStops(s: Scenario, count: number, name: string) {
  await expect(stopPosition(s)).toHaveCount(count);
  await expect(stopAlpha(s)).toHaveCount(count);
  await s.check(snapshot => {
    const gradient = s.lookup(snapshot, name).gradient;
    expect(String(gradient?.type).toLowerCase()).toBe('linear');
    expect(gradient?.stops).toHaveLength(count);
  });
}

async function addStroke(s: Scenario, color = '000000', width = 4, alignment = 'Inside') {
  await button(s, 'Add stroke').click();
  await expect(hexField(s)).toBeVisible();
  await closePaint(s);
  await put(field(s, 'Stroke color'), color);
  await put(strokeWidth(s), width);
  await choose(s, strokeAlign(s), alignment);
}

async function expectStroke(s: Scenario, name: string, match: Record<string, unknown>) {
  await s.check(snapshot => {
    const stroke = s.lookup(snapshot, name).stroke;
    const firstPaint = Array.isArray(stroke?.paints) ? stroke.paints[0] : undefined;
    expect({ ...firstPaint, ...stroke }).toMatchObject(match);
  });
}

async function openStrokeSides(s: Scenario) {
  const menu = button(s, 'Individual strokes');
  if (!await menu.isVisible()) {
    await button(s, /^(?:Stroke sides|Individual strokes)$/i).click();
  }
  if (!await option(s, 'Custom').isVisible()) await menu.click();
}

async function prepareStrokeSides(s: Scenario, widths: readonly number[]) {
  await openStrokeSides(s);
  await option(s, 'Custom').click();
  for (const [i, side] of ['Left', 'Top', 'Right', 'Bottom'].entries())
    await put(sideField(s, side), widths[i]!);
}

const sideField = (s: Scenario, side: string) => field(s, new RegExp('^' + side + '(?: stroke width| stroke| side)?$', 'i'));
async function checkSides(s: Scenario, expected: number[]) {
  for (const [i, side] of ['Left', 'Top', 'Right', 'Bottom'].entries())
    await number(sideField(s, side), expected[i]!);
  await s.check(snapshot => {
    const stroke = s.lookup(snapshot, 'Paint').stroke;
    const sides = stroke?.sideWidths ?? { left: stroke?.width, top: stroke?.width, right: stroke?.width, bottom: stroke?.width };
    expect(sides).toEqual({ left: expected[0], top: expected[1], right: expected[2], bottom: expected[3] });
  });
}

async function addShadow(s: Scenario) {
  await button(s, 'Add effect').click();
  await expect(field(s, 'Shadow X')).toBeVisible();
}

async function shadowValues(s: Scenario, x: number, y: number, blur: number, spread: number) {
  for (const [name, value] of Object.entries({ 'Shadow X': x, 'Shadow Y': y, 'Shadow blur': blur, 'Shadow spread': spread }))
    await put(field(s, name), value);
}

async function assertShadowFields(s: Scenario, x: number, y: number, blur: number, spread: number) {
  for (const [name, value] of Object.entries({ 'Shadow X': x, 'Shadow Y': y, 'Shadow blur': blur, 'Shadow spread': spread }))
    await number(field(s, name), value);
}

async function twoFills(s: Scenario) {
  await s.select('Paint');
  await solidRow(s, '0000FF');
  await button(s, 'Add fill').click();
  await paintColor(s, 'FF0000', 100);
  await closePaint(s);
  await expect(fillValue(s)).toHaveCount(2);
  await expect(fillValue(s).nth(0)).toHaveValue('FF0000');
  await expect(fillValue(s).nth(1)).toHaveValue('0000FF');
}

async function togglePaint(s: Scenario, paint: Paint, index = 0) {
  const specific = button(s, new RegExp('^(?:Toggle |Hide |Show )?' + paint + ' visibility$', 'i'));
  if (await specific.count()) {
    await specific.nth(index).click();
    return;
  }
  // Local Fill rows precede Stroke rows in Design.
  const preceding = paint === 'Stroke' ? await paintSwatch(s).count() : 0;
  await button(s, /^(?:Toggle paint visibility|Hide paint|Show paint)$/i).nth(preceding + index).click();
}

async function drawGroup(s: Scenario, count: 3 | 4) {
  const names = ['A', 'B', 'C', 'D'].slice(0, count);
  for (const [i, name] of names.entries()) {
    await rectangle(s, 30 + i * 140, 70, 110, 85, name);
    await solidRow(s, 'FF0000');
  }
  return names;
}

async function groupABC(s: Scenario) {
  await s.select('A');
  await s.layer('B').click({ modifiers: ['ControlOrMeta'] });
  await s.layer('C').click({ modifiers: ['ControlOrMeta'] });
  await s.press('ControlOrMeta+g');
  await s.bindSelected('G');
  await s.check(snapshot => {
    const group = s.lookup(snapshot, 'G');
    expect(group.type).toBe('group');
    for (const name of ['A', 'B', 'C']) expect(s.lookup(snapshot, name).parentId).toBe(group.id);
  });
}

function program(requirement: string, name: string, run: Program['run']): Program {
  return { requirement, name, run };
}

export const programs: Program[] = [
  program('FILL-EDIT', 'Edit a solid color and its alpha', async s => {
    const name = await rectangle(s);
    const before = (await s.object(name)).geometry;
    await paintSwatch(s).click();
    await expect(namedRegion(s, /^(?:Color area|Color picker area)$/i)).toBeVisible();
    await expect(namedRegion(s, /^(?:Hue|Hue track)$/i)).toBeVisible();
    await expect(namedRegion(s, /^(?:Alpha track|Alpha slider)$/i)).toBeVisible();
    await expect(button(s, 'Color format')).toBeVisible();
    await paintColor(s, '2563EB', 60);
    await closePaint(s);
    await expect(fillValue(s)).toHaveValue('2563EB');
    await number(fillAlpha(s), 60);
    await paintSwatch(s).click();
    await expect(hexField(s)).toHaveValue('2563EB');
    await number(alphaField(s), 60);
    await paintColor(s, 'FF0000');
    await closePaint(s);
    await expectFill(s, name, 'FF0000', 0.6);
    expect((await s.object(name)).geometry).toEqual(before);
    const background = await s.pixel(16, 16);
    await expectPixel(s, name, 80, 50, rgb('FF0000').map((channel, i) => Math.round(channel * 0.6 + background[i]! * 0.4)));
  }),

  program('PAINT-CORNERS', 'Set opacity and individual corners', async s => {
    const name = await rectangle(s);
    await solidRow(s, '2563EB', 60);
    const before = (await s.object(name)).geometry;
    await s.set('Opacity', '50');
    await s.set('Corner radius', '12');
    await s.check(snapshot => expect(s.lookup(snapshot, name).cornerRadius).toBe(12));
    await cornerDetails(s).click();
    const topLeft = field(s, /^(?:Top left(?: corner)? radius|Top left corner)$/i);
    await put(topLeft, 22);
    await s.point(20, 20);
    await s.select(name);
    if (!await topLeft.isVisible()) await cornerDetails(s).click();
    await number(topLeft, 22);
    await number(field(s, /^(?:Top right(?: corner)? radius|Top right corner)$/i), 12);
    await expectFill(s, name, '2563EB', 0.6, 0.5);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('PAINT-STROKE', 'Set stroke color, width, and alignment', async s => {
    const name = await rectangle(s);
    await solidRow(s, '0000FF');
    const before = (await s.object(name)).geometry;
    await addStroke(s, 'FF0000', 8, 'Inside');
    await s.point(20, 20);
    const background = await layerPixel(s, name, -8, 50);
    await expectPixel(s, name, 2, 50, 'FF0000');
    await expectPixel(s, name, -2, 50, background.slice(0, 3));
    await s.select(name);
    await choose(s, strokeAlign(s), 'Center');
    await s.point(20, 20);
    await expectPixel(s, name, -2, 50, 'FF0000');
    await expectPixel(s, name, 7, 50, '0000FF');
    await s.select(name);
    await expect(strokeAlign(s)).toContainText('Center');
    await expect(field(s, 'Stroke color')).toHaveValue('FF0000');
    await number(strokeWidth(s), 8);
    await expectFill(s, name, '0000FF', 1);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('PAINT-EFFECTS', 'Set and reopen a drop shadow', async s => {
    const name = await rectangle(s);
    const before = (await s.object(name)).geometry;
    const background = await layerPixel(s, name, 30, 115);
    await addShadow(s);
    await shadowValues(s, 8, 14, 0, 3);
    await put(field(s, 'Shadow color'), '000000');
    await put(field(s, 'Shadow opacity'), 75);
    await closePopup(s);
    await shadowOpen(s).click();
    await assertShadowFields(s, 8, 14, 0, 3);
    await put(field(s, 'Shadow Y'), 20);
    await closePopup(s);
    await expect.poll(async () => (await layerPixel(s, name, 30, 117))[0]!).toBeLessThan(background[0]! - 50);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('FILL-EDIT', 'Edit the current layer after selection changes', async s => {
    await s.select('Paint');
    const baseline = await s.obs();
    await paintSwatch(s).click();
    await paintColor(s, 'FF0000', 60);
    await closePaint(s);
    await s.select('Circle');
    await paintSwatch(s).click();
    await paintColor(s, '0000FF');
    await closePaint(s);
    await expectFill(s, 'Paint', 'FF0000', 0.6);
    await expectFill(s, 'Circle', '0000FF', 1);
    await expectPixel(s, 'Circle', 40, 40, '0000FF');
    await s.select('Paint');
    await paintSwatch(s).click();
    await expect(hexField(s)).toHaveValue('FF0000');
    await number(alphaField(s), 60);
    const hue = namedRegion(s, /^(?:Hue|Hue track)$/i);
    const bounds = await hue.boundingBox();
    expect(bounds).not.toBeNull();
    await hue.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
    await closePaint(s);
    const updated = (await s.object('Paint')).fill!.color;
    expect(updated).not.toBe('FF0000');
    await expect(fillValue(s)).toHaveValue(updated);
    await expectFill(s, 'Paint', updated, 0.6);
    await expectFill(s, 'Circle', '0000FF', 1);
    for (const name of ['Paint', 'Circle']) {
      const current = await s.object(name);
      expect(current.id).toBe(s.lookup(baseline, name).id);
      expect(current.parentId).toBe(s.lookup(baseline, name).parentId);
      expect(current.geometry).toEqual(s.lookup(baseline, name).geometry);
    }
    expect((await s.selected()).name).toBe('Paint');
    await s.layer('Circle').click({ modifiers: ['ControlOrMeta'] });
    await expect(s.page.getByText('Selection colors', { exact: true })).toBeVisible();
    await expect(selectedHex(s)).toHaveCount(2);
    expect((await selectedHex(s).evaluateAll(els => els.map(el => (el as HTMLInputElement).value))).sort()).toEqual(['0000FF', updated].sort());
    await s.select('Paint');
    await expect(fillValue(s)).toHaveValue(updated);
    await s.select('Circle');
    await expect(fillValue(s)).toHaveValue('0000FF');
  }),

  program('PAINT-02', 'Keep format during replacement and further input', async s => {
    await button(s, 'Text').click();
    await s.point(48, 52);
    const editor = field(s, 'Text editor');
    await editor.fill('abcdef');
    await editor.press('Escape');
    const name = (await s.selected()).name!;
    await s.set('Font size', '12');
    await expect(button(s, 'Font family')).toContainText('Inter');
    await expect(button(s, 'Font style')).toContainText('Regular');
    await s.press('Enter');
    await editor.press('Home');
    await editor.press('ArrowRight');
    await editor.press('ArrowRight');
    await editor.press('Shift+ArrowRight');
    await editor.press('Shift+ArrowRight');
    await editor.press('ControlOrMeta+b');
    await s.page.keyboard.insertText('X');
    await s.page.keyboard.insertText('Y');
    await editor.press('Shift+ArrowLeft');
    await expect(button(s, 'Font style')).toContainText('Bold');
    await editor.press('Escape');
    await s.select(name);
    await expect(button(s, 'Font style')).toContainText('Mixed');
    await s.check(snapshot => {
      const item = s.lookup(snapshot, name);
      expect(item.text).toBe('abXYef');
      for (let i = 0; i < 6; i++) {
        const run = item.textRuns?.find(run => run.start <= i && run.end > i);
        const style = run?.fontStyle ?? (run as { font?: { style?: string } } | undefined)?.font?.style ?? item.font?.style;
        expect(style).toBe(i === 2 || i === 3 ? 'Bold' : 'Regular');
      }
    });
  }),

  program('PAINT-GRADIENT', 'Keep stop alpha and Fill opacity separate', async s => {
    const name = await movedPaint(s);
    const before = (await s.object(name)).geometry;
    await prepareGradient(s, 60, 'FF0000', '0000FF');
    await put(stopAlpha(s).nth(0), 30);
    await closePaint(s);
    await put(fillAlpha(s), 40);
    await paintSwatch(s).click();
    await number(stopAlpha(s).nth(0), 30);
    await number(fillAlpha(s), 40);
    await number(field(s, 'Opacity'), 100);
    await button(s, 'Add stop').click();
    await assertStops(s, 3, name);
    await number(stopPosition(s).nth(1), 50);
    const marker = midpointMarker(s);
    await expect(marker).toBeVisible();
    await marker.click();
    await expect(role(s.canvas(), 'button', /^(?:Canvas )?Gradient stop(?: at)? 50%$/i)).toBeVisible();
    const endpoint = namedRegion(s, /^(?:Canvas )?Gradient (?:end|end point|end handle|direction end)$/i)
      .or(role(s.canvas(), 'button', /^(?:Canvas )?Gradient (?:end|end point|end handle|direction end)$/i));
    const bounds = await endpoint.boundingBox();
    expect(bounds).not.toBeNull();
    await s.drag(bounds!.width / 2, bounds!.height / 2, bounds!.width / 2 + 45, bounds!.height / 2 - 25, { target: endpoint });
    const shifted = await endpoint.boundingBox();
    expect(shifted).not.toBeNull();
    expect(Math.abs(shifted!.x - bounds!.x)).toBeGreaterThan(20);
    await closePaint(s);
    await paintSwatch(s).click();
    await assertStops(s, 3, name);
    await number(stopAlpha(s).nth(0), 30);
    await number(fillAlpha(s), 40);
    const reopened = await endpoint.boundingBox();
    expect(reopened).not.toBeNull();
    expect(reopened!.x).toBeCloseTo(shifted!.x, 0);
    expect(reopened!.y).toBeCloseTo(shifted!.y, 0);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('COLOR-VALUE', 'Change color continuously and switch formats', async s => {
    const name = await rectangle(s);
    await solidRow(s, '2563EB', 60);
    await paintSwatch(s).click();
    await expect(hexField(s)).toHaveValue('2563EB');
    await choose(s, button(s, 'Color format'), 'RGB');
    for (const [name, value] of Object.entries({ R: 37, G: 99, B: 235 }))
      await number(field(s, name), value);
    await number(alphaField(s), 60);
    await choose(s, button(s, 'Color format'), 'CSS');
    await expect(field(s, /^(?:CSS|CSS color)$/i)).toHaveValue(/^rgba\(\s*37\s*,\s*99\s*,\s*235\s*,\s*0\.6(?:0*)\s*\)$/);
    for (const [format, channel] of [['HSL', /^(?:L|Lightness)$/i], ['HSB', /^(?:B|Brightness)$/i]] as const) {
      await choose(s, button(s, 'Color format'), format);
      await expect(field(s, channel)).toBeVisible();
      await number(alphaField(s), 60);
      await expectFill(s, name, '2563EB', 0.6);
    }
    await choose(s, button(s, 'Color format'), 'Hex');
    await expect(hexField(s)).toHaveValue('2563EB');
    await number(alphaField(s), 60);
    const area = namedRegion(s, /^(?:Color area|Color picker area)$/i);
    const box = await area.boundingBox();
    expect(box).not.toBeNull();
    const original = (await s.object(name)).fill!.color;
    const backdrop = await s.pixel(15, 15);
    const blend = (hex: string, alpha: number) =>
      rgb(hex).map((value, i) => Math.round(value * alpha + backdrop[i]! * (1 - alpha)));
    const { mouse } = s.page;
    await mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.4);
    await mouse.down();
    try {
      await mouse.move(box!.x + box!.width * 0.45, box!.y + box!.height * 0.6, { steps: 4 });
      const middle = await hexField(s).inputValue();
      expect(middle).not.toBe(original);
      await expectFill(s, name, middle, 0.6);
      await expectPixel(s, name, 75, 47, blend(middle, 0.6));
      await mouse.move(box!.x + box!.width * 0.72, box!.y + box!.height * 0.23, { steps: 4 });
      const end = await hexField(s).inputValue();
      expect(end).not.toBe(middle);
      await expectFill(s, name, end, 0.6);
      await expectPixel(s, name, 75, 47, blend(end, 0.6));
    } finally {
      await mouse.up();
    }
    const hue = namedRegion(s, /^(?:Hue|Hue track)$/i);
    const h = await hue.boundingBox();
    expect(h).not.toBeNull();
    const beforeHue = await hexField(s).inputValue();
    await s.drag(h!.width * 0.5, h!.height / 2, h!.width * 0.25, h!.height / 2, { target: hue });
    const afterHue = await hexField(s).inputValue();
    expect(afterHue).not.toBe(beforeHue);
    const alpha = namedRegion(s, /^(?:Alpha track|Alpha slider)$/i);
    const a = await alpha.boundingBox();
    expect(a).not.toBeNull();
    await s.drag(a!.width * 0.6, a!.height / 2, a!.width * 0.25, a!.height / 2, { target: alpha });
    const alphaValue = Number((await alphaField(s).inputValue()).replace(/%$/, ''));
    expect(alphaValue).toBeGreaterThan(15);
    expect(alphaValue).toBeLessThan(40);
    await closePaint(s);
    await expect(fillValue(s)).toHaveValue(afterHue);
    await number(fillAlpha(s), alphaValue);
    await expectFill(s, name, afterHue, alphaValue / 100);
    await expectPixel(s, name, 75, 47, blend(afterHue, alphaValue / 100));
  }),

  program('COLOR-VALUE', 'Commit and cancel a color field', async s => {
    const name = await rectangle(s);
    await solidRow(s, '2563EB', 60);
    await paintSwatch(s).click();
    await hexField(s).fill('FF0000');
    await expectFill(s, name, '2563EB', 0.6);
    await hexField(s).press('Escape');
    await expect(hexField(s)).toHaveValue('2563EB');
    await expect(hexField(s)).toBeFocused();
    await put(hexField(s), 'FF0000');
    await expectFill(s, name, 'FF0000', 0.6);
    await alphaField(s).fill('80');
    await expectFill(s, name, 'FF0000', 0.6);
    await alphaField(s).press('Escape');
    await expect(hexField(s)).toBeHidden();
    await paintSwatch(s).click();
    await expect(hexField(s)).toHaveValue('FF0000');
    await number(alphaField(s), 60);
  }),

  program('COLOR-EYEDROPPER', 'Sample the page background into a stroke', async s => {
    const name = await rectangle(s);
    await solidRow(s, '0000FF');
    await addStroke(s);
    await paintSwatch(s, 'Stroke').click();
    const eyedropper = button(s, /^(?:Eyedropper|Sample color)$/i);
    await eyedropper.click();
    const box = await s.canvas().boundingBox();
    expect(box).not.toBeNull();
    await s.page.mouse.move(box!.x + 250, box!.y + 210);
    const sample = role(s.page, 'status', /^(?:Color sample|Sampled color|Eyedropper preview)$/i);
    await expect(sample).toContainText(/#?F5F5F5/i);
    await s.point(250, 210);
    await expectStroke(s, name, { color: 'F5F5F5', opacity: 1 });
    await expectFill(s, name, '0000FF', 1);
    expect((await s.selected()).name).toBe(name);
    if (!await eyedropper.isVisible()) await paintSwatch(s, 'Stroke').click();
    await eyedropper.click();
    await s.page.mouse.move(box!.x + 100, box!.y + 90);
    await s.press('Escape');
    await expectStroke(s, name, { color: 'F5F5F5', opacity: 1 });
    await expectFill(s, name, '0000FF', 1);
    expect((await s.selected()).name).toBe(name);
  }),

  program('COLOR-SAMPLES', 'Apply a page color and refresh the samples', async s => {
    await rectangle(s, 30, 60, 130, 85, 'A');
    await solidRow(s, 'FF0000');
    await rectangle(s, 210, 60, 130, 85, 'B');
    await solidRow(s, '0000FF');
    const swatch = (hex: string) => button(s, new RegExp('^(?:(?:Use|Apply) )?#?' + hex + '(?: color)?$', 'i'));
    await s.select('A');
    await paintSwatch(s).click();
    await expect(s.page.getByText('On this page', { exact: true })).toBeVisible();
    await swatch('0000FF').click();
    await closePaint(s);
    await expectFill(s, 'A', '0000FF', 1);
    await paintSwatch(s).click();
    await expect(swatch('FF0000')).toHaveCount(0);
    await expect(swatch('0000FF')).toHaveCount(1);
    await closePaint(s);
    await s.select('B');
    await solidRow(s, '00FF00');
    await paintSwatch(s).click();
    for (const color of ['0000FF', '00FF00', 'F5F5F5']) await expect(swatch(color)).toHaveCount(1);
    await expectFill(s, 'A', '0000FF', 1);
    await expectFill(s, 'B', '00FF00', 1);
  }),

  program('FILL-ADD', 'Add another paint above the existing paint', async s => {
    await s.select('Paint');
    await solidRow(s, '0000FF');
    const identity = (await s.object('Paint')).id;
    await button(s, 'Add fill').click();
    await expect(hexField(s)).toBeVisible();
    await expect(paintSwatch(s)).toHaveCount(2);
    await expect(fillValue(s).nth(1)).toHaveValue('0000FF');
    await number(fillAlpha(s).nth(0), 20);
    await number(fillAlpha(s).nth(1), 100);
    await number(alphaField(s), 20);
    const top = await hexField(s).inputValue();
    await closePaint(s);
    const composite = rgb(top).map((value, i) => Math.round(value * 0.2 + rgb('0000FF')[i]! * 0.8));
    await expectPixel(s, 'Paint', 80, 40, composite);
    expect((await s.object('Paint')).id).toBe(identity);
  }),

  program('FILL-REORDER', 'Move the upper paint below the lower paint', async s => {
    await twoFills(s);
    await expectPixel(s, 'Paint', 80, 40, 'FF0000');
    const handle = button(s, /^(?:Reorder|Drag) (?:fill|paint)$/i).or(s.page.getByTitle('Reorder', { exact: true })).nth(0);
    const bottom = await fillValue(s).nth(1).boundingBox();
    const from = await handle.boundingBox();
    expect(bottom).not.toBeNull();
    expect(from).not.toBeNull();
    await s.drag(from!.width / 2, from!.height / 2, from!.width / 2, bottom!.y - from!.y + bottom!.height + 5, { target: handle });
    await expect(fillValue(s).nth(0)).toHaveValue('0000FF');
    await expect(fillValue(s).nth(1)).toHaveValue('FF0000');
    await number(fillAlpha(s).nth(1), 100);
    await expectPixel(s, 'Paint', 80, 40, '0000FF');
  }),

  program('FILL-VISIBILITY', 'Hide and restore the upper paint', async s => {
    await twoFills(s);
    await expectPixel(s, 'Paint', 80, 40, 'FF0000');
    await togglePaint(s, 'Fill');
    await expectPixel(s, 'Paint', 80, 40, '0000FF');
    await expect(fillValue(s).nth(0)).toHaveValue('FF0000');
    await expect(fillValue(s).nth(1)).toHaveValue('0000FF');
    await number(fillAlpha(s).nth(0), 100);
    await togglePaint(s, 'Fill');
    await expectPixel(s, 'Paint', 80, 40, 'FF0000');
    await expect(fillValue(s).nth(0)).toHaveValue('FF0000');
    await number(fillAlpha(s).nth(1), 100);
  }),

  program('FILL-REMOVE', 'Remove every paint and add one again', async s => {
    await twoFills(s);
    const before = await s.object('Paint');
    await removePaint(s, 'Fill').first().click();
    await expect(fillValue(s)).toHaveCount(1);
    await removePaint(s, 'Fill').click();
    await expect(fillValue(s)).toHaveCount(0);
    await expect(s.page.getByText('Fill', { exact: true })).toBeVisible();
    await button(s, 'Add fill').click();
    await expect(hexField(s)).toBeVisible();
    await expect(paintSwatch(s)).toHaveCount(1);
    await paintColor(s, '00FF00', 100);
    await closePaint(s);
    expect((await s.object('Paint')).id).toBe(before.id);
    await expectFill(s, 'Paint', '00FF00', 1);
    await expectPixel(s, 'Paint', 80, 40, '00FF00');
  }),

  program('EDITOR-GRADIENT', 'Edit gradient stops from the paint editor', async s => {
    const name = await movedPaint(s);
    await prepareGradient(s, 65);
    await assertStops(s, 2, name);
    await button(s, 'Add stop').click();
    await put(stopPosition(s).nth(1), 50);
    await assertStops(s, 3, name);
    const marker = midpointMarker(s);
    await marker.click();
    await expect(stopSwatches(s).nth(1)).toBeVisible();
    await expect(stopColors(s).nth(1)).toBeVisible();
    await expect(button(s, 'Remove stop').nth(1)).toBeEnabled();
    await stopSwatches(s).nth(1).click();
    await paintColor(s, '00FF00');
    await closePopup(s);
    await expect(stopColors(s).nth(1)).toHaveValue('00FF00');
    await number(stopPosition(s).nth(1), 50);
    await number(stopAlpha(s).nth(1), 100);
    await button(s, 'Flip gradient').click();
    await s.check(snapshot => {
      const stops = s.lookup(snapshot, name).gradient?.stops as Stop[] | undefined;
      expect(stops?.find(stop => stop.color === 'FF0000')?.position).toBe(1);
      expect(stops?.find(stop => stop.color === '990000')?.position).toBe(0);
      expect(stops?.find(stop => stop.color === '00FF00')?.position).toBe(0.5);
    });
    const beforeRotate = await layerPixel(s, name, 27, 24);
    await button(s, 'Rotate gradient').click();
    await closePaint(s);
    await expect.poll(async () => {
      const after = await layerPixel(s, name, 27, 24);
      return after.slice(0, 3).reduce((sum, value, i) => sum + Math.abs(value - beforeRotate[i]!), 0);
    }).toBeGreaterThan(12);
    await number(fillAlpha(s), 65);
  }),

  program('DESIGN-OPACITY', 'Keep layer and paint opacity separate', async s => {
    await s.select('Paint');
    await solidRow(s, '2563EB', 40);
    await s.set('Opacity', '50');
    await reselectPaint(s);
    await number(field(s, 'Opacity'), 50);
    await number(fillAlpha(s), 40);
    await expectFill(s, 'Paint', '2563EB', 0.4, 0.5);
    const background = await s.pixel(175, 95);
    await expectPixel(s, 'Paint', 80, 40, rgb('2563EB').map((value, i) => Math.round(value * 0.2 + background[i]! * 0.8)));
    await put(fillAlpha(s), 65);
    await s.set('Opacity', '75');
    await expectFill(s, 'Paint', '2563EB', 0.65, 0.75);
  }),

  program('DESIGN-CORNERS', 'Open individual corner controls', async s => {
    await s.select('Paint');
    await s.set('Corner radius', '12');
    await cornerDetails(s).click();
    const corner = (name: string) => field(s, new RegExp('^' + name + '(?: corner)?(?: radius)?$', 'i'));
    for (const name of ['Top left', 'Top right', 'Bottom left', 'Bottom right']) await number(corner(name), 12);
    await expect(button(s, 'Corner smoothing')).toBeVisible();
    await put(corner('Top left'), 24);
    await cornerDetails(s).click();
    await expect(corner('Top left')).toBeHidden();
    await cornerDetails(s).click();
    await number(corner('Top left'), 24);
    for (const name of ['Top right', 'Bottom left', 'Bottom right']) await number(corner(name), 12);
    await expect(button(s, 'Corner smoothing')).toBeVisible();
  }),

  program('DESIGN-STROKE-PAINT', 'Edit stroke color independently of Fill', async s => {
    const name = await movedPaint(s);
    await solidRow(s, '0000FF');
    await addStroke(s, '000000', 6);
    await paintSwatch(s, 'Stroke').click();
    await paintColor(s, 'FF0000');
    await closePaint(s);
    await expect(field(s, 'Stroke color')).toHaveValue('FF0000');
    await expectStroke(s, name, { color: 'FF0000' });
    await expectFill(s, name, '0000FF', 1);
    await s.select('Circle');
    await expectPixel(s, name, 2, 35, 'FF0000');
    await expectPixel(s, name, 75, 37, '0000FF');
  }),

  program('DESIGN-STROKE-GEOMETRY', 'Inspect stroke alignment for a closed shape', async s => {
    const name = await movedPaint(s);
    await solidRow(s, 'FFFFFF');
    await addStroke(s, '000000', 2, 'Inside');
    await s.select('Circle');
    const background = await layerPixel(s, name, -5, 42);
    await expectPixel(s, name, 1, 42, '000000');
    await expectPixel(s, name, -1, 42, background.slice(0, 3));
    await s.select(name);
    await choose(s, strokeAlign(s), 'Center');
    await number(strokeWidth(s), 2);
    await expect(strokeAlign(s)).toContainText('Center');
    await expectStroke(s, name, { alignment: 'center', width: 2 });
    await s.select('Circle');
    await expectPixel(s, name, -1, 42, '000000');
    await expectPixel(s, name, 3, 42, 'FFFFFF');
  }),

  program('DESIGN-EFFECTS-LIST', 'Hide and restore a Drop shadow', async s => {
    const name = await movedPaint(s);
    const background = await layerPixel(s, name, 70, 88);
    await addShadow(s);
    await shadowValues(s, 0, 14, 0, 2);
    await closePopup(s);
    const shown = await layerPixel(s, name, 70, 88);
    expect(shown[0]!).toBeLessThan(background[0]! - 25);
    const toggle = button(s, /^(?:Toggle shadow visibility|Hide shadow|Show shadow)$/i);
    await toggle.click();
    await expectPixel(s, name, 70, 88, background.slice(0, 3));
    await toggle.click();
    await expectPixel(s, name, 70, 88, shown.slice(0, 3));
    await shadowOpen(s).click();
    await assertShadowFields(s, 0, 14, 0, 2);
    await closePopup(s);
    await button(s, /^(?:Remove effect|Remove shadow)$/i).click();
    await expect(shadowOpen(s)).toHaveCount(0);
    await expect(button(s, 'Add effect')).toBeVisible();
    await expectPixel(s, name, 70, 88, background.slice(0, 3));
  }),

  program('DESIGN-EFFECTS-VALUES', 'Reopen shadow settings', async s => {
    const name = await movedPaint(s);
    const before = (await s.object(name)).geometry;
    await addShadow(s);
    await shadowValues(s, 0, 4, 12, 0);
    await closePopup(s);
    await shadowOpen(s).click();
    await assertShadowFields(s, 0, 4, 12, 0);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('EDITOR-IMAGE', 'Open Image controls for an existing fill', async s => {
    const name = 'Image box';
    await s.select(name);
    const start = await s.object(name);
    const mode = button(s, 'Image mode');
    const preview = namedRegion(s, /^(?:Image preview|Source image preview)$/i)
      .or(role(s.page, 'img', /^(?:Image preview|Source image(?: preview)?)$/i));
    const background = await s.pixel(130, 35);
    await paintSwatch(s).click();
    await expect(preview).toBeVisible();
    await choose(s, mode, 'Fit');
    await expect(mode).toContainText('Fit');
    await s.check(snapshot => expect(s.lookup(snapshot, name).image?.mode).toBe('fit'));
    await expectPixel(s, name, 35, 6, background.slice(0, 3));
    await choose(s, mode, 'Fill');
    await expect(mode).toContainText('Fill');
    await s.check(snapshot => expect(s.lookup(snapshot, name).image?.mode).toBe('fill'));
    const fillSample = await layerPixel(s, name, 35, 6);
    expect(Math.max(...fillSample.slice(0, 3).map((value, index) => Math.abs(value - background[index]!)))).toBeGreaterThan(25);
    await preview.hover();
    const [chooser] = await Promise.all([
      s.page.waitForEvent('filechooser', { timeout: 5_000 }),
      button(s, 'Upload from computer').click(),
    ]);
    await chooser.setFiles([]);
    await s.press('Escape');
    await s.check(snapshot => {
      const current = s.lookup(snapshot, name);
      expect(current.geometry).toEqual(start.geometry);
      expect(current.image).toMatchObject({ mode: 'fill', sourceWidth: 120, sourceHeight: 80 });
    });
    await expectPixel(s, name, 35, 6, fillSample.slice(0, 3));
    if (!await preview.isVisible()) await paintSwatch(s).click();
    await expect(preview).toBeVisible();
  }),

  program('DESIGN-STROKE-PAINT', 'Add a second stroke paint without replacing the first', async s => {
    const name = await movedPaint(s);
    await solidRow(s, '0000FF');
    await addStroke(s, 'FF0000', 4, 'Center');
    await button(s, 'Add stroke').click();
    await expect(hexField(s)).toBeVisible();
    await expect(paintSwatch(s, 'Stroke')).toHaveCount(2);
    await number(field(s, 'Stroke opacity').nth(0), 20);
    await expect(field(s, 'Stroke color').nth(1)).toHaveValue('FF0000');
    await closePaint(s);
    await togglePaint(s, 'Stroke');
    await expectPixel(s, name, -1, 45, 'FF0000');
    await removePaint(s, 'Stroke').nth(0).click();
    await expect(paintSwatch(s, 'Stroke')).toHaveCount(1);
    await expect(field(s, 'Stroke color')).toHaveValue('FF0000');
    await expectPixel(s, name, -1, 45, 'FF0000');
    await number(strokeWidth(s), 4);
    await expect(strokeAlign(s)).toContainText('Center');
    await expectFill(s, name, '0000FF', 1);
  }),

  program('DESIGN-STROKE-SIDES', 'Edit individual stroke sides', async s => {
    const name = await movedPaint(s);
    await solidRow(s, '0000FF');
    const before = (await s.object(name)).geometry;
    await addStroke(s, '000000', 2, 'Inside');
    await prepareStrokeSides(s, [0, 4, 2, 6]);
    await reselectPaint(s);
    await checkSides(s, [0, 4, 2, 6]);
    await expect(strokeWidth(s)).toHaveValue('Mixed');
    await s.select('Circle');
    await expectPixel(s, name, 1, 40, '0000FF');
    await expectPixel(s, name, 75, 3, '000000');
    await expectPixel(s, name, 75, 4, '0000FF');
    await expectPixel(s, name, 158, 40, '000000');
    await expectPixel(s, name, 157, 40, '0000FF');
    await expectPixel(s, name, 75, 74, '000000');
    await expectPixel(s, name, 75, 73, '0000FF');
    await expectFill(s, name, '0000FF', 1);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('DESIGN-STROKE-STYLE', 'Edit and reopen a dashed stroke', async s => {
    const name = await movedPaint(s);
    await solidRow(s, '0000FF');
    const before = (await s.object(name)).geometry;
    await addStroke(s, '000000', 4, 'Inside');
    const settings = button(s, 'Stroke settings');
    const cap = button(s, /^(?:Round cap|Round dash cap)$/i);
    await settings.click();
    await choose(s, button(s, 'Stroke style'), 'Dashed');
    await put(field(s, 'Dash'), 8);
    await put(field(s, 'Gap'), 4);
    await button(s, /^(?:No cap|None dash cap)$/i).click();
    await closePopup(s);
    await s.select('Circle');
    const pixels = await Promise.all([22, 26, 30, 34, 38, 42, 46, 50].map(x => layerPixel(s, name, x, 1)));
    expect(pixels.some(pixel => pixel[2]! < 25), 'dash painted').toBe(true);
    expect(pixels.some(pixel => pixel[2]! > 180), 'gap remains visible').toBe(true);
    await s.select(name);
    await settings.click();
    await cap.click();
    await closePopup(s);
    await settings.click();
    await expect(button(s, 'Stroke style')).toContainText('Dashed');
    await number(field(s, 'Dash'), 8);
    await number(field(s, 'Gap'), 4);
    await expect(cap).toHaveAttribute('aria-pressed', 'true');
    await closePopup(s);
    await expectStroke(s, name, { color: '000000', width: 4, style: 'dashed' });
    await expectFill(s, name, '0000FF', 1);
    expect((await s.object(name)).geometry).toEqual(before);
  }),

  program('DESIGN-STROKE-SIDES', 'Set a common weight after individual side edits', async s => {
    const name = await movedPaint(s);
    const before = await s.object(name);
    await addStroke(s);
    await prepareStrokeSides(s, [0, 4, 2, 6]);
    await expect(strokeWidth(s)).toHaveValue('Mixed');
    await put(strokeWidth(s), 5);
    await checkSides(s, [5, 5, 5, 5]);
    await number(strokeWidth(s), 5);
    await reselectPaint(s);
    await expect(sideField(s, 'Left')).toBeHidden();
    await number(strokeWidth(s), 5);
    await openStrokeSides(s);
    await expect(option(s, 'All')).toBeVisible();
    await option(s, 'Custom').click();
    await checkSides(s, [5, 5, 5, 5]);
    await number(strokeWidth(s), 5);
    await s.select('Circle');
    for (const [x, y] of [[4, 35], [155, 35], [70, 4], [70, 75]]) await expectPixel(s, name, x!, y!, '000000');
    const current = await s.object(name);
    expect(current.fill).toEqual(before.fill);
    expect(current.geometry).toEqual(before.geometry);
  }),

  program('DESIGN-STROKE-SIDES', 'Keep the chosen side width when applying a preset', async s => {
    const name = await movedPaint(s);
    await solidRow(s, '0000FF');
    await addStroke(s);
    await prepareStrokeSides(s, [0, 4, 2, 6]);
    const sidesMenu = button(s, 'Individual strokes');
    await choose(s, sidesMenu, 'Top');
    await number(strokeWidth(s), 4);
    await expectStroke(s, name, { sideWidths: { left: 0, top: 4, right: 0, bottom: 0 } });
    await s.select('Circle');
    await expectPixel(s, name, 75, 3, '000000');
    await expectPixel(s, name, 75, 4, '0000FF');
    await expectPixel(s, name, 2, 35, '0000FF');
    await s.select(name);
    if (!await sidesMenu.isVisible()) await button(s, 'Stroke sides').click();
    await choose(s, sidesMenu, 'Left');
    await number(strokeWidth(s), 4);
    await expectStroke(s, name, { sideWidths: { left: 4, top: 0, right: 0, bottom: 0 } });
    await s.select('Circle');
    await expectPixel(s, name, 3, 35, '000000');
    await expectPixel(s, name, 4, 35, '0000FF');
    await expectPixel(s, name, 75, 2, '0000FF');
  }),

  program('DESIGN-STROKE-STYLE', 'Use automatic or explicit dash spacing', async s => {
    const name = await movedPaint(s);
    const before = await s.object(name);
    await addStroke(s);
    const settings = button(s, 'Stroke settings');
    const dash = field(s, 'Dash');
    const gap = field(s, 'Gap');
    await settings.click();
    await choose(s, button(s, 'Stroke style'), 'Dashed');
    await number(dash, 8);
    await expect(gap).toHaveValue('');
    await expect(gap).toHaveAttribute('placeholder', '8');
    await put(dash, 10);
    await expect(gap).toHaveAttribute('placeholder', '10');
    await put(gap, 4);
    await number(gap, 4);
    await s.check(snapshot => expect(s.lookup(snapshot, name).stroke?.dashes).toEqual([10, 4]));
    await put(gap, '');
    await expect(gap).toHaveValue('');
    await expect(gap).toHaveAttribute('placeholder', '10');
    await closePopup(s);
    await settings.click();
    await number(dash, 10);
    await expect(gap).toHaveValue('');
    await expect(gap).toHaveAttribute('placeholder', '10');
    await s.check(snapshot => {
      const object = s.lookup(snapshot, name);
      expect(object.stroke).toMatchObject({ width: 4, style: 'dashed', dashes: [10, 10] });
      expect(object.fill).toEqual(before.fill);
      expect(object.geometry).toEqual(before.geometry);
      expect(object.id).toBe(before.id);
    });
  }),

  program('DESIGN-SELECTION-COLORS', 'Edit and select matching Fill and Stroke paints', async s => {
    await drawGroup(s, 4);
    await s.select('B');
    await removePaint(s, 'Fill').click();
    await addStroke(s, 'FF0000', 4, 'Center');
    await s.select('C');
    await put(fillAlpha(s), 50);
    await groupABC(s);
    const before = await s.obs();
    await expect(s.page.getByText('Selection colors', { exact: true })).toBeVisible();
    await expect(selectedHex(s)).toHaveCount(2);
    await expect(selectedAlpha(s)).toHaveCount(2);
    const alphas = await selectedAlpha(s).evaluateAll(els => els.map(el => Number((el as HTMLInputElement).value.replace(/%$/, ''))));
    expect([...alphas].sort((a, b) => a - b)).toEqual([50, 100]);
    const opaque = alphas.indexOf(100);
    await expect(selectedHex(s).nth(opaque)).toHaveValue('FF0000');
    await expect(selectedHex(s).nth(1 - opaque)).toHaveValue('FF0000');
    await put(selectedHex(s).nth(opaque), '0000FF');
    await expectFill(s, 'A', '0000FF', 1);
    await expectStroke(s, 'B', { color: '0000FF', opacity: 1, alignment: 'center', width: 4 });
    await expectFill(s, 'C', 'FF0000', 0.5);
    await expectFill(s, 'D', 'FF0000', 1);
    const values = await selectedHex(s).evaluateAll(els => els.map(el => (el as HTMLInputElement).value));
    await button(s, /^(?:Select layers using this color|Select uses)$/i).nth(values.indexOf('0000FF')).click();
    await s.check(snapshot => {
      expect([...snapshot.selectionIds].sort()).toEqual(['A', 'B'].map(name => s.lookup(snapshot, name).id).sort());
      for (const name of ['A', 'B', 'C', 'D']) {
        expect(s.lookup(snapshot, name).geometry).toEqual(s.lookup(before, name).geometry);
        expect(s.lookup(snapshot, name).parentId).toBe(s.lookup(before, name).parentId);
      }
    });
  }),

  program('DESIGN-SELECTION-COLORS', 'Edit a shared Linear paint', async s => {
    await drawGroup(s, 3);
    for (const name of ['A', 'B']) {
      await s.select(name);
      await prepareGradient(s);
      await closePaint(s);
    }
    await groupABC(s);
    await expect(selectedSwatch(s)).toHaveCount(2);
    await expect(selectedHex(s)).toHaveCount(1);
    const linear = s.page.getByText('Linear', { exact: true });
    const linearBox = await linear.boundingBox();
    expect(linearBox).not.toBeNull();
    const swatches = await selectedSwatch(s).all();
    const distances = await Promise.all(swatches.map(async swatch => {
      const box = await swatch.boundingBox();
      return box ? Math.abs(box.y + box.height / 2 - (linearBox!.y + linearBox!.height / 2)) : Infinity;
    }));
    await swatches[distances.indexOf(Math.min(...distances))]!.click();
    await expect(button(s, 'Rotate gradient')).toBeDisabled();
    await expect(stopPosition(s)).toHaveCount(2);
    await put(field(s, 'Gradient start color'), '0000FF');
    await closePaint(s);
    await s.check(snapshot => {
      for (const name of ['A', 'B']) {
        const item = s.lookup(snapshot, name);
        expect(item.gradient?.stops).toEqual([
          { position: 0, color: '0000FF', opacity: 1 }, { position: 1, color: '990000', opacity: 1 },
        ]);
      }
      expect(s.lookup(snapshot, 'C').fill).toEqual({ color: 'FF0000', opacity: 1 });
    });
    const beforeA = await layerPixel(s, 'A', 25, 25);
    await s.select('B');
    await paintSwatch(s).click();
    await expect(button(s, 'Rotate gradient')).toBeEnabled();
    await button(s, 'Rotate gradient').click();
    await closePaint(s);
    await s.select('G');
    await expect(selectedSwatch(s)).toHaveCount(3);
    await expect(s.page.getByText('Linear', { exact: true })).toHaveCount(2);
    await expect(selectedHex(s)).toHaveCount(1);
    await expect(selectedAlpha(s)).toHaveCount(3);
    for (let i = 0; i < 3; i++) await number(selectedAlpha(s).nth(i), 100);
    await expectPixel(s, 'A', 25, 25, beforeA.slice(0, 3));
  }),

  program('DESIGN-SELECTION-COLORS', 'Detach one shared Color Style entry', async s => {
    await drawGroup(s, 4);
    const openPicker = async () => {
      const named = button(s, 'Fill style picker');
      if (await named.isVisible()) {
        await named.click();
        return;
      }
      const heading = s.page.getByText('Fill', { exact: true });
      const anchor = await heading.boundingBox();
      expect(anchor).not.toBeNull();
      const actions = await button(s, 'Apply styles').all();
      const offsets = await Promise.all(actions.map(async action => {
        const box = await action.boundingBox();
        return box ? Math.abs(box.y + box.height / 2 - (anchor!.y + anchor!.height / 2)) : Infinity;
      }));
      await actions[offsets.indexOf(Math.min(...offsets))]!.click();
    };
    await s.select('A');
    await solidRow(s, 'F43F5E');
    await openPicker();
    await button(s, 'Create style').click();
    await put(field(s, 'Style name'), 'Action');
    await put(field(s, 'Style color'), 'F43F5E');
    await button(s, 'Create style confirm').click();
    for (const name of ['A', 'B', 'D']) {
      await s.select(name);
      if (!(await s.object(name)).styles?.fillSourceId) {
        await openPicker();
        await option(s, 'Action').or(button(s, 'Action')).click();
      }
    }
    await s.select('C');
    await solidRow(s, 'F43F5E');
    await groupABC(s);
    const dSource = (await s.object('D')).styles?.fillSourceId;
    expect(dSource).toBeTruthy();
    await s.check(snapshot => {
      for (const name of ['A', 'B']) expect(s.lookup(snapshot, name).styles?.fillSourceId).toBe(dSource);
    });
    await expect(selectedHex(s)).toHaveCount(1);
    await expect(selectedHex(s)).toHaveValue('F43F5E');
    const actionStyle = s.page.getByText('Action', { exact: true });
    await expect(actionStyle).toBeVisible();
    await actionStyle.hover();
    await button(s, 'Detach style').click();
    await expect(actionStyle).toHaveCount(0);
    await expect(selectedHex(s)).toHaveCount(1);
    await expect(selectedHex(s)).toHaveValue('F43F5E');
    await s.check(snapshot => {
      for (const name of ['A', 'B', 'C']) {
        expect(s.lookup(snapshot, name).styles?.fillSourceId ?? null).toBeNull();
        expect(s.lookup(snapshot, name).fill).toEqual({ color: 'F43F5E', opacity: 1 });
      }
      expect(s.lookup(snapshot, 'D').styles?.fillSourceId).toBe(dSource);
      expect(s.lookup(snapshot, 'D').fill).toEqual({ color: 'F43F5E', opacity: 1 });
    });
    for (const name of ['A', 'B']) {
      await s.select(name);
      await expect(fillValue(s)).toHaveValue('F43F5E');
    }
    await s.select('D');
    await expect(button(s, 'Fill style')).toContainText('Action');
  }),

  program('EDITOR-IMAGE', 'Choose a crop ratio from the full image', async s => {
    const name = 'Image box';
    await s.select(name);
    await s.check(snapshot => {
      const object = s.lookup(snapshot, name);
      expect(object.geometry).toEqual({ x: 0, y: 0, width: 80, height: 80 });
      expect(object.image).toMatchObject({ mode: 'fill', sourceWidth: 120, sourceHeight: 80 });
    });
    await paintSwatch(s).click();
    const ratio = button(s, /^(?:Crop aspect ratio|Aspect ratio)$/i);
    await ratio.click();
    const landscape = option(s, 'Landscape');
    await landscape.hover();
    if (!await option(s, '16:9').isVisible()) await landscape.click();
    await option(s, '16:9').click();
    const apply = button(s, /^(?:Apply crop|Submit crop|Apply|Done)$/i);
    await apply.click();
    await s.check(snapshot => {
      const object = s.lookup(snapshot, name);
      const { geometry, image } = object;
      expect(geometry.x).toBeCloseTo(-20, 1);
      expect(geometry.y).toBeCloseTo(6.25, 1);
      expect(geometry.width).toBeCloseTo(120, 1);
      expect(geometry.height).toBeCloseTo(67.5, 1);
      expect(image).toMatchObject({ mode: 'crop', sourceWidth: 120, sourceHeight: 80 });
      expect(image?.cropWidth).toBeCloseTo(120, 1);
      expect(image?.cropHeight).toBeCloseTo(80, 1);
      expect(geometry.x + geometry.width / 2 + Number(image?.cropOffsetX ?? 0)).toBeCloseTo(40, 1);
      expect(geometry.y + geometry.height / 2 + Number(image?.cropOffsetY ?? 0)).toBeCloseTo(40, 1);
      expect(image?.cropRotation ?? 0).toBe(0);
    });
    await paintSwatch(s).click();
    await expect(ratio).toBeEnabled();
    await expect(namedRegion(s, /^(?:Image preview|Source image preview)$/i)
      .or(role(s.page, 'img', /^(?:Image preview|Source image(?: preview)?)$/i))).toBeVisible();
    await expect(button(s, /^(?:Crop (?:top left|top right|bottom left|bottom right)(?: handle)?)$/i)).toHaveCount(4);
  }),

  program('EDITOR-PAINT-TYPE', 'Switch paint types and reopen the editor', async s => {
    await s.select('Paint');
    await put(fillAlpha(s), 60);
    await paintSwatch(s).click();
    await expect(hexField(s)).toBeVisible();
    await paintType(s, 'Gradient');
    await expect(stopPosition(s)).toHaveCount(2);
    await number(fillAlpha(s), 60);
    await closePaint(s);
    await paintSwatch(s).click();
    await expect(gradientType(s)).toContainText('Linear');
    await expect(stopPosition(s)).toHaveCount(2);
    await number(fillAlpha(s), 60);
    await paintType(s, 'Solid');
    await expect(hexField(s)).toBeVisible();
    await expect(button(s, 'Color format')).toBeVisible();
    await expect(gradientType(s)).toBeHidden();
    await number(fillAlpha(s), 60);
    await closePaint(s);
    await expect(fillValue(s)).toBeVisible();
    await number(fillAlpha(s), 60);
  }),
];
