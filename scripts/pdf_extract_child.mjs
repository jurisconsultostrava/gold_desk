#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const file = process.argv[2];
if (!file) {
  console.error('Missing PDF path');
  process.exit(2);
}

let parser;
try {
  const buf = await readFile(file);
  parser = new PDFParse({ data: buf });
  const res = await parser.getText();
  process.stdout.write(res?.text || '');
} catch (err) {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
} finally {
  try { await parser?.destroy?.(); } catch {}
}
