import { test } from '@playwright/test';
import { loadScenarioCases, runAcceptance } from './driver.js';
import { requireBaseUrl } from './oracles.js';
import { runProgram, type Program } from './scenario.js';
import { programs as canvasEdit } from './programs/canvas-edit.js';
import { programs as document } from './programs/document.js';
import { programs as layout } from './programs/layout.js';
import { programs as paint } from './programs/paint.js';
import { programs as structure } from './programs/structure.js';

const cases = await loadScenarioCases();
const identity = (requirement: string, name: string) => JSON.stringify([requirement, name]);
const programs = new Map<string, Program>();
for (const program of [...canvasEdit, ...document, ...layout, ...paint, ...structure]) {
  const key = identity(program.requirement, program.name);
  if (programs.has(key)) throw new Error('Duplicate scenario program: ' + key);
  programs.set(key, program);
}

for (const { requirementId, requirementName, scenario } of cases) {
  const title = `${requirementId} ${requirementName} › ${scenario.name}`;
  const acceptance = scenario.x_acceptance!;
  const key = identity(requirementId, scenario.name);
  const program = programs.get(key);
  programs.delete(key);
  if (acceptance.mode === 'manual_required') throw new Error('Scenario has no automation: ' + key);
  if ((acceptance.mode === 'scripted') !== Boolean(program)) throw new Error('Scenario program mismatch: ' + key);
  if (!process.env.BASE_URL?.trim() && !process.env.PLAYWRIGHT_BASE_URL?.trim()) {
    test(title, async () => requireBaseUrl(process.env.BASE_URL));
  } else test(title, async ({ page }, testInfo) => {
    if (program) await runProgram(page, testInfo, acceptance.seed ?? 'blank', program);
    else await runAcceptance(page, acceptance, testInfo);
  });
}
if (programs.size) throw new Error('Programs without requirement scenarios: ' + [...programs.keys()].join(', '));
