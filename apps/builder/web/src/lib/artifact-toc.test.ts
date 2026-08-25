// artifact-toc.test.ts — the two pure rules behind the artifact panel's contents rail: what a main.yml
// offers as anchors (it is one text blob with no elements to read), and which entry counts as current.
import { describe, it, expect } from 'vitest';
import { activeTocIndex, tocSelector, usesYamlAnchors, yamlAnchors } from './artifact-toc';

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
  it('anchors the spec on its rendered headings and the report on its section titles', () => {
    expect(tocSelector('spec')).toMatch(/spec-preview h1/);
    expect(tocSelector('report')).toBe('.art-section-title');
  });

  it('main.yml has none — its rail comes from the text, since a <pre> has nothing to anchor to', () => {
    expect(tocSelector('yaml')).toBeNull();
  });

  // A diff used to be a TAB, and that tab stacked BOTH files — the `.art-section-title` rail was how you
  // got between them. Each diff lives in its own file's tab now, so there is one section and nothing to
  // navigate. The `view` argument is what carries that; a call that ignores it re-creates a rail of one.
  it('a diff view has no rail, in either tab — one section is not a table of contents', () => {
    expect(tocSelector('spec', 'diff')).toBeNull();
    expect(tocSelector('yaml', 'diff')).toBeNull();
  });

  // The one that would have shipped a wrong rail rather than a useless one. main.yml's rail is anchored
  // by LINE NUMBER against `yamlAnchors(art.yaml)`; in diff view the text on screen is not that YAML, so
  // every entry would scroll to a line that is not where it says. Null here is what keeps the caller's
  // `yamlAnchors` branch from running — and the caller checks `view === 'code'` for the same reason.
  it('the diff check runs BEFORE the per-tab ones, so no tab can leak its selector into a diff', () => {
    // Order matters here, not just the spec/yaml answers: `report` still returns `.art-section-title`
    // in its normal view, so if the diff branch sat after the tab checks this would come back non-null.
    for (const tab of ['spec', 'yaml', 'report', 'anything-future']) {
      expect(tocSelector(tab, 'diff'), `${tab} leaked a selector into its diff view`).toBeNull();
    }
    expect(tocSelector('report')).toBe('.art-section-title'); // ...and the normal view is untouched
  });

  it('an omitted view keeps the normal per-tab answer (the diff is the only special case)', () => {
    expect(tocSelector('spec', 'preview')).toMatch(/spec-preview h1/);
    expect(tocSelector('spec', 'edit')).toMatch(/spec-preview h1/);
    expect(tocSelector('yaml', 'code')).toBeNull();
  });
});

describe('usesYamlAnchors — main.yml\'s line-anchored rail, and the one view it must not run in', () => {
  it('applies in the code view', () => {
    expect(usesYamlAnchors('yaml', 'code')).toBe(true);
  });

  // MEASURED, not theorised: with this check removed, switching main.yml to 差分 left all 33 YAML
  // anchors in the rail while a diff was on screen — every entry scrolling to a line that is not what
  // it names. The reason it is easy to get wrong is that the branch ALSO checks the DOM for a
  // `.codeblock pre`, which looks like it would already exclude a diff. It does not.
  it('does NOT apply in the diff view — the text on screen is not that YAML', () => {
    expect(usesYamlAnchors('yaml', 'diff')).toBe(false);
  });

  it('never applies to another tab, whatever its view', () => {
    for (const v of ['code', 'diff', 'preview', undefined]) {
      expect(usesYamlAnchors('spec', v)).toBe(false);
      expect(usesYamlAnchors('report', v)).toBe(false);
    }
  });

  it('an unknown/absent view does not count as code — the rail stays off until it is asked for', () => {
    expect(usesYamlAnchors('yaml', undefined)).toBe(false);
    expect(usesYamlAnchors('yaml', 'something-new')).toBe(false);
  });
});
