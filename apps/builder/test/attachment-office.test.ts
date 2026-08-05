/**
 * Office attachments end-to-end through the attachment layer (spec 089): the 400 surfaces extraction
 * adds, the sidecar that `saveAttachments` writes, and the server↔web allowlist parity.
 *
 * The sidecar cases pin the two invariants that are cheap to break and expensive to notice:
 *   - ONE returned path per input file (the reply route derives its append index from that length, so a
 *     second path per file would make a later turn's uploads overwrite an earlier turn's);
 *   - the returned path is the SIDECAR, while the original stays on disk.
 *
 * The parity check RUNS both copies and compares what they accept, rather than diffing the two source
 * files: a textual guard passes while the two sides still disagree about what the rule means. See the
 * note on the dynamic import below for why loading the web copy takes the shape it does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateAttachments,
  saveAttachments,
  ACCEPTED_EXT,
  MAX_SIDECAR_CHARS,
  type AttachmentInput,
} from '../server/lib/attachments.js';
import { LEGACY_OFFICE_EXT } from '../server/lib/office-text.js';
import { zipStore } from '../server/lib/zip.js';

/**
 * The web copy is loaded through a DYNAMIC import with a computed specifier, on purpose. The two
 * packages compile under different TypeScript configs — the server's is node16 + no DOM lib, the web's
 * is bundler resolution + DOM — so a static import drags the web module into the wrong compiler and
 * fails on `FileReader` and extensionless paths, in EITHER direction. A computed specifier is invisible
 * to `tsc` while `tsx` still resolves it at runtime, which is what keeps this a behavioural check
 * (running both implementations) instead of a textual one that passes while the two sides disagree
 * about what the rule means.
 */
const web = (await import(new URL('../web/src/lib/attachments.ts', import.meta.url).href)) as {
  ACCEPTED_EXT: Set<string>;
  LEGACY_OFFICE_EXT: Set<string>;
  isAcceptedFile: (file: { name: string; size: number; type: string }) => boolean;
};
const { ACCEPTED_EXT: WEB_ACCEPTED_EXT, LEGACY_OFFICE_EXT: WEB_LEGACY_OFFICE_EXT, isAcceptedFile: webIsAcceptedFile } = web;

/** A minimal but genuine .docx: one paragraph of text, packed as a real zip. */
function docxBytes(text: string): Buffer {
  return zipStore([
    {
      name: 'word/document.xml',
      data: Buffer.from(`<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`, 'utf8'),
    },
  ]);
}

/** A minimal but genuine file of each Office type — enough for extraction to yield real text. */
function officeBytes(ext: string): Buffer {
  if (ext === 'docx') return docxBytes('x');
  if (ext === 'pptx') {
    return zipStore([
      { name: 'ppt/slides/slide1.xml', data: Buffer.from('<p:sld><a:p><a:r><a:t>x</a:t></a:r></a:p></p:sld>', 'utf8') },
    ]);
  }
  return zipStore([
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>', 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>', 'utf8') },
  ]);
}

const entry = (name: string, bytes: Buffer): AttachmentInput => ({
  name,
  mime: '', // browsers routinely report '' for a picked .docx — the extension is the key (spec 025)
  dataUrl: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
});

/** Where `saveAttachments` actually lands files: `<projectsDir>/apps/builder/.runs/<taskId>/uploads`. */
const uploadsOf = (root: string, taskId: string): string => join(root, 'apps/builder/.runs', taskId, 'uploads');

describe('validateAttachments — Office files', () => {
  test('a readable .docx is admitted and carries its extracted text', () => {
    const r = validateAttachments([entry('proposal.docx', docxBytes('ニュース収集フロー'))]);
    assert.ok(r.ok);
    assert.equal(r.attachments.length, 1);
    assert.equal(r.attachments[0].ext, 'docx');
    assert.match(r.attachments[0].sidecar ?? '', /ニュース収集フロー/);
    assert.match(r.attachments[0].sidecar ?? '', /Extracted from \*\*proposal\.docx\*\*/);
  });

  test('a damaged Office file is a readable 400 naming the file — not a 500 from the write path', () => {
    const r = validateAttachments([entry('broken.docx', Buffer.from('this is not a zip', 'utf8'))]);
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : '', /could not read 'broken\.docx'/);
  });

  test('a document with no text is REJECTED rather than persisted as an empty sidecar', () => {
    // An image-only document: valid .docx, zero readable characters.
    const empty = zipStore([
      { name: 'word/document.xml', data: Buffer.from('<w:document><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>', 'utf8') },
    ]);
    const r = validateAttachments([entry('scan.docx', empty)]);
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.error : '', /no readable text/);
  });

  test('a pre-2007 file is rejected by name, with the fix in the message', () => {
    for (const ext of LEGACY_OFFICE_EXT) {
      const r = validateAttachments([entry(`old.${ext}`, Buffer.from('ole2', 'utf8'))]);
      assert.equal(r.ok, false);
      const err = r.ok === false ? r.error : '';
      assert.match(err, /pre-2007 Office file/);
      assert.match(err, /Save As/);
    }
  });

  test('a non-Office attachment gets no sidecar (the text family is read directly)', () => {
    const r = validateAttachments([
      { name: 'notes.md', mime: '', dataUrl: `data:text/markdown;base64,${Buffer.from('# hi').toString('base64')}` },
    ]);
    assert.ok(r.ok);
    assert.equal(r.attachments[0].sidecar, undefined);
  });

  test('extracted text over the cap is truncated with the cut announced', () => {
    const r = validateAttachments([entry('big.docx', docxBytes('あ'.repeat(MAX_SIDECAR_CHARS + 500)))]);
    assert.ok(r.ok);
    assert.match(r.attachments[0].sidecar ?? '', /TRUNCATED: showing the first/);
  });
});

describe('saveAttachments — the Office sidecar', () => {
  let dir = '';
  const setup = (): string => (dir = mkdtempSync(join(tmpdir(), 'att-office-')));
  const cleanup = (): void => rmSync(dir, { recursive: true, force: true });

  test('returns ONE path per file — the sidecar — while the original stays on disk', async () => {
    setup();
    try {
      const r = validateAttachments([entry('proposal.docx', docxBytes('body text'))]);
      assert.ok(r.ok);
      const rels = await saveAttachments(dir, 't1', r.attachments, 0);

      assert.equal(rels.length, 1, 'one input file must contribute exactly one path');
      assert.ok(rels[0].endsWith('0_proposal.docx.md'), `injected path should be the sidecar, got ${rels[0]}`);
      const uploads = uploadsOf(dir, 't1');
      assert.ok(existsSync(join(uploads, '0_proposal.docx')), 'the original must be kept for comparison');
      assert.match(readFileSync(join(uploads, '0_proposal.docx.md'), 'utf8'), /body text/);
    } finally {
      cleanup();
    }
  });

  test('a reply turn appends without overwriting (the index invariant the sidecar must not break)', async () => {
    setup();
    try {
      const first = validateAttachments([entry('a.docx', docxBytes('first'))]);
      const second = validateAttachments([entry('b.docx', docxBytes('second'))]);
      assert.ok(first.ok && second.ok);

      const r1 = await saveAttachments(dir, 't2', first.attachments, 0);
      // How the reply route computes its start index: the length of what is already recorded.
      const r2 = await saveAttachments(dir, 't2', second.attachments, r1.length);

      assert.deepEqual(
        [...r1, ...r2].map((p) => p.split('/').pop()),
        ['0_a.docx.md', '1_b.docx.md']
      );
      const uploads = uploadsOf(dir, 't2');
      assert.match(readFileSync(join(uploads, '0_a.docx.md'), 'utf8'), /first/);
      assert.match(readFileSync(join(uploads, '1_b.docx.md'), 'utf8'), /second/);
    } finally {
      cleanup();
    }
  });

  test('a mixed turn keeps one path per file across sidecar and non-sidecar types', async () => {
    setup();
    try {
      const r = validateAttachments([
        entry('doc.docx', docxBytes('x')),
        { name: 'shot.png', mime: 'image/png', dataUrl: `data:image/png;base64,${Buffer.alloc(8, 1).toString('base64')}` },
      ]);
      assert.ok(r.ok);
      const rels = await saveAttachments(dir, 't3', r.attachments, 0);
      assert.deepEqual(rels.map((p) => p.split('/').pop()), ['0_doc.docx.md', '1_shot.png']);
    } finally {
      cleanup();
    }
  });
});

describe('server ↔ web allowlist parity', () => {
  test('the two ACCEPTED_EXT copies are the same set', () => {
    assert.deepEqual([...ACCEPTED_EXT].sort(), [...WEB_ACCEPTED_EXT].sort());
    assert.deepEqual([...LEGACY_OFFICE_EXT].sort(), [...WEB_LEGACY_OFFICE_EXT].sort());
  });

  test('both sides reach the same verdict on real filenames, with one documented divergence', () => {
    const names = [
      'proposal.docx', 'sheet.xlsx', 'deck.pptx', 'flow.yml', 'flow.yaml', 'notes.md',
      'data.csv', 'ref.pdf', 'shot.png', 'icon.svg', 'archive.zip', 'app.exe', 'noext',
      'old.doc', 'old.xls', 'old.ppt',
    ];
    for (const name of names) {
      const ext = name.split('.').pop() ?? '';
      // Office entries carry genuine bytes: this test is about the ALLOWLIST agreeing, and a server
      // rejection for unreadable CONTENT would masquerade as a type disagreement.
      const bytes = ['docx', 'xlsx', 'pptx'].includes(ext) ? officeBytes(ext) : Buffer.alloc(16, 1);
      // The web guard's own inputs: a non-empty file whose MIME the browser left blank.
      const webAccepts = webIsAcceptedFile({ name, size: 16, type: '' });
      const serverAccepts = validateAttachments([
        { name, mime: '', dataUrl: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
      ]).ok;

      if (LEGACY_OFFICE_EXT.has(name.split('.').pop() ?? '')) {
        // Deliberate: the composer holds a legacy Office file so the server's 400 can explain the fix,
        // instead of the guard discarding it with no message at all.
        assert.equal(webAccepts, true, `${name}: composer should hold it for the server to explain`);
        assert.equal(serverAccepts, false, `${name}: server must still refuse it`);
        continue;
      }
      assert.equal(webAccepts, serverAccepts, `${name}: composer and server must agree`);
    }
  });

  test('a valid Office file passes BOTH guards (the parity that actually unblocks the user)', () => {
    assert.equal(webIsAcceptedFile({ name: 'proposal.docx', size: 4096, type: '' }), true);
    assert.ok(validateAttachments([entry('proposal.docx', docxBytes('hi'))]).ok);
  });
});
