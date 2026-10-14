// Static guards for mistakes that unit tests with fake data cannot see but that break every request
// against a real Postgres (found by tests/integration/order-status.e2e.ts).
import fs from 'node:fs';
import path from 'node:path';
import { assert, test } from './harness';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);
}

test('advisory locks use $executeRaw — $queryRaw cannot read pg_advisory_*()\'s void result and 500s every write', () => {
  const offenders = sourceFiles(path.resolve(__dirname, '..', 'src'))
    .filter(f => /\$queryRaw`[^`]*pg_(try_)?advisory_/.test(fs.readFileSync(f, 'utf-8')))
    .map(f => path.relative(path.resolve(__dirname, '..'), f));
  assert.deepEqual(offenders, []);
});
