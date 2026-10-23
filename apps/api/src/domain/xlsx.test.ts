import { expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx } from './xlsx.js';

/** Reads the stored files back out of the zip's central directory. */
function unzip(buffer: Buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  const files = new Map<string, string>();
  for (let i = 0, at = buffer.readUInt32LE(end + 16); i < count; i++) {
    const size = buffer.readUInt32LE(at + 20), nameLength = buffer.readUInt16LE(at + 28), offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString();
    const start = offset + 30 + buffer.readUInt16LE(offset + 26);
    files.set(name, inflateRawSync(buffer.subarray(start, start + size)).toString());
    at += 46 + nameLength;
  }
  return files;
}

it('writes typed, escaped cells into a valid workbook', () => {
  const files = unzip(buildXlsx([{ name: 'Users/1', columns: [{ header: 'Name' }, { header: 'USDT', type: 'usdt' }, { header: 'When', type: 'date' }],
    rows: [['<Ali & "Sara">\u0001', 1_500_000n, new Date('1970-01-02T00:00:00Z')], ['', null, undefined]] }]));
  expect([...files.keys()]).toContain('xl/worksheets/sheet1.xml');
  expect(files.get('xl/workbook.xml')).toContain('name="Users 1"');
  const sheet = files.get('xl/worksheets/sheet1.xml')!;
  expect(sheet).toContain('&lt;Ali &amp; &quot;Sara&quot;&gt;</t>');
  expect(sheet).toContain('<c r="B2" s="2"><v>1.5</v></c>');
  expect(sheet).toContain('<c r="C2" s="4"><v>25570</v></c>');
  expect(sheet).toContain('<row r="3"></row>');
  expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
});
