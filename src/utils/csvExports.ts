import type { FinanceState } from '../types';
import { ddMmYyyyStamp } from './format';
import { triggerBlobDownload } from './pdfReports';

function csvEscape(val: unknown): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvContent(headers: string[], rows: Array<Array<string | number>>): {
  csvText: string;
  blob: Blob;
} {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ];
  const csvText = lines.join('\r\n');
  // UTF-8 BOM ensures clean Excel / Sheets rendering
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  return { csvText, blob };
}

export interface GeneratedCsvResult {
  filename: string;
  blobUrl: string;
  title: string;
  csvText: string;
  rowCount: number;
}

export function exportCashFlowCsv(
  state: FinanceState,
  fromDate: string,
  toDate: string
): GeneratedCsvResult {
  const rows = (Array.isArray(state.transactions) ? state.transactions : [])
    .filter((t) => (!fromDate || (t.date || '') >= fromDate) && (!toDate || (t.date || '') <= toDate))
    .map((t) => [
      t.date || '',
      t.activity || '',
      t.category || '',
      t.description || '',
      Number(t.amount) || 0,
      t.receiptName || '',
    ]);
  const filename = `${ddMmYyyyStamp()}_cash_flow.csv`;
  const { csvText, blob } = buildCsvContent(
    ['Date', 'Activity', 'Category', 'Description', 'Amount (TZS)', 'Receipt'],
    rows
  );
  return {
    filename,
    blobUrl: triggerBlobDownload(blob, filename),
    title: 'Cash Flow Ledger CSV',
    csvText,
    rowCount: rows.length,
  };
}

export function exportHoldingsCsv(state: FinanceState, toDate = ''): GeneratedCsvResult {
  const rows = (Array.isArray(state.holdings) ? state.holdings : [])
    .filter((h) => !toDate || !h.date || h.date <= toDate)
    .map((h) => {
      const units = Number(h.units) || 0;
      const cost = Number(h.cost) || 0;
      const price = Number(h.price) || 0;
      const px = price > 0 ? price : cost;
      const val = units * px;
      const basis = units * cost;
      return [
        h.symbol || '',
        h.kind || '',
        units,
        cost,
        price,
        val,
        val - basis,
        h.source || '',
        h.updated || '',
      ];
    });
  const filename = `${ddMmYyyyStamp()}_holdings.csv`;
  const { csvText, blob } = buildCsvContent(
    [
      'Symbol',
      'Type',
      'Units',
      'Avg Cost (TZS)',
      'Current Price (TZS)',
      'Market Value (TZS)',
      'Unrealised P/L (TZS)',
      'Source',
      'Updated',
    ],
    rows
  );
  return {
    filename,
    blobUrl: triggerBlobDownload(blob, filename),
    title: 'Holdings Portfolio CSV',
    csvText,
    rowCount: rows.length,
  };
}

export function exportBalanceSheetCsv(state: FinanceState, toDate = ''): GeneratedCsvResult {
  const rows = (Array.isArray(state.balance) ? state.balance : [])
    .filter((b) => !toDate || !b.date || b.date <= toDate)
    .map((b) => [
      b.date || '',
      b.section || '',
      b.type || '',
      b.name || '',
      Number(b.amount) || 0,
    ]);
  const filename = `${ddMmYyyyStamp()}_balance_sheet.csv`;
  const { csvText, blob } = buildCsvContent(
    ['As At', 'Section', 'Type', 'Description', 'Amount (TZS)'],
    rows
  );
  return {
    filename,
    blobUrl: triggerBlobDownload(blob, filename),
    title: 'Balance Sheet CSV',
    csvText,
    rowCount: rows.length,
  };
}
