/** Every Excel download is named <report>[_<filter>]_<YYYY-MM-DD>.xlsx —
 * ASCII letters, digits, "_" and "-" only, so it's a safe filename on every
 * OS and browser. The date is the Cairo calendar date, whatever the admin
 * computer's own time zone. The backend (app/routers/report_exports.py)
 * uses the same convention for its Content-Disposition header. */

export type ExportReport = 'Finance_Report' | 'Online_Orders_Report' | 'B2B_Orders_Report' | 'Inventory_Report';

const FILTER_SLUG: Record<string, string> = {
  website: 'Website',
  b2b: 'B2B',
  spending: 'Spending',
  income: 'Income',
  expense: 'Expense',
  pending: 'Pending',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** The Cairo calendar date of the moment the export is clicked, as
 * YYYY-MM-DD (the en-CA format is exactly that). */
const CAIRO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
function cairoDate(d: Date): string {
  return CAIRO_DATE.format(d);
}

export function exportFilename(report: ExportReport, filters: (string | undefined)[] = [], now: Date = new Date()): string {
  const parts = [report, ...filters.filter((f): f is string => !!f).map((f) => FILTER_SLUG[f] ?? f)];
  return `${parts.join('_')}_${cairoDate(now)}.xlsx`;
}
