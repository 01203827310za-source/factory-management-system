import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import Modal from './Modal';
import { dashboardApi, type ReceivablesAudit } from '../services/api';

const fmt = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

const STOCK_LABEL: Record<string, string> = {
  removed: 'خُصم بالكامل',
  partly_removed: 'خُصم جزئيًا (رصيد الكارت أقل)',
  no_stock_card: 'لا يوجد كارت مخزون',
  possible_mismatch: 'اللون لا يطابق الكارت',
};

export default function ReceivablesAuditModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [data, setData] = useState<ReceivablesAudit | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoading(true); setError('');
    dashboardApi.getReceivablesAudit()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) { setData(null); setError(e instanceof Error ? e.message : 'تعذر تحميل التدقيق'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isOpen]);

  const r = data?.reconciliation;
  const t = data?.totals;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تدقيق الأوردرات «لم يتم الصرف» (مشحونة ولم تُحصَّل)" size="2xl">
      {loading && <div className="flex items-center justify-center py-10 text-gray-400 text-sm"><RefreshCw size={18} className="animate-spin ml-2" /> جارٍ التدقيق...</div>}
      {!loading && error && <p className="text-center py-8 text-sm text-gray-500">{error}</p>}
      {!loading && data && r && t && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">مستحق على شركة الشحن (لم يُصرف)</p><p className="font-bold">{fmt(r.shipping_receivable_not_paid_out)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">فرق تحصيل أوردرات مصروفة</p><p className="font-bold">{fmt(r.shipping_receivable_paid_out_gap)} ج.م</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">حسابات العملاء</p><p className="font-bold">{fmt(r.client_accounts_receivable)} ج.م</p></div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3"><p className="text-xs text-blue-700">الفلوس اللي لنا برا</p><p className="font-bold text-blue-800">{fmt(r.money_owed_to_us)} ج.م</p></div>
          </div>

          {r.double_counted_orders > 0 && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              تنبيه: {r.double_counted_orders.toLocaleString('ar-EG')} أوردر ({fmt(r.double_counted_amount)} ج.م) مسجّل كمستحق على شركة الشحن وكفاتورة في حساب عميل في نفس الوقت — يُعدّ مرتين. اترك واحدًا فقط (غيّر حالة الأوردر إلى «حساب عميل» أو احذف الفاتورة).
            </p>
          )}
          {r.on_account_orders_without_client_invoice.length > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {r.on_account_orders_without_client_invoice.length.toLocaleString('ar-EG')} أوردر بحالة «حساب عميل» بلا فاتورة في حساب العميل — مستحقه غير محسوب في أي مكان ({r.on_account_orders_without_client_invoice.map(o => o.order_number).join('، ')}).
            </p>
          )}

          {data.orders.length === 0 ? (
            <p className="text-center py-6 text-sm text-gray-400">لا توجد أوردرات بحالة «لم يتم الصرف»</p>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    {['رقم الأوردر', 'الفاتورة', 'الكمية المشحونة', 'الكمية المخصومة', 'تكلفة مخصومة (الكارت)', 'تكلفة مسجّلة وقت الشحن', 'المحصّل', 'المستحق', 'ما يزال في المخزون؟'].map(h => (
                      <th key={h} className="text-right px-3 py-2 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.orders.map(o => (
                    <tr key={o.sale_id} className={o.inventory_still_in_stock || o.also_in_client_account ? 'bg-amber-50/50' : ''}>
                      <td className="px-3 py-2 font-medium text-gray-800" title={o.notes.join('\n')}>#{o.sale_id} · {o.order_number}</td>
                      <td className="px-3 py-2">{fmt(o.invoice_value)}</td>
                      <td className="px-3 py-2">{fmt(o.shipped_qty)}</td>
                      <td className="px-3 py-2">{fmt(o.inventory_qty_deducted)}</td>
                      <td className="px-3 py-2">{fmt(o.inventory_cost_deducted_card)}</td>
                      <td className="px-3 py-2 text-gray-500">{o.inventory_cost_deducted_recorded === null ? '—' : fmt(o.inventory_cost_deducted_recorded)}</td>
                      <td className="px-3 py-2 text-emerald-700">{fmt(o.collected_amount)}</td>
                      <td className="px-3 py-2 font-bold text-purple-700">{fmt(o.outstanding_receivable)}</td>
                      <td className={`px-3 py-2 ${o.inventory_still_in_stock ? 'text-red-700 font-semibold' : 'text-gray-600'}`}>
                        {o.inventory_still_in_stock ? 'نعم — ' : 'لا — '}{STOCK_LABEL[o.stock_status]}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-bold text-blue-800">
                    <td className="px-3 py-2">الإجمالي ({t.orders.toLocaleString('ar-EG')})</td>
                    <td className="px-3 py-2">{fmt(t.invoice_value)}</td>
                    <td className="px-3 py-2">{fmt(t.shipped_qty)}</td>
                    <td className="px-3 py-2">{fmt(t.inventory_qty_deducted)}</td>
                    <td className="px-3 py-2">{fmt(t.inventory_cost_deducted_card)}</td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2">{fmt(t.collected_amount)}</td>
                    <td className="px-3 py-2">{fmt(t.outstanding_receivable)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">
            المخزون والمستحقات أصلان مختلفان: تكلفة البضاعة المشحونة تخرج من المخزون، والمستحق يُحسب بقيمته الصحيحة فقط — لا تُخصم التكلفة من المستحق.
            {r.uncosted_orders > 0 && ` ${r.uncosted_orders.toLocaleString('ar-EG')} أوردر شُحن قبل تسجيل التكلفة وقت الشحن.`}
          </p>
        </div>
      )}
    </Modal>
  );
}
