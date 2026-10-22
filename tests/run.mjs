import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Compile the real modules with the project's compiler. Keeping generated files
// beneath this checkout preserves dependency resolution without another runner.
const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = resolve(root, '.sites-runtime');
mkdirSync(runtime, { recursive: true });
const scratch = mkdtempSync(resolve(runtime, 'regression-'));
const files = [
  'lib/types.ts', 'lib/demo.ts', 'lib/arrange.ts', 'lib/import.ts', 'lib/export.ts', 'lib/book-catalog.ts', 'lib/book-community.ts',
  'lib/book-size.ts', 'lib/shelf-geometry.ts', 'lib/shelf-placement.ts', 'lib/shelf-actions.ts', 'lib/reading.ts', 'lib/reading-log.ts', 'lib/connections.ts', 'lib/connections/hardcover.ts',
  'tests/import.test.ts', 'tests/arrange.test.ts', 'tests/book-size.test.ts', 'tests/shelf-geometry.test.ts', 'tests/shelf-actions.test.ts', 'tests/reading.test.ts', 'tests/reading-log.test.ts', 'tests/connections.test.ts', 'tests/hardcover.test.ts', 'tests/book-community.test.ts',
];
try {
  for (const file of files) {
    const output = resolve(scratch, file.replace(/\.ts$/, '.mjs'));
    mkdirSync(dirname(output), { recursive: true });
    const compiled = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText.replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_, quote, specifier) =>
      `from ${quote}${specifier.replace(/\.ts$/, '').replace(/\.mjs$/, '')}.mjs${quote}`);
    writeFileSync(output, compiled);
  }
  const result = spawnSync(process.execPath, [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=tap',
    '--test-reporter-destination=' + resolve(scratch, 'completion.tap'),
    // Report actual cases consistently in managed runtimes where child-process
    // test reporting may otherwise collapse each module into a single result.
    '--experimental-test-isolation=none',
    resolve(scratch, 'tests/import.test.mjs'),
    resolve(scratch, 'tests/arrange.test.mjs'),
    resolve(scratch, 'tests/book-size.test.mjs'),
    resolve(scratch, 'tests/shelf-geometry.test.mjs'),
    resolve(scratch, 'tests/shelf-actions.test.mjs'),
    resolve(scratch, 'tests/reading.test.mjs'),
    resolve(scratch, 'tests/reading-log.test.mjs'),
    resolve(scratch, 'tests/connections.test.mjs'),
    resolve(scratch, 'tests/hardcover.test.mjs'),
    resolve(scratch, 'tests/book-community.test.mjs'),
    resolve(root, 'tests/book-catalog.test.mjs'),
    resolve(root, 'tests/spoilers.test.mjs'),
    resolve(root, 'lib/server/server.test.mjs'),
    resolve(root, 'lib/server/auth.test.mjs'),
    resolve(root, 'tests/deployment-auth.test.mjs'),
    resolve(root, 'tests/browser-draft.test.mjs'),
  ], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status === 0) {
    // A clean process exit alone must not approve an incomplete async test run.
    const report = readFileSync(resolve(scratch, 'completion.tap'), 'utf8');
    if (!/^1\.\.[1-9]\d*$/m.test(report) || !/^# tests [1-9]\d*$/m.test(report) || !/^# duration_ms /m.test(report)) {
      throw new Error('The test process ended without a complete terminal summary. No verification result was accepted.');
    }
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
