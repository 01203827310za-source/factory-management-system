// Small shared pieces for the Dashboard report tabs: number format, Excel export, filter inputs, sortable header, loading/error/empty states.
import * as XLSX from 'xlsx';
import { ArrowUpDown, Download, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
export const inputCls = 'border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white';
export const dayOf = (iso: string) => String(iso).slice(0, 10);
export const monthOf = (iso: string) => String(iso).slice(0, 7);
export const todayCairo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

/** Downloads the given rows as .xlsx. Read-only: it only formats data already on screen. */
export function exportRows(fileBase: string, sheet: string, rows: Record<string, string | number>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, `${fileBase}_${todayCairo()}.xlsx`);
}

export function Loading({ text = 'جارٍ التحميل...' }: { text?: string }) {
  return <div className="flex items-center justify-center py-10 text-gray-400 text-sm"><RefreshCw size={18} className="animate-spin ml-2" /> {text}</div>;
}
export const ErrorBox = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="text-center py-8 text-sm text-red-600">{message}{onRetry && <button className="mr-3 underline" onClick={onRetry}>إعادة المحاولة</button>}</div>
);
export const Empty = ({ text = 'لا توجد بيانات مطابقة' }: { text?: string }) => <div className="text-center py-8 text-sm text-gray-400">{text}</div>;

export function Panel({ title, hint, actions, children }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
    <Download size={13} /> تصدير Excel
  </button>
);

export const SortTh = ({ label, active, desc, onClick, align = 'right' }: { label: string; active: boolean; desc: boolean; onClick: () => void; align?: 'right' | 'center' }) => (
  <th className={`px-3 py-2 font-semibold text-${align}`} aria-sort={active ? (desc ? 'descending' : 'ascending') : 'none'}>
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1">{label}<ArrowUpDown size={11} className={active ? 'text-blue-600' : 'text-gray-300'} /></button>
  </th>
);

export const Th = ({ children, align = 'right' }: { children: ReactNode; align?: 'right' | 'center' }) => <th className={`px-3 py-2 font-semibold text-${align}`}>{children}</th>;

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between text-xs text-gray-500 px-4 py-2 border-t border-gray-100">
      <button className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</button>
      <span>صفحة {page} من {pages}</span>
      <button className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي</button>
    </div>
  );
}

export const Tile = ({ label, value, tone = 'gray' }: { label: string; value: string; tone?: 'gray' | 'blue' | 'red' | 'green' | 'amber' }) => {
  const tones = { gray: 'bg-gray-50 text-gray-800', blue: 'bg-blue-50 text-blue-800', red: 'bg-red-50 text-red-800', green: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800' };
  return <div className={`rounded-lg p-3 ${tones[tone]}`}><p className="text-xs opacity-70">{label}</p><p className="font-bold">{value}</p></div>;
};
