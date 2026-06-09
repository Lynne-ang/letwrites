import { parse, HTMLElement, Node, NodeType } from 'node-html-parser';
import type { ConversionResult, ConvertContext, UnconvertedItem } from './types.js';

/**
 * Convert Confluence "storage format" (XHTML with ac:/ri: custom tags) to
 * Markdown.
 *
 * Design stance (the honest-migration promise): we convert the common 80%
 * faithfully, and for anything we can't translate cleanly (Confluence-specific
 * macros, unknown tags) we leave a visible placeholder AND record an
 * UnconvertedItem so the user gets a precise report instead of silent loss.
 *
 *   storage XHTML ──▶ parse ──▶ walk tree ──▶ md string + unconverted[]
 *
 * Macros we translate: code, info/note/warning/tip panels, status.
 * Macros we flag:      jira, expand, include, toc, drawio, anything unknown.
 */

// Confluence macros we can render to clean Markdown.
const PANEL_MACROS: Record<string, string> = {
  info: 'ℹ️ ',
  note: '📝 ',
  warning: '⚠️ ',
  tip: '💡 ',
};

export function convertStorageToMarkdown(html: string, ctx: ConvertContext): ConversionResult {
  const unconverted: UnconvertedItem[] = [];
  const root = parse(html, { lowerCaseTagName: false, comment: false });
  const md = walkChildren(root, ctx, unconverted).trim();
  // Collapse 3+ blank lines down to 2.
  const cleaned = md.replace(/\n{3,}/g, '\n\n') + '\n';
  return { markdown: cleaned, unconverted };
}

function walkChildren(node: Node, ctx: ConvertContext, un: UnconvertedItem[]): string {
  let out = '';
  for (const child of node.childNodes) out += walk(child, ctx, un);
  return out;
}

function walk(node: Node, ctx: ConvertContext, un: UnconvertedItem[]): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    const raw = node.rawText;
    // Whitespace-only text nodes: a newline means it's formatting whitespace
    // between block elements (drop it — avoids stray indented lines); spaces
    // without a newline are a meaningful inline gap (keep a single space).
    if (raw.trim() === '') return raw.includes('\n') ? '' : ' ';
    return decodeEntities(raw);
  }
  if (!(node instanceof HTMLElement)) return '';

  const tag = node.rawTagName?.toLowerCase() ?? '';

  switch (tag) {
    case 'h1': return `\n# ${inline(node, ctx, un)}\n\n`;
    case 'h2': return `\n## ${inline(node, ctx, un)}\n\n`;
    case 'h3': return `\n### ${inline(node, ctx, un)}\n\n`;
    case 'h4': return `\n#### ${inline(node, ctx, un)}\n\n`;
    case 'h5': return `\n##### ${inline(node, ctx, un)}\n\n`;
    case 'h6': return `\n###### ${inline(node, ctx, un)}\n\n`;
    case 'p': return `\n${inline(node, ctx, un)}\n\n`;
    case 'br': return '\n';
    case 'hr': return `\n---\n\n`;
    case 'strong': case 'b': return `**${inline(node, ctx, un)}**`;
    case 'em': case 'i': return `*${inline(node, ctx, un)}*`;
    case 'code': return `\`${node.text}\``;
    case 'pre': return `\n\`\`\`\n${node.text}\n\`\`\`\n\n`;
    case 'blockquote':
      return '\n' + walkChildren(node, ctx, un).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
    case 'ul': return `\n${list(node, ctx, un, '-')}\n`;
    case 'ol': return `\n${list(node, ctx, un, '1.')}\n`;
    case 'a': {
      const href = node.getAttribute('href') ?? '';
      return `[${inline(node, ctx, un)}](${href})`;
    }
    case 'table': return `\n${table(node, ctx, un)}\n`;

    // Confluence custom tags ------------------------------------------------
    case 'ac:structured-macro': return macro(node, ctx, un);
    case 'ac:link': return acLink(node, ctx, un);
    case 'ac:image': return acImage(node, ctx, un);
    case 'ac:task-list': return `\n${taskList(node, ctx, un)}\n`;

    default:
      // Unknown ac:/ri: tag we don't model — pass through children but record it
      // once so the report is precise without being noisy.
      if (tag.startsWith('ac:') || tag.startsWith('ri:')) {
        un.push({ pageId: ctx.pageId, pageTitle: ctx.pageTitle, kind: 'unknown-tag', name: tag, note: 'passed through inner content; structure may be lost' });
      }
      return walkChildren(node, ctx, un);
  }
}

/** Inline context: trims surrounding whitespace collapse for headings/paras. */
function inline(node: Node, ctx: ConvertContext, un: UnconvertedItem[]): string {
  return walkChildren(node, ctx, un).replace(/\s+/g, ' ').trim();
}

function list(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[], bullet: string): string {
  const items = node.childNodes.filter(
    (c) => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === 'li',
  ) as HTMLElement[];
  return items
    .map((li, i) => {
      const marker = bullet === '1.' ? `${i + 1}.` : bullet;
      const body = walkChildren(li, ctx, un).trim().replace(/\n/g, '\n  ');
      return `${marker} ${body}`;
    })
    .join('\n') + '\n';
}

function taskList(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[]): string {
  const tasks = node.querySelectorAll('ac\\:task');
  return tasks
    .map((t) => {
      const status = t.querySelector('ac\\:task-status')?.text?.trim();
      const body = t.querySelector('ac\\:task-body')?.text?.trim() ?? '';
      return `- [${status === 'complete' ? 'x' : ' '}] ${body}`;
    })
    .join('\n') + '\n';
}

function table(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[]): string {
  const rows = node.querySelectorAll('tr');
  if (!rows.length) return '';
  const cellText = (cell: HTMLElement) => inline(cell, ctx, un).replace(/\|/g, '\\|') || ' ';
  const lines: string[] = [];
  rows.forEach((row, idx) => {
    const cells = row.querySelectorAll('th,td');
    lines.push('| ' + cells.map(cellText).join(' | ') + ' |');
    if (idx === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
  });
  return lines.join('\n') + '\n';
}

function macro(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[]): string {
  const name = (node.getAttribute('ac:name') ?? '').toLowerCase();

  // Code block macro: <ac:structured-macro ac:name="code"> ... <ac:plain-text-body>
  if (name === 'code') {
    const lang = paramValue(node, 'language') ?? '';
    const code = node.querySelector('ac\\:plain-text-body')?.text ?? node.text;
    return `\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`;
  }

  // Panel macros → blockquote with an icon prefix.
  if (name in PANEL_MACROS) {
    const bodyEl = node.querySelector('ac\\:rich-text-body');
    const body = bodyEl ? walkChildren(bodyEl, ctx, un).trim() : node.text.trim();
    const prefixed = body.split('\n').map((l) => `> ${l}`).join('\n');
    return `\n> ${PANEL_MACROS[name]}\n${prefixed}\n\n`;
  }

  if (name === 'status') {
    const color = paramValue(node, 'colour') ?? '';
    const title = paramValue(node, 'title') ?? '';
    return ` \`[${color ? color + ': ' : ''}${title}]\` `;
  }

  // Everything else: leave a visible placeholder and record it for the report.
  un.push({
    pageId: ctx.pageId,
    pageTitle: ctx.pageTitle,
    kind: 'macro',
    name: name || '(unnamed)',
    note: 'no clean Markdown equivalent; placeholder left in page',
  });
  return `\n> **[Unsupported Confluence macro: \`${name}\`]** — review original page.\n\n`;
}

function acLink(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[]): string {
  const pageRef = node.querySelector('ri\\:page');
  const bodyText = node.querySelector('ac\\:link-body')?.text?.trim()
    || node.querySelector('ac\\:plain-text-link-body')?.text?.trim();

  if (pageRef) {
    const title = pageRef.getAttribute('ri:content-title') ?? undefined;
    const target = ctx.resolvePageLink({ title });
    const label = bodyText || title || 'link';
    if (target) return `[${label}](${target})`;
    un.push({ pageId: ctx.pageId, pageTitle: ctx.pageTitle, kind: 'broken-link', name: title ?? '(unknown)', note: 'linked page not found in export scope' });
    return `${label}`;
  }
  // Attachment / user / other ri: targets — keep the label, flag the link.
  un.push({ pageId: ctx.pageId, pageTitle: ctx.pageTitle, kind: 'broken-link', name: 'ac:link', note: 'non-page link target not resolved' });
  return bodyText ?? '';
}

function acImage(node: HTMLElement, ctx: ConvertContext, un: UnconvertedItem[]): string {
  const att = node.querySelector('ri\\:attachment');
  const alt = node.getAttribute('ac:alt') ?? '';
  if (att) {
    const fileName = att.getAttribute('ri:filename');
    if (fileName) return `![${alt}](${ctx.attachmentsRelDir}/${encodeURIComponent(fileName)})`;
  }
  const url = node.querySelector('ri\\:url')?.getAttribute('ri:value');
  if (url) return `![${alt}](${url})`;
  un.push({ pageId: ctx.pageId, pageTitle: ctx.pageTitle, kind: 'attachment', name: 'ac:image', note: 'image source not resolvable' });
  return '';
}

function paramValue(macroEl: HTMLElement, paramName: string): string | null {
  const params = macroEl.querySelectorAll('ac\\:parameter');
  for (const p of params) {
    if (p.getAttribute('ac:name') === paramName) return p.text.trim();
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
