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

export interface ImageUploader {
  /** Upload a local image file to the page's gallery; return the BookStack URL. */
  upload(pageId: number, absPath: string, name: string): Promise<string>;
}

/** Local (non-URL) image references in a page's Markdown. */
export function findLocalImages(markdown: string): { alt: string; ref: string }[] {
  const out: { alt: string; ref: string }[] = [];
  for (const m of markdown.matchAll(IMG_RE)) {
    const ref = m[2].trim();
    if (!/^https?:\/\//i.test(ref) && !ref.startsWith('/') && !ref.startsWith('data:')) {
      out.push({ alt: m[1], ref });
    }
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
      // Replace every occurrence of this exact ref. Split/join = literal, no regex escaping.
      out = out.split(`](${ref})`).join(`](${url})`);
      uploadedRefs.push(ref);
    } catch {
      failed.push(ref); // leave the ref in place; report it
    }
  }
  return { markdown: out, uploaded: uploadedRefs.length, uploadedRefs, found: local.length, missing, failed };
}
