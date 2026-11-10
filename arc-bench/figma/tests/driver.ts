import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { parse } from 'yaml';
import { assertRenderedArtifact } from './rendered-artifact.js';
import {
  assertAcceptanceShape,
  requireAutomatedAcceptance,
  assertArtifact,
  assertObserveAssertion,
  assertObservation,
  requireBaseUrl,
  resolveSelectedNamedObject,
  type AcceptanceAction,
  type Acceptance,
  type ObserveSnapshot,
} from './oracles.js';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const EVALUATION_PATH = path.join(REPO_ROOT, 'tests', 'evaluation.yaml');
export const REQUIREMENTS_PATH = path.join(REPO_ROOT, 'requirements', 'requirements.yaml');

export interface AtomicRequirement {
  id: string;
  name: string;
  type: string;
  children?: AtomicRequirement[];
  x_benchmark?: { specification_version: string };
  scenarios?: Array<{
    name: string;
    x_acceptance?: Acceptance;
  }>;
}

export interface ScenarioCase {
  requirementId: string;
  requirementName: string;
  scenario: NonNullable<AtomicRequirement['scenarios']>[number];
}

export function parseRequirementsYaml(source: string): AtomicRequirement {
  return parse(source, { uniqueKeys: true }) as AtomicRequirement;
}

export async function loadScenarioCases(): Promise<ScenarioCase[]> {
  const inventory = readFile(path.join(REPO_ROOT, 'tests', 'scenario-index.yaml'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(REQUIREMENTS_PATH, 'utf8');
  });
  const [source, evaluation] = await Promise.all([inventory, readFile(EVALUATION_PATH, 'utf8')]);
  return collectScenarioCases(parseRequirementsYaml(source), parse(evaluation, { uniqueKeys: true }));
}

export interface EvaluationFile {
  version: number;
  specification_version: string;
  scenarios: Array<{ requirement: string; name: string; acceptance: Acceptance }>;
}

export function collectScenarioCases(root: AtomicRequirement, evaluation: EvaluationFile): ScenarioCase[] {
  if (evaluation?.version !== 1 || typeof evaluation.specification_version !== 'string' ||
      evaluation.specification_version !== root.x_benchmark?.specification_version)
    throw new Error('Evaluation version does not match requirements.');
  if (!Array.isArray(evaluation.scenarios)) throw new Error('Evaluation scenarios must be an array.');
  const key = (requirement: string, name: string) => JSON.stringify([requirement, name]);
  const records = new Map<string, Acceptance>();
  for (const record of evaluation.scenarios) {
    if (!record || typeof record.requirement !== 'string' || !record.requirement || typeof record.name !== 'string' || !record.name)
      throw new Error('Evaluation record is missing requirement/name.');
    const identity = key(record.requirement, record.name);
    if (records.has(identity)) throw new Error(`Duplicate evaluation record: ${identity}`);
    assertAcceptanceShape(record.acceptance);
    records.set(identity, record.acceptance);
  }
  const used = new Set<string>();
  const cases: ScenarioCase[] = [];
  const ids = new Set<string>();

  function visit(node: AtomicRequirement): void {
    if (!node.id || ids.has(node.id)) throw new Error(`Missing or duplicate requirement ID: ${node.id}`);
    ids.add(node.id);
    if (node.type === 'ATOMIC') {
      if (node.children?.length) throw new Error(`${node.id}: ATOMIC cannot contain children.`);
      if (!node.scenarios?.length) throw new Error(`${node.id}: ATOMIC has no scenarios.`);
      for (const scenario of node.scenarios ?? []) {
        if ('x_acceptance' in scenario) throw new Error('Requirements must not embed evaluation programs.');
        const identity = key(node.id, scenario.name);
        if (used.has(identity)) throw new Error(`Duplicate scenario: ${identity}`);
        const acceptance = records.get(identity);
        if (!acceptance) throw new Error(`Missing evaluation record: ${identity}`);
        used.add(identity);
        // This joined object exists only in the evaluator, never in a generated requirement file.
        cases.push({ requirementId: node.id, requirementName: node.name,
          scenario: { ...scenario, x_acceptance: acceptance } });
      }
      return;
    }
    if (node.type !== 'FOLDER' || !node.children?.length) throw new Error(`${node.id}: expected a nonempty FOLDER.`);
    for (const child of node.children) visit(child);
  }

  visit(root);
  if (used.size !== records.size) throw new Error('Orphan evaluation record.');
  if (cases.length === 0) throw new Error('requirements.yaml contains no ATOMIC scenarios.');
  return cases;
}

export interface LocatorSpec {
  role?: string;
  name?: string;
  exact?: boolean;
  selected?: boolean;
  region?: string;
  label?: string;
  text?: string;
  testId?: string;
}

function locator(page: Page, spec: LocatorSpec | undefined): Locator {
  if (!spec) throw new Error('UI action is missing target locator.');
  const forms = [spec.role !== undefined, spec.label !== undefined, spec.text !== undefined, spec.testId !== undefined]
    .filter(Boolean).length;
  if (forms !== 1) throw new Error('Locator must specify exactly one of role, label, text, or testId.');
  const scope = spec.region ? page.getByRole('region', { name: spec.region, exact: true }) : page;
  if (spec.role !== undefined) {
    if (!spec.name && !(spec.role === 'tab' && spec.selected === true)) throw new Error('Role locator requires an accessible name or the current tab.');
    return scope.getByRole(spec.role as never, { name: spec.name, exact: spec.exact ?? true, selected: spec.selected });
  }
  if (spec.label !== undefined) return scope.getByLabel(spec.label, { exact: spec.exact ?? true });
  if (spec.text !== undefined) return scope.getByText(spec.text, { exact: spec.exact ?? true });
  return scope.getByTestId(spec.testId!);
}

export async function renameSelectedLayer(page: Page, value: string): Promise<void> {
  const selected = resolveSelectedNamedObject(await readObservation(page));
  const oldName = selected.name!;
  const selectedRow = (name: string) => page.getByTestId(`layer:${name}`).and(page.locator('[aria-selected="true"]'));
  const oldRow = selectedRow(oldName);
  const oldLabel = oldRow.getByTestId(`layer-name:${oldName}`);
  await expect(oldRow).toBeVisible();
  await expect.poll(() => oldRow.getAttribute('aria-selected')).toBe('true');
  await expect(oldLabel).toBeVisible();
  await expect(oldLabel).toHaveText(oldName);

  await oldLabel.dblclick();
  const editor = page.getByRole('textbox', { name: 'Layer name', exact: true });
  await editor.fill(value);
  await editor.press('Enter');
  await expect(editor).toBeHidden();

  const newRow = selectedRow(value);
  const newLabel = newRow.getByTestId(`layer-name:${value}`);
  await expect(newRow).toBeVisible();
  await expect(newRow).toHaveAttribute('aria-selected', 'true');
  await expect(newLabel).toBeVisible();
  await expect(newLabel).toHaveText(value);
}

async function performAction(page: Page, action: AcceptanceAction, testInfo: TestInfo, artifacts: Map<string, string>): Promise<Page | undefined> {
  switch (action.type) {
    case 'click':
      await locator(page, action.target).click({
        ...(action.button ? { button: action.button } : {}),
        ...(action.position ? { position: action.position } : {}),
        ...(action.modifiers ? { modifiers: action.modifiers } : {}),
        ...(action.clickCount ? { clickCount: action.clickCount } : {}),
      });
      return;
    case 'fill':
      if (action.value === undefined) throw new Error('Fill action requires value.');
      await locator(page, action.target).fill(action.value);
      return;
    case 'renameSelection': {
      await renameSelectedLayer(page, action.value);
      return;
    }
    case 'press':
      if (!action.key) throw new Error('Press action requires key.');
      if (action.target) await locator(page, action.target).press(action.key);
      else await page.keyboard.press(action.key);
      return;
    case 'drag': {
      if (!action.target || !action.from || !action.to) throw new Error('Drag action requires target, from, and to points relative to target bounds.');
      const box = await locator(page, action.target).boundingBox();
      if (!box) throw new Error('Cannot drag: target has no visible bounding box.');
      const from = { x: box.x + action.from.x, y: box.y + action.from.y };
      const to = { x: box.x + action.to.x, y: box.y + action.to.y };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      return;
    }
    case 'fileChooser': {
      if (!action.fixture) throw new Error('fileChooser action requires a repository fixture path.');
      const fixture = path.resolve(REPO_ROOT, action.fixture);
      if (!fixture.startsWith(`${REPO_ROOT}${path.sep}`)) {
        throw new Error(`Fixture path must stay inside the repository: ${action.fixture}`);
      }
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 10_000 });
      await locator(page, action.target).click();
      const chooser = await chooserPromise;
      await chooser.setFiles(fixture);
      return;
    }
    case 'download': {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(action.artifact) || action.artifact.includes('..')) {
        throw new Error('Download action requires an artifact alias without directory components.');
      }
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await locator(page, action.target).click();
      const download = await downloadPromise;
      await mkdir(testInfo.outputPath('artifacts'), { recursive: true });
      const destination = testInfo.outputPath('artifacts', action.artifact);
      await download.saveAs(destination);
      artifacts.set(action.artifact, destination);
      await testInfo.attach(`download-${action.artifact}`, { path: destination });
      return;
    }
    case 'reopen': {
      const currentUrl = page.url();
      const context = page.context();
      await page.close();
      const reopened = await context.newPage();
      await reopened.goto(currentUrl, { waitUntil: 'domcontentloaded' });
      await assertObserverAvailable(reopened);
      return reopened;
    }
    default: {
      throw new Error('Unsupported UI action.');
    }
  }
}

async function performActions(page: Page, actions: AcceptanceAction[], testInfo: TestInfo, artifacts: Map<string, string>): Promise<Page> {
  let currentPage = page;
  for (const action of actions) {
    const replacement = await performAction(currentPage, action, testInfo, artifacts);
    if (replacement) currentPage = replacement;
  }
  return currentPage;
}

export async function readObservation(page: Page): Promise<ObserveSnapshot> {
  const result = await page.evaluate(async () => {
    const host = window as Window & { arcBench?: { observe?: () => unknown | Promise<unknown> } };
    if (typeof host.arcBench?.observe !== 'function') {
      throw new Error('Required read-only window.arcBench.observe() is unavailable.');
    }
    return await host.arcBench.observe();
  });
  assertObservation(result);
  return result;
}

async function assertObserverAvailable(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const host = window as Window & { arcBench?: { observe?: unknown } };
    return typeof host.arcBench?.observe === 'function';
  }), { timeout: 8_000 }).toBe(true);
}

export function createEntryUrl(baseURL: string, seed: string, worksetId: string): string {
  const entryURL = new URL(baseURL);
  entryURL.searchParams.set('arc_workset', worksetId);
  entryURL.searchParams.set('arc_seed', seed);
  return entryURL.toString();
}

async function readEntryObservation(page: Page, expected: { seed: string; worksetId: string }): Promise<ObserveSnapshot> {
  const snapshot = await readObservation(page);
  if (snapshot.document.seed !== expected.seed) {
    throw new Error(`Observer seed mismatch: URL requested ${expected.seed}, observed ${snapshot.document.seed}.`);
  }
  if (snapshot.document.worksetId !== expected.worksetId) {
    throw new Error(`Observer worksetId mismatch: URL requested ${expected.worksetId}, observed ${snapshot.document.worksetId}.`);
  }
  return snapshot;
}

export async function runAcceptance(page: Page, acceptance: Acceptance, testInfo: TestInfo): Promise<void> {
  assertAcceptanceShape(acceptance);
  requireAutomatedAcceptance(acceptance);
  const baseURL = requireBaseUrl(process.env.BASE_URL);
  const seed = acceptance.seed ?? 'blank';
  const worksetId = `${testInfo.testId}-retry${testInfo.retry}-${randomUUID()}`;
  const entryURL = createEntryUrl(baseURL, seed, worksetId);
  await page.goto(entryURL, { waitUntil: 'domcontentloaded' });
  await assertObserverAvailable(page);
  const expectedEntry = { seed, worksetId };
  await expect(() => readEntryObservation(page, expectedEntry)).toPass({ timeout: 8_000 });

  const artifacts = new Map<string, string>();
  let activePage = await performActions(page, acceptance.setup ?? [], testInfo, artifacts);
  if (acceptance.setup?.length) {
    const setupSnapshot = await readEntryObservation(activePage, expectedEntry);
    await testInfo.attach('setup-observation.json', { body: JSON.stringify(setupSnapshot, null, 2), contentType: 'application/json' });
  }

  const priorStages = new Map<string, ObserveSnapshot>();
  for (const [index, stage] of acceptance.stages.entries()) {
    activePage = await performActions(activePage, stage.actions, testInfo, artifacts);
    const safeName = `${String(index + 1).padStart(2, '0')}-${stage.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 44) || 'stage'}`;
    let snapshot: ObserveSnapshot | undefined;
    try {
      // 轮询公开 observer，等待 UI 编辑反映到语义状态；超时直接失败，不用固定 sleep 或状态 API 兜底。
      await expect(async () => {
        const candidate = await readEntryObservation(activePage, expectedEntry);
        snapshot = candidate;
        for (const assertion of stage.assertions) {
          if (assertion.source === 'observe') assertObserveAssertion(candidate, assertion, priorStages);
        }
      }).toPass({ timeout: 8_000, intervals: [100, 250, 500, 1_000] });
    } catch (error) {
      if (snapshot) {
        await testInfo.attach(`${safeName}-failed-observation.json`, { body: JSON.stringify(snapshot, null, 2), contentType: 'application/json' });
      }
      try {
        const shot = await activePage.screenshot({ fullPage: true });
        await testInfo.attach(`${safeName}-failed-ui.png`, { body: shot, contentType: 'image/png' });
      } catch { /* Preserve the original assertion error if the page has already closed. */ }
      throw error;
    }
    if (!snapshot) throw new Error(`Stage ${stage.name} produced no observer snapshot.`);

    const savedSnapshot = snapshot;
    await testInfo.attach(`${safeName}-observation.json`, { body: JSON.stringify(savedSnapshot, null, 2), contentType: 'application/json' });
    const shot = await activePage.screenshot({ fullPage: true });
    await testInfo.attach(`${safeName}-ui.png`, { body: shot, contentType: 'image/png' });

    for (const assertion of stage.assertions) {
      if (assertion.source === 'ui') {
        const target = locator(activePage, assertion.locator);
        if (assertion.state !== 'visible') await expect(target).toBeVisible();
        switch (assertion.state) {
          case 'visible':
            if (assertion.equals === true) await expect(target).toBeVisible();
            else await expect(target).toBeHidden();
            break;
          case 'checked':
            if (assertion.equals === true) await expect(target).toBeChecked();
            else await expect(target).not.toBeChecked();
            break;
          case 'selected':
            await expect.poll(() => target.getAttribute('aria-selected'), { timeout: 8_000 }).toBe(assertion.equals ? 'true' : 'false');
            break;
          case 'text': {
            await expect.poll(() => target.innerText(), { timeout: 8_000 }).toBe(String(assertion.equals));
            break;
          }
          case 'value': {
            await expect.poll(() => target.inputValue(), { timeout: 8_000 }).toBe(String(assertion.equals));
            break;
          }
        }
      }
    }

    for (const assertion of stage.assertions) {
      if (assertion.source === 'artifact') {
        const filePath = artifacts.get(assertion.artifact);
        if (!filePath) throw new Error(`Artifact \"${assertion.artifact}\" was not downloaded by an earlier UI action.`);
        const bytes = await readFile(filePath);
        if (assertion.format === 'png') assertArtifact(bytes, 'png', { width: assertion.width, height: assertion.height });
        else if (assertion.minimumPaths !== undefined) assertArtifact(bytes, 'svg', { minimumPaths: assertion.minimumPaths });
        await assertRenderedArtifact(activePage, bytes, assertion);
      }
    }
    priorStages.set(stage.name, savedSnapshot);
  }
}

export { assertAcceptanceShape };
