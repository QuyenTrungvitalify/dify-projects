/* Autolink coverage for richText (Chat.tsx) — the gate-summary render path (e.g. a done-build's
   `app: http://…/workflow` line), which does NOT go through the markdown renderer. */
import { describe, it, expect } from 'vitest';
import { richText, summaryLineParts } from './components/Chat';

/* eslint-disable @typescript-eslint/no-explicit-any */
function anchors(nodes: any[]): any[] {
  return nodes.filter((n) => n && typeof n === 'object' && n.type === 'a');
}

describe('richText — bare-URL autolink', () => {
  it('links a bare URL into a new-tab anchor', () => {
    const url = 'http://localhost:8090/app/73791c65-cd82-4a3b-8a98-171316d84e01/workflow';
    const out = richText(`app: ${url}`) as any[];
    const a = anchors(out);
    expect(a).toHaveLength(1);
    expect(a[0].props.href).toBe(url);
    expect(a[0].props.target).toBe('_blank');
    expect(a[0].props.rel).toBe('noopener noreferrer');
  });

  it('preserves a <c>chip</c> and still links a following URL', () => {
    const out = richText('<c>main.yml</c> at http://x.com/y') as any[];
    expect(anchors(out)).toHaveLength(1);
    expect(anchors(out)[0].props.href).toBe('http://x.com/y');
    expect(out.some((n) => n && typeof n === 'object' && n.type === 'span' && n.props.className === 'mchip')).toBe(true);
  });

  it('drops trailing sentence punctuation from the link', () => {
    const out = richText('see http://x.com/foo.') as any[];
    expect(anchors(out)[0].props.href).toBe('http://x.com/foo');
  });

  it('emits no anchor for a URL-free line', () => {
    expect(anchors(richText('plain text only') as any[])).toHaveLength(0);
  });
});

describe('summaryLineParts — split "; " list-notes onto lines', () => {
  const brs = (nodes: any[]) => nodes.filter((n) => n && typeof n === 'object' && n.type === 'br');

  it('a line with no "; " renders unchanged (no <br>)', () => {
    expect(brs(summaryLineParts('a single note') as any[])).toHaveLength(0);
  });

  it('splits a 3-item readiness note into 3 lines (2 <br>)', () => {
    const note = 'you need to: the AI model; a value for X — paste it; a value for Y — paste it. (setup)';
    expect(brs(summaryLineParts(note) as any[])).toHaveLength(2);
  });

  it('one "; " → one <br> (two lines)', () => {
    expect(brs(summaryLineParts('lint failures: a; b') as any[])).toHaveLength(1);
  });
});
