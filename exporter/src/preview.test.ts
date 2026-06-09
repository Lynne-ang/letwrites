import { describe, it, expect } from 'vitest';
import { safeUrl } from './preview.js';

// Regression tests for the preview XSS fix: migrated content can be
// attacker-influenced, so link/image URLs must be sanitized before they land
// in the generated HTML.
describe('safeUrl — preview URL sanitization (XSS)', () => {
  it('blocks javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('  JavaScript:alert(1)')).toBe('#');
  });
  it('blocks data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });
  it('blocks other non-http schemes', () => {
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
    expect(safeUrl('file:///etc/passwd')).toBe('#');
  });
  it('allows http(s)', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('http://example.com')).toBe('http://example.com');
  });
  it('allows relative URLs (re-pointed internal links + attachments)', () => {
    expect(safeUrl('./onboarding/dev-setup.md')).toBe('./onboarding/dev-setup.md');
    expect(safeUrl('architecture.attachments/topology.png')).toBe('architecture.attachments/topology.png');
  });
  it('neutralizes attribute-breakout quotes', () => {
    expect(safeUrl('a" onerror=alert(1)')).not.toContain('"');
  });
});
