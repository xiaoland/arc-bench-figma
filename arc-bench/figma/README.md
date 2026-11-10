# Minimal Figma Design · ARC-Bench task

Give the generator the **requirements/** directory. It includes the requirement
tree, visual references, starting data, the public launch and observation
interface, and optional implementation guidance.

Run the evaluator in a separate environment after starting the application.

    npm ci
    npx playwright install chromium
    BASE_URL=http://127.0.0.1:3000 npm run test:e2e

The runner also accepts PLAYWRIGHT_BASE_URL. It uses Playwright Chromium by
default. With an existing compatible browser, set AGENT_BROWSER_EXECUTABLE_PATH
to its executable and skip the browser installation step. Use test:e2e:list to
list scenarios. By default, reports and artifacts go to ../figma-evaluation.
Set ARC_EVAL_OUTPUT_DIR to select a different run directory. Run
test:e2e:report for the default HTML report, or pass the custom html directory
to playwright show-report.

One Playwright case is keyed to each requirement ID and scenario name. It
checks product behavior through the visible UI, observable document results,
and actual downloaded files. Libraries, asset provenance, and internal storage
are implementation choices. Only the requirements directory is generator input.
