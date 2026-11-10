import { isDeepStrictEqual } from 'node:util';

export interface ObserveObject {
  id: string;
  type: string;
  name?: string;
  pageId: string;
  parentId: string | null;
  siblingIndex: number;
  geometry: { x: number; y: number; width: number; height: number };
  text?: string;
  textRuns?: Array<{ start: number; end: number; fontStyle?: string; fill?: string; text?: string }>;
  textSizing?: string;
  font?: Record<string, unknown>;
  pageName?: string;
  visible: boolean;
  locked: boolean;
  selected: boolean;
  fill?: { color: string; opacity: number };
  opacity?: number;
  cornerRadius?: number | Record<string, number>;
  stroke?: Record<string, unknown>;
  shadow?: Record<string, unknown> | Array<Record<string, unknown>>;
  gradient?: Record<string, unknown>;
  image?: Record<string, unknown>;
  vector?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  constraints?: Record<string, unknown>;
  component?: {
    sourceId: string;
    variant?: Record<string, string>;
    properties?: Record<string, string | boolean>;
  };
  styles?: { fillSourceId?: string; textSourceId?: string };
}

export interface ObserveSnapshot {
  schemaVersion: 1;
  document: {
    id: string;
    worksetId: string;
    seed: string;
    name?: string;
    pages: Array<{ id: string; name: string }>;
    currentPageId: string;
    pageNames?: string[];
    currentPageName?: string;
    view?: { panX?: number; panY?: number; zoom?: number; [key: string]: unknown };
    [key: string]: unknown;
  };
  selectionIds: string[];
  objects: ObserveObject[];
}

export type LocatorSpec = {
  role?: string;
  name?: string;
  exact?: boolean;
  selected?: boolean;
  region?: string;
  label?: string;
  text?: string;
  testId?: string;
};

export type AcceptanceAction =
  | { type: 'click'; target: LocatorSpec; position?: { x: number; y: number }; modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>; clickCount?: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'fill'; target: LocatorSpec; value: string }
  | { type: 'renameSelection'; value: string }
  | { type: 'press'; target?: LocatorSpec; key: string }
  | { type: 'drag'; target: LocatorSpec; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'fileChooser'; target: LocatorSpec; fixture: string }
  | { type: 'download'; target: LocatorSpec; artifact: string }
  | { type: 'reopen' };

export interface ArtifactSample {
  region: [number, number, number, number];
  color: string;
  minPixels: number;
}

export type AcceptanceAssertion =
  | { source: 'observe'; object: string; path: string; equals?: unknown; exists?: boolean; equalsObjectId?: string; sameAs?: { stage: string; object: string; path: string }; deltaFrom?: { stage: string; object: string; path: string; delta: number } }
  | { source: 'ui'; locator: LocatorSpec; state: 'visible' | 'checked' | 'selected' | 'text' | 'value'; equals: string | number | boolean }
  | { source: 'artifact'; artifact: string; format: 'png'; width: number; height: number; samples?: ArtifactSample[] }
  | { source: 'artifact'; artifact: string; format: 'svg'; minimumPaths?: number; vectorOnly?: boolean;
      outlineText?: boolean; samples?: ArtifactSample[] };

export interface AcceptanceStage {
  name: string;
  actions: AcceptanceAction[];
  assertions: AcceptanceAssertion[];
}

export interface AutomatedAcceptance {
  mode?: 'automated';
  version: 1;
  seed?: string;
  setup?: AcceptanceAction[];
  stages: AcceptanceStage[];
}

type ProtocolStep = { name: string; actions: string; expected: string; evidence: string };

export interface ScriptedAcceptance {
  version: 1;
  mode: 'scripted';
  seed?: string;
  protocol: ProtocolStep[];
}

export interface ManualAcceptance {
  version: 1;
  mode: 'manual_required';
  seed?: string;
  reason: string;
  protocol: ProtocolStep[];
}
export type Acceptance = AutomatedAcceptance | ScriptedAcceptance | ManualAcceptance;

export function requireAutomatedAcceptance(value: Acceptance): asserts value is AutomatedAcceptance {
  require(value.mode !== 'manual_required', 'manual_required: 此场景必须按公开协议执行并记录证据；自动运行不能将未执行人工验收报告为通过。');
  require(value.mode !== 'scripted', 'scripted: use the scenario program.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function requireBaseUrl(value: string | undefined): string {
  const baseURL = value?.trim() || process.env.PLAYWRIGHT_BASE_URL?.trim();
  require(baseURL, 'BASE_URL is required to run product acceptance tests; set it to the tested app URL.');
  return baseURL;
}

export function assertAcceptanceShape(value: unknown): asserts value is Acceptance {
  require(isRecord(value), 'Scenario is missing x_acceptance object.');
  require(value.version === 1, 'x_acceptance.version must equal 1.');
  if ('seed' in value) require(typeof value.seed === 'string' && value.seed.length > 0, 'x_acceptance.seed must be a non-empty string when present.');
  require(value.mode === undefined || value.mode === 'automated' || value.mode === 'manual_required' || value.mode === 'scripted',
    'Unknown acceptance mode.');
  if (value.mode === 'manual_required' || value.mode === 'scripted') {
    if (value.mode === 'manual_required') require(typeof value.reason === 'string' && value.reason.trim(), 'Manual acceptance requires a reason.');
    require(!('stages' in value) && !('setup' in value), 'A protocol cannot contain automated stages or setup.');
    require(Array.isArray(value.protocol) && value.protocol.length > 0, 'Acceptance requires a non-empty protocol.');
    const names = new Set<string>();
    for (const step of value.protocol) {
      require(isRecord(step) && ['name', 'actions', 'expected', 'evidence'].every(key => typeof step[key] === 'string' && (step[key] as string).trim()), 'Manual protocol requires name/actions/expected/evidence.');
      require(!names.has(step.name as string), 'Manual protocol names must be unique.');
      names.add(step.name as string);
    }
    return;
  }
  require(Array.isArray(value.stages) && value.stages.length > 0, 'x_acceptance.stages must be non-empty.');
  const validActionTypes = new Set(['click', 'fill', 'renameSelection', 'press', 'drag', 'fileChooser', 'download', 'reopen']);
  const validateActions = (actions: unknown[], where: string) => {
    for (const action of actions) {
      require(isRecord(action) && typeof action.type === 'string' && validActionTypes.has(action.type), `${where} has an unsupported UI action.`);
      if (action.type === 'click' || action.type === 'fill' || action.type === 'fileChooser' || action.type === 'download') {
        validateLocator(action.target, `${where} ${action.type}`);
      }
      if (action.type === 'fill') require(typeof action.value === 'string', `${where} fill action requires a string value.`);
      if (action.type === 'renameSelection') require(typeof action.value === 'string' && action.value.trim().length > 0, `${where} renameSelection requires a non-empty value.`);
      if (action.type === 'click') {
        if ('button' in action) require(['left', 'right', 'middle'].includes(String(action.button)), `${where} click button is invalid.`);
        if ('position' in action) validatePoint(action.position, `${where} click position`);
        if ('clickCount' in action) require(Number.isInteger(action.clickCount) && (action.clickCount as number) > 0, `${where} clickCount must be a positive integer.`);
        if ('modifiers' in action) require(Array.isArray(action.modifiers) && action.modifiers.every((modifier) => ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'].includes(String(modifier))), `${where} click modifiers contain an unsupported Playwright modifier.`);
      }
      if (action.type === 'press') {
        require(typeof action.key === 'string' && action.key.length > 0, `${where} press action requires a Playwright key.`);
        if ('target' in action) validateLocator(action.target, `${where} press`);
      }
      if (action.type === 'drag') {
        validateLocator(action.target, `${where} drag`);
        validatePoint(action.from, `${where} drag from`);
        validatePoint(action.to, `${where} drag to`);
      }
      if (action.type === 'fileChooser') require(typeof action.fixture === 'string', `${where} fileChooser action requires a fixture path.`);
      if (action.type === 'download') require(validArtifactAlias(action.artifact), `${where} download action requires a simple artifact alias.`);
    }
  };
  const downloadedArtifacts = new Set<string>();
  if ('setup' in value) {
    require(Array.isArray(value.setup), 'x_acceptance.setup must be an array when present.');
    validateActions(value.setup, 'setup');
    for (const action of value.setup) if (isRecord(action) && action.type === 'download' && typeof action.artifact === 'string') downloadedArtifacts.add(action.artifact);
  }
  const priorStageNames = new Set<string>();
  for (const [index, stage] of value.stages.entries()) {
    require(isRecord(stage) && typeof stage.name === 'string' && stage.name.trim().length > 0, `Stage ${index + 1} requires a name.`);
    require(!priorStageNames.has(stage.name), `Stage name must be unique: ${stage.name}.`);
    require(Array.isArray(stage.actions) && stage.actions.length > 0, `Stage ${stage.name} must contain real UI actions.`);
    require(Array.isArray(stage.assertions) && stage.assertions.length > 0, `Stage ${stage.name} assertions must be non-empty.`);
    validateActions(stage.actions, `Stage ${stage.name}`);
    for (const action of stage.actions) if (isRecord(action) && action.type === 'download' && typeof action.artifact === 'string') downloadedArtifacts.add(action.artifact);
    for (const assertion of stage.assertions) {
      require(isRecord(assertion) && ['observe', 'ui', 'artifact'].includes(String(assertion.source)), `Stage ${stage.name} assertion has an unsupported source.`);
      if (assertion.source === 'observe') {
        require(typeof assertion.object === 'string' && typeof assertion.path === 'string', 'observe assertion requires object and relative semantic path.');
        const operators = ['equals', 'exists', 'equalsObjectId', 'sameAs', 'deltaFrom'].filter((key) => key in assertion);
        require(operators.length === 1, 'observe assertion requires exactly one supported comparison operator.');
        if ('exists' in assertion) require(typeof assertion.exists === 'boolean', 'observe exists operator must be boolean.');
        if ('equalsObjectId' in assertion) require(typeof assertion.equalsObjectId === 'string', 'equalsObjectId must name an object.');
        if ('sameAs' in assertion) {
          validateStageReference(assertion.sameAs, 'sameAs');
          require(priorStageNames.has(assertion.sameAs.stage), `sameAs must reference a completed earlier stage: ${assertion.sameAs.stage}.`);
        }
        if ('deltaFrom' in assertion) {
          require(isRecord(assertion.deltaFrom), 'deltaFrom requires a stage reference and numeric delta.');
          validateStageReference(assertion.deltaFrom, 'deltaFrom');
          const delta = (assertion.deltaFrom as { delta?: unknown }).delta;
          require(typeof delta === 'number' && Number.isFinite(delta), 'deltaFrom requires a finite numeric delta.');
          require(priorStageNames.has(assertion.deltaFrom.stage), `deltaFrom must reference a completed earlier stage: ${assertion.deltaFrom.stage}.`);
        }
      }
      if (assertion.source === 'ui') {
        validateLocator(assertion.locator, `Stage ${stage.name} UI assertion`);
        require(['visible', 'checked', 'selected', 'text', 'value'].includes(String(assertion.state)) && 'equals' in assertion, 'ui assertion requires locator, visible/checked/selected/text/value state, and equals.');
        if (assertion.state === 'visible' || assertion.state === 'checked' || assertion.state === 'selected') require(typeof assertion.equals === 'boolean', `ui ${assertion.state} assertion requires a boolean equals value.`);
        if (assertion.state === 'text' || assertion.state === 'value') require(typeof assertion.equals === 'string' || typeof assertion.equals === 'number', `ui ${assertion.state} assertion requires string or numeric equals.`);
      }
      if (assertion.source === 'artifact') {
        require(validArtifactAlias(assertion.artifact) && ['png', 'svg'].includes(String(assertion.format)), 'artifact assertion requires a downloaded artifact and png/svg format.');
        require(downloadedArtifacts.has(assertion.artifact), `artifact ${assertion.artifact} must be downloaded by a UI action before assertion.`);
        if (assertion.format === 'png') require(Number.isInteger(assertion.width) && (assertion.width as number) > 0 && Number.isInteger(assertion.height) && (assertion.height as number) > 0, 'PNG artifact assertion requires positive integer width and height.');
        if (assertion.format === 'svg') {
          require((Number.isInteger(assertion.minimumPaths) && (assertion.minimumPaths as number) >= 0)
            || assertion.vectorOnly === true, 'SVG artifact assertion requires a vector result.');
        }
        if ('samples' in assertion) {
          require(Array.isArray(assertion.samples) && assertion.samples.length > 0, 'Image samples must be non-empty.');
          for (const sample of assertion.samples) {
            require(isRecord(sample) && typeof sample.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(sample.color)
              && Number.isInteger(sample.minPixels) && Number(sample.minPixels) > 0
              && Array.isArray(sample.region) && sample.region.length === 4
              && sample.region.every(value => typeof value === 'number' && value >= 0 && value <= 1),
            'An image sample needs a normalized region, RGB hex color and positive pixel count.');
            const [x, y, width, height] = sample.region as number[];
            require(width! > 0 && height! > 0 && x! + width! <= 1 && y! + height! <= 1, 'Image sample outside output.');
          }
        }
      }
    }
    require(stage.assertions.some((entry) => isRecord(entry) && entry.source === 'observe'), `Stage ${stage.name} needs a semantic observe assertion.`);
    require(stage.assertions.some((entry) => isRecord(entry) && entry.source === 'ui'), `Stage ${stage.name} needs a UI assertion; a screenshot alone is evidence, not acceptance.`);
    priorStageNames.add(stage.name);
  }
}

function validateLocator(value: unknown, where: string): asserts value is Record<string, unknown> {
  require(isRecord(value), `${where} requires a locator.`);
  const forms = ['role', 'label', 'text', 'testId'].filter((key) => value[key] !== undefined);
  require(forms.length === 1, `${where} locator must specify exactly one of role, label, text, or testId.`);
  const form = forms[0]!;
  require(typeof value[form] === 'string' && value[form].length > 0, `${where} locator ${form} must be a non-empty string.`);
  if (form === 'role') require((typeof value.name === 'string' && value.name.length > 0) || (value.role === 'tab' && value.selected === true), `${where} role locator requires a non-empty accessible name.`);
  if ('region' in value) require(typeof value.region === 'string' && value.region.trim().length > 0, `${where} region must be a non-empty accessible name.`);
  if ('selected' in value) require(form === 'role' && value.role === 'tab' && typeof value.selected === 'boolean', `${where} selected filter requires a tab role and boolean.`);
  if ('exact' in value) require(typeof value.exact === 'boolean', `${where} locator exact must be boolean.`);
}

function validatePoint(value: unknown, where: string): void {
  require(isRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y), `${where} requires finite x/y coordinates.`);
}

function validArtifactAlias(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..');
}

export function resolveSelectedNamedObject(snapshot: ObserveSnapshot): ObserveObject {
  require(snapshot.selectionIds.length === 1, `renameSelection requires exactly one selected object; found ${snapshot.selectionIds.length}.`);
  const [selectedId] = snapshot.selectionIds;
  const matches = snapshot.objects.filter((object) => object.id === selectedId);
  require(matches.length === 1, `renameSelection requires one observed selected object; found ${matches.length}.`);
  const selected = matches[0]!;
  require(typeof selected.name === 'string' && selected.name.trim().length > 0, 'renameSelection requires the selected object to have a non-empty name.');
  return selected;
}

function validateStageReference(value: unknown, operator: string): asserts value is { stage: string; object: string; path: string } {
  require(isRecord(value) && typeof value.stage === 'string' && typeof value.object === 'string' && typeof value.path === 'string', `${operator} requires stage, object, and path strings.`);
}

export function assertObservation(value: unknown): asserts value is ObserveSnapshot {
  require(isRecord(value), 'window.arcBench.observe() must return a snapshot object.');
  require(value.schemaVersion === 1, 'observe snapshot schemaVersion must be 1.');
  require(isRecord(value.document) && typeof value.document.id === 'string', 'observe snapshot must include a document id.');
  require(typeof value.document.worksetId === 'string' && typeof value.document.seed === 'string', 'observe snapshot must include worksetId and seed test-mode facts.');
  require(Array.isArray(value.document.pages) && typeof value.document.currentPageId === 'string', 'observe snapshot must include pages and currentPageId.');
  require(Array.isArray(value.selectionIds) && value.selectionIds.every((id) => typeof id === 'string'), 'observe snapshot selectionIds must be string[].');
  const selectionIds = new Set(value.selectionIds as string[]);
  require(selectionIds.size === (value.selectionIds as string[]).length, 'observe snapshot selectionIds must not contain duplicates.');
  require(Array.isArray(value.objects), 'observe snapshot objects must be an array.');
  const ids = new Set<string>();
  for (const object of value.objects) {
    require(isRecord(object), 'observe snapshot object entries must be records.');
    require(typeof object.id === 'string' && !ids.has(object.id), 'each observed object needs a unique stable id.');
    ids.add(object.id);
    require(typeof object.type === 'string' && typeof object.pageId === 'string', `object ${object.id} needs type and pageId.`);
    require(object.parentId === null || typeof object.parentId === 'string', `object ${object.id} needs parentId string|null.`);
    require(typeof object.siblingIndex === 'number' && Number.isInteger(object.siblingIndex) && object.siblingIndex >= 0, `object ${object.id} needs non-negative siblingIndex.`);
    require(isRecord(object.geometry), `object ${object.id} needs geometry.`);
    const geometry = object.geometry;
    for (const key of ['x', 'y', 'width', 'height']) require(typeof geometry[key] === 'number' && Number.isFinite(geometry[key]), `object ${object.id} geometry.${key} must be finite.`);
    require(typeof object.visible === 'boolean' && typeof object.locked === 'boolean' && typeof object.selected === 'boolean', `object ${object.id} needs visible, locked, and selected booleans.`);
    require(object.selected === selectionIds.has(object.id), `object ${object.id} selected must agree with selectionIds.`);
  }
  const objectIds = new Set((value.objects as Array<{ id: string }>).map((object) => object.id));
  require([...selectionIds].every((id) => objectIds.has(id)), 'observe snapshot selectionIds must refer to observed objects.');
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// shortcut: 这里只验PNG结构/CRC/尺寸；关闭EXPORT-CONTENT-VISUAL闸门前须补真实解码和内容比较。
export function assertPngDimensions(bytes: Uint8Array, width: number, height: number): void {
  require(bytes.byteLength >= 8, `PNG is too short to contain its signature (${bytes.byteLength} bytes).`);
  require(PNG_SIGNATURE.every((byte, index) => bytes[index] === byte), 'File does not have the PNG signature.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let chunkIndex = 0;
  let actualWidth: number | undefined;
  let actualHeight: number | undefined;
  let idatBytes = 0;
  let sawIdat = false;
  let idatClosed = false;
  let sawIend = false;

  while (offset < bytes.byteLength) {
    require(offset + 12 <= bytes.byteLength, 'PNG has a truncated chunk header or CRC.');
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    require(length <= bytes.byteLength - dataOffset - 4, 'PNG chunk length exceeds remaining file data.');
    const type = String.fromCharCode(bytes[typeOffset]!, bytes[typeOffset + 1]!, bytes[typeOffset + 2]!, bytes[typeOffset + 3]!);
    require(/^[A-Za-z]{4}$/.test(type), `PNG chunk type is invalid: ${type}.`);
    require(type[2] === type[2]!.toUpperCase(), `PNG chunk ${type} uses the reserved lowercase bit.`);
    const crcOffset = dataOffset + length;
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(bytes.subarray(typeOffset, dataOffset), 0);
    crcInput.set(bytes.subarray(dataOffset, crcOffset), 4);
    require(view.getUint32(crcOffset) === crc32(crcInput), `PNG chunk ${type} has an invalid CRC.`);

    if (chunkIndex === 0) {
      require(type === 'IHDR' && length === 13, 'PNG must begin with a 13-byte IHDR chunk.');
      actualWidth = view.getUint32(dataOffset);
      actualHeight = view.getUint32(dataOffset + 4);
      require(actualWidth > 0 && actualHeight > 0, 'PNG dimensions must be positive.');
    } else if (type === 'IHDR') {
      require(false, 'PNG must contain exactly one IHDR chunk.');
    }

    if (type === 'IDAT') {
      require(!idatClosed, 'PNG IDAT chunks must be consecutive.');
      sawIdat = true;
      idatBytes += length;
    } else if (sawIdat && type !== 'IEND') {
      idatClosed = true;
    }

    if (type[0] === type[0]!.toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
      require(false, `PNG contains an unknown critical chunk ${type}.`);
    }

    offset = crcOffset + 4;
    chunkIndex += 1;
    if (type === 'IEND') {
      require(length === 0, 'PNG IEND chunk must be empty.');
      require(sawIdat && idatBytes > 0, 'PNG must contain non-empty IDAT data before IEND.');
      require(offset === bytes.byteLength, 'PNG IEND must be the final chunk.');
      sawIend = true;
      break;
    }
  }
  require(sawIend, 'PNG is truncated or missing its final IEND chunk.');
  require(actualWidth !== undefined && actualHeight !== undefined, 'PNG is missing IHDR dimensions.');
  require(actualWidth === width && actualHeight === height, `PNG dimensions expected ${width}x${height}, got ${actualWidth}x${actualHeight}.`);
}

// shortcut: 正则仅验SVG基本标记；进入内容评分前须补XML解析、渲染和视觉比较。
export function assertSvgStructure(source: string, minimumPaths: number): void {
  require(/<svg(?:\s|>)/i.test(source), 'SVG artifact has no svg root element.');
  const paths = source.match(/<path(?:\s|\/?>)/gi)?.length ?? 0;
  require(paths >= minimumPaths, `SVG artifact expected at least ${minimumPaths} path elements, got ${paths}.`);
}

export function assertObserveAssertion(
  snapshot: ObserveSnapshot,
  assertion: Extract<AcceptanceAssertion, { source: 'observe' }>,
  priorStages: Map<string, ObserveSnapshot>,
): void {
  if (assertion.object === '$document') {
    assertSemanticValue(getPath(snapshot.document, assertion.path), assertion, priorStages, snapshot);
    return;
  }
  const matches = snapshot.objects.filter((object) => object.name === assertion.object);
  if (matches.length === 0 && assertion.path === 'id' && assertion.exists === false) return;
  require(matches.length === 1, `Expected unique observed object named "${assertion.object}", found ${matches.length}.`);
  const object = matches[0]!;
  const actual = getPath(object, assertion.path);
  assertSemanticValue(actual, assertion, priorStages, snapshot);
}

function assertSemanticValue(actual: unknown, assertion: Extract<AcceptanceAssertion, { source: 'observe' }>, priorStages: Map<string, ObserveSnapshot>, current?: ObserveSnapshot): void {
  if ('equals' in assertion && !isDeepStrictEqual(actual, assertion.equals)) {
    throw new Error(`observe ${assertion.object}.${assertion.path}: expected ${JSON.stringify(assertion.equals)}, got ${JSON.stringify(actual)}.`);
  }
  if ('exists' in assertion && (actual !== undefined) !== assertion.exists) {
    throw new Error(`observe ${assertion.object}.${assertion.path}: expected exists=${assertion.exists}, got ${actual === undefined}.`);
  }
  if ('equalsObjectId' in assertion) {
    require(current !== undefined, 'equalsObjectId requires a current snapshot.');
    const targets = current.objects.filter((object) => object.name === assertion.equalsObjectId);
    require(targets.length === 1, `Expected unique object named "${assertion.equalsObjectId}" for identity comparison, found ${targets.length}.`);
    require(actual === targets[0]!.id, `observe ${assertion.object}.${assertion.path}: expected identity of ${assertion.equalsObjectId}, got ${String(actual)}.`);
  }
  if ('sameAs' in assertion) {
    const reference = assertion.sameAs;
    require(reference !== undefined, 'sameAs assertion requires a stage/object/path reference.');
    const baseline = priorStages.get(reference.stage);
    require(baseline !== undefined, `sameAs references unknown earlier stage "${reference.stage}".`);
    const expected = resolveReference(baseline, reference.object, reference.path);
    require(isDeepStrictEqual(actual, expected), `observe ${assertion.object}.${assertion.path}: expected sameAs ${reference.stage}/${reference.object}.${reference.path} (${String(expected)}), got ${String(actual)}.`);
  }
  if ('deltaFrom' in assertion) {
    const reference = assertion.deltaFrom;
    require(reference !== undefined, 'deltaFrom assertion requires a stage/object/path reference.');
    const baseline = priorStages.get(reference.stage);
    require(baseline !== undefined, `deltaFrom references unknown earlier stage "${reference.stage}".`);
    const previous = resolveReference(baseline, reference.object, reference.path);
    require(typeof actual === 'number' && Number.isFinite(actual), `observe ${assertion.object}.${assertion.path}: deltaFrom requires a finite numeric current value.`);
    require(typeof previous === 'number' && Number.isFinite(previous), `observe ${assertion.object}.${assertion.path}: deltaFrom reference is not a finite number.`);
    const expected = previous + reference.delta;
    require(Object.is(actual, expected), `observe ${assertion.object}.${assertion.path}: expected ${reference.stage}/${reference.object}.${reference.path} + ${reference.delta} = ${expected}, got ${actual}.`);
  }
}

function resolveReference(snapshot: ObserveSnapshot, objectName: string, path: string): unknown {
  if (objectName === '$document') return getPath(snapshot.document, path);
  const matches = snapshot.objects.filter((object) => object.name === objectName);
  require(matches.length === 1, `Expected unique baseline object "${objectName}", found ${matches.length}.`);
  return path === 'id' ? matches[0]!.id : getPath(matches[0], path);
}

function getPath(value: unknown, path: string): unknown {
  let cursor = value;
  for (const segment of path.split('.')) {
    if (!isRecord(cursor) || !(segment in cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function assertArtifact(bytes: Uint8Array, format: 'png' | 'svg', expected: { width: number; height: number } | { minimumPaths: number }): void {
  if (format === 'png') {
    require('width' in expected && 'height' in expected, 'PNG artifact requires dimensions.');
    assertPngDimensions(bytes, expected.width, expected.height);
    return;
  }
  require('minimumPaths' in expected, 'SVG artifact requires minimumPaths.');
  assertSvgStructure(new TextDecoder().decode(bytes), expected.minimumPaths);
}
