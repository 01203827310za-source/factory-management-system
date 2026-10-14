// Minimal test harness (the project has no test framework). Each test runs in isolation;
// the process exits non-zero if anything fails so `npm test` can gate a deploy.
import assert from 'node:assert/strict';

type Case = { name: string; fn: () => void | Promise<void> };
const cases: Case[] = [];

export function test(name: string, fn: () => void | Promise<void>) {
  cases.push({ name, fn });
}

export { assert };

export async function runAll(): Promise<void> {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log(`PASS  ${c.name}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${c.name}\n      ${err instanceof Error ? err.message.split('\n').join('\n      ') : String(err)}`);
    }
  }
  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
}
