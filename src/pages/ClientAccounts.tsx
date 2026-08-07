import { useState, useEffect, useMemo, Fragment } from 'react';
import { clientAcctsStore, clientAccountPaymentsStore, clientAccountInvoicesStore } from '../data/store';
import type { ClientAccount, ClientAccountPayment } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Download, Search, RefreshCw, Banknote, FileText, ChevronDown, ChevronUp, History } from 'lucide-react';
import * as XLSX from 'xlsx';
const ic = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const lc = "block text-xs font-semibold text-gray-600 mb-1";
const today = new Date().toISOString().split('T')[0];

const METHODS = ['نقدي', 'تحويل بنكي', 'شيك'];

// ─── unified account history (invoices + payments) with a running balance ────
// Invoices are debits (increase the balance owed), payments are credits
// (decrease it). The opening balance reconciles whatever total_amount /
// amount_paid was set directly on the account (at creation or by editing it)
// outside of the invoice/payment sub-ledgers, so the final running balance
// always lands exactly on item.remaining.
type HistoryRow = {
  key: string;
  date: string;
  type: 'رصيد افتتاحي' | 'فاتورة' | 'دفعة';
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  notes: string;
  payment?: ClientAccountPayment;
};

function buildAccountHistory(item: ClientAccount): HistoryRow[] {
  const invoices = item.invoices || [];
  const payments = item.payments || [];
  const totalInvoices = invoices.reduce((s, i) => s + i.amount, 0);
  const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
  const opening = (item.total_amount - totalInvoices) - (item.amount_paid - totalPayments);

  type Entry = { date: string; sortKey: number; type: 'فاتورة' | 'دفعة'; reference: string; debit: number; credit: number; notes: string; payment?: ClientAccountPayment; key: string };
  const entries: Entry[] = [
    ...invoices.map(inv => ({
      date: inv.date, sortKey: inv.id, type: 'فاتورة' as const, reference: inv.order_number || '-',
      debit: inv.amount, credit: 0, notes: inv.notes, key: `inv-${inv.id}`,
    })),
    ...payments.map(p => ({
      date: p.date, sortKey: p.id + 1_000_000, type: 'دفعة' as const, reference: p.payment_method || p.receiver || '-',
      debit: 0, credit: p.amount, notes: p.description, payment: p, key: `pay-${p.id}`,
    })),
  ];
  entries.sort((a, b) => (a.date === b.date ? a.sortKey - b.sortKey : a.date.localeCompare(b.date)));

  const rows: HistoryRow[] = [];
  if (Math.abs(opening) > 0.005) {
    rows.push({
      key: 'opening', date: item.date, type: 'رصيد افتتاحي', reference: '-',
      debit: Math.max(opening, 0), credit: Math.max(-opening, 0), balance: opening, notes: '-',
    });
  }
  let balance = opening;
  entries.forEach(e => {
    balance += e.debit - e.credit;
    rows.push({ key: e.key, date: e.date, type: e.type, reference: e.reference, debit: e.debit, credit: e.credit, balance, notes: e.notes || '-', payment: e.payment });
  });
  return rows;
}

export default function ClientAccounts() {
  const toast = useToast();
  const [items, setItems] = useState<ClientAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Main CRUD
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<ClientAccount | null>(null);
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const emptyForm = { date: '', client_name: '', model_name: '', quantity: 0, total_amount: 0, amount_paid: 0, notes: '' };
  const [form, setForm] = useState(emptyForm);

  // Expandable rows
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Add payment modal
  const [payTarget, setPayTarget] = useState<ClientAccount | null>(null);
  const emptyPayForm = { date: today, amount: 0, payment_method: '', description: '', receiver: '' };
  const [payForm, setPayForm] = useState(emptyPayForm);

  // Add invoice modal
  const [invTarget, setInvTarget] = useState<ClientAccount | null>(null);
  const emptyInvForm = { order_number: '', amount: 0, date: today, notes: '' };
  const [invForm, setInvForm] = useState(emptyInvForm);

  // Edit payment modal
  const [editPay, setEditPay] = useState<ClientAccountPayment | null>(null);
  const [editPayForm, setEditPayForm] = useState({ date: '', amount: 0, payment_method: '', description: '' });

  // Delete payment confirm
  const [deletePayConfirm, setDeletePayConfirm] = useState<{ accountId: number; pid: number } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try { setItems(await clientAcctsStore.getAll()); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadData(); }, []);

  const toggleExpand = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openAdd = () => { setEditItem(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (item: ClientAccount) => {
    setEditItem(item);
    setForm({ date: item.date, client_name: item.client_name, model_name: item.model_name, quantity: item.quantity, total_amount: item.total_amount, amount_paid: item.amount_paid, notes: item.notes });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.client_name) { toast('error', 'يرجى كتابة اسم العميل'); return; }
    setSaving(true);
    try {
      if (editItem) { await clientAcctsStore.update(editItem.id, form); toast('success', 'تم التعديل'); }
      else { await clientAcctsStore.add(form); toast('success', 'تم الإضافة'); }
      setModalOpen(false); await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await clientAcctsStore.remove(id); toast('success', 'تم الحذف'); setDeleteConfirm(null); await loadData(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  // ----- Payment handlers -----
  const openPayModal = (item: ClientAccount) => {
    setPayTarget(item);
    setPayForm({ ...emptyPayForm, date: today });
  };

  const handleAddPayment = async () => {
    if (!payTarget) return;
    if (payForm.amount <= 0) { toast('error', 'يرجى إدخال مبلغ صحيح'); return; }
    setSaving(true);
    try {
      await clientAccountPaymentsStore.add(payTarget.id, payForm);
      toast('success', `تم تسجيل دفعة ${payForm.amount.toLocaleString('ar-EG')}`);
      setPayTarget(null);
      setExpandedRows(prev => new Set(prev).add(payTarget.id));
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  // ----- Invoice handlers -----
  const openInvoiceModal = (item: ClientAccount) => {
    setInvTarget(item);
    setInvForm({ ...emptyInvForm, date: today });
  };

  const handleAddInvoice = async () => {
    if (!invTarget) return;
    if (!invForm.order_number.trim()) { toast('error', 'رقم الطلب مطلوب'); return; }
    if (invForm.amount <= 0) { toast('error', 'قيمة الفاتورة يجب أن تكون أكبر من صفر'); return; }
    setSaving(true);
    try {
      await clientAccountInvoicesStore.add(invTarget.id, invForm);
      toast('success', `تم إضافة فاتورة بقيمة ${invForm.amount.toLocaleString('ar-EG')}`);
      setInvTarget(null);
      setExpandedRows(prev => new Set(prev).add(invTarget.id));
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const openEditPay = (p: ClientAccountPayment) => {
    setEditPay(p);
    setEditPayForm({ date: p.date, amount: p.amount, payment_method: p.payment_method, description: p.description });
  };

  const handleEditPayment = async () => {
    if (!editPay) return;
    if (editPayForm.amount <= 0) { toast('error', 'يرجى إدخال مبلغ صحيح'); return; }
    setSaving(true);
    try {
      await clientAccountPaymentsStore.update(editPay.account_id, editPay.id, editPayForm);
      toast('success', 'تم تعديل الدفعة');
      setEditPay(null);
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
    finally { setSaving(false); }
  };

  const handleDeletePayment = async () => {
    if (!deletePayConfirm) return;
    try {
      await clientAccountPaymentsStore.remove(deletePayConfirm.accountId, deletePayConfirm.pid);
      toast('success', 'تم حذف الدفعة');
      setDeletePayConfirm(null);
      await loadData();
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const filtered = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(r => r.client_name.toLowerCase().includes(q) || r.model_name.toLowerCase().includes(q));
  }, [items, search]);

  const totalRemaining = items.reduce((s, i) => s + i.remaining, 0);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(r => ({
      'التاريخ': r.date, 'العميل': r.client_name, 'الموديل': r.model_name,
      'الكمية': r.quantity, 'الإجمالي': r.total_amount,
      'المدفوع': r.amount_paid, 'المتبقي': r.remaining, 'ملاحظات': r.notes,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'حسابات عملاء');
    XLSX.writeFile(wb, 'client_accounts.xlsx');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-800">👤 حساب عميل</h1><p className="text-sm text-gray-500">متابعة مستحقات العملاء</p></div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Download size={16} /> تصدير</button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]"><Plus size={16} /> إضافة حساب</button>
        </div>
      </div>

      {totalRemaining > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <span className="font-medium text-amber-700">إجمالي مستحقاتنا من العملاء</span>
          <span className="text-xl font-bold text-amber-700">{totalRemaining.toLocaleString('ar-EG')}</span>
        </div>
      )}

      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث بالعميل أو الموديل..." className={`w-full pr-10 ${ic}`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                {['#','التاريخ','العميل','الموديل','الكمية','الإجمالي','المدفوع','المتبقي','ملاحظات','إجراءات'].map(h =>
                  <th key={h} className="px-4 py-3 text-center font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="text-center py-8 text-gray-400"><RefreshCw size={16} className="animate-spin inline mr-2" />جارٍ التحميل...</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>}
              {filtered.map((item, idx) => (
                <Fragment key={item.id}>
                  <tr className={`border-t border-gray-100 hover:bg-blue-50/40 transition ${item.remaining > 0 ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-3 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-3 text-center">{item.date}</td>
                    <td className="px-4 py-3 font-medium">{item.client_name}</td>
                    <td className="px-4 py-3">{item.model_name}</td>
                    <td className="px-4 py-3 text-center">{item.quantity}</td>
                    <td className="px-4 py-3 text-center">{item.total_amount.toLocaleString('ar-EG')}</td>
                    <td className="px-4 py-3 text-center text-emerald-600">{item.amount_paid.toLocaleString('ar-EG')}</td>
                    <td className={`px-4 py-3 text-center font-bold ${item.remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{item.remaining.toLocaleString('ar-EG')}</td>
                    <td className="px-4 py-3 text-xs">{item.notes || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {item.remaining > 0 && (
                          <button onClick={() => openPayModal(item)} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg" title="تسجيل دفعة"><Banknote size={15} /></button>
                        )}
                        <button onClick={() => openInvoiceModal(item)} className="p-1.5 text-purple-600 hover:bg-purple-100 rounded-lg" title="إضافة فاتورة"><FileText size={15} /></button>
                        <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={15} /></button>
                        <button onClick={() => setDeleteConfirm(item.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={15} /></button>
                        <button onClick={() => toggleExpand(item.id)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg" title="سجل الحساب">
                          {expandedRows.has(item.id) ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {expandedRows.has(item.id) && (() => {
                    const history = buildAccountHistory(item);
                    return (
                    <tr className="border-t border-gray-100">
                      <td colSpan={10} className="bg-slate-50 px-6 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <History size={15} className="text-slate-500" />
                          <span className="text-sm font-bold text-slate-700">سجل الحساب</span>
                          <span className="text-xs text-slate-400">
                            ({(item.invoices || []).length} فاتورة · {(item.payments || []).length} دفعة)
                          </span>
                        </div>
                        {history.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">لا توجد حركات مسجلة بعد.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                              <thead>
                                <tr className="bg-slate-200 text-slate-700">
                                  {['التاريخ','النوع','المرجع','مدين (فاتورة)','دائن (دفعة)','الرصيد الجاري','ملاحظات','إجراءات'].map(h =>
                                    <th key={h} className="px-3 py-2 text-center font-semibold">{h}</th>)}
                                </tr>
                              </thead>
                              <tbody>
                                {history.map(row => (
                                  <tr key={row.key} className="border-t border-slate-100 hover:bg-slate-100 transition bg-white">
                                    <td className="px-3 py-2 text-center">{row.date}</td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`px-2 py-0.5 rounded-full font-medium ${
                                        row.type === 'فاتورة' ? 'bg-purple-100 text-purple-700'
                                        : row.type === 'دفعة' ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-gray-200 text-gray-600'}`}>{row.type}</span>
                                    </td>
                                    <td className="px-3 py-2 text-center">{row.reference}</td>
                                    <td className="px-3 py-2 text-center font-semibold text-purple-700">{row.debit ? row.debit.toLocaleString('ar-EG') : '-'}</td>
                                    <td className="px-3 py-2 text-center font-semibold text-emerald-700">{row.credit ? row.credit.toLocaleString('ar-EG') : '-'}</td>
                                    <td className={`px-3 py-2 text-center font-bold ${row.balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{row.balance.toLocaleString('ar-EG')}</td>
                                    <td className="px-3 py-2 text-center">{row.notes || '-'}</td>
                                    <td className="px-3 py-2 text-center">
                                      {row.payment && (
                                        <div className="flex items-center justify-center gap-1">
                                          <button onClick={() => openEditPay(row.payment!)} className="p-1 text-blue-600 hover:bg-blue-100 rounded"><Edit2 size={12} /></button>
                                          <button onClick={() => setDeletePayConfirm({ accountId: item.id, pid: row.payment!.id })} className="p-1 text-red-600 hover:bg-red-100 rounded"><Trash2 size={12} /></button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })()}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Account Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'تعديل الحساب' : 'إضافة حساب عميل'}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={form.date} onChange={e => setForm({...form, date: e.target.value})} /></div>
          <div><label className={lc}>اسم العميل *</label><input className={ic} value={form.client_name} onChange={e => setForm({...form, client_name: e.target.value})} /></div>
          <div><label className={lc}>اسم الموديل</label><input className={ic} value={form.model_name} onChange={e => setForm({...form, model_name: e.target.value})} /></div>
          <div><label className={lc}>الكمية</label><input type="number" className={ic} value={form.quantity} onChange={e => setForm({...form, quantity: parseInt(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>الإجمالي</label><input type="number" className={ic} value={form.total_amount} onChange={e => setForm({...form, total_amount: parseFloat(e.target.value)||0})} min={0} /></div>
          <div><label className={lc}>المدفوع</label><input type="number" className={ic} value={form.amount_paid} onChange={e => setForm({...form, amount_paid: parseFloat(e.target.value)||0})} min={0} /></div>
          <div className="md:col-span-2"><label className={lc}>ملاحظات</label><input className={ic} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setModalOpen(false)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
        </div>
      </Modal>

      {/* Add Payment Modal */}
      {payTarget && (
        <Modal isOpen={true} onClose={() => setPayTarget(null)} title={`تسجيل دفعة — ${payTarget.client_name}`}>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <span className="text-gray-600">المتبقي: </span>
              <span className="font-bold text-amber-600">{payTarget.remaining.toLocaleString('ar-EG')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={payForm.date} onChange={e => setPayForm({...payForm, date: e.target.value})} /></div>
              <div><label className={lc}>المبلغ *</label><input type="number" className={ic} value={payForm.amount} onChange={e => setPayForm({...payForm, amount: parseFloat(e.target.value)||0})} min={0} /></div>
              <div><label className={lc}>طريقة الدفع</label>
                <select className={ic} value={payForm.payment_method} onChange={e => setPayForm({...payForm, payment_method: e.target.value})}>
                  <option value="">اختر</option>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div><label className={lc}>ملاحظات</label><input className={ic} value={payForm.description} onChange={e => setPayForm({...payForm, description: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button onClick={() => setPayTarget(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
            <button onClick={handleAddPayment} disabled={saving} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'تسجيل الدفعة'}</button>
          </div>
        </Modal>
      )}

      {/* Add Invoice Modal */}
      {invTarget && (
        <Modal isOpen={true} onClose={() => setInvTarget(null)} title={`إضافة فاتورة — ${invTarget.client_name}`}>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-3 text-sm">
              <span className="text-gray-600">المتبقي الحالي: </span>
              <span className="font-bold text-amber-600">{invTarget.remaining.toLocaleString('ar-EG')}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lc}>رقم الطلب *</label><input className={ic} value={invForm.order_number} onChange={e => setInvForm({...invForm, order_number: e.target.value})} /></div>
              <div><label className={lc}>قيمة الفاتورة *</label><input type="number" className={ic} value={invForm.amount} onChange={e => setInvForm({...invForm, amount: parseFloat(e.target.value)||0})} min={0} /></div>
              <div className="col-span-2"><label className={lc}>تاريخ الفاتورة</label><input type="date" className={ic} value={invForm.date} onChange={e => setInvForm({...invForm, date: e.target.value})} /></div>
            </div>
            <div><label className={lc}>ملاحظات</label><input className={ic} value={invForm.notes} onChange={e => setInvForm({...invForm, notes: e.target.value})} /></div>
            {invForm.amount > 0 && (
              <div className="bg-purple-50 rounded-lg p-3 text-sm text-purple-800">
                المتبقي بعد الفاتورة: <span className="font-bold">{(invTarget.remaining + invForm.amount).toLocaleString('ar-EG')}</span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button onClick={() => setInvTarget(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
            <button onClick={handleAddInvoice} disabled={saving} className="px-5 py-2 text-sm bg-purple-600 text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'إضافة الفاتورة'}</button>
          </div>
        </Modal>
      )}

      {/* Edit Payment Modal */}
      {editPay && (
        <Modal isOpen={true} onClose={() => setEditPay(null)} title="تعديل الدفعة">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lc}>التاريخ</label><input type="date" className={ic} value={editPayForm.date} onChange={e => setEditPayForm({...editPayForm, date: e.target.value})} /></div>
            <div><label className={lc}>المبلغ *</label><input type="number" className={ic} value={editPayForm.amount} onChange={e => setEditPayForm({...editPayForm, amount: parseFloat(e.target.value)||0})} min={0} /></div>
            <div><label className={lc}>طريقة الدفع</label>
              <select className={ic} value={editPayForm.payment_method} onChange={e => setEditPayForm({...editPayForm, payment_method: e.target.value})}>
                <option value="">اختر</option>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="col-span-2"><label className={lc}>ملاحظات</label><input className={ic} value={editPayForm.description} onChange={e => setEditPayForm({...editPayForm, description: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <button onClick={() => setEditPay(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
            <button onClick={handleEditPayment} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-60">{saving ? 'جارٍ الحفظ...' : 'حفظ'}</button>
          </div>
        </Modal>
      )}

      {/* Delete Account Confirm */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا الحساب؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button>
        </div>
      </Modal>

      {/* Delete Payment Confirm */}
      <Modal isOpen={deletePayConfirm !== null} onClose={() => setDeletePayConfirm(null)} title="تأكيد حذف الدفعة" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذه الدفعة؟ سيتم خصمها من المبلغ المدفوع.</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeletePayConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg">إلغاء</button>
          <button onClick={handleDeletePayment} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg">حذف</button>
        </div>
      </Modal>
    </div>
  );
}
