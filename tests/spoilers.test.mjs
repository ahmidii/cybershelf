import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Render the actual component. Only the CSS-module import is stubbed for Node;
// hooks, JSX, icons, conditional mounting, and generated markup stay real.
const progressCode = ts.transpileModule(readFileSync(new URL('../lib/reading-progress.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const progressModule = 'data:text/javascript;base64,' + Buffer.from(progressCode).toString('base64');
const source = readFileSync(new URL('../components/SpoilerText.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  fileName: 'SpoilerText.tsx',
}).outputText
  .replace(/import styles from ['"]\.\/Feed\.module\.css['"];?/, 'const styles = {};')
  .replace(/from ['"]@\/lib\/reading-progress['"]/, 'from ' + JSON.stringify(progressModule))
  .replace(/from (['"])(react(?:\/jsx-runtime)?|lucide-react)\1/g, (_, _quote, name) => 'from ' + JSON.stringify(import.meta.resolve(name)));
const { default: SpoilerText } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const secret = 'The ending contains a hidden spoiler sentinel.';
const render = props => renderToStaticMarkup(createElement(SpoilerText, { body: secret, progress: 50, readerProgress: 50, unread: false, ...props }));

test('unread or unknown books do not mount spoiler text, even at zero progress', () => {
  const html = render({ progress: 0, readerProgress: 0, unread: true });
  assert.equal(html.includes(secret), false, 'Hidden prose must not reach the DOM or screen readers');
  assert.match(html, /Save this for later/); assert.match(html, />Reveal</);
});

test('thoughts ahead of the reader are absent from rendered markup', () => {
  const html = render({ progress: 51, readerProgress: 50 });
  assert.equal(html.includes(secret), false);
  assert.match(html, /ahead of your bookmark/); assert.match(html, /51%/);
});

test('thoughts at or before the reader’s bookmark are readable', () => {
  for (const progress of [0, 49, 50]) {
    const html = render({ progress, readerProgress: 50 });
    assert.equal(html.includes(secret), true);
    assert.equal(html.includes('>Reveal<'), false);
  }
});

test('rounded display percentages never reveal a later thought or imply completion', () => {
  const html = render({ progress: 40.34, readerProgress: 40.31 });
  assert.equal(html.includes(secret), false, 'Matching display labels must not replace the exact spoiler comparison');
  assert.match(html, /40\.3%/);
  const nearEnd = render({ progress: 100, readerProgress: 999 / 1000 * 100 });
  assert.equal(nearEnd.includes(secret), false);
  assert.match(nearEnd, /You’re at 99\.9%/);
});

test('explicit show-all reveals unread and ahead-of-me text', () => {
  const html = render({ progress: 100, readerProgress: 0, unread: true, defaultHide: false });
  assert.equal(html.includes(secret), true);
  assert.equal(html.includes('>Reveal<'), false);
});

test('progress-only milestones render no empty spoiler panel', () => {
  assert.equal(render({ body: '', progress: 100, unread: true }), '');
});
