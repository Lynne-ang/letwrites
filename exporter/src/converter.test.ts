import { describe, it, expect } from 'vitest';
import { convertStorageToMarkdown } from './converter.js';
import type { ConvertContext } from './types.js';

const ctx = (overrides: Partial<ConvertContext> = {}): ConvertContext => ({
  pageId: '100',
  pageTitle: 'Test Page',
  attachmentsRelDir: 'test-page.attachments',
  resolvePageLink: ({ title }) => (title === 'Onboarding' ? './onboarding.md' : null),
  ...overrides,
});

describe('convertStorageToMarkdown', () => {
  it('converts headings and paragraphs', () => {
    const { markdown } = convertStorageToMarkdown(
      '<h1>Title</h1><p>Hello <strong>world</strong>.</p>',
      ctx(),
    );
    expect(markdown).toContain('# Title');
    expect(markdown).toContain('Hello **world**.');
  });

  it('converts the code macro with language', () => {
    const html =
      '<ac:structured-macro ac:name="code">' +
      '<ac:parameter ac:name="language">ts</ac:parameter>' +
      '<ac:plain-text-body>const x = 1;</ac:plain-text-body>' +
      '</ac:structured-macro>';
    const { markdown, unconverted } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('```ts');
    expect(markdown).toContain('const x = 1;');
    expect(unconverted).toHaveLength(0);
  });

  it('converts info panels to blockquotes', () => {
    const html =
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Heads up</p></ac:rich-text-body></ac:structured-macro>';
    const { markdown } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('>');
    expect(markdown).toContain('Heads up');
  });

  it('converts tables with a header separator', () => {
    const html =
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>';
    const { markdown } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('| --- | --- |');
    expect(markdown).toContain('| 1 | 2 |');
  });

  it('re-points internal page links that resolve', () => {
    const html =
      '<ac:link><ri:page ri:content-title="Onboarding" /><ac:link-body>see onboarding</ac:link-body></ac:link>';
    const { markdown, unconverted } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('[see onboarding](./onboarding.md)');
    expect(unconverted).toHaveLength(0);
  });

  it('flags internal links to pages outside export scope', () => {
    const html =
      '<ac:link><ri:page ri:content-title="Missing Page" /><ac:link-body>gone</ac:link-body></ac:link>';
    const { markdown, unconverted } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('gone');
    expect(unconverted).toHaveLength(1);
    expect(unconverted[0].kind).toBe('broken-link');
  });

  it('rewrites attachment images to the relative attachments dir', () => {
    const html = '<ac:image ac:alt="diagram"><ri:attachment ri:filename="arch.png" /></ac:image>';
    const { markdown } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('![diagram](test-page.attachments/arch.png)');
  });

  it('flags unsupported macros with a visible placeholder AND a report item', () => {
    const html = '<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">ENG-1</ac:parameter></ac:structured-macro>';
    const { markdown, unconverted } = convertStorageToMarkdown(html, ctx());
    expect(markdown.toLowerCase()).toContain('unsupported confluence macro');
    expect(unconverted).toHaveLength(1);
    expect(unconverted[0].kind).toBe('macro');
    expect(unconverted[0].name).toBe('jira');
  });

  it('converts a realistic mixed page end-to-end', () => {
    const html = `
      <h1>Service Runbook</h1>
      <p>Owned by the <strong>platform</strong> team.</p>
      <ac:structured-macro ac:name="warning"><ac:rich-text-body><p>Do not restart in peak hours.</p></ac:rich-text-body></ac:structured-macro>
      <h2>Steps</h2>
      <ol><li>Drain traffic</li><li>Restart</li></ol>
      <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body>kubectl rollout restart deploy/api</ac:plain-text-body></ac:structured-macro>
      <ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">topology</ac:parameter></ac:structured-macro>
    `;
    const { markdown, unconverted } = convertStorageToMarkdown(html, ctx());
    expect(markdown).toContain('# Service Runbook');
    expect(markdown).toContain('1. Drain traffic');
    expect(markdown).toContain('```bash');
    // drawio is unsupported → exactly one flagged item
    expect(unconverted.filter((u) => u.name === 'drawio')).toHaveLength(1);
  });
});
