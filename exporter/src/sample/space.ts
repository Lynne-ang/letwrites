import type { Attachment, ConfluencePage, PageSource } from '../types.js';

/**
 * A self-contained sample Confluence space ("ENG") in real storage format.
 *
 * Lets the whole export pipeline run with ZERO credentials, so the demo is
 * reproducible anywhere. It deliberately includes the hard cases:
 *  - nested hierarchy (Handbook ▸ Onboarding ▸ Dev Setup, ▸ Runbooks ▸ API)
 *  - clean macros (code, info/warning panels, status) → convert
 *  - cross-page links (ac:link) → re-pointed
 *  - an attachment image (ac:image) → downloaded + rewritten
 *  - unsupported macros (jira, drawio) → flagged in the migration report
 */

// 1x1 transparent PNG so the referenced image actually resolves in the preview.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PAGES: ConfluencePage[] = [
  {
    id: '1',
    title: 'Engineering Handbook',
    parentId: null,
    version: 7,
    storageBody: `
      <p>Welcome to the <strong>Engineering Handbook</strong>. This is the canonical
      home for how we build and run software.</p>
      <ac:structured-macro ac:name="info"><ac:rich-text-body><p>Everything here is the
      source of truth. If a Slack thread disagrees with the handbook, the handbook wins.</p></ac:rich-text-body></ac:structured-macro>
      <h2>Sections</h2>
      <ul>
        <li>Onboarding</li>
        <li>Runbooks</li>
        <li>Architecture</li>
      </ul>`,
  },
  {
    id: '2',
    title: 'Onboarding',
    parentId: '1',
    version: 12,
    storageBody: `
      <p>Your first week, start to finish.</p>
      <h2>Day 1 checklist</h2>
      <ol>
        <li>Get your accounts provisioned</li>
        <li>Set up your machine — see <ac:link><ri:page ri:content-title="Dev Environment Setup" /><ac:link-body>Dev Environment Setup</ac:link-body></ac:link></li>
        <li>Read the <ac:link><ri:page ri:content-title="Engineering Handbook" /><ac:link-body>handbook</ac:link-body></ac:link></li>
      </ol>
      <ac:structured-macro ac:name="warning"><ac:rich-text-body><p>Do not commit secrets.
      We rotate any key that lands in git history.</p></ac:rich-text-body></ac:structured-macro>`,
  },
  {
    id: '3',
    title: 'Dev Environment Setup',
    parentId: '2',
    version: 31,
    storageBody: `
      <p>Status: <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">Maintained</ac:parameter></ac:structured-macro></p>
      <h2>Install</h2>
      <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body>brew install node@20
npm install
npm run dev</ac:plain-text-body></ac:structured-macro>
      <h2>Required tools</h2>
      <table>
        <tr><th>Tool</th><th>Version</th><th>Notes</th></tr>
        <tr><td>Node</td><td>20.x</td><td>use the .nvmrc</td></tr>
        <tr><td>Docker</td><td>latest</td><td>for local services</td></tr>
      </table>`,
  },
  {
    id: '4',
    title: 'Runbooks',
    parentId: '1',
    version: 4,
    storageBody: `
      <p>Operational playbooks. Linked tickets live in Jira:</p>
      <ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">OPS-114</ac:parameter></ac:structured-macro>
      <p>See the <ac:link><ri:page ri:content-title="API Service Runbook" /><ac:link-body>API Service Runbook</ac:link-body></ac:link>.</p>`,
  },
  {
    id: '5',
    title: 'API Service Runbook',
    parentId: '4',
    version: 18,
    storageBody: `
      <ac:structured-macro ac:name="warning"><ac:rich-text-body><p>Never restart during peak hours (09:00–18:00).</p></ac:rich-text-body></ac:structured-macro>
      <h2>Restart procedure</h2>
      <ol>
        <li>Drain traffic at the load balancer</li>
        <li>Roll the deployment</li>
      </ol>
      <ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body>kubectl rollout restart deploy/api</ac:plain-text-body></ac:structured-macro>`,
  },
  {
    id: '6',
    title: 'Architecture',
    parentId: '1',
    version: 22,
    storageBody: `
      <p>High-level system topology:</p>
      <ac:image ac:alt="System topology"><ri:attachment ri:filename="topology.png" /></ac:image>
      <p>The diagram source lives in a drawio macro that won't survive export:</p>
      <ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">topology</ac:parameter></ac:structured-macro>
      <h2>Services</h2>
      <ul>
        <li><strong>api</strong> — request handling</li>
        <li><strong>worker</strong> — async jobs</li>
      </ul>`,
  },
];

// Which page carries which attachments (just the topology image on Architecture).
const ATTACHMENTS: Record<string, Attachment[]> = {
  '6': [
    { id: 'att-1', fileName: 'topology.png', downloadPath: '/sample/topology.png', mediaType: 'image/png', pageId: '6' },
  ],
};

/** A PageSource backed by the in-memory sample — no network, no credentials. */
export class SampleSource implements PageSource {
  async verifySpace(): Promise<string> {
    return 'Engineering (sample)';
  }
  async fetchAllPages(): Promise<ConfluencePage[]> {
    return PAGES.map((p) => ({ ...p }));
  }
  async fetchAttachments(pageId: string): Promise<Attachment[]> {
    return (ATTACHMENTS[pageId] ?? []).map((a) => ({ ...a }));
  }
  async downloadAttachment(_downloadPath: string): Promise<Buffer> {
    return ONE_PX_PNG;
  }
}
