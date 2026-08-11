// artifact-toc.test.ts — the two pure rules behind the artifact panel's contents rail: what a main.yml
// offers as anchors (it is one text blob with no elements to read), and which entry counts as current.
import { describe, it, expect } from 'vitest';
import { activeTocIndex, tocSelector, yamlAnchors } from './artifact-toc';

const DSL = [
  'app:',                       // 0
  "  description: ''",          // 1
  '  mode: workflow',           // 2
  '  name: My Flow',            // 3
  'kind: app',                  // 4
  'version: 0.6.0',             // 5
  'workflow:',                  // 6
  '  graph:',                   // 7
  '    nodes:',                 // 8
  '    - data:',                // 9
  "        desc: ''",           // 10
  '        title: Start',       // 11
  '        type: start',        // 12
  '      id: start',            // 13
  '    - data:',                // 14
  '        title: Summarize',   // 15
  '        type: llm',          // 16
  '      id: llm1',             // 17
].join('\n');

describe('yamlAnchors — a long main.yml is navigable by NODE, not by top-level key', () => {
  it('lists top-level keys and every node title, in document order with its line', () => {
    expect(yamlAnchors(DSL)).toEqual([
      { line: 0, text: 'app', level: 1 },
      { line: 4, text: 'kind', level: 1 },
      { line: 5, text: 'version', level: 1 },
      { line: 6, text: 'workflow', level: 1 },
      { line: 11, text: 'Start · start', level: 2 },
      { line: 15, text: 'Summarize · llm', level: 2 },
    ]);
  });

  it('labels a title with its OWN node type — two nodes must not swap types', () => {
    const anchors = yamlAnchors(DSL).filter((a) => a.level === 2);
    expect(anchors.map((a) => a.text)).toEqual(['Start · start', 'Summarize · llm']);
  });

  it('a node with no type line still gets a row (the title alone), not a dropped entry', () => {
    const y = '    - data:\n        title: Lonely\n      id: x\n';
    expect(yamlAnchors(y)).toEqual([{ line: 1, text: 'Lonely', level: 2 }]);
  });

  it('ignores a `type:` at a different indent — it belongs to another block, not this node', () => {
    const y = '    - data:\n        title: Outer\n          type: nested-thing\n';
    expect(yamlAnchors(y)).toEqual([{ line: 1, text: 'Outer', level: 2 }]);
  });

  it('strips quotes around a title and skips an empty one', () => {
    expect(yamlAnchors("        title: 'Quoted'\n")).toEqual([{ line: 0, text: 'Quoted', level: 2 }]);
    expect(yamlAnchors('        title:\n')).toEqual([]);
  });

  it('degrades to fewer anchors rather than throwing on empty or malformed input', () => {
    expect(yamlAnchors('')).toEqual([]);
    expect(yamlAnchors('not: [valid, yaml')).toEqual([{ line: 0, text: 'not', level: 1 }]);
  });

  it('caps the rail so a runaway file cannot build a contents list longer than the document', () => {
    const many = Array.from({ length: 500 }, (_, i) => `        title: N${i}\n        type: llm`).join('\n');
    expect(yamlAnchors(many).length).toBeLessThanOrEqual(200);
  });
});

describe('activeTocIndex — which section the reader is inside', () => {
  const e = [{ top: 0 }, { top: 300 }, { top: 900 }];

  it('picks the last entry at or above the fold', () => {
    expect(activeTocIndex(e, 0)).toBe(0);
    expect(activeTocIndex(e, 400)).toBe(1);
    expect(activeTocIndex(e, 5000)).toBe(2);
  });

  it('the lookahead makes a clicked row highlight ITSELF, not the row above it', () => {
    // Clicking entry 1 scrolls to top=300; a strict `top <= scrollTop` would land 299.5 → still entry 0.
    expect(activeTocIndex(e, 299)).toBe(1);
  });

  it('above the first entry → nothing is current', () => {
    expect(activeTocIndex([{ top: 120 }], 0)).toBe(-1);
    expect(activeTocIndex([], 0)).toBe(-1);
  });
});

describe('tocSelector', () => {
  it('anchors the spec on its rendered headings and the other DOM tabs on section titles', () => {
    expect(tocSelector('spec')).toMatch(/spec-preview h1/);
    expect(tocSelector('report')).toBe('.art-section-title');
    expect(tocSelector('diff')).toBe('.art-section-title');
  });

  it('main.yml has none — its rail comes from the text, since a <pre> has nothing to anchor to', () => {
    expect(tocSelector('yaml')).toBeNull();
  });
});
