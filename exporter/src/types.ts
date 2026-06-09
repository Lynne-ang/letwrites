/**
 * Shared types for the Letwrites Confluence exporter.
 *
 * Export pipeline (see exporter.ts):
 *
 *   Confluence REST API ──▶ ConfluencePage[] ──▶ PathMap ──▶ convert each ──▶ files
 *          │                      │                 │            │             │
 *      (client.ts)           body.storage      hierarchy   (converter.ts)  + manifest
 *                            (XHTML)           + slugs                     + UNCONVERTED.md
 */

/** Connection + scope config. For Confluence Cloud, auth is Basic email:apiToken. */
export interface ConfluenceConfig {
  /** e.g. https://your-org.atlassian.net/wiki  (no trailing slash) */
  baseUrl: string;
  /** Atlassian account email (Cloud). Omit for anonymous/PAT setups. */
  email?: string;
  /** API token (Cloud) or personal access token (Server/DC). */
  apiToken: string;
  /** Space key to export, e.g. "ENG". */
  spaceKey: string;
  /** Where to write the export. */
  outDir: string;
  /** Page fetch batch size. */
  pageSize?: number;
}

/** A page as we care about it, normalized from the API response. */
export interface ConfluencePage {
  id: string;
  title: string;
  /** Direct parent page id, or null if top-level in the space. */
  parentId: string | null;
  /** Confluence "storage format" body — XHTML with ac:/ri: custom tags. */
  storageBody: string;
  version: number;
}

export interface Attachment {
  id: string;
  /** File name as stored in Confluence, e.g. "diagram.png". */
  fileName: string;
  /** Absolute or relative download URL from the API. */
  downloadPath: string;
  mediaType: string;
  pageId: string;
}

/** One thing the converter could not faithfully translate. Surfaced to the user. */
export interface UnconvertedItem {
  pageId: string;
  pageTitle: string;
  kind: 'macro' | 'unknown-tag' | 'broken-link' | 'attachment';
  /** Macro name or tag name, e.g. "jira", "expand". */
  name: string;
  /** Short note on what we did instead (placeholder left, link dropped, etc.). */
  note: string;
}

export interface ConversionResult {
  markdown: string;
  unconverted: UnconvertedItem[];
}

/** Resolved output location for a page, used to re-point internal links. */
export interface PathEntry {
  page: ConfluencePage;
  /** Slugified path segments from root, e.g. ["engineering", "onboarding"]. */
  segments: string[];
  /** Relative file path from outDir, e.g. "engineering/onboarding.md". */
  relPath: string;
}

/** Lookup context handed to the converter so it can resolve links/images. */
export interface ConvertContext {
  pageId: string;
  pageTitle: string;
  /** Resolve a linked page (by id or title) to a relative md path, if known. */
  resolvePageLink: (ref: { id?: string; title?: string }) => string | null;
  /** Relative dir (from this page's file) where attachments live. */
  attachmentsRelDir: string;
}

/**
 * Where pages come from. The live Confluence client implements this, and so
 * does the bundled sample space — so the exact same convert+write pipeline
 * runs in the credential-free demo and against a real instance.
 */
export interface PageSource {
  verifySpace(): Promise<string>;
  fetchAllPages(): Promise<ConfluencePage[]>;
  fetchAttachments(pageId: string): Promise<Attachment[]>;
  downloadAttachment(downloadPath: string): Promise<Buffer>;
}

export interface ExportSummary {
  spaceKey: string;
  pagesExported: number;
  attachmentsDownloaded: number;
  unconvertedCount: number;
  outDir: string;
}
