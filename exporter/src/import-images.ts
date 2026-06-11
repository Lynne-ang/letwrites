import { join, dirname } from 'node:path';

/**
 * Image handling for import: the exporter downloaded images into
 * `<page>.attachments/` and left relative Markdown refs. To make them show in
 * BookStack we must upload each file to BookStack's image gallery (scoped to the
 * page) and rewrite the Markdown ref to the returned BookStack URL.
 *
 *   ![x](architecture.attachments/topology.png)  ──upload──▶  ![x](https://docs/uploads/images/…png)
 *
 * This module is the pure, testable orchestration. The actual HTTP upload is the
 * injected `ImageUploader` (BookStackImportClient in prod, a mock in tests).
 * Failures degrade gracefully: a missing/failed image is left as-is and reported,
 * never breaking the import.
 */

const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
// Images that carry a Confluence display width are emitted as inline HTML <img src="ref" … width="N">
// (markdown has no width syntax). Match those refs too so they get uploaded + rewritten like ![](ref).
const IMG_TAG_RE = /<img\b[^>]*?\ssrc="([^"]+)"[^>]*>/gi;

export interface ImageUploader {
  /** Upload a local image file to the page's gallery; return the BookStack URL. */
  upload(pageId: number, absPath: string, name: string): Promise<string>;
}

export interface FileUploader {
  /** Upload a local file (non-image attachment) to the page; return its download URL. */
  uploadAttachment(pageId: number, absPath: string, name: string): Promise<string>;
}

// Inter-page-FILE marker the ingester emits for a linked attachment: [text](lwfile:<page>.attachments/<name>).
const FILE_RE = /\[([^\]]*)\]\(lwfile:([^)]+)\)/g;

export interface FileRewriteResult { markdown: string; uploaded: number; missing: string[]; failed: string[] }

/**
 * Upload the non-image file attachments a page links to (PDF, mp4, …) and repoint the links to the
 * BookStack download URL. Scoped to the page (like images). Failed/missing files degrade to plain text.
 */
export async function rewritePageFiles(args: {
  markdown: string; pageId: number; exportDir: string; sourcePath: string;
  uploader: FileUploader; exists: (absPath: string) => boolean;
}): Promise<FileRewriteResult> {
  const { markdown, pageId, exportDir, sourcePath, uploader, exists } = args;
  const refs = new Set<string>();
  for (const m of markdown.matchAll(FILE_RE)) refs.add(m[2].trim());
  if (!refs.size) return { markdown, uploaded: 0, missing: [], failed: [] };

  const pageDir = dirname(sourcePath);
  const urlByRef = new Map<string, string>();
  const missing: string[] = []; const failed: string[] = [];
  for (const ref of refs) {
    const absPath = join(exportDir, pageDir, decodeURIComponent(ref));
    if (!exists(absPath)) { missing.push(ref); continue; }
    const name = ref.split('/').pop() || 'file';
    try { urlByRef.set(ref, await uploader.uploadAttachment(pageId, absPath, name)); }
    catch { failed.push(ref); }
  }
  const out = markdown.replace(FILE_RE, (_full, txt, ref) => {
    const url = urlByRef.get(String(ref).trim());
    return url ? `[${txt}](${url})` : (txt || String(ref).split('/').pop() || 'file'); // upload failed → keep text
  });
  return { markdown: out, uploaded: urlByRef.size, missing, failed };
}

/** Local (non-URL) image references in a page's Markdown. */
export function findLocalImages(markdown: string): { alt: string; ref: string }[] {
  const out: { alt: string; ref: string }[] = [];
  const isLocal = (ref: string) => !/^https?:\/\//i.test(ref) && !ref.startsWith('/') && !ref.startsWith('data:');
  for (const m of markdown.matchAll(IMG_RE)) {
    const ref = m[2].trim();
    if (isLocal(ref)) out.push({ alt: m[1], ref });
  }
  for (const m of markdown.matchAll(IMG_TAG_RE)) { // inline <img> form (width-bearing images)
    const ref = m[1].trim();
    if (isLocal(ref)) out.push({ alt: '', ref });
  }
  return out;
}

export interface ImageRewriteResult {
  markdown: string;
  uploaded: number;
  uploadedRefs: string[]; // refs successfully uploaded (for the integrity manifest)
  found: number; // total local image refs found in the page
  missing: string[]; // refs whose local file was absent
  failed: string[]; // refs whose upload errored (left in place)
}

export async function rewritePageImages(args: {
  markdown: string;
  pageId: number;
  exportDir: string;
  sourcePath: string;
  uploader: ImageUploader;
  exists: (absPath: string) => boolean;
}): Promise<ImageRewriteResult> {
  const { markdown, pageId, exportDir, sourcePath, uploader, exists } = args;
  const pageDir = dirname(sourcePath);
  let out = markdown;
  const uploadedRefs: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];

  const local = findLocalImages(markdown);
  for (const { ref } of local) {
    const absPath = join(exportDir, pageDir, decodeURIComponent(ref));
    if (!exists(absPath)) {
      missing.push(ref);
      continue;
    }
    const name = ref.split('/').pop() || 'image';
    try {
      const url = await uploader.upload(pageId, absPath, name);
      // Replace every occurrence of this exact ref, in BOTH forms — markdown ![](ref) and inline
      // <img src="ref"> (width-bearing). Split/join = literal, no regex escaping; the absent form is a no-op.
      out = out.split(`](${ref})`).join(`](${url})`);
      out = out.split(`src="${ref}"`).join(`src="${url}"`);
      uploadedRefs.push(ref);
    } catch {
      failed.push(ref); // leave the ref in place; report it
    }
  }
  return { markdown: out, uploaded: uploadedRefs.length, uploadedRefs, found: local.length, missing, failed };
}
