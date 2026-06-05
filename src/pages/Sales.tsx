import { useState, useMemo, useEffect } from 'react';
import {
  salesApi,
  returnsApi,
  readyStockApi,
  marketersApi
} from '../services/api';
import type { Sale, ReturnItem } from '../types';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Plus, Edit2, Trash2, Filter, Download, Search, UserPlus, Printer, ArrowLeftRight, RefreshCw, CheckSquare, XCircle, BookmarkPlus } from 'lucide-react';

import * as XLSX from 'xlsx';

const ORDER_STATUSES: Sale['order_status'][] = ['تم الصرف', 'لم يتم الصرف', 'حساب عميل', 'تم الحجز', 'تم الإلغاء'];
const DELIVERY_METHODS = ['ايرجنت', 'مصنع', 'البريد', 'شحن موقف'];

// Marketers now stored in database via API

export default function Sales() {
  const toast = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editSale, setEditSale] = useState<Sale | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [isReservation, setIsReservation] = useState(false);
  const [convertConfirm, setConvertConfirm] = useState<number | null>(null);
  const [cancelReservationConfirm, setCancelReservationConfirm] = useState<number | null>(null);

  // Marketers
  const [marketers, setMarketers] = useState<string[]>([]);
  const [newMarketer, setNewMarketer] = useState('');
  const [showAddMarketer, setShowAddMarketer] = useState(false);

  // Invoice
  const [invoiceSale, setInvoiceSale] = useState<Sale | null>(null);

  // Returns
  const [returnsModalOpen, setReturnsModalOpen] = useState(false);
  const [returns, setReturns] = useState<ReturnItem[]>([]);
  const [readyStock, setReadyStock] = useState<any[]>([]);
  const [returnForm, setReturnForm] = useState({
    date: '', order_number: '', client_name: '', returned_by: '' as 'حاتم' | 'ميدو' | '',
    paid_by: '' as 'حاتم' | 'ميدو' | '',
    model_code: '', model_qty: 0, model_color: '', refund_amount: 0, notes: ''
  });
  const [deleteReturnConfirm, setDeleteReturnConfirm] = useState<number | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, r, m, stock] = await Promise.all([
  salesApi.getAll(),
  returnsApi.getAll(),
  marketersApi.getAll(),
  readyStockApi.getAll()
]);

console.log('sales=', s);
console.log('returns=', r);
console.log('marketers=', m);

setSales(s as any);
setReturns(r as any);
setMarketers(m);
setReadyStock(stock);
    } catch (e: unknown) {
      toast('error', e instanceof Error ? e.message : 'خطأ في التحميل');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadData(); }, []);

  // Marketers loaded from database in loadData()

  const handleAddMarketer = async () => {
    const name = newMarketer.trim();
    if (!name) { toast('error', 'يرجى كتابة اسم المسوق'); return; }
    if (marketers.includes(name)) { toast('error', 'هذا المسوق موجود بالفعل'); return; }
    try {
      const updated = await marketersApi.add(name);
      setMarketers(updated);
      setForm({ ...form, marketer: name });
      setNewMarketer(''); setShowAddMarketer(false);
      toast('success', `تم إضافة المسوق "${name}"`);
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const emptyForm = {
    order_number: '', marketer: marketers[0] || '', client: '', mobile: '',
    model1_code: '', model1_qty: 0, model1_color: '',
    model2_code: '', model2_qty: 0, model2_color: '',
    model3_code: '', model3_qty: 0, model3_color: '',
    model4_code: '', model4_qty: 0, model4_color: '',
    model5_code: '', model5_qty: 0, model5_color: '',
    invoice_value: 0, deposit_paid: 0, deposit_receiver: '' as 'حاتم' | 'ميدو' | '',
    shipping_number: '', order_status: 'تم الصرف' as Sale['order_status'],
    delivery_method: DELIVERY_METHODS[0], warehouse: '', shipping_collected: 0,
  };
  const [form, setForm] = useState(emptyForm);

  const stockCodes = readyStock.map((s: any) => s.model_code);

const stockColors: Record<string, string[]> = {};

readyStock.forEach((s: any) => {
  if (!stockColors[s.model_code]) {
    stockColors[s.model_code] = [];
  }

  if (!stockColors[s.model_code].includes(s.color)) {
    stockColors[s.model_code].push(s.color);
  }
});
  const openAdd = () => { setEditSale(null); setIsReservation(false); setForm({ ...emptyForm, marketer: marketers[0] || '', order_status: 'تم الصرف' }); setModalOpen(true); };
  const openReservation = () => { setEditSale(null); setIsReservation(true); setForm({ ...emptyForm, marketer: marketers[0] || '', order_status: 'تم الحجز' }); setModalOpen(true); };
  const openEdit = (sale: Sale) => {
    setEditSale(sale);
    setForm({
      order_number: sale.order_number, marketer: sale.marketer, client: sale.client, mobile: sale.mobile,
      model1_code: sale.model1_code, model1_qty: sale.model1_qty, model1_color: sale.model1_color,
      model2_code: sale.model2_code, model2_qty: sale.model2_qty, model2_color: sale.model2_color,
      model3_code: sale.model3_code, model3_qty: sale.model3_qty, model3_color: sale.model3_color,
      model4_code: sale.model4_code, model4_qty: sale.model4_qty, model4_color: sale.model4_color,
      model5_code: sale.model5_code, model5_qty: sale.model5_qty, model5_color: sale.model5_color,
      invoice_value: sale.invoice_value, deposit_paid: sale.deposit_paid,
      deposit_receiver: sale.deposit_receiver || '',
      shipping_number: sale.shipping_number, order_status: sale.order_status,
      delivery_method: sale.delivery_method, warehouse: sale.warehouse, shipping_collected: sale.shipping_collected,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.order_number || !form.client) {
      toast('error', 'يرجى ملء رقم الأوردر واسم العميل');
      return;
    }
    const data = {
      order_number: form.order_number, marketer: form.marketer, client: form.client, mobile: form.mobile,
      model1_code: form.model1_code, model1_qty: form.model1_qty, model1_color: form.model1_color,
      model2_code: form.model2_code, model2_qty: form.model2_qty, model2_color: form.model2_color,
      model3_code: form.model3_code, model3_qty: form.model3_qty, model3_color: form.model3_color,
      model4_code: form.model4_code, model4_qty: form.model4_qty, model4_color: form.model4_color,
      model5_code: form.model5_code, model5_qty: form.model5_qty, model5_color: form.model5_color,
      invoice_value: form.invoice_value, deposit_paid: form.deposit_paid,
      deposit_receiver: form.deposit_receiver,
      shipping_number: form.shipping_number, order_status: form.order_status,
      delivery_method: form.delivery_method, warehouse: form.warehouse, shipping_collected: form.shipping_collected,
      row_number: sales.length + 1,
    };
    if (editSale) {
  await salesApi.update(editSale.id, data as any);
  toast('success', 'تم تعديل الأوردر بنجاح');
} else {
  await salesApi.add(data as any);
  toast('success', 'تم إضافة الأوردر بنجاح');
}

await loadData();
setModalOpen(false);
};
  const handleDelete = async (id: number) => {
    await salesApi.remove(id);
await loadData();; setDeleteConfirm(null); toast('success', 'تم حذف الأوردر');
  };

  const handleConvertReservation = async (id: number) => {
    try {
      await salesApi.convertReservation(id);
      await loadData();
      setConvertConfirm(null);
      toast('success', 'تم صرف الحجز — تم خصم الكمية من المخزون');
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const handleCancelReservation = async (id: number) => {
    try {
      await salesApi.cancelReservation(id);
      await loadData();
      setCancelReservationConfirm(null);
      toast('success', 'تم إلغاء الحجز — تم تحرير الكمية المحجوزة');
    } catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  // Invoice Print
  const handlePrintInvoice = () => {
    const w = window.open('', '_blank');
    if (!w || !invoiceSale) return;
    const s = invoiceSale;
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>فاتورة - ${s.order_number}</title>
    <style>body{font-family:'Cairo',Arial,sans-serif;padding:30px;color:#1e3a5f}h1{text-align:center;margin-bottom:5px}h2{text-align:center;color:#666;font-weight:normal;font-size:14px}
    table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #ddd;padding:8px 12px;text-align:right;font-size:13px}
    th{background:#1e3a5f;color:white}.footer{margin-top:30px;text-align:center;font-size:12px;color:#999}
    .totals td{text-align:center;font-weight:bold;font-size:15px}.highlight{color:#ef4444}
    </style></head><body>
    <h1>فاتورة مبيعات</h1><h2>نظام إدارة المصنع</h2>
    <table><tr><td><strong>رقم الأوردر:</strong> ${s.order_number}</td><td><strong>التاريخ:</strong> ${new Date(s.created_at).toLocaleDateString('ar-EG')}</td></tr>
    <tr><td><strong>المسوق:</strong> ${s.marketer}</td><td><strong>العميل:</strong> ${s.client}</td></tr>
    <tr><td><strong>الموبايل:</strong> ${s.mobile}</td><td><strong>طريقة التسليم:</strong> ${s.delivery_method}</td></tr>
    ${s.shipping_number ? `<tr><td colspan="2"><strong>رقم البوليصة:</strong> ${s.shipping_number}</td></tr>` : ''}
    <tr><td><strong>المخزن:</strong> ${s.warehouse}</td><td><strong>الحالة:</strong> ${s.order_status}</td></tr></table>
    <h3 style="margin-top:25px">تفاصيل الموديلات:</h3>
    <table><tr><th>#</th><th>كود الموديل</th><th>العدد</th><th>اللون</th></tr>
    ${[[s.model1_code,s.model1_qty,s.model1_color],[s.model2_code,s.model2_qty,s.model2_color],[s.model3_code,s.model3_qty,s.model3_color],[s.model4_code,s.model4_qty,s.model4_color],[s.model5_code,s.model5_qty,s.model5_color]]
      .filter(r=>r[0]&&(Number(r[1])>0)).map((r,i)=>`<tr><td>${i+1}</td><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</table>
    <table class="totals"><tr><td>قيمة الفاتورة</td><td>${s.invoice_value.toLocaleString('ar-EG')}</td></tr>
    <tr><td>العربون المدفوع</td><td style="color:#10b981">${s.deposit_paid.toLocaleString('ar-EG')}</td></tr>
    ${s.deposit_receiver?`<tr><td>الذي استلم العربون</td><td>${s.deposit_receiver}</td></tr>`:''}
    <tr><td class="highlight">المتبقي</td><td class="highlight">${s.remaining.toLocaleString('ar-EG')}</td></tr>
    ${s.shipping_collected>0?`<tr><td>تم التحصيل من الشحن</td><td>${s.shipping_collected.toLocaleString('ar-EG')}</td></tr>`:''}
    </table><div class="footer">نظام إدارة المصنع المتكامل</div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  // Returns
  const openReturns = () => {
    setReturnForm({ date: '', order_number: '', client_name: '', returned_by: '', paid_by: '', model_code: '', model_qty: 0, model_color: '', refund_amount: 0, notes: '' });
    setReturnsModalOpen(true);
  };

  const handleSaveReturn = async () => {
    if (!returnForm.model_code || !returnForm.order_number) {
      toast('error', 'يرجى ملء رقم الأوردر وكود الموديل');
      return;
    }
    await returnsApi.add(returnForm as any);
await loadData();(returnForm);
    toast('success', 'تم تسجيل المرتجع — تم تحديث المخزون');
    setReturnsModalOpen(false);
  };

  const handleDeleteReturn = async (id: number) => {
    try { await await returnsApi.remove(id);(id); toast('success', 'تم حذف المرتجع'); setDeleteReturnConfirm(null); await loadData(); }
    catch (e: unknown) { toast('error', e instanceof Error ? e.message : 'خطأ'); }
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(s => ({
      'رقم الأوردر': s.order_number, 'المسوق': s.marketer, 'العميل': s.client,
      'الموبايل': s.mobile, 'البوليصة': s.shipping_number,
      'موديل 1': s.model1_code, 'عدد 1': s.model1_qty, 'لون 1': s.model1_color,
      'موديل 2': s.model2_code, 'عدد 2': s.model2_qty, 'لون 2': s.model2_color,
      'موديل 3': s.model3_code, 'عدد 3': s.model3_qty, 'لون 3': s.model3_color,
      'موديل 4': s.model4_code, 'عدد 4': s.model4_qty, 'لون 4': s.model4_color,
      'موديل 5': s.model5_code, 'عدد 5': s.model5_qty, 'لون 5': s.model5_color,
      'قيمة الفاتورة': s.invoice_value, 'العربون': s.deposit_paid, 'مستلم العربون': s.deposit_receiver, 'المتبقي': s.remaining,
      'الحالة': s.order_status, 'التسليم': s.delivery_method,
      'المخزن': s.warehouse, 'تحصيل شحن': s.shipping_collected,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المبيعات');
    XLSX.writeFile(wb, 'sales_export.xlsx');
  };

  const filtered = useMemo(() => {
    let result = sales;
    if (filterStatus) result = result.filter(s => s.order_status === filterStatus);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.order_number.toLowerCase().includes(q) || s.client.toLowerCase().includes(q) ||
        s.marketer.toLowerCase().includes(q) || s.mobile.includes(q) ||
        s.shipping_number.toLowerCase().includes(q)
      );
    }
    return result;
  }, [sales, filterStatus, search]);

  const totals = useMemo(() => ({
    invoices: filtered.reduce((s, r) => s + r.invoice_value, 0),
    deposits: filtered.reduce((s, r) => s + r.deposit_paid, 0),
    remaining: filtered.reduce((s, r) => s + r.remaining, 0),
  }), [filtered]);

  const inputClass = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent";
  const labelClass = "block text-xs font-semibold text-gray-600 mb-1";
  const totalRefunds = returns.reduce((s, r) => s + r.refund_amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📋 بيان المبيعات</h1>
          <p className="text-sm text-gray-500">إدارة الأوردرات والفواتير المرتجعات</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={loadData} disabled={loading} className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={exportExcel} className="flex items-center gap-2 px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
            <Download size={16} /> تصدير
          </button>
          <button onClick={openReturns} className="flex items-center gap-2 px-3 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">
            <ArrowLeftRight size={16} /> المرتجعات ({returns.length})
          </button>
          <button onClick={openReservation} className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition shadow-sm">
            <BookmarkPlus size={16} /> إضافة حجز
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] transition shadow-sm">
            <Plus size={16} /> إضافة أوردر
          </button>
        </div>
      </div>

      {/* Returns Summary */}
      {returns.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-orange-700">🔄 المرتجعات: {returns.length} مرتجع</span>
          <span className="text-lg font-bold text-orange-700">إجمالي الاسترجاع: {totalRefunds.toLocaleString('ar-EG')}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث برقم الأوردر، العميل، المسوق..." className={`w-full pr-10 ${inputClass}`} />
        </div>
        <div className="relative">
          <Filter size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="pr-10 appearance-none bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">جميع الحالات</option>
            {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="bg-[#1e3a5f] text-white">
                <th className="px-2 py-3 text-right font-semibold">ت</th>
                <th className="px-2 py-3 text-right font-semibold">الأوردر</th>
                <th className="px-2 py-3 text-right font-semibold">المسوق</th>
                <th className="px-2 py-3 text-right font-semibold">العميل</th>
                <th className="px-2 py-3 text-center font-semibold">البوليصة</th>
                <th className="px-2 py-3 text-center font-semibold">الموديلات</th>
                <th className="px-2 py-3 text-center font-semibold">الفاتورة</th>
                <th className="px-2 py-3 text-center font-semibold">العربون</th>
                <th className="px-2 py-3 text-center font-semibold">مستلم</th>
                <th className="px-2 py-3 text-center font-semibold">المتبقي</th>
                <th className="px-2 py-3 text-center font-semibold">الحالة</th>
                <th className="px-2 py-3 text-center font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (<tr><td colSpan={12} className="text-center py-8 text-gray-400">لا توجد بيانات</td></tr>)}
              {filtered.map((sale, idx) => (
                <tr key={sale.id} className="border-t border-gray-100 hover:bg-blue-50/40 transition">
                  <td className="px-2 py-3 text-gray-500">{idx + 1}</td>
                  <td className="px-2 py-3 font-medium">{sale.order_number}</td>
                  <td className="px-2 py-3">{sale.marketer}</td>
                  <td className="px-2 py-3">{sale.client}</td>
                  <td className="px-2 py-3 text-center">
                    {sale.shipping_number ? (
                      <span className="inline-block bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">{sale.shipping_number}</span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <div className="flex flex-wrap justify-center gap-1">
                      {[sale.model1_code&&`${sale.model1_code}(${sale.model1_qty})`,sale.model2_code&&`${sale.model2_code}(${sale.model2_qty})`,sale.model3_code&&`${sale.model3_code}(${sale.model3_qty})`,sale.model4_code&&`${sale.model4_code}(${sale.model4_qty})`,sale.model5_code&&`${sale.model5_code}(${sale.model5_qty})`].filter(Boolean).map((m,i)=>(
                        <span key={i} className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full">{m}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-center font-semibold">{sale.invoice_value.toLocaleString('ar-EG')}</td>
                  <td className="px-2 py-3 text-center text-emerald-600">{sale.deposit_paid.toLocaleString('ar-EG')}</td>
                  <td className="px-2 py-3 text-center">
                    {sale.deposit_receiver ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sale.deposit_receiver === 'حاتم' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {sale.deposit_receiver}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className={`px-2 py-3 text-center font-semibold ${sale.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {sale.remaining.toLocaleString('ar-EG')}
                  </td>
                  <td className="px-2 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      sale.order_status === 'تم الصرف' ? 'bg-emerald-100 text-emerald-700' :
                      sale.order_status === 'تم الحجز' ? 'bg-orange-100 text-orange-700' :
                      sale.order_status === 'تم الإلغاء' ? 'bg-red-100 text-red-700' :
                      sale.order_status === 'لم يتم الصرف' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{sale.order_status}</span>
                  </td>
                  <td className="px-2 py-3 text-center">
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {sale.order_status === 'تم الحجز' && (
                        <>
                          <button onClick={() => setConvertConfirm(sale.id)} className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-lg" title="صرف الحجز">
                            <CheckSquare size={14} />
                          </button>
                          <button onClick={() => setCancelReservationConfirm(sale.id)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-lg" title="إلغاء الحجز">
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      <button onClick={() => setInvoiceSale(sale)} className="p-1.5 text-indigo-600 hover:bg-indigo-100 rounded-lg" title="فاتورة">
                        <Printer size={14} />
                      </button>
                      <button onClick={() => openEdit(sale)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg"><Edit2 size={14} /></button>
                      <button onClick={() => setDeleteConfirm(sale.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                <td colSpan={6} className="px-2 py-3 text-right">الإجمالي</td>
                <td className="px-2 py-3 text-center">{totals.invoices.toLocaleString('ar-EG')}</td>
                <td className="px-2 py-3 text-center text-emerald-600">{totals.deposits.toLocaleString('ar-EG')}</td>
                <td></td>
                <td className={`px-2 py-3 text-center ${totals.remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {totals.remaining.toLocaleString('ar-EG')}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setShowAddMarketer(false); setNewMarketer(''); setIsReservation(false); }} title={editSale ? 'تعديل الأوردر' : isReservation ? 'إضافة حجز جديد' : 'إضافة أوردر جديد'} size="2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>رقم الأوردر *</label>
            <input className={inputClass} value={form.order_number} onChange={e => setForm({...form, order_number: e.target.value})} />
          </div>
          <div>
            <label className={labelClass}>المسوق</label>
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                {showAddMarketer ? (
                  <div className="flex gap-2">
                    <input className={inputClass} value={newMarketer} onChange={e => setNewMarketer(e.target.value)} placeholder="اسم المسوق الجديد" onKeyDown={e => { if (e.key === 'Enter') handleAddMarketer(); }} autoFocus />
                    <button onClick={handleAddMarketer} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs hover:bg-emerald-700 whitespace-nowrap">إضافة</button>
                    <button onClick={() => setShowAddMarketer(false)} className="px-2 py-2 bg-gray-200 text-gray-600 rounded-lg text-xs">✕</button>
                  </div>
                ) : (
                  <select className={inputClass} value={form.marketer} onChange={e => setForm({...form, marketer: e.target.value})}>
                    <option value="">اختر المسوق</option>
                    {marketers.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              {!showAddMarketer && (
                <button onClick={() => setShowAddMarketer(true)} className="p-2 bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] flex-shrink-0" title="إضافة مسوق جديد"><UserPlus size={18} /></button>
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>العميل *</label>
            <input className={inputClass} value={form.client} onChange={e => setForm({...form, client: e.target.value})} />
          </div>
          <div>
            <label className={labelClass}>رقم الموبايل</label>
            <input className={inputClass} value={form.mobile} onChange={e => setForm({...form, mobile: e.target.value})} />
          </div>
        </div>

        {/* 5 Model Groups */}
        <div className="mt-4">
          <h3 className="font-bold text-gray-700 mb-3">الموديلات</h3>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 p-3 bg-gray-50 rounded-lg">
              <div>
                <label className={labelClass}>موديل {i}</label>
                <select className={inputClass} value={form[`model${i}_code` as keyof typeof form] as string} onChange={e => setForm({...form, [`model${i}_code`]: e.target.value})}>
                  <option value="">اختر الموديل</option>
                  {stockCodes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>العدد</label>
                <input type="number" className={inputClass} value={form[`model${i}_qty` as keyof typeof form] as number} onChange={e => setForm({...form, [`model${i}_qty`]: parseInt(e.target.value) || 0})} min={0} />
              </div>
              <div>
                <label className={labelClass}>اللون</label>
                <select className={inputClass} value={form[`model${i}_color` as keyof typeof form] as string} onChange={e => setForm({...form, [`model${i}_color`]: e.target.value})}>
                  <option value="">اختر اللون</option>
                  {(stockColors[form[`model${i}_code` as keyof typeof form] as string] || []).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div>
            <label className={labelClass}>قيمة الفاتورة</label>
            <input type="number" className={inputClass} value={form.invoice_value} onChange={e => setForm({...form, invoice_value: parseFloat(e.target.value) || 0})} min={0} />
          </div>
          <div>
            <label className={labelClass}>العربون المدفوع</label>
            <input type="number" className={inputClass} value={form.deposit_paid} onChange={e => setForm({...form, deposit_paid: parseFloat(e.target.value) || 0})} min={0} />
          </div>
          <div>
            <label className={labelClass}>من استلم العربون</label>
            <select className={inputClass} value={form.deposit_receiver} onChange={e => setForm({...form, deposit_receiver: e.target.value as 'حاتم' | 'ميدو' | ''})}>
              <option value="">اختر</option>
              <option value="حاتم">حاتم</option>
              <option value="ميدو">ميدو</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>المتبقي</label>
            <input className={`${inputClass} bg-gray-100 font-bold text-red-600`} value={(form.invoice_value - form.deposit_paid).toLocaleString('ar-EG')} readOnly />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div>
            <label className={labelClass}>رقم البوليصة</label>
            <input className={inputClass} value={form.shipping_number} onChange={e => setForm({...form, shipping_number: e.target.value})} placeholder="رقم البوليصة / الشحن" />
          </div>
          <div>
            <label className={labelClass}>حالة الأوردر</label>
            <select className={inputClass} value={form.order_status} onChange={e => setForm({...form, order_status: e.target.value as Sale['order_status']})}>
              {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>طريقة التسليم</label>
            <select className={inputClass} value={form.delivery_method} onChange={e => setForm({...form, delivery_method: e.target.value})}>
              {DELIVERY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
          <div>
            <label className={labelClass}>المخزن</label>
            <input className={inputClass} value={form.warehouse} onChange={e => setForm({...form, warehouse: e.target.value})} />
          </div>
          <div>
            <label className={labelClass}>تم التحصيل من الشحن</label>
            <input type="number" className={inputClass} value={form.shipping_collected} onChange={e => setForm({...form, shipping_collected: parseFloat(e.target.value) || 0})} min={0} />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => { setModalOpen(false); setShowAddMarketer(false); setNewMarketer(''); setIsReservation(false); }} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition">إلغاء</button>
          <button onClick={handleSave} className="px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d] transition">حفظ</button>
        </div>
      </Modal>

      {/* Invoice Modal */}
      <Modal isOpen={invoiceSale !== null} onClose={() => setInvoiceSale(null)} title="معاينة الفاتورة" size="lg">
        {invoiceSale && (
          <div id="invoice-content">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-[#1e3a5f]">فاتورة مبيعات</h2>
              <p className="text-gray-400 text-sm">نظام إدارة المصنع</p>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm mb-6 bg-gray-50 rounded-lg p-4">
              <div><span className="text-gray-500">رقم الأوردر:</span> <strong>{invoiceSale.order_number}</strong></div>
              <div><span className="text-gray-500">التاريخ:</span> <strong>{new Date(invoiceSale.created_at).toLocaleDateString('ar-EG')}</strong></div>
              <div><span className="text-gray-500">المسوق:</span> <strong>{invoiceSale.marketer}</strong></div>
              <div><span className="text-gray-500">العميل:</span> <strong>{invoiceSale.client}</strong></div>
              <div><span className="text-gray-500">الموبايل:</span> <strong>{invoiceSale.mobile}</strong></div>
              <div><span className="text-gray-500">التسليم:</span> <strong>{invoiceSale.delivery_method}</strong></div>
              {invoiceSale.shipping_number && <div><span className="text-gray-500">البوليصة:</span> <strong>{invoiceSale.shipping_number}</strong></div>}
              {invoiceSale.deposit_receiver && <div><span className="text-gray-500">مستلم العربون:</span> <strong>{invoiceSale.deposit_receiver}</strong></div>}
            </div>
            <h3 className="font-bold text-gray-700 mb-3">تفاصيل الموديلات:</h3>
            <table className="w-full text-sm border-collapse mb-6">
              <thead><tr className="bg-[#1e3a5f] text-white">
                <th className="px-3 py-2 text-right">#</th><th className="px-3 py-2 text-right">الكود</th><th className="px-3 py-2 text-center">العدد</th><th className="px-3 py-2 text-center">اللون</th>
              </tr></thead>
              <tbody>
                {[invoiceSale.model1_code&&{c:invoiceSale.model1_code,q:invoiceSale.model1_qty,col:invoiceSale.model1_color},invoiceSale.model2_code&&{c:invoiceSale.model2_code,q:invoiceSale.model2_qty,col:invoiceSale.model2_color},invoiceSale.model3_code&&{c:invoiceSale.model3_code,q:invoiceSale.model3_qty,col:invoiceSale.model3_color},invoiceSale.model4_code&&{c:invoiceSale.model4_code,q:invoiceSale.model4_qty,col:invoiceSale.model4_color},invoiceSale.model5_code&&{c:invoiceSale.model5_code,q:invoiceSale.model5_qty,col:invoiceSale.model5_color}].filter(Boolean).map((m: any, i: number) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-3 py-2">{i + 1}</td><td className="px-3 py-2">{m.c}</td><td className="px-3 py-2 text-center">{m.q}</td><td className="px-3 py-2 text-center">{m.col}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4 text-sm">
              <div className="flex justify-between"><span>قيمة الفاتورة:</span><strong>{invoiceSale.invoice_value.toLocaleString('ar-EG')}</strong></div>
              <div className="flex justify-between text-emerald-600"><span>العربون:</span><strong>{invoiceSale.deposit_paid.toLocaleString('ar-EG')}</strong></div>
              <div className="flex justify-between text-red-600"><span>المتبقي:</span><strong>{invoiceSale.remaining.toLocaleString('ar-EG')}</strong></div>
              {invoiceSale.shipping_collected > 0 && <div className="flex justify-between"><span>تحصيل شحن:</span><strong>{invoiceSale.shipping_collected.toLocaleString('ar-EG')}</strong></div>}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={() => setInvoiceSale(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إغلاق</button>
          <button onClick={handlePrintInvoice} className="flex items-center gap-2 px-5 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#16304d]">
            <Printer size={16} /> طباعة
          </button>
        </div>
      </Modal>

      {/* Returns Modal */}
      <Modal isOpen={returnsModalOpen} onClose={() => setReturnsModalOpen(false)} title="🔄 المرتجعات" size="2xl">
        <div className="flex gap-2 mb-4">
          <button onClick={() => {
            setReturnForm({ date: '', order_number: '', client_name: '', returned_by: '', paid_by: '', model_code: '', model_qty: 0, model_color: '', refund_amount: 0, notes: '' });
          }} className="flex items-center gap-2 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700">
            <Plus size={14} /> تسجيل مرتجع
          </button>
        </div>

        {/* Return Form */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 p-4 bg-orange-50 rounded-lg border border-orange-200">
          <div>
            <label className={labelClass}>التاريخ</label>
            <input type="date" className={inputClass} value={returnForm.date} onChange={e => setReturnForm({...returnForm, date: e.target.value})} />
          </div>
          <div>
            <label className={labelClass}>رقم الأوردر *</label>
            <input className={inputClass} value={returnForm.order_number} onChange={e => setReturnForm({...returnForm, order_number: e.target.value})} placeholder="ORD-001" />
          </div>
          <div>
            <label className={labelClass}>العميل</label>
            <input className={inputClass} value={returnForm.client_name} onChange={e => setReturnForm({...returnForm, client_name: e.target.value})} />
          </div>
          <div>
            <label className={labelClass}>من رجع *</label>
            <select className={inputClass} value={returnForm.returned_by} onChange={e => setReturnForm({...returnForm, returned_by: e.target.value as 'حاتم' | 'ميدو' | ''})}>
              <option value="">اختر</option>
              <option value="حاتم">حاتم</option>
              <option value="ميدو">ميدو</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>من حول مبلغ المرتجع *</label>
            <select className={inputClass} value={returnForm.paid_by} onChange={e => setReturnForm({...returnForm, paid_by: e.target.value as 'حاتم' | 'ميدو' | ''})}>
              <option value="">اختر</option>
              <option value="حاتم">حاتم</option>
              <option value="ميدو">ميدو</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>كود الموديل *</label>
            <select className={inputClass} value={returnForm.model_code} onChange={e => setReturnForm({...returnForm, model_code: e.target.value})}>
              <option value="">اختر</option>
              {stockCodes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>العدد</label>
            <input type="number" className={inputClass} value={returnForm.model_qty} onChange={e => setReturnForm({...returnForm, model_qty: parseInt(e.target.value) || 0})} min={0} />
          </div>
          <div>
            <label className={labelClass}>اللون</label>
            <select className={inputClass} value={returnForm.model_color} onChange={e => setReturnForm({...returnForm, model_color: e.target.value})}>
              <option value="">اختر</option>
              {(stockColors[returnForm.model_code] || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>مبلغ الاسترجاع</label>
            <input type="number" className={inputClass} value={returnForm.refund_amount} onChange={e => setReturnForm({...returnForm, refund_amount: parseFloat(e.target.value) || 0})} min={0} />
          </div>
          <div className="flex items-end">
            <button onClick={handleSaveReturn} className="w-full px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition">حفظ المرتجع</button>
          </div>
        </div>

        {/* Returns Table */}
        {returns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-orange-100 text-orange-800">
                  <th className="px-3 py-2 text-right">التاريخ</th><th className="px-3 py-2 text-right">الأوردر</th>
                  <th className="px-3 py-2 text-right">العميل</th><th className="px-3 py-2 text-center">المرجع</th><th className="px-3 py-2 text-center">محول المبلغ</th>
                  <th className="px-3 py-2 text-right">الموديل</th><th className="px-3 py-2 text-center">العدد</th>
                  <th className="px-3 py-2 text-center">الاسترجاع</th><th className="px-3 py-2 text-center">ملاحظات</th><th className="px-3 py-2 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 text-center">{r.date}</td>
                    <td className="px-3 py-2">{r.order_number}</td>
                    <td className="px-3 py-2">{r.client_name}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.returned_by === 'حاتم' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.returned_by || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.paid_by === 'حاتم' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.paid_by || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.model_code} - {r.model_color}</td>
                    <td className="px-3 py-2 text-center font-semibold text-emerald-600">{r.model_qty}</td>
                    <td className="px-3 py-2 text-center font-semibold text-red-600">{r.refund_amount.toLocaleString('ar-EG')}</td>
                    <td className="px-3 py-2 text-center text-xs">{r.notes || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => setDeleteReturnConfirm(r.id)} className="p-1.5 text-red-600 hover:bg-red-100 rounded-lg"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Delete Return Confirm */}
      <Modal isOpen={deleteReturnConfirm !== null} onClose={() => setDeleteReturnConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا المرتجع؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteReturnConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => deleteReturnConfirm !== null && handleDeleteReturn(deleteReturnConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">حذف</button>
        </div>
      </Modal>

      {/* Delete Sale Confirm */}
      <Modal isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} title="تأكيد الحذف" size="sm">
        <p className="text-gray-600">هل أنت متأكد من حذف هذا الأوردر؟</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setDeleteConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => deleteConfirm !== null && handleDelete(deleteConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">حذف</button>
        </div>
      </Modal>

      {/* Convert Reservation Confirm */}
      <Modal isOpen={convertConfirm !== null} onClose={() => setConvertConfirm(null)} title="تأكيد صرف الحجز" size="sm">
        <p className="text-gray-600">هل تريد تحويل هذا الحجز إلى أوردر مصروف؟ سيتم خصم الكميات من المخزون.</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConvertConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">إلغاء</button>
          <button onClick={() => convertConfirm !== null && handleConvertReservation(convertConfirm)} className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">صرف</button>
        </div>
      </Modal>

      {/* Cancel Reservation Confirm */}
      <Modal isOpen={cancelReservationConfirm !== null} onClose={() => setCancelReservationConfirm(null)} title="تأكيد إلغاء الحجز" size="sm">
        <p className="text-gray-600">هل تريد إلغاء هذا الحجز؟ سيتم تحرير الكمية المحجوزة.</p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setCancelReservationConfirm(null)} className="px-5 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">رجوع</button>
          <button onClick={() => cancelReservationConfirm !== null && handleCancelReservation(cancelReservationConfirm)} className="px-5 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">إلغاء الحجز</button>
        </div>
      </Modal>
    </div>
  );
}
