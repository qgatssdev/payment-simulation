#!/usr/bin/env node
// Drive the web UI the way a user does, from a JSON list of steps, recording evidence.
//
//   node .claude/skills/verify-payments/scripts/browse.mjs <journey-name> <steps.json>
//
// Needs WEB_URL and EVIDENCE_DIR (from launch.sh). Writes to $EVIDENCE_DIR/<journey-name>/:
// transcript.txt (every step and its result), *.aria.txt, *.png, vars.json, and
// browser-problems.txt (console errors, page errors, failed requests, HTTP >= 400).
// Exits 1 on the first failing step, after saving failure.png and failure.aria.txt.
//
// Steps (one key each). Locators are by role + accessible name or by label, never CSS:
//   {"goto": "/payments/new"}                         path on WEB_URL (supports ${var})
//   {"click": {"role": "button", "name": "Create payment", "exact": true}}
//   {"fill": {"label": "Description", "value": "Order ${runId}"}}
//   {"expect": {"role": "status", "name": "Status: SUCCEEDED", "timeout": 30000}}
//   {"expectText": {"text": "25 of 25 sent", "timeout": 15000}}
//   {"expectEnabled": {"role": "button", "name": "Refund payment", "enabled": false}}
//   {"expectCount": {"role": "link", "name": "Open payment", "min": 16}}
//   {"select": {"label": "Status", "value": "FAILED"}}
//   {"expectUrl": "/payments/[0-9a-f-]{36}$"}         regex on the current URL
//   {"saveUrlMatch": {"var": "paymentId", "regex": "/payments/([0-9a-f-]{36})"}}
//   {"snapshot": "after-create"}                     ARIA snapshot of the page
//   {"screenshot": "after-create"}                   full-page PNG
//   {"wait": 500}                                    milliseconds (prefer expect*)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [journey, stepsFile] = process.argv.slice(2);
const { WEB_URL, EVIDENCE_DIR, RUN_ID } = process.env;
if (!journey || !stepsFile || !WEB_URL || !EVIDENCE_DIR) {
  console.error(
    'usage: WEB_URL=... EVIDENCE_DIR=... browse.mjs <journey-name> <steps.json>',
  );
  process.exit(2);
}

// Resolve playwright from the repository (a root devDependency), wherever this runs from.
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const out = join(EVIDENCE_DIR, journey);
mkdirSync(out, { recursive: true });
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const vars = { runId: RUN_ID ?? 'run' };
const transcript = [];
const problems = [];
const log = (line) => {
  transcript.push(line);
  console.log(line);
};
const sub = (value) =>
  typeof value === 'string'
    ? value.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    : value;

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch(); // Playwright's bundled Chromium
}
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 900 } })
).newPage();
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on(
  'response',
  (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`),
);
page.on('requestfailed', (r) => {
  const error = r.failure()?.errorText ?? '';
  // Expected aborts, not failures: navigation closes open event streams, and the Next.js
  // router cancels its own speculative RSC fetches (verified to still navigate in-document).
  const expected =
    error.includes('ERR_ABORTED') &&
    (/\/stream(\?|$)/.test(r.url()) || /[?&]_rsc=/.test(r.url()));
  if (!expected) problems.push(`requestfailed: ${r.url()} ${error}`);
});

const byRole = ({ role, name, exact }) =>
  page.getByRole(role, { name: sub(name), exact: !!exact });

async function run(step) {
  const [op, arg] = Object.entries(step)[0];
  switch (op) {
    case 'goto':
      await page.goto(new URL(sub(arg), WEB_URL).toString());
      return page.url();
    case 'click':
      await byRole(arg).click();
      return 'clicked';
    case 'fill':
      await page.getByLabel(sub(arg.label), { exact: true }).fill(sub(arg.value));
      return 'filled';
    case 'expect':
      await byRole(arg)
        .first()
        .waitFor({ state: 'visible', timeout: arg.timeout ?? 10000 });
      return 'visible';
    case 'expectText':
      await page
        .getByText(sub(arg.text))
        .first()
        .waitFor({ timeout: arg.timeout ?? 10000 });
      return 'visible';
    case 'expectEnabled': {
      const enabled = await byRole(arg).isEnabled();
      if (enabled !== (arg.enabled ?? true)) throw new Error(`enabled=${enabled}`);
      return `enabled=${enabled}`;
    }
    case 'expectCount': {
      const locator = byRole(arg);
      const deadline = Date.now() + (arg.timeout ?? 10000);
      let count = await locator.count();
      while (count < (arg.min ?? 1) && Date.now() < deadline) {
        await page.waitForTimeout(200);
        count = await locator.count();
      }
      if (count < (arg.min ?? 1))
        throw new Error(`count=${count}, wanted >= ${arg.min ?? 1}`);
      return `count=${count}`;
    }
    case 'select':
      await page.getByLabel(sub(arg.label), { exact: true }).selectOption(sub(arg.value));
      return `selected ${arg.value}`;
    case 'expectUrl':
      await page.waitForURL(new RegExp(sub(arg)), { timeout: 10000 });
      return page.url();
    case 'saveUrlMatch': {
      const match = new RegExp(arg.regex).exec(page.url());
      if (!match) throw new Error(`no match in ${page.url()}`);
      vars[arg.var] = match[1];
      return `${arg.var}=${match[1]}`;
    }
    case 'snapshot':
      writeFileSync(
        join(out, `${arg}.aria.txt`),
        await page.locator('body').ariaSnapshot(),
      );
      return `${arg}.aria.txt`;
    case 'screenshot':
      await page.screenshot({ path: join(out, `${arg}.png`), fullPage: true });
      return `${arg}.png`;
    case 'wait':
      await page.waitForTimeout(arg);
      return `${arg} ms`;
    default:
      throw new Error(`unknown step "${op}"`);
  }
}

let failed = false;
for (const [i, step] of steps.entries()) {
  const label = `${String(i + 1).padStart(2)}. ${JSON.stringify(step)}`;
  const started = Date.now();
  try {
    const result = await run(step);
    log(`PASS ${label} -> ${result} (${Date.now() - started} ms)`);
  } catch (error) {
    log(`FAIL ${label} -> ${error.message.split('\n')[0]}`);
    await page
      .screenshot({ path: join(out, 'failure.png'), fullPage: true })
      .catch(() => {});
    writeFileSync(
      join(out, 'failure.aria.txt'),
      await page
        .locator('body')
        .ariaSnapshot()
        .catch(() => ''),
    );
    failed = true;
    break;
  }
}

writeFileSync(join(out, 'transcript.txt'), `${transcript.join('\n')}\n`);
writeFileSync(join(out, 'vars.json'), `${JSON.stringify(vars, null, 2)}\n`);
writeFileSync(
  join(out, 'browser-problems.txt'),
  problems.length ? `${problems.join('\n')}\n` : 'none\n',
);
console.log(
  problems.length
    ? `browser problems: ${problems.length} (see browser-problems.txt)`
    : 'browser problems: none',
);
await browser.close();
process.exit(failed ? 1 : 0);
