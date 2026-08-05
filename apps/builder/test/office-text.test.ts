/**
 * The Office attachment extractors (spec 089): the zip reader and the docx/xlsx/pptx → text passes.
 *
 * Fixtures are BUILT HERE from XML written by hand and packed with the repo's own `zipStore`, so no
 * binary blob is committed and every assertion states exactly which XML construct it is pinning. The
 * two writers checking each other also covers the reader's stored path end-to-end; the deflate path —
 * which is what real Office files always use, and which `zipStore` cannot emit — is exercised against
 * an archive produced by the SYSTEM `zip`, so a header-arithmetic mistake cannot hide behind our own
 * writer's conventions.
 *
 * Each extractor test names the construct that would break silently if it regressed: a cell gap that
 * shifts a column, a reordered deck, furigana doubling every Japanese cell.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStore } from '../server/lib/zip.js';
import { readEntries, MAX_INFLATED } from '../server/lib/unzip.js';
import { extractOfficeText, sidecarText, OFFICE_EXT, LEGACY_OFFICE_EXT } from '../server/lib/office-text.js';

const pack = (parts: Record<string, string>): Buffer =>
  zipStore(Object.entries(parts).map(([name, data]) => ({ name, data: Buffer.from(data, 'utf8') })));

/* ------------------------------------------------------------------ unzip */

describe('readEntries — zip reading', () => {
  test('round-trips what zipStore writes, and only what `want` asks for', () => {
    const buf = pack({ 'a/one.xml': '<x>①</x>', 'b/two.xml': '<y/>', 'skip.bin': 'nope' });
    const got = readEntries(buf, (n) => n.endsWith('.xml'));
    assert.deepEqual([...got.keys()].sort(), ['a/one.xml', 'b/two.xml']);
    assert.equal(got.get('a/one.xml')?.toString('utf8'), '<x>①</x>');
    assert.equal(got.has('skip.bin'), false, 'an entry the caller did not ask for is never returned');
  });

  test('reads a DEFLATED archive (the method real Office files use)', () => {
    let zipBin = true;
    try {
      execFileSync('zip', ['-v'], { stdio: 'ignore' });
    } catch {
      zipBin = false;
    }
    if (!zipBin) {
      console.warn('office-text.test: `zip` not found — deflate round-trip skipped');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'office-deflate-'));
    try {
      // Repetitive content so the zipper actually chooses deflate over store.
      const body = '<w:p><w:r><w:t>repeat</w:t></w:r></w:p>'.repeat(200);
      mkdirSync(join(dir, 'word'));
      writeFileSync(join(dir, 'word', 'document.xml'), `<w:document><w:body>${body}</w:body></w:document>`);
      execFileSync('zip', ['-r', '-q', 'out.zip', 'word'], { cwd: dir });
      const got = readEntries(readFileSync(join(dir, 'out.zip')), (n) => n === 'word/document.xml');
      assert.ok(got.get('word/document.xml')?.toString('utf8').includes('repeat'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('refuses non-zip bytes rather than returning nothing', () => {
    assert.throws(() => readEntries(Buffer.from('not a zip at all', 'utf8'), () => true), /not a zip/);
  });

  test('refuses contents over the decompression cap (zip-bomb backstop)', () => {
    const huge = pack({ 'big.bin': 'x'.repeat(MAX_INFLATED + 1) });
    assert.throws(() => readEntries(huge, () => true), /decompression limit/);
  });
});

/* ------------------------------------------------------------------- docx */

const docx = (body: string): Buffer =>
  pack({ 'word/document.xml': `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>` });

describe('extractOfficeText — .docx', () => {
  test('paragraphs, tabs, entities, and a table rendered as markdown', () => {
    const out = extractOfficeText(
      'docx',
      docx(
        '<w:p><w:r><w:t>ニュース収集フロー</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t xml:space="preserve">Step 1</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Tavily</w:t></w:r></w:p>' +
          '<w:tbl>' +
          '<w:tr><w:tc><w:p><w:r><w:t>項目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>値</w:t></w:r></w:p></w:tc></w:tr>' +
          '<w:tr><w:tc><w:p><w:r><w:t>期間</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7日</w:t></w:r></w:p></w:tc></w:tr>' +
          '</w:tbl>' +
          '<w:p><w:r><w:t>&#x3053;&amp;end</w:t></w:r></w:p>'
      )
    );
    assert.equal(
      out,
      ['ニュース収集フロー', 'Step 1\tTavily', '| 項目 | 値 |', '| --- | --- |', '| 期間 | 7日 |', '', 'こ&end'].join('\n')
    );
  });

  test('text split across runs joins without a gap (Word splits mid-word constantly)', () => {
    const out = extractOfficeText('docx', docx('<w:p><w:r><w:t>Chat</w:t></w:r><w:r><w:t>work</w:t></w:r></w:p>'));
    assert.equal(out, 'Chatwork');
  });

  test('a line break inside a table cell does not split the markdown row', () => {
    const out = extractOfficeText(
      'docx',
      docx('<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>')
    );
    assert.equal(out.split('\n')[0], '| a b |');
  });

  test('a document with no text yields empty (callers must reject, not persist)', () => {
    assert.equal(extractOfficeText('docx', docx('<w:p><w:r><w:drawing/></w:r></w:p>')), '');
  });

  test('a zip without word/document.xml is refused by name', () => {
    assert.throws(() => extractOfficeText('docx', pack({ 'xl/workbook.xml': '<x/>' })), /not a Word document/);
  });
});

/* ------------------------------------------------------------------- pptx */

describe('extractOfficeText — .pptx', () => {
  const slide = (t: string): string => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

  test('slide order follows sldIdLst, NOT the slide file numbers', () => {
    // The deck was reordered in PowerPoint: slide2.xml is shown first and keeps its part name.
    const out = extractOfficeText(
      'pptx',
      pack({
        'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
        'ppt/slides/slide1.xml': slide('FIRST FILE'),
        'ppt/slides/slide2.xml': slide('SHOWN FIRST'),
      })
    );
    assert.equal(out, ['## Slide 1', 'SHOWN FIRST', '', '## Slide 2', 'FIRST FILE'].join('\n'));
  });

  test('falls back to numeric order when the presentation part is missing, with slide10 after slide9', () => {
    const parts: Record<string, string> = {};
    for (const n of [10, 9, 1]) parts[`ppt/slides/slide${n}.xml`] = slide(`s${n}`);
    const out = extractOfficeText('pptx', pack(parts));
    assert.deepEqual(
      out.split('\n').filter((l) => l.startsWith('s')),
      ['s1', 's9', 's10']
    );
  });

  test('a zip with no slides is refused by name', () => {
    assert.throws(() => extractOfficeText('pptx', pack({ 'word/document.xml': '<w:document/>' })), /not a PowerPoint/);
  });
});

/* ------------------------------------------------------------------- xlsx */

describe('extractOfficeText — .xlsx', () => {
  const book = (sheetXml: string, sharedXml: string): Buffer =>
    pack({
      'xl/workbook.xml': '<workbook><sheets><sheet name="キーワードシート" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': sharedXml,
      'xl/worksheets/sheet1.xml': sheetXml,
    });

  test('a skipped cell keeps its column (the shift that would silently corrupt every row)', () => {
    const out = extractOfficeText(
      'xlsx',
      book(
        '<worksheet><sheetData>' +
          // B1 is absent from the XML, which is how Excel writes an empty cell.
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>AI</t></is></c><c r="B2"><v>45000</v></c><c r="C2" t="b"><v>1</v></c></row>' +
          '<row r="3"><c r="A3" s="2"/></row>' +
          '<row r="4"><c r="A4" t="s"><v>2</v></c></row>' +
          '</sheetData></worksheet>',
        '<sst><si><t>キーワード</t></si><si><t>期間</t><rPh sb="0" eb="2"><t>キカン</t></rPh></si><si><t>quote"comma,</t></si></sst>'
      )
    );
    assert.equal(
      out,
      [
        '## キーワードシート',
        'キーワード,,期間', // C1 stayed in column 3 despite B1 being absent
        'AI,45000,TRUE', // inline string · raw number (a date would show as its serial) · boolean
        '"quote""comma,",,', // CSV quoting, padded to the sheet width
      ].join('\n')
    );
    assert.ok(!out.includes('キカン'), 'furigana (<rPh>) must not be interleaved into Japanese cell text');
  });

  test('an all-empty row is dropped rather than padding the output with commas', () => {
    const out = extractOfficeText(
      'xlsx',
      book('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" s="1"/></row></sheetData></worksheet>', '<sst><si><t>only</t></si></sst>')
    );
    assert.equal(out, '## キーワードシート\nonly');
  });

  test('a workbook with no rows says so instead of yielding empty text', () => {
    const out = extractOfficeText('xlsx', book('<worksheet><sheetData/></worksheet>', '<sst/>'));
    assert.equal(out, '## キーワードシート\n(empty sheet)');
  });

  test('a zip with no worksheets is refused by name', () => {
    assert.throws(() => extractOfficeText('xlsx', pack({ 'word/document.xml': '<w:document/>' })), /not an Excel workbook/);
  });
});

/* ---------------------------------------------------------------- sidecar */

describe('sidecarText — the header the model actually reads', () => {
  test('names the original file and the extraction scope', () => {
    const out = sidecarText('docx', 'dify_flow_proposal.docx', 'body text', 1000);
    assert.match(out, /dify_flow_proposal\.docx/);
    assert.match(out, /Word document/);
    assert.match(out, /text boxes, headers\/footers/);
    assert.ok(out.endsWith('body text\n'));
    assert.ok(!out.includes('TRUNCATED'), 'no truncation notice when nothing was cut');
  });

  test('truncation is announced in the HEADER — the end of the file is what truncation removes', () => {
    const out = sidecarText('xlsx', 'sheet.xlsx', 'abcdefghij', 4);
    const head = out.split('\n\n')[0];
    assert.match(head, /TRUNCATED: showing the first 4 of 10 characters/);
    assert.ok(out.endsWith('abcd\n'));
  });

  test('the xlsx caveat warns that dates arrive as serial numbers', () => {
    assert.match(sidecarText('xlsx', 'a.xlsx', 'x', 99), /serial numbers/);
  });
});

describe('format sets', () => {
  test('the modern set is exactly the three zip-based formats', () => {
    assert.deepEqual([...OFFICE_EXT].sort(), ['docx', 'pptx', 'xlsx']);
  });

  test('the legacy set is disjoint from it (they need a different parser entirely)', () => {
    assert.deepEqual([...LEGACY_OFFICE_EXT].sort(), ['doc', 'ppt', 'xls']);
    for (const e of LEGACY_OFFICE_EXT) assert.ok(!OFFICE_EXT.has(e));
  });

  test('an extension with no extractor is refused', () => {
    assert.throws(() => extractOfficeText('pdf', pack({ 'a': 'b' })), /no text extractor/);
  });
});
