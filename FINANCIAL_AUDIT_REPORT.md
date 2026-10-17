# Financial Systems Audit — Clothing Factory Management System

**Audit date:** 2026-10-17 · **Scope:** whole repository (`src/` frontend, `backend/src/` API, `backend/prisma/` schema + migrations, `backend/tests/`)
**Type:** audit and report only — no application code, schema, migration, environment variable or data was changed. The only file created in the repository is this report.

---

## 1. Executive summary

### 1.1 What was audited and how

| Evidence level | Meaning | Used in this report |
|---|---|---|
| **[CODE]** | Read from the actual source / schema, with `file:line` | All findings |
| **[SYN]** | The *real* route/service code was executed on **synthetic in-memory rows** (no database touched) to quantify an issue. The numbers are illustrative, **not** your business data. | Experiments E1–E7b (§13.2) |
| **[TEST]** | Result of the project's own automated tests, re-run during this audit | 89/89 unit tests pass |
| **[DB]** | Verified against the **real** database | **None — see 1.2** |

### 1.2 Was the real database accessible?

**No.** The configured database host is Railway's *internal* address (`postgres.railway.internal:5432`), which cannot be reached from this machine. A read-only connection attempt (the project's own `audit:receivables` script, which only runs `findMany`) failed with *"Can't reach database server"*. `.env` files were not opened or printed.

Consequence: **every row of the reconciliation tables in §13 that needs real data is marked "not verified"**. Nothing in this report claims a real-database result. §Appendix A contains read-only SQL so that the same checks can be run where the database is reachable (inside Railway, or through a read-only connection).

### 1.3 Verdict in one paragraph

The system's **order → stock → collection → cost** pipeline (the part rebuilt recently with append-only ledgers, FIFO reservations, idempotent planners and cancellation reversals) is internally consistent and well covered by tests. The weaknesses are **around it**: (a) the figure presented as **"profit"** is a *cash-flow total* (and "profit by period" is *asset growth*), so capital injections, loans and customer deposits show up as profit; (b) several **cash-moving events are never recorded** (or can be edited/deleted without a ledger trail), so "actual cash" cannot be reconciled to reality; (c) the **same asset is valued differently on different pages** (Dashboard, Financial Center, snapshots, Reports, AI assistant), one of which (the Financial Center) wrongly deducts reserved goods; and (d) **unit cost is typed in by hand** at every stage, so true product cost, gross profit per model and labour/overhead allocation are not computable from the data.

### 1.4 Findings by severity

| Severity | Count | Definition used |
|---|---:|---|
| **Critical** | **6** | Cash, stock, or profit can be materially wrong or duplicated |
| **High** | **16** | Incorrect balances, missing costs, or incorrect transitions |
| **Medium** | **15** | Inconsistent reporting, missing reconciliation, weak validation |
| **Low** | **7** | Labels, usability, documentation |
| **Total** | **44** | (full list with evidence in §14) |

### 1.5 The three most important accounting risks

1. **"Profit" is not profit.** `صافي الربح` / `الصافي` = *total cash in − total cash out* (includes `راس مالى`, `استلاف`, deposits on unshipped or cancelled orders; excludes cost of goods sold, payroll, depreciation). `الربح حسب الفترة` = *change in current assets between snapshots*, written by **two different asset definitions** (C-01, C-02). On synthetic data a 250,000 capital+loan entry with **zero trading** displays as a 250,000 "net profit" (E5), and two writers disagree by 8,400 on the same data (E4).
2. **Cash can silently diverge from reality** — "paid" amounts on debts/client accounts bypass cash (C-04), purchases/print jobs/payroll/fixed assets have no cash or payable entry (H-08, H-09, H-10), deposits have no ledger (H-16), and deleting an order or a payment hard-deletes the money trail (C-05, M-10).
3. **Inventory and asset totals are not consistent across pages** — Financial Center subtracts reserved and cancelled sales from stock (−10,200 in E1), duplicate stock cards double-apply production/sales (+6,000 in E7b), fabric is under-valued when >1 warehouse row exists (−1,500 in E2), WIP can be counted again as stock (E3), and five different definitions of "current assets" are in use (C-03, C-06, H-01, H-02, H-04).

### 1.6 Correction of an earlier statement

In earlier work on this project I described the Financial Center as already valuing stock at *physical quantity × cost*. This audit found that to be **incomplete**: the Financial Center deducts **every** sale from stock regardless of status (`financialCenter.ts:75-87`), including reservations and cancellations, so it does *not* follow the reservation rule. That is finding **C-03** below. Nothing was changed in this audit.

### 1.7 Recommended next steps (before any fix is implemented)

1. Run Appendix A queries inside Railway (read-only transaction) and attach the output to §13 — this converts "not verified" into real numbers and sizes C-04/C-06/H-05/H-06 exactly.
2. Take the **business decisions** in §17 (profit definition, opening balances, WIP/cutting meaning, what a "season" carries over).
3. Approve the **correction plan** in §15 phase by phase; implement Critical items first, each with the tests in §16.
4. Do not change valuation or profit formulas until step 2 is answered — several "fixes" are policy choices, not bugs.

---

## 2. System map — which files control what

| Page (Arabic) | Frontend | API endpoint | Backend calculation |
|---|---|---|---|
| لوحة التحكم (Dashboard) | `src/pages/Dashboard.tsx`, `components/DashboardBreakdownModal.tsx`, `MissingStockSummary.tsx`, `ReceivablesAuditModal.tsx`, `CharitySection.tsx`, `ProfitByPeriod.tsx` | `GET /api/dashboard`, `/api/dashboard/breakdown/*`, `/api/charity/*`, `/api/snapshots/*` | `backend/src/routes/dashboard.ts`, `dashboardBreakdown.ts`, `services/financialMetrics.ts`, `readyStockPositions.ts`, `inventoryMovements.ts`, `missingStock.ts`, `receivablesAudit.ts`, `orderCancellation.ts`, `charity.ts` |
| المركز المالي (Financial Center) | `src/pages/FinancialCenter.tsx` | `GET /api/financial-center` | `backend/src/routes/financialCenter.ts` (**self-contained, does not use the shared services**) |
| المبيعات (Sales) | `src/pages/Sales.tsx` | `/api/sales/*` | `routes/sales.ts`, `services/orderLedgers.ts`, `shippingCollections.ts`, `orderCancellation.ts` |
| المصاريف والإيرادات | `src/pages/Expenses.tsx` | `/api/expenses` | `routes/entities.ts:39-91` (plain CRUD) |
| الديون / حساب عميل | `Debts.tsx`, `ClientAccounts.tsx` | `/api/debts`, `/api/client-accounts` | `routes/entities.ts:580-908` |
| المخازن (قماش، إكسسوارات، قص، تصنيع، استوك) | `FabricWarehouse.tsx`, `Accessories.tsx`, `Cutting.tsx`, `ModelProduction.tsx`, `ReadyStock.tsx` | `/api/fabric`, `/accessories`, `/cutting`, `/model-prod`, `/ready-stock`, `/fabric-purchases`, `/print-orders` | `routes/entities.ts:93-578, 1030-1500`, `services/reservationSync.ts` |
| الأصول الثابتة | `FixedAssets.tsx` (depreciation computed **client-side**, lines 21-35) | `/api/fixed-assets` | `routes/entities.ts:1336-1372` |
| الحضور والمرتبات | `Payroll.tsx` | `/api/payroll/*` | `routes/payroll.ts`, `services/payrollCalc.ts` |
| التقارير | `Reports.tsx` | `/api/reports`, `/api/reports/employee-movements` (cash-flow) | `routes/reports.ts` (own capital-snapshot function, lines 33-104) |
| المساعد الذكي | `AiAssistant.tsx` | `/api/ai-assistant` | `routes/aiAssistant.ts` (own definitions, e.g. line 329) |

Season handling: every request resolves a season via `getSeasonId` (`services/seasonContext.ts:22-31`: header `X-Season-Id` or `?season_id`, **silently falling back to the active season** if the id is invalid) and filters with `seasonWhere`.

### 2.1 Money-related tables (Prisma, `backend/prisma/schema.prisma`)

| Table | Season-scoped | Money / quantity fields | Role |
|---|:--:|---|---|
| `sales` (127-174) | ✅ | `invoice_value, deposit_paid, remaining, shipping_collected, shipping_collected_date, cancel_disposition`, 5 × (`modelN_code/qty/color`) | Orders; deposit = plain field |
| `shipping_collections` (649) | ✅ | signed `amount`, `kind`, `collected_date`, `date_estimated` | Append-only collection ledger; `sales.shipping_collected` is its maintained sum |
| `inventory_movements` (673) | ✅ | `qty, unit_cost, total_cost, movement_type (SHIP / SHIP_REVERSAL)` | Cost snapshot at shipment |
| `order_cancellations` (699) | ✅ | `goods_qty, goods_cost, deposit_held, collected_held, disposition` | Cancellation audit rows |
| `expenses_revenues` (177) | ✅ | `amount_in, amount_out, operation_type` (free text), legacy `hatem_*`/`mido_*` | Manual cash book |
| `payment_logs` (435) | ✅ | `type ∈ {client_payment, debt_payment}`, `amount` | Cash-in/out generated by client/debt payments |
| `return_items` (415) | ✅ | `refund_amount, model_qty` | Refunds (cash out) **and** returned stock |
| `debts` / `debt_payments` (324/340) | ✅ | `total_amount, amount_paid, remaining` | Liabilities |
| `client_accounts` / `_payments` / `_invoices` (359/379/398) | ✅ | `total_amount, amount_paid, remaining` | Manual receivables |
| `ready_stock` (198) | ✅ | `opening_balance, cost_per_piece, reserved_quantity` (cache) | Stock cards (**no unique key on model+colour**) |
| `fabric_warehouse` (214) | ✅ | `qty_in, cost_per_kg, avg_cost_per_kg` (no `qty_out`) | Raw material; consumption derived from cutting |
| `fabric_purchases` (231) | ✅ | `quantity_kg, price_per_kg, total_cost` | Purchase invoices (no cash link) |
| `accessories_warehouse` (250) | ✅ | `qty_in, qty_consumed, cost` | Manual consumption |
| `cutting_orders` (265) | ✅ | `kg_consumed, total_pieces, cost_per_meter` | Manual cost |
| `model_productions` (286) / `model_parts` (309) | ✅ | `qty_received, cost_per_piece, status` | Production, WIP |
| `print_orders` (577) | ✅ | `quantity, blank_unit_cost, print_cost_per_piece, final_unit_cost` | Re-costs stock, no cash entry |
| `financial_snapshots` (558) | ✅ | `total_current_assets, cash, …` | One row per season/day, last writer wins |
| `charity_payments` (625) | ✅ | `amount, charity_month, expense_id` | Linked 1:1 to an expense |
| `fixed_assets` (468), `assets` (457) | ❌ **global** | `purchase_price` / `value` | Not season-isolated (`assets` is unused) |
| `employees`, `attendance`, `salary_adjustments`, `payroll` (482-555) | ❌ **global** | `monthly_salary, net_salary, advances…` | Not season-isolated; no link to cash |
| `marketers`, `audit_logs`, users/roles/permissions | ❌ global | — | Intentionally shared |

---

## 3. Inventory of financial formulas

Legend — **Basis**: `rec` = computed live from records · `ledger` = from an append-only ledger · `cache` = stored derived value · `manual` = typed in by a user.
**Scope**: `S` = filtered by selected season · `S+D` = season and a date range · `—` = no date filter · `⚠global` = not season-isolated.
**Cls**: A asset · L liability · R revenue · E expense · I inventory · Rec receivable · P payable · Pr profit · C cash-flow (not an accounting class).
"Statuses" lists which order statuses the figure includes. Evidence is `file:line` [CODE]; "E#" refers to a synthetic experiment in §13.2.

### 3.1 Dashboard (`Dashboard.tsx` ← `GET /api/dashboard` ← `routes/dashboard.ts`)

| ID | UI label | Formula | Source | Tables · fields | Basis · Scope | Statuses | Cls | Double-count / notes |
|---|---|---|---|---|---|---|---|---|
| F-01 | إجمالي المبيعات | Σ `invoice_value` over **all** orders | `dashboard.ts:31` | sales.invoice_value | rec · S · — | **all** (reserved, cancelled, shipped, unpaid) | R (mislabelled) | Counts reservations and cancelled invoices → **H-13** (E6: 10,000 shown vs 2,000 recognised) |
| F-02 | إجمالي المصاريف (card) / إجمالي المصاريف (top table) | `total_out` = Σ `expenses.amount_out` + Σ `payment_logs[debt_payment]` + Σ `return_items.refund_amount` | `financialMetrics.ts:128-141`; `dashboard.ts:37-38,350` | expenses_revenues.amount_out · payment_logs.amount · return_items.refund_amount | rec · S · — | n/a | C (outflow) | Includes **debt repayments** (a liability reduction), **refunds** and **charity** → not "expenses" in the accounting sense (**H-13**) |
| F-03 | الصافي (top table) = صافي الربح (card) | `total_in − total_out` | `financialMetrics.ts:142`; `dashboard.ts:38,351`; `Dashboard.tsx:185` | as F-02 + F-04 | rec · S · — | see F-04 | **C, shown as Pr** | **C-01** — includes capital, loans, deposits on unfulfilled/cancelled orders; excludes COGS, payroll, depreciation (E5) |
| F-04 | إجمالي الوارد | Σ `expenses.amount_in` + Σ `sales.deposit_paid` (**every** status) + Σ `sales.shipping_collected` (status ∈ {تم الصرف, تم الإلغاء}) + Σ `payment_logs[client_payment]` | `financialMetrics.ts:130-140`; `readyStockPositions.ts:48` | expenses_revenues.amount_in · sales.deposit_paid, shipping_collected · payment_logs | rec · S · — | deposits: all; collections: paid-out + cancelled-held | C (inflow) | Deposits have no ledger/date (**H-16**); manual `ايراد مبيعات` rows can duplicate automatic flows (**H-14**) |
| F-05 | المتبقي من الديون | Σ `debts.remaining` | `dashboard.ts:40` | debts.remaining (maintained incrementally) | cache · S · — | n/a | L | `remaining` can be edited without cash (**C-04**) |
| F-06 | الكاش المتاح | `total_in − total_out − Σ debts.remaining` | `dashboard.ts:48,355` | as F-04, F-02, F-05 | rec · S · — | n/a | C net of L | A *different* concept from F-10 and from the Financial Center's `cash_available` (**H-04**, **L-04**) |
| F-07 | الفلوس اللي لنا برا | Σ max(0,`remaining`) [لم يتم الصرف] + Σ max(0,`remaining − shipping_collected`) [تم الصرف] + Σ max(0,`client_accounts.remaining`) | `dashboard.ts:44-47`; `receivablesAudit.ts:25` | sales.remaining, shipping_collected, status · client_accounts.remaining | rec · S · — | not-paid-out, paid-out gap; **not** reserved, cancelled, `حساب عميل` | Rec | Overlap with client-account invoices only *detected* (M-01); `حساب عميل` orders create no receivable (M-15); gaps never closable (H-15) |
| F-08 | إجمالي الحجوزات | Σ `invoice_value` where status = `تم الحجز` (يتم التجهيز) | `dashboard.ts:32-34` | sales | rec · S · — | prepared only | operational commitment (not an asset) | — |
| F-09 | إجمالي الأصول الحالية | F-10 + F-11 + F-12 + F-13 + F-14 + F-15 + F-07 | `dashboard.ts:319`; reconciliation `:321-337` | see components | rec · S · — | see components | A | Component rows are checked to sum to the total on every request (`assets_reconciliation`). Other pages use *different* definitions (**H-04**) |
| F-10 | الكاش الفعلي بالخزنة | = F-03 (`net_profit`) | `dashboard.ts:309` | as F-03 | rec · S · — | — | A (cash) | Not netted for debts/refund liabilities |
| F-11 | مخزن القماش | per warehouse row: max(0, `qty_in − Σ cutting.kg_consumed`(same material+colour, fuzzy)) × (`avg_cost_per_kg` if >0 else `cost_per_kg`) | `dashboard.ts:56-74` | fabric_warehouse · cutting_orders.kg_consumed | rec · S · — | n/a | I (raw) | Whole-key consumption subtracted from **each** row → under-value when >1 row (**H-01**, E2) |
| F-12 | الاستوك الفعلي (متاح + محجوز) × التكلفة | per stock card: physical × `cost_per_piece`, physical = max(0, `opening_balance` + Σ `qty_received`(all production statuses) − Σ shipped qty(`leavesStock`) + Σ `return_items.model_qty`) | `dashboard.ts:116-171`; `readyStockPositions.ts:74,146` | ready_stock · model_productions.qty_received · sales slots · return_items | rec/manual cost · S · — | shipped + cancelled-not-returned leave stock; reserved & unpaid stay | I | Duplicate cards double-apply production/sales (**C-06**, E7b); production in progress also in F-15 (**H-02**, E3); cost is a manual card value (**H-05**) |
| F-13 | الإكسسوارات × التكلفة | Σ max(0,`qty_in − qty_consumed`) × `cost` | `dashboard.ts:173-179` | accessories_warehouse | rec/manual · S · — | n/a | I | `qty_consumed` is typed by hand (no link to production) |
| F-14 | قطع متبقية × تكلفة المتر | Σ max(0,`total_pieces − pieces used by model_parts`) × `cost_per_meter` | `dashboard.ts:76-101` | cutting_orders · model_parts · model_productions.qty_from_cutting | rec/manual · S · — | n/a | I (WIP-cut) | **Pieces × (cost per *metre*)** — unit mismatch/ambiguity (**H-03**) |
| F-15 | قيمة التشغيل (قيد التشغيل) | Σ `qty_received × cost_per_piece` where `status='قيد التشغيل'` | `dashboard.ts:103-114` | model_productions | rec/manual · S · — | n/a | I (WIP) | Same units are also in F-12 via `qty_received` (**H-02**) |
| F-16 | متاح / محجوز / ناقص (stock detail) | FIFO allocation of physical stock to `تم الحجز` orders; reserved ≤ physical; pending = requested − reserved | `readyStockPositions.ts:146-230`; `dashboard.ts:145-171` | ready_stock · sales slots | derived · S · — | prepared | I (split of F-12) | Invariant physical = available + reserved holds by construction |
| F-17 | مبيعات خرجت من المصنع (معترف بها) | Σ `invoice_value` where goods left the factory (`isStockDeducting`) | `dashboard.ts:218-219` | sales | rec · S · — | shipped statuses incl. `حساب عميل` | R | Whole-order invoice (shipping/extra charges not separable) |
| F-18 | تكلفة البضاعة المباعة | Σ SHIP `total_cost` − Σ SHIP_REVERSAL `total_cost` − cost credit of recorded returns | `dashboard.ts:221-240`; `inventoryMovements.ts:100-125` | inventory_movements | ledger · S · — | shipped | E (COGS) | Orders shipped before the ledger have **no** cost (**H-06**); zero-cost cards produce zero-cost rows counted as "costed" (**H-05**) |
| F-19 | هامش إجمالي | Σ invoice of *costed* shipped orders − F-18 | `dashboard.ts:241,381` | — | derived · S · — | shipped & costed | Pr (gross, order level) | No per-line price → no per-model margin (**H-07**) |
| F-20 | مستحق على شركة الشحن | Σ of F-07's sale rows | `dashboard.ts:243-245` | — | rec · S · — | not-paid-out + gap | Rec | — |
| F-21 | عربون على حجوزات لم تُشحن (التزام) | Σ `deposit_paid` where status = `تم الحجز` | `dashboard.ts:252` | sales | rec · S · — | prepared | L (customer deposit) | Shown as a metric; **not deducted** from any asset/net-position total (**M-11**) |
| F-22 | التزام رد عربون لعملاء (أوردرات ملغاة) | Σ max(0, `deposit_paid − refunds recorded for that order_number`) over cancelled orders | `dashboard.ts:255-258`; `orderCancellation.ts:28` | sales · return_items.refund_amount (matched by order number) | rec · S · — | cancelled | L | Refund match is by order-number text |
| F-23 | التزام رد لشركة الشحن (أوردرات ملغاة) | Σ `shipping_collected` over cancelled orders | `dashboard.ts:259` | sales (kept collection) | rec/ledger · S · — | cancelled | L | — |
| F-24 | بضاعة ملغاة لم تعد للمخزون | Σ `goods_qty`/`goods_cost` of open cancellations with disposition not_returned / returned_damaged | `dashboard.ts:262-270` | order_cancellations | ledger · S · — | cancelled | memo (not an asset) | Valued at historical cost, excluded from assets by design |
| F-25 | أوردرات في انتظار الإنتاج + ملخص النواقص | pending = requested − reserved per order line; grouped by model+colour | `dashboard.ts:273-285,392`; `missingStock.ts` | sales slots · ready_stock | derived · S · — | prepared | operational | Never an asset |

### 3.2 Dashboard drill-downs and charity

| ID | UI label | Formula | Source | Notes |
|---|---|---|---|---|
| F-26 | تفاصيل صافي الربح | Inflows/outflows listed by source; total = F-03 | `dashboardBreakdown.ts:44-82` | Same function as F-03 → reconciles by construction |
| F-27 | تفاصيل إجمالي المصاريف | Categories = `operation_type` groups of `amount_out` + `سداد ديون` + `مرتجعات`; reconciliation flag against F-02 | `dashboardBreakdown.ts:88-150` | — |
| F-28 | تفاصيل إجمالي المبيعات | Totals by status/marketer/delivery; `total_cash_collected` = deposits + collections | `dashboardBreakdown.ts:178-232` | Includes cancelled orders' deposits in "cash collected" |
| F-29 | صدقة الشهر | `due = round(month_total × rate)`; rate 1% (<200k), 1.5% (<400k), 2% (≤800k), 3% (>800k); `month_total = Σ shipping_collections.amount` grouped by `collected_date` month, positive nets per sale | `services/charity.ts:44-60`; `shippingCollections.ts:87-116`; `routes/charity.ts:91-232` | Payment creates a real expense (`charity.ts:176-190`) in one transaction; idempotent key; over-payment rejected |

### 3.3 Financial Center (`FinancialCenter.tsx` ← `GET /api/financial-center` ← `financialCenter.ts`)

| ID | UI label | Formula | Source | Differences from the Dashboard |
|---|---|---|---|---|
| F-30 | إجمالي الأصول المتداولة | fabric + stock + accessories + receivables + cash | `financialCenter.ts:104` | **No cutting, no WIP**; fabric at `cost_per_kg` (`:65`) not WAC; stock subtracts **all** sales (`:75-87`) |
| F-31 | السيولة الحالية (`cash_available`) | `total_in − total_out` (no debts) | `financialCenter.ts:53` | Same *name* as the Dashboard's `cash_available` but **different meaning** (**L-04**) |
| F-32 | إجمالي الأصول الثابتة | Σ `fixed_assets.purchase_price` (**all seasons, at cost**) | `financialCenter.ts:24,106` | FixedAssets page shows *book value*; no depreciation expense anywhere (**H-10**) |
| F-33 | إجمالي الأصول | F-30 + F-32 | `:107` | — |
| F-34 | صافي المركز المالي | F-33 − Σ `debts.remaining` | `:108` | Customer deposits, refund obligations, payroll payable not liabilities (**M-11**) |

### 3.4 Snapshots / "الربح حسب الفترة" / Reports / AI

| ID | UI label | Formula | Source | Notes |
|---|---|---|---|---|
| F-35 | أصول البداية / أصول النهاية | `financial_snapshots.total_current_assets` at/before the dates (end = live `computeSnapshot` if today) | `snapshots.ts:56-88` | Missing start snapshot → start = 0 (`:84-89`) → "profit" = entire asset base |
| F-36 | صافي الربح / الخسارة (الربح حسب الفترة) | `end_assets − start_assets` (UI states it: `ProfitByPeriod.tsx:344`) | `snapshots.ts:88` | **C-02**: asset growth, not profit; snapshot rows have two writers with different definitions |
| F-37 | Snapshot A (Dashboard writer) | cash(`cash_available`) stored in `cash`; `total_current_assets` = F-09 | `dashboard.ts:339-346` | Written on every `GET /api/dashboard`, **UTC** date, overwrites that day's row |
| F-38 | Snapshot B (helper) | fabric + stock + accessories + receivables + (net cash − debts); **no cutting/WIP** | `snapshotHelper.ts:116-117` | Used by `POST /snapshots/take` and live end value |
| F-39 | Reports — الملخص / صافي الربح "كل الوقت" | `computeFinancialSummary` over the whole season (period filter **not** applied) | `reports.ts:117,224-231,252-255` | UI labels it "كل الوقت" (`Reports.tsx:267`) but sits beside period-filtered sections |
| F-40 | Reports — تطور رأس المال | `net_assets = (stock+fabric+accessories+receivables+cash) − debts` at two dates, dated by order *creation* | `reports.ts:33-104,219-222` | A third asset definition; includes capital injections as "growth" |
| F-41 | Reports — تقرير التدفق النقدي | deposits + collections dated by **order creation date**, expenses/payments by their own date | `reports.ts:291-380` (route is named `employee-movements`) | **H-11** |
| F-42 | Reports — top clients / marketers / models | Σ over orders in the period, **all statuses** | `reports.ts:119-140,197-204` | Cancelled and reserved orders rank customers/models |
| F-43 | المساعد الذكي — "إجمالي الأصول الحالية" | fabric + stock + accessories + net cash (**no receivables**) | `aiAssistant.ts:329` | A fourth definition; reads global payroll/fixed assets (`:148-151`) |

### 3.5 Operational pages (client-side or simple sums)

| ID | UI label | Formula | Source | Notes |
|---|---|---|---|---|
| F-44 | المبيعات — شريط الإجماليات | invoices, deposits, `remaining` (all statuses), `shippingReceived` (status تم الصرف only), `shippingGap` | `Sales.tsx:395-399` | Filtered rows only; `shippingReceived` ignores held collections of cancelled orders (differs from F-04) |
| F-45 | المبيعات — المتبقي لكل أوردر | `remaining = invoice_value − deposit_paid` (stored; recomputed on edit when either changes) | `sales.ts` PUT (`remaining` set from `inv − dep`) | Legacy rows can be stale (Appendix A check) |
| F-46 | المصاريف والإيرادات — الإجماليات | Σ `amount_in`, Σ `amount_out` of listed rows | `Expenses.tsx:72-73` | Operation types are a free list: `راس مالى, مصروف تشغيل, ايراد مبيعات, استلاف, سداد` (+ `صدقة` auto) |
| F-47 | الديون — إجمالي المتبقي | Σ `remaining` | `Debts.tsx:136` | — |
| F-48 | حساب عميل — الإجماليات | Σ invoices, Σ payments, Σ remaining | `ClientAccounts.tsx:35-36,215` | — |
| F-49 | مخزن القماش — مشتريات | Σ `quantity_kg`, Σ `total_cost` | `FabricWarehouse.tsx:317-319` | Purchases do **not** create a cash entry |
| F-50 | القص — قيمة المتبقي | remaining pieces × `cost_per_meter` | `Cutting.tsx:106` | same as F-14 |
| F-51 | التصنيع — قيمة التشغيل | `qty_received × cost_per_piece` if in progress | `ModelProduction.tsx:332` | same as F-15 |
| F-52 | الاستوك — قيمة المخزون (الفعلي) | max(0, actual) × `cost_per_piece` (client-side) | `ReadyStock.tsx` (value column) | Uses the stock page's own `actual_balance` |
| F-53 | الأصول الثابتة — القيمة الدفترية | straight-line: `price − min(price/life × years, price)` | `FixedAssets.tsx:21-35,136` | Not used by any backend total |
| F-54 | الرواتب — صافي المرتب | `base_salary + overtime + bonuses − advances − deductions` | `payrollCalc.ts` (`calcEmployeePayroll`); `Payroll.tsx:843,913` | Not a cash/expense entry (**H-09**) |

---

## 4. Cash and bank balance audit

### 4.1 The exact formula for "actual cash"

There is **no cash/bank account entity, no opening balance and no bank reconciliation** in the schema. "Cash" is a *derived* number, computed per season in four places that must agree:
`financialMetrics.ts:128-143` (Dashboard + breakdowns), `financialCenter.ts:27-53`, `snapshotHelper.ts:34-50`, `aiAssistant.ts:155-181` (and `reports.ts` through `computeFinancialSummary`).

```
cash_in  = Σ expenses_revenues.amount_in                       (every operation_type, incl. راس مالى, استلاف, ايراد مبيعات)
         + Σ sales.deposit_paid                                (EVERY order status, no ledger, no date of its own)
         + Σ sales.shipping_collected   where status ∈ {تم الصرف, تم الإلغاء}   (= Σ shipping_collections.amount per order)
         + Σ payment_logs.amount        where type = 'client_payment'
cash_out = Σ expenses_revenues.amount_out                      (incl. charity, and any purchase typed as an expense)
         + Σ payment_logs.amount        where type = 'debt_payment'
         + Σ return_items.refund_amount
cash     = cash_in − cash_out                                  ← shown as «الصافي» / «صافي الربح» / «الكاش الفعلي بالخزنة»
```
`الكاش المتاح` (Dashboard) additionally subtracts Σ `debts.remaining`. The Financial Center's field `cash_available` is the *un-netted* figure above.

### 4.2 Event-by-event matrix — does each event change cash, exactly once?

| # | Event | Recorded where | Affects cash? | Exactly once? | Evidence · remark |
|---|---|---|---|---|---|
| 1 | Initial capital / partner contribution | `expenses_revenues` row, type `راس مالى`, `amount_in` | ✅ in | ✅ (manual) | `Expenses.tsx:11`; **also counted as profit** (C-01). There is no opening-balance concept, so opening cash must be typed as "capital" |
| 2 | Loan received / borrowing | `expenses_revenues` `استلاف` `amount_in` | ✅ in | ✅ (manual) | Creating a **debt** record does *not* add cash (`entities.ts:592-604`); the two must be entered separately → duplicate/omission risk (H-14); counted as profit (C-01) |
| 3 | Customer deposit on an order | `sales.deposit_paid` | ✅ in (all statuses) | ✅ but **untracked** | `financialMetrics.ts:130`. A plain editable field: editing it moves cash with no ledger row, no date, no history (H-16); cancelled/reserved deposits stay in cash by design |
| 4 | Shipping-company collection | `shipping_collections` ledger → `sales.shipping_collected` | ✅ in | ✅ idempotent | `orderLedgers.ts:40-62`, `shippingCollections.ts:44`. Re-saving appends nothing; corrections append a delta row. Test: `accounting.test.ts` E/F |
| 5 | Client-account payment | `POST /client-accounts/:id/payments` → `payment_logs(client_payment)` | ✅ in | ✅ | `entities.ts:790-816` |
| 6 | Client account created/edited with an **initial or increased "paid"** amount | `client_accounts.amount_paid` only | ❌ **no cash row** | n/a | `entities.ts:743-745`, `759-766`: `remaining` is recalculated, **no payment_log is created** (only *decreases* purge logs) → account shows money collected that never reaches cash (**C-04**) |
| 7 | Debt created/edited with an **initial or increased "paid"** amount | `debts.amount_paid` only | ❌ **no cash row** | n/a | `entities.ts:596-603`, `612-619` — same pattern: liability falls, cash does not (**C-04**) |
| 8 | Debt repayment | `POST /debts/:id/payments` → `payment_logs(debt_payment)` | ✅ out | ✅ | `entities.ts:644-670` |
| 9 | Manual expense / supplier payment | `expenses_revenues.amount_out` | ✅ out | ✅ (manual) | `entities.ts:49-57`; no validation of sign/amount (M-03) |
| 10 | **Fabric purchase** | `fabric_purchases` + warehouse row (qty, WAC) | ❌ **none** (and no payable) | n/a | `entities.ts:1088-1158` creates inventory value with no counter-entry (H-08) |
| 11 | **Print/embroidery job** | `print_orders`, destination stock card at `final_unit_cost` | ❌ **none** | n/a | `entities.ts:1443-1444,1462`: print cost is added to inventory value with no expense/cash/payable (H-08) |
| 12 | **Payroll / salary advances** | `payroll`, `salary_adjustments` | ❌ **none** | n/a | `payroll.ts` writes only payroll tables; nothing reaches `expenses_revenues` or `payment_logs` (H-09) |
| 13 | **Fixed-asset purchase** | `fixed_assets.purchase_price` | ❌ **none** | n/a | `entities.ts:1343-1350` (H-10) |
| 14 | Charity payment | `charity_payments` + linked expense row (one transaction) | ✅ out | ✅ | `routes/charity.ts:176-190`; unique idempotency key; reversal deletes both |
| 15 | Refund / returned order | `return_items.refund_amount` | ✅ out | ✅ | `financialMetrics.ts:136`; refunds for cancelled orders use the same table (`sales.ts:467-525`) |
| 16 | Customer-deposit refund for a **cancelled** order | return row (qty 0) via `POST /sales/:id/refunds` | ✅ out | ✅ idempotent | cancelling itself does **not** move cash |
| 17 | Shipping-company repayment after cancellation | negative `shipping_collections` row | ✅ out | ✅ idempotent | `sales.ts:467-525` |
| 18 | Manual cash adjustment | `POST /payment-log` (arbitrary `type`, `amount`) or an expense row | ✅ | ✅ but unlinked | `entities.ts:972-980`; no check against an account (M-14) |
| 19 | **Deleting** an order | `DELETE /sales/:id` | ✅ silently reverses deposit **and** collections | n/a | `sales.ts:535-553`; collection/cost/cancellation ledgers are `ON DELETE CASCADE` (schema 654, 678, 704) → money trail gone except the audit-log JSON (**C-05**) |
| 20 | Deleting an expense / return / payment log / debt / client account | CRUD deletes | ✅ silently reverses | n/a | `entities.ts:75-91`, `625-641`, `772-787` (debt/account deletes also delete their payment logs) (M-10) |
| 21 | Currency/bank transfer between accounts | — | not supported | — | No account dimension exists; transfers cannot be represented (M-09) |

### 4.3 Does the displayed cash equal the sum of actual cash transactions plus opening balances?

- **By construction** the displayed number equals the sum of the *recorded* flows above. [CODE]
- It **cannot be proven equal to real cash** because (a) there is no opening-balance or bank/cash-count record to compare with, (b) events 6, 7, 10–13 never produce a cash row, and (c) events 3, 19, 20 can change cash with no ledger trail.
- The unexplained difference between displayed cash and the real safe/bank **cannot be computed without the real database and a physical cash count**. Appendix A (query A1–A4) gives the exact components to compare. **Status: not verified [DB].**

### 4.4 Invoices vs cash (checked)

Invoice value, receivables and expected collections never enter cash (`financialMetrics.ts:128-143` reads only `deposit_paid` and recorded collections). Confirmed by tests (`accounting.test.ts` B+C, D, I; `dashboard.test.ts` "invoices never become cash") [TEST]. The only things that reach cash are deposits, ledger collections, client-account payment logs, expense rows, debt-payment logs and refunds.

---

## 5. Orders and every status transition

### 5.1 Behaviour per status (stored value in parentheses)

| Status | Stock | Reservation | Cost ledger | Collections | Cash | Receivable | Revenue |
|---|---|---|---|---|---|---|---|
| **يتم التجهيز** (`تم الحجز`) | physical unchanged | FIFO allocation of *existing* stock; shortage tracked as pending (`readyStockPositions.ts:146-230`) | none | none | deposit counts (all statuses) | none | not recognised |
| **لم يتم الصرف** | leaves sellable stock (derived: `leavesStock`) | released | `SHIP` rows at the card's `cost_per_piece` (`orderLedgers.ts:63-86`, idempotent diff) | `shipping_collected` forced to 0 (`sales.ts:103-124`) | no increase | `max(0, remaining)` | recognised |
| **تم الصرف** | still out; **no second deduction** | — | no new rows | entered amount ≤ remaining, ledger delta only | + actual amount | gap `max(0, remaining − collected)` | recognised |
| **حساب عميل** | leaves stock, `SHIP` rows | — | yes | 0 | none | **none automatic** — only via a manual client-account invoice (**M-15**) | recognised |
| **تم الإلغاء** before shipment | unchanged | released | none | none | deposit stays in cash (liability metric F-22) | none | none |
| **تم الإلغاء** after shipment | restored **only** if disposition = `returned_resalable`; otherwise stays out of sellable stock (`holdsGoodsOutside`) | released | `SHIP_REVERSAL` at the original recorded cost (`inventoryMovements.ts:57-98`) | **kept** (no reversal row); becomes "owed back" until a repayment row | held money stays cash | gone (status) | reversed (status) |

### 5.2 Can repeated saves / status flips duplicate movements?

**No for the ledgers, yes for two unguarded paths.** [CODE][TEST]

- Collections and cost movements are written as *differences* between ledger and the order's current state (`planCollectionChange`, `planMovements`), under a per-season advisory lock and a re-read of the order inside the transaction (`sales.ts:338-347`). Repeating a save, a payout, or a cancellation appends nothing. Tests: `accounting.test.ts` E/F/F2–F4, `cancellation.test.ts` #7, integration scripts (46 + 55 checks on a scratch Postgres in earlier work).
- **Not guarded:** deleting an order (C-05), and editing `deposit_paid` (H-16) — both move cash without a ledger row.
- **Cancelled → reopened** creates *new* `SHIP` rows at **today's** card cost even if the goods never left (L-05).
- `convert-reservation` and `cancel-reservation` endpoints repeat the same checks (`sales.ts:563-640`).

### 5.3 Transition weaknesses worth knowing

1. `PUT /sales/:id` spreads the request body into the update (`sales.ts:361`); numeric fields such as `invoice_value`/`deposit_paid` are not range-checked (M-03).
2. An order can be **created directly** in `تم الصرف` (counter sale): allowed, goes through the same collection and stock validation (`sales.ts:180-258`).
3. There is no **status history table**; the audit log holds before/after JSON (`auditHelper.ts`), which is the only record of *when* a status changed.
4. A short payment from the shipping company stays a receivable forever; the system has no way to record *why* (fee, commission, deduction, return) — H-15.

---

## 6. Inventory and valuation audit

### 6.1 How each stock layer is derived

| Layer | Quantity | Unit cost | Value | Consumption |
|---|---|---|---|---|
| Fabric (kg) | `fabric_warehouse.qty_in` per row; **no out-quantity field** | `avg_cost_per_kg` (WAC, maintained on purchases `entities.ts:1131-1146`) else `cost_per_kg` | `max(0, qty_in − Σ cutting.kg_consumed (fuzzy key)) × cost` per **row** | `cutting_orders.kg_consumed` (typed by hand) |
| Accessories | `qty_in − qty_consumed` per row | row `cost` (manual) | qty × cost | `qty_consumed` typed by hand — not linked to production |
| Cut pieces (cutting WIP) | `total_pieces − Σ qty_from_cutting of models that use that cut+colour` | **`cost_per_meter`** (manual) | pieces × cost_per_meter | model production |
| Work in progress | `model_productions.qty_received` where status `قيد التشغيل` | `cost_per_piece` (manual) | qty × cost | status change to `تام` |
| Ready stock | `opening_balance + Σ qty_received(all statuses) − shipped + returned` | `ready_stock.cost_per_piece` (manual; set when the card is created, **never updated by later batches**) | physical × cost | order status (derived, no stock-out table) |
| Reserved / available | allocation of physical stock to prepared orders (FIFO by order id) | — | reserved value ≤ physical value | `reserved_quantity` column is a **cache** refreshed by `reservationSync.ts` |
| Shipped goods | `inventory_movements` SHIP rows | card cost at the moment of shipping | `total_cost` | reversal rows |
| Returned goods | `return_items.model_qty` | not recorded | restored at the card's *current* cost | — |
| Damaged / missing | only for cancelled shipped orders (`cancel_disposition`) | historical cost in `order_cancellations.goods_cost` | **not** in assets | — |

### 6.2 Relationships checked

| Rule | Result | Evidence |
|---|---|---|
| Physical = available + reserved | ✅ holds by construction (`valueStockRow`, allocation caps reservation at physical) | `readyStockPositions.ts:74-90,146-230`; tests `allocation.test.ts` [TEST] |
| Reservation does not reduce physical value | ✅ on the Dashboard / snapshots / reports | `dashboard.ts:149-171`. ❌ **Financial Center** subtracts reserved sales (**C-03**, E1: 49,800 vs 60,000) |
| Shipment removes value once | ✅ derived from status; SHIP rows idempotent | `orderLedgers.ts`, tests |
| No stock counted twice across layers | ❌ WIP vs ready stock (**H-02**, E3), duplicate stock cards (**C-06**, E7b), fabric rows (**H-01**, E2) | below |
| Negative stock | Clamped to 0 in Dashboard/FC/snapshots (`Math.max(0, …)`), **not** clamped in Reports (`reports.ts:167`) → the same shortage appears as 0 in one place and negative in another (M-02) | |

### 6.3 Specific inventory issues

- **C-06 Duplicate stock cards.** `ReadyStock` has no uniqueness on (season, model, colour) (`schema.prisma:198-211`; `POST /ready-stock` creates unconditionally, `entities.ts:113`). Every valuation loop applies the *key-level* production, sales and returns to **each** card (`dashboard.ts:149-171`, `financialCenter.ts:96-101`, `snapshotHelper.ts:105-111`, `reports.ts:59-65`). With cards A (opening 50) and B (opening 0), production 20 and 10 shipped, the true physical is 60 but both pages show 70 pieces (E7b: 42,000 vs 36,000). The newer allocation code (`computeStockPositions`) treats only the first card as primary, so the *quantities shown in the stock page* and the *valuation on the Dashboard* can disagree.
- **H-01 Fabric.** One shared consumption number is subtracted from **every** warehouse row of the same material+colour (`dashboard.ts:63-74`, same in `financialCenter.ts:62-66`, `snapshotHelper.ts:67-73`, `reports.ts:73-78`). Purchases merge into one row (`entities.ts:1110-1147`), but the direct "إضافة وارد" route always creates a new row (`entities.ts:166-174`) → two rows, double subtraction. E2: true 8,500 vs shown 7,000.
- **H-02 WIP overlap.** `newProd` sums `qty_received` of **all** statuses into ready stock (`dashboard.ts:116-121`), and WIP value counts `qty_received` of in-progress models again (`:103-114`). The code comment ("no double counting") holds only if `qty_received` stays 0 until a model is completed — a business rule that is not enforced (E3: 2,000 vs 1,000). *Decision needed (§17).*
- **H-03 Cutting.** Value = remaining *pieces* × field named *cost per metre* (`dashboard.ts:93`; UI label `Cutting.tsx:150` "تكلفة المتر"). Either the field really means "cost per cut piece" (then the label is wrong) or the value is mis-scaled. Not derivable from data.
- **H-05 Card cost.** `ensureReadyStockRow` only *creates* a card, using the first production's cost, or **0** when blank (`entities.ts:429-452`); later batches at other costs do not change the card (no weighted average). Shipments snapshot whatever the card says; a zero-cost card produces `SHIP` rows with `unit_cost = 0`, which the Dashboard counts as **costed** (`dashboard.ts:233-235`).
- **H-08 Print jobs** add `blank_unit_cost + print_cost_per_piece` to the new card (`entities.ts:1444,1462`) but create no expense, cash or payable → inventory value is created with no counter-entry.
- **Fuzzy matching (M-13).** Model/colour linking uses normalised + edit-distance matching (`utils/textMatch.ts`) everywhere (stock, cost, returns). It prevents spelling splits but can also merge distinct items; `receivablesAudit.ts` exists to surface mismatches but nothing blocks them.

### 6.4 Stock rows with inconsistent data — **not verifiable without the database**

Negative stock, cards with cost 0, `reserved_quantity` ≠ derived reservation, stock cards vs movement history: Appendix A queries A9–A13 find them. **Status: not verified [DB].** Note the stored `reserved_quantity` is a cache that is rewritten whenever stock inputs change; legacy rows may hold the *old* "reserve everything requested" value until the next write.

---

## 7. Real unit cost and profitability

### 7.1 What the system can and cannot reconstruct

| Cost element | Recorded? | Where | Allocated to units? |
|---|---|---|---|
| Fabric cost | purchases (kg × price, WAC) and cutting `kg_consumed` | `fabric_purchases`, `fabric_warehouse`, `cutting_orders` | ❌ no link from kg consumed to cost per piece; `cost_per_meter` is typed by hand |
| Accessories | quantity + unit cost; consumption typed by hand | `accessories_warehouse` | ❌ no link to a model |
| Cutting / sewing / finishing | **no cost field** other than hand-entered `cost_per_meter` / `cost_per_piece` | `cutting_orders`, `model_productions` | ❌ |
| Printing / embroidery | `print_cost_per_piece` | `print_orders` | ✅ added to the destination stock card's cost (but no cash entry — H-08) |
| Labour (wages) | monthly payroll | `payroll` (global, no season) | ❌ never allocated to units, never expensed (H-09) |
| Transport, rent, electricity, other overhead | only as free-text manual expense rows | `expenses_revenues` | ❌ no allocation key; they are period expenses by default |

**Conclusion:** the actual production cost per unit **is not computed by the system**. It is a single number typed into `model_productions.cost_per_piece` (and again into `ready_stock.cost_per_piece`), so "real unit cost" is only as good as that manual entry. Direct production costs and period expenses are not distinguished in the data model.

### 7.2 Per-model capability

| Metric | Computable? | How / why not |
|---|---|---|
| Production cost per unit | ⚠ as entered | `cost_per_piece` (manual) |
| COGS for shipped quantities | ✅ for orders shipped **after** the cost ledger existed | `inventory_movements` (card cost at shipping). Older shipped orders: **unknown** (H-06) |
| Revenue per model | ❌ | an order has up to 5 model lines but a single `invoice_value`; no per-line price (**H-07**) |
| Gross profit / margin | ⚠ order level only | `gross_margin = Σ invoice of costed orders − COGS` (`dashboard.ts:241,381`); invoice may include non-product amounts (shipping) |
| Operating expenses | ⚠ | manual `expenses_revenues` rows; not separated from capital/loans/debt repayment (F-02) |
| Net profit (accounting) | ❌ | no such figure exists — the displayed "net profit" is cash flow (C-01) |

### 7.3 Current vs original cost

- Shipped cost uses the card's cost **at shipping time** (snapshot) ✅, and cancellation reversals use the **recorded** cost, not today's ✅ (test `cancellation.test.ts` #3 [TEST]).
- Stock **valuation** uses the card's *current* cost for all remaining units; there are no cost layers/FIFO costing, so editing a card's cost revalues all remaining units (including already-reserved ones).
- Returned goods come back at the card's current cost, not the cost at which they shipped (F-18 credits the returned units at the *shipped* cost only for COGS).
- Historical orders without cost: **cannot be quantified without the database** (`uncosted_shipped_orders` on the Dashboard, `receivablesAudit` `uncosted_orders`, Appendix A query A8). No costs were invented.

---

## 8. Current assets and liabilities

### 8.1 Five definitions of "current assets" are live at the same time

| Component | Dashboard (F-09) | Financial Center (F-30) | Snapshot writer B (F-38) | Reports "تطور رأس المال" (F-40) | AI assistant (F-43) |
|---|:--:|:--:|:--:|:--:|:--:|
| Cash | ✅ gross (`net`) | ✅ gross | ✅ **net of debts** | ✅ gross, then − debts | ✅ gross |
| Fabric | ✅ WAC | ✅ **cost_per_kg** | ✅ WAC | ✅ WAC | ✅ |
| Ready stock | ✅ physical | ❌ **minus reserved & cancelled** | ✅ physical | ✅ physical | ✅ |
| Accessories | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cutting pieces | ✅ | ❌ | ❌ | ❌ | ❌ |
| WIP | ✅ | ❌ | ❌ | ❌ | ❌ |
| Receivables | ✅ | ✅ | ✅ | ✅ | ❌ |
| Fixed assets | ❌ | ✅ (all seasons, at cost) | ❌ | ❌ | listed separately |
| Debts | shown separately | subtracted → net position | **netted inside cash** | subtracted → net assets | shown separately |

The pages are **not** silently combined here; they are reported as-is. Which definition is "the" current-assets figure is a **business decision (§17)**. Snapshot rows mix definitions A and B (C-02).

### 8.2 Assets — reconciliation logic checked

- Cash vs receivable: a deposit is cash; only the unpaid balance is a receivable; a collection moves value from receivable to cash and leaves the total unchanged — verified by test `dashboard.test.ts` "receivables stay out of cash until collected" [TEST].
- Inventory vs shipped-goods receivable: shipped goods leave stock and a receivable appears; the receivable is **not** reduced by the goods' cost (correct) [TEST].
- Unprepared/unfulfilled orders: not inventory, not receivable; shown only as `pending_orders` / `missing_stock` [TEST].
- Valid receivables from the shipping company: derived from status + `remaining` + ledger collections; short payments remain open indefinitely (H-15).

### 8.3 Liabilities — what the system actually knows

| Liability | Recorded? | In a total? |
|---|---|---|
| Debts | `debts.remaining` | ✅ Financial Center net position, Reports, snapshot cash |
| Customer deposits on unfulfilled orders | `sales.deposit_paid` (status `تم الحجز`) | ❌ metric only (F-21) |
| Refund obligations of cancelled orders | derived (F-22, F-23) | ❌ metric only (M-11) |
| Supplier payables | **no record** (purchases create no payable) | ❌ (H-08) |
| Payroll payable / advances | `payroll`, `salary_adjustments` (global) | ❌ (H-09) |
| Taxes, loans (as liabilities) | loans only as manual `استلاف` cash-in rows | ❌ |

---

## 9. Sales, revenue, expenses and net profit — exact meaning today

| Term (UI) | Meaning in the application | Includes wrongly? |
|---|---|---|
| إجمالي المبيعات | Σ invoice of **all** orders (F-01) | reserved and cancelled invoices (E6: 10,000 shown, 2,000 shipped) |
| Recognised sales (new card) | Σ invoice of orders whose goods left the factory (F-17) | whole-invoice incl. any shipping amount |
| Total revenue received | = `total_in` (F-04), labelled "إجمالي الوارد"/"total_revenues" in Reports (`reports.ts:252`) | capital, loans, manual `ايراد مبيعات`, deposits on cancelled/reserved orders |
| إجمالي المصاريف | `total_out` (F-02) | debt repayments, refunds, charity |
| Gross profit | order-level margin of costed shipments (F-19) | pre-ledger shipments are absent |
| Net profit (صافي الربح / الصافي) | `total_in − total_out` (F-03) — **cash flow** | capital, loans, advances; excludes COGS/payroll/depreciation → **critical** |
| "الربح حسب الفترة" | `assets_end − assets_start` (F-36) | any asset growth incl. capital injections and revaluation → **critical** |
| Outstanding debts | Σ `debts.remaining` | — |
| Amount owed by the shipping company | F-20 | — |
| Total reservations | Σ invoice of prepared orders (F-08) | operational, not revenue |
| Customer deposits | Σ `deposit_paid`, all statuses, inside cash; liability metrics F-21/F-22 | not recorded as a liability line |

Effects on profit of items you asked about [SYN]:

| Item | Changes "net profit"? | Evidence |
|---|---|---|
| Capital contribution | **Yes, +** | E5: +200,000 |
| Loan received (`استلاف`) | **Yes, +** | E5: +50,000 |
| Debt repayment | **Yes, −** (as an "expense") | F-02 |
| Transfer between accounts | not representable | M-09 |
| Cancelled order's deposit | **Yes, +** until refunded | by design; refund is a negative entry |
| Unpaid / reserved orders | no (only via deposits) | F-04 |
| Charity payment | **Yes, −** | real expense row |

**Cash flow vs accounting profit:** the application has *no* accounting-profit figure; cash flow is displayed under profit names. Flagged **Critical (C-01, C-02)**.

---

## 10. Shipping collections and monthly charity

| Check | Result | Evidence |
|---|---|---|
| Partial collections recorded as separate rows | ✅ | `orderLedgers.ts:40-62`, `shippingCollections.ts:44-85` |
| Re-saving an unchanged order adds nothing | ✅ | `accounting.test.ts` E; integration "re-saving a paid-out order adds no collection" |
| Corrections append deltas; history preserved | ✅ (negative rows allocated to the newest dates) | `shippingCollections.ts:70-85`; test F |
| Reversals keep the audit trail | ✅ for status changes; ❌ if the **order is deleted** (cascade) | C-05 |
| Collection date decides the reporting month | ✅ for charity (ledger `collected_date`); ❌ for Reports/period summaries, which use the order's creation date | `shippingCollections.ts:87-116` vs `financialMetrics.ts:46,52-57`, `reports.ts:322` (H-11) |
| Historical/estimated dates identified | ✅ `date_estimated` + card note; legacy rows use the creation day | migration `20261016…`; `CharitySection.tsx` |
| Thresholds | ✅ <200,000: 1% · <400,000: 1.5% · ≤800,000: 2% · >800,000: 3% | `services/charity.ts:44-50`; tests |
| Charity payment creates a linked expense, reduces cash only when paid, not counted twice | ✅ | `routes/charity.ts:160-190`; linked expenses cannot be edited/deleted directly (`entities.ts:64-68,81-85`) |
| Ambiguities | the base includes collections held for **cancelled** orders; repayments reduce only the same-month net of that order | M-06 |

---

## 11. Season isolation

| Area | Isolated by season? | Notes |
|---|---|---|
| Sales, collections, movements, cancellations, expenses, payment logs, returns, debts, client accounts, stock, fabric, purchases, accessories, cutting, production, print orders, snapshots, charity | ✅ `season_id` on every row and in every query | verified by reading each `findMany`; tests `accounting.test.ts` J, `dashboard.test.ts` season tests, integration #10 [TEST] |
| Fixed assets / `assets` | ❌ global | Financial Center and AI add **all-season** fixed assets to the selected season (`financialCenter.ts:24`, `aiAssistant.ts:151`) |
| Employees, attendance, adjustments, payroll | ❌ global | payroll cost cannot be assigned to a season (H-09) |
| Marketers, users, roles, audit log | intentionally global | — |
| Seasons start empty | — | `seasons.ts:48-62`; no opening balances for cash, receivables, debts or stock are carried over (H-12) |
| Silent fallback | `getSeasonId` falls back to the **active** season when the header is invalid (`seasonContext.ts:22-31`) → a stale client could read/write the wrong season (M-04) |
| Snapshots | per-season/day, but written by two definitions (C-02) |

---

## 12. Data integrity, historical records and missing costs

| Risk | Why it matters | How to quantify (Appendix A) | Status |
|---|---|---|---|
| Orders shipped **before** the cost ledger | `inventory_movements` has no rows for them → COGS and gross margin exclude them; dashboard shows `uncosted_shipped_orders` | A6, A8 | not verified [DB] |
| Stock cards with `cost_per_piece = 0` and `SHIP` rows with `unit_cost = 0` | inventory/COGS silently understated; counted as "costed" | A10 | not verified [DB] |
| Paid-out orders whose receipt date was never recorded | backfilled to the creation day and flagged `date_estimated`; affects monthly charity and period reports | A20 | not verified [DB] |
| Old paid-out orders whose `shipping_collected` was set to `remaining` by an earlier migration | assumes full payment; a short payment may be hidden | A15 (+ confirm with bank statements) | not verified [DB] |
| Debts / client accounts with `amount_paid` > Σ payments | the "paid" part never reached cash (C-04) | A14 | not verified [DB] |
| Cancelled orders created before the disposition field | `cancel_disposition IS NULL` → keep the old behaviour (stock restored) | A19 | not verified [DB] |
| Stale `sales.remaining` / `reserved_quantity` | totals drift from components | A12, A15 | not verified [DB] |
| Duplicate stock cards / fabric rows | double application (C-06, H-01) | A9, A13 | not verified [DB] |
| Client invoices duplicating shipped orders | double receivable (M-01) | A16 | not verified [DB] |
| Payroll history deleted with an employee | `ON DELETE CASCADE` on attendance/adjustments/payroll (schema 503, 522, 537) | — | [CODE] |
| Orders / payments hard-deleted | cash and cost history lost except audit JSON (C-05, M-10) | audit_logs where `action='DELETE'` | not verified [DB] |
| Snapshot history mixes definitions | profit-by-period is unreliable for any past window (C-02) | A17 | not verified [DB] |

**No cost was invented anywhere in this audit.** Unknown costs are reported as unknown; their financial effect cannot be sized until A6/A8/A10 are run.

---

## 13. Reconciliation

### 13.1 Dashboard vs independently recalculated values (current season = primary scope)

The independent recalculation requires the real database, which was inaccessible (§1.2). The queries that produce the "recalculated" column are in **Appendix A**; the "Dashboard value" column must be read from the live page for the same season.

| Metric | Dashboard value | Independently recalculated value | Difference | Status |
|---|---:|---:|---:|---|
| Actual cash (`الكاش الفعلي بالخزنة`) | n/a | n/a (A1) | n/a | **Not verified — database inaccessible** |
| Physical inventory value | n/a | n/a (A11, exact-match approximation) | n/a | **Not verified — database inaccessible** |
| Shipping receivables | n/a | n/a (A3) | n/a | **Not verified — database inaccessible** |
| Customer deposit liabilities | n/a | n/a (A4) | n/a | **Not verified — database inaccessible** |
| Recognised sales | n/a | n/a (A5) | n/a | **Not verified — database inaccessible** |
| Cost of goods sold | n/a | n/a (A6) | n/a | **Not verified — database inaccessible** |
| Total expenses (`total_out`) | n/a | n/a (A1) | n/a | **Not verified — database inaccessible** |
| Gross profit | n/a | n/a (A5 − A6) | n/a | **Not verified — database inaccessible** |
| Net profit (`total_in − total_out`) | n/a | n/a (A1, A7) | n/a | **Not verified — database inaccessible** |
| Current assets | n/a | n/a (A1 + A11 + A3 + fabric/accessories/cutting/WIP) | n/a | **Not verified — database inaccessible** |

*Internal consistency that **was** verified:* on every Dashboard request the code itself checks that each component equals its detail rows and that the total equals the component sum (`assets_reconciliation`, `dashboard.ts:321-337`) and the project's tests assert it [TEST]. This proves the Dashboard is *self-consistent*, **not** that it matches reality.

### 13.2 Synthetic-data experiments [SYN] — real code, invented rows

These show the *size and direction* of each defect on a controlled dataset. They are **not** your business numbers. Script kept outside the repository (scratch directory); the real route handlers (`dashboard.ts`, `financialCenter.ts`, `snapshotHelper.ts`) ran on in-memory rows.

| ID | Scenario (synthetic) | Expected | Dashboard | Financial Center | Finding |
|---|---|---:|---:|---:|---|
| E1 | 100 pcs @600; 10 pcs reserved; a 7-pcs reservation later cancelled | 60,000 | 60,000 | **49,800** (−10,200) | C-03 |
| E2 | 2 warehouse rows × 100 kg @50 of the same fabric; 30 kg consumed | 8,500 | **7,000** (−1,500) | (same pattern) | H-01 |
| E3 | 10 pcs in production (`قيد التشغيل`, `qty_received=10`, cost 100) with a stock card | 1,000 | stock **1,000** + WIP **1,000** = 2,000 | — | H-02 |
| E4 | One dataset with cutting 2,400, WIP 3,000, debts 3,000 | — | assets **36,400** | snapshot helper **28,000** (−8,400 = 2,400 + 3,000 + 3,000) | C-02 |
| E5 | Capital 200,000 + loan 50,000, **no trading** | profit 0 | net profit **250,000** | — | C-01 |
| E6 | Orders: cancelled 5,000 (deposit 1,000), reserved 3,000, shipped 2,000 | recognised 2,000 | total sales **10,000**; cash **1,000** from the cancelled deposit | — | H-13 |
| E7 | Duplicate empty card for the same model+colour | 30,000 | 30,000 | 30,000 | (no effect while the duplicate has no production/sales) |
| E7b | Duplicate cards + production 20 + 10 shipped (true physical 60) | 36,000 | **42,000** (+6,000) | **42,000** | C-06 |

---

## 14. Findings, prioritised

Severity: **Critical** — cash, stock or profit can be materially wrong or duplicated · **High** — incorrect balances, missing costs or incorrect transitions · **Medium** — inconsistent reporting, missing reconciliation, weak validation · **Low** — labelling/usability/documentation.
"Evidence" is `file:line` as of 2026-10-17 [CODE] unless a synthetic experiment is cited.

### 14.1 Critical (6)

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| **C-01** | **"Net profit" is a cash-flow total.** `net = total_in − total_out` includes capital (`راس مالى`), loans (`استلاف`), manual `ايراد مبيعات`, deposits on reserved/cancelled orders; excludes COGS, payroll, depreciation. Displayed as `الصافي`, `صافي الربح`, Reports "net profit", AI. | `financialMetrics.ts:128-143`; `dashboard.ts:37-38,351`; `Dashboard.tsx:185,278`; `reports.ts:228,254`; E5 | Owners see "profit" that is not earnings; decisions on distributions, tax or pricing can be wrong |
| **C-02** | **"الربح حسب الفترة" = asset growth, from snapshots with two writers.** `profit = end − start` of `total_current_assets`; rows are written by the Dashboard (definition A, includes cutting+WIP, gross cash) *and* by `computeSnapshot` (definition B, cash net of debts, no cutting/WIP); the last writer of the day wins; missing start snapshot ⇒ start 0. Capital injections count as profit. | `snapshots.ts:56-89`; `dashboard.ts:339-346`; `snapshotHelper.ts:116-117`; `ProfitByPeriod.tsx:344`; E4 | Any window straddling a change of writer shows phantom profit/loss (8,400 in E4) |
| **C-03** | **Financial Center deducts every sale from stock** — reserved and cancelled included — contradicting the rule that reservations do not reduce inventory. | `financialCenter.ts:75-99` (no status filter); E1 | Stock and current assets understated whenever reservations/cancellations exist (−10,200 in E1) |
| **C-04** | **"Paid" amounts on debts and client accounts can be set/raised with no cash entry.** Only *decreases* purge payment logs. | `entities.ts:596-603,612-619` (debts); `743-745,759-766` (client accounts); `purgePaymentLogs` `:19-36` | Liability/receivable falls while cash does not move → cash and balances diverge silently |
| **C-05** | **Deleting an order hard-deletes its money trail.** `DELETE /sales/:id` removes the row (deposit and collected cash vanish from totals), cascades `shipping_collections`, `inventory_movements`, `order_cancellations` (FK `ON DELETE CASCADE`), and restores stock without any return. | `sales.ts:535-553`; `schema.prisma:654,678,704` | Cash, COGS and cancellation history can disappear with one click; only the audit-log JSON remains |
| **C-06** | **Duplicate stock cards double-apply production, sales and returns** in every valuation path; nothing prevents duplicates. | `dashboard.ts:149-171`; `financialCenter.ts:96-101`; `snapshotHelper.ts:105-111`; `reports.ts:59-65`; `entities.ts:113`; `schema.prisma:198-211`; E7b | Stock overstated (+6,000 in E7b) whenever two cards share model+colour |

### 14.2 High (16)

| ID | Finding | Evidence |
|---|---|---|
| **H-01** | Fabric value subtracts the full cutting consumption from **each** warehouse row of the same material+colour; the direct-entry route creates extra rows. | `dashboard.ts:63-74`; `entities.ts:166-174`; E2 |
| **H-02** | Work in progress can be counted twice: `qty_received` of in-progress models is in ready stock *and* in WIP value. | `dashboard.ts:103-121`; E3 |
| **H-03** | Cutting valuation multiplies **pieces × a field labelled "cost per metre"** — unit mismatch or mislabel. | `dashboard.ts:93`; `Cutting.tsx:150` |
| **H-04** | Five definitions of "current assets" (Dashboard / Financial Center / snapshot / Reports / AI) and two meanings of `cash_available`. | §8.1; `financialCenter.ts:104`; `snapshotHelper.ts:117`; `reports.ts:100`; `aiAssistant.ts:329` |
| **H-05** | Stock-card cost is manual and never updated by later batches (no weighted average); zero-cost cards produce zero-cost `SHIP` rows that are still counted as costed. | `entities.ts:429-452`; `dashboard.ts:233-235`; `inventoryMovements.ts:57-98` |
| **H-06** | Orders shipped before the cost ledger have no cost → COGS and gross margin cover only recent shipments (size unknown without DB). | `dashboard.ts:233-241,382` |
| **H-07** | No per-line selling price (one `invoice_value` for up to 5 models) → no revenue or gross profit per model. | `schema.prisma:127-174` |
| **H-08** | Fabric purchases, print jobs and fixed assets create assets/inventory value with **no cash, payable or expense** entry (print cost inflates inventory). | `entities.ts:1088-1158,1443-1462,1343-1350` |
| **H-09** | Payroll is global (no season), never reaches cash/expenses/profit/unit cost, and is deleted with the employee (cascade). | `schema.prisma:482-555`; `payroll.ts` |
| **H-10** | Fixed assets are global; the Financial Center adds all seasons at **cost** while the page shows book value; depreciation is never an expense. | `financialCenter.ts:24,106`; `FixedAssets.tsx:21-35,136` |
| **H-11** | Period reports date deposits and shipping collections by the **order's creation date** instead of the receipt date. | `financialMetrics.ts:34-35,46,52-57`; `reports.ts:312,322` |
| **H-12** | Seasons start empty: no opening balances or carry-over of cash, receivables, debts or stock. | `seasons.ts:48-62`; §11 |
| **H-13** | Headline labels mislead: `إجمالي المبيعات` counts reserved and cancelled invoices; `إجمالي المصاريف` includes debt repayments, refunds and charity. | `dashboard.ts:31`; `financialMetrics.ts:137-141`; `Dashboard.tsx:183-184`; E6 |
| **H-14** | Manual expense types (`ايراد مبيعات`, `سداد`, `استلاف`, `راس مالى`) create parallel manual channels that can duplicate automatic flows. | `Expenses.tsx:11`; `entities.ts:49-57` |
| **H-15** | A short payment from the shipping company has no classification path (fee / commission / deduction / return); the gap stays a receivable forever. | `dashboard.ts:41-43`; no adjustment endpoint exists |
| **H-16** | Deposits have no ledger: an editable field counted as cash for **every** status, with no receipt date or history. | `financialMetrics.ts:130`; `sales.ts:361` |

### 14.3 Medium (15)

| ID | Finding | Evidence |
|---|---|---|
| M-01 | Overlap between shipping receivables and client-account invoices is only *prevented for new entries* and *flagged* for existing ones; totals still double count until fixed manually. | `entities.ts:884-894`; `dashboard.ts:287-302` |
| M-02 | Reports leave stock unclamped (negative) while other pages clamp at 0. | `reports.ts:167` vs `dashboard.ts:154` |
| M-03 | No numeric/field validation on monetary create/update (mass assignment of `req.body`; negative or odd amounts accepted). | `entities.ts:52,169,214,298,596,743,975`; `sales.ts:361` |
| M-04 | Invalid `X-Season-Id` silently falls back to the active season. | `seasonContext.ts:22-31` |
| M-05 | Payment-log cleanup matches rows by description prefix containing a name — name collisions remove the wrong log. | `entities.ts:19-36,618,765` |
| M-06 | Charity base includes collections held for cancelled orders; repayments reduce only the same-month net; estimated dates feed the base. | `shippingCollections.ts:87-116`; `charity.ts:62-81` |
| M-07 | The AI assistant computes its own financial figures with its own definitions and global payroll/fixed-asset data. | `aiAssistant.ts:148-151,329` |
| M-08 | `GET /api/dashboard` writes to the database (snapshot upsert) with a UTC date. | `dashboard.ts:339-346` |
| M-09 | No cash/bank account entity, opening balance, payment-method dimension or reconciliation to a cash count/bank statement; transfers unrepresentable. | schema |
| M-10 | Hard deletes of expenses, returns, payment logs, debts (with their logs) and client accounts erase cash movements. | `entities.ts:75-91,625-641,772-787,981-990` |
| M-11 | Customer-deposit and refund obligations are not part of any liabilities total or net position. | `financialCenter.ts:108`; `dashboard.ts:250-270` |
| M-12 | Reports mixes an all-time financial summary with period-filtered sections on one page. | `reports.ts:117,219-231`; `Reports.tsx:267` |
| M-13 | Fuzzy model/colour matching drives stock, cost and return attribution; mismatches are surfaced by an audit tool but never blocked. | `utils/textMatch.ts`; `receivablesAudit.ts:109-163` |
| M-14 | `POST /payment-log` can create cash movements of any type with no link to a debt/account. | `entities.ts:972-980` |
| M-15 | `حساب عميل` orders leave stock but create no receivable automatically (needs a manual client-account invoice). | `dashboard.ts:44-47`; `receivablesAudit.ts:25-29` |

### 14.4 Low (7)

| ID | Finding | Evidence |
|---|---|---|
| L-01 | Dead/legacy artefacts: `hatem_*`/`mido_*` columns, unused `assets` table, unused `computeCurrentAssets`. | `schema.prisma:187-190,457-465`; `financialMetrics.ts:74-81` |
| L-02 | Misleading Reports labels: revenues called "إجمالي الوارد", net profit called "صافي الشركاء". | `Reports.tsx:324-331` |
| L-03 | Stale comment says the Dashboard total excludes cash. | `dashboard.ts:303-304` |
| L-04 | Same field name `cash_available`, two meanings (Dashboard nets debts; Financial Center does not). | `dashboard.ts:48` vs `financialCenter.ts:53` |
| L-05 | Re-opening a cancelled "not returned" order re-ships it at today's card cost. | `orderLedgers.ts:63-86` |
| L-06 | UTC vs Cairo dates: snapshot date and several default payment dates use `toISOString()`. | `dashboard.ts:339`; `snapshots.ts:14,55`; `entities.ts:654,800,896` |
| L-07 | `as any` used for `cost_per_piece` in the Dashboard (type bypass). | `dashboard.ts:107,111,112` |

**Totals: Critical 6 · High 16 · Medium 15 · Low 7 = 44.**

---

## 15. Recommended correction plan (for a separate, approved implementation phase)

Nothing below has been implemented. Items marked **(decision)** need an answer from §17 first. Every change should be additive/non-destructive, behind tests (§16), and verified on a staging copy of the production database before release.

### Critical — do first

| Step | Fix (safe approach) | Finding |
|---|---|---|
| 1 | Rename the figure honestly (`صافي التدفق النقدي`) **and** add a separate accounting profit: *recognised sales − COGS − operating expenses*, excluding capital, loans and debt repayments. Keep both visible until the owner picks the headline. **(decision)** | C-01 |
| 2 | Make exactly one snapshot writer (one shared function used by the Dashboard, `/snapshots/take` and the profit endpoint); stop writing from `GET /dashboard`; store a `definition_version`; compute period profit from ledgers (income − COGS − expenses) instead of asset growth, or label asset growth as "نمو الأصول". Never overwrite old rows — add new ones. **(decision)** | C-02, M-08 |
| 3 | Make the Financial Center use the shared stock service (`computeStockPositions`/`leavesStock`) and the same fabric cost rule; add a test that both pages return the same stock value for the same data. | C-03, H-04 |
| 4 | When `amount_paid` is created/increased on a debt or client account, create the matching `payment_logs` row (idempotently), or remove the editable "paid" field and force payments through the payment endpoints. Add a reconciliation report for existing rows (Appendix A14) and let the owner decide per row. **(decision for historical rows)** | C-04, M-05 |
| 5 | Replace hard delete of orders (and payments, expenses, returns) with "void" (status + reason + timestamp) that keeps ledgers; change FKs from `CASCADE` to `RESTRICT`; if hard delete must stay, block it when money or movements exist. | C-05, M-10 |
| 6 | Enforce uniqueness of (season, model, colour) on `ready_stock` (migration that first reports duplicates for manual merge — never auto-merge); make all valuation loops use the primary-card rule already in `computeStockPositions`. | C-06 |

### High

| Step | Fix | Finding |
|---|---|---|
| 7 | Fabric: aggregate warehouse rows per material+colour before subtracting consumption (or store consumption as a ledger); merge direct entries into the existing row. | H-01 |
| 8 | Decide the meaning of `qty_received` for in-progress models; either exclude in-progress quantities from ready stock or from WIP. **(decision)** | H-02 |
| 9 | Decide the unit of `cost_per_meter` (per metre vs per cut piece) and rename/convert accordingly. **(decision)** | H-03 |
| 10 | Publish one "current assets" definition and use it everywhere (Dashboard, Financial Center, snapshots, Reports, AI); keep differences as explicit, labelled lines. **(decision)** | H-04, M-07 |
| 11 | Cost integrity: recompute card cost as weighted average on every production receipt; reject/flag cost 0; treat zero-cost SHIP rows as *uncosted*; show the count and value gap. | H-05, H-06 |
| 12 | Add per-line selling price (additive column(s)) so margin per model is possible; leave history empty rather than guessing. | H-07 |
| 13 | Give purchases, print jobs, payroll payments and fixed-asset purchases an explicit payment record (cash out or payable) linked to the source document. | H-08, H-09, H-10 |
| 14 | Report cash by **receipt date** (use `shipping_collections.collected_date`; give deposits their own dated ledger). | H-11, H-16 |
| 15 | Define opening balances / carry-over for new seasons (cash, receivables, debts, stock). **(decision)** | H-12 |
| 16 | Re-label headline cards (`إجمالي الوارد/المنصرف`, `المبيعات المعترف بها`) and add the missing "recognised sales" next to total sales. | H-13 |
| 17 | Restrict/retire manual `ايراد مبيعات` and `سداد` expense types or warn when an automatic flow already exists. | H-14 |
| 18 | Add a "shipping settlement adjustment" record (reason: fee / commission / deduction / return) that moves a gap out of receivables into the right account — never auto-classified. **(decision)** | H-15 |

### Medium

| Step | Fix | Finding |
|---|---|---|
| 19 | Liabilities block (customer deposits, refund obligations, payroll payable, supplier payables) feeding the net position. | M-11, M-09 |
| 20 | Add a cash/bank account dimension with opening balance and a periodic reconciliation record. | M-09 |
| 21 | Validate every monetary payload (schema validation, sign checks, whitelist fields). | M-03 |
| 22 | Reject unknown season ids instead of falling back. | M-04 |
| 23 | Link payment logs to their debt/account by id (no description matching). | M-05, M-14 |
| 24 | Charity: exclude cancelled orders' held collections from the base, or net repayments by date. **(decision)** | M-06 |
| 25 | Clamp stock identically in Reports; unify Reports' period vs all-time sections. | M-02, M-12 |
| 26 | Make `حساب عميل` orders create a receivable automatically, or show them in an explicit "unbilled" line. **(decision)** | M-15 |
| 27 | Turn the overlap warning into a blocking check at save time for edits, and offer a guided fix for existing overlaps. | M-01 |

### Low

Remove dead artefacts (L-01), fix labels and stale comments (L-02, L-03, L-04), use Cairo dates consistently (L-06), remove `as any` (L-07), re-ship a reopened cancelled order at its original cost (L-05).

---

## 16. Proposed tests for every critical accounting rule

(Existing coverage is listed in §18; the items below are **new** tests to add with the fixes. They should run on the in-memory harness *and* against a staging PostgreSQL via the existing integration-script pattern.)

| Rule | Test |
|---|---|
| Cash flow ≠ profit | A capital inflow and a loan change cash but **not** accounting profit; a deposit on a reserved/cancelled order changes cash but not profit; COGS and payroll reduce profit (C-01) |
| Single snapshot definition | The Dashboard, `/snapshots/take` and the profit endpoint produce the same `total_current_assets` for the same data; calling them in any order never changes the stored value; period profit = ledger income − COGS − expenses (C-02) |
| Page parity | For random datasets (reserved, cancelled, shipped, duplicates) the Dashboard, Financial Center, Reports and snapshot report the same stock, fabric and cash (C-03, H-04) |
| Paid amounts need cash | Creating/raising `amount_paid` on a debt or client account creates exactly one payment log; lowering removes the matching one only; the cash total always equals Σ logs (C-04) |
| No destructive deletes | Deleting/voiding an order with a deposit, a collection or a cost row keeps cash, ledger and audit rows and is refused if hard delete would orphan them (C-05, M-10) |
| Stock-card uniqueness | Creating a second card for the same season+model+colour is rejected; valuation with legacy duplicates equals valuation of one merged card (C-06) |
| Fabric rows | Two rows of one material+colour with total consumption C yield `Σ qty − C`, not `Σ(qty − C)` (H-01) |
| WIP/stock exclusivity | A unit is valued either as WIP or as ready stock, never both (H-02) |
| Cost integrity | A zero-cost card cannot be shipped silently / is reported as uncosted; weighted-average cost after two batches of different cost (H-05, H-06) |
| Per-line price | Two models in one order produce revenue and margin per model that sum to the order (H-07) |
| Counter-entries | Each purchase / print job / payroll payment / fixed asset creates exactly one cash-out or payable record (H-08–H-10) |
| Receipt-date reporting | A collection recorded in March for an April order appears in March's cash-flow report (H-11) |
| Season carry-over | Opening balances appear once in the new season and never in the old one (H-12) |
| Settlement adjustments | A short payment with a stated reason removes the gap from receivables and posts to the stated account exactly once, idempotently (H-15) |
| Deposit ledger | Editing a deposit appends a dated adjustment row; cash equals Σ ledger (H-16) |

---

## 17. Business decisions that require your approval

1. **What is "profit"?** Cash flow, accounting profit (sales − COGS − expenses), or growth in net assets? Which one is the headline, and should capital/loans be excluded from every profit figure? (C-01, C-02)
2. **What is the one definition of "current assets"?** Should it include cutting pieces and WIP, fixed assets, and should cash be gross or net of debts? (H-04)
3. **Are customer deposits revenue, cash-with-obligation, or both?** Where must they appear (liability line, net position)? (H-16, M-11)
4. **Opening balances per season.** What carries into Winter from Summer — cash, receivables, debts, stock, fixed assets? (H-12)
5. **Meaning of `qty_received` for in-progress models** and of **`cost_per_meter`**. (H-02, H-03)
6. **Costing method.** Manual card cost (today), weighted average, or FIFO layers? How should labour, accessories and overhead be allocated to units? (H-05, §7)
7. **Payroll, purchases, print jobs, fixed assets:** should each automatically create a cash-out or a payable? From which date? (H-08–H-10)
8. **Shipping short-payments:** which reasons exist (fee, commission, deduction, return, dispute) and to which accounts do they post? (H-15)
9. **Deletion policy:** forbid hard delete of anything that touched money? Who may "void"? (C-05, M-10)
10. **`حساب عميل` orders:** should they create a receivable automatically? (M-15)
11. **Historical rows** flagged by the Appendix A queries (paid amounts without cash, zero-cost cards, estimated dates): correct them, annotate them, or leave as history? (C-04, H-05, H-06)
12. **Charity base:** should collections held for cancelled orders count, and are repayments netted? (M-06)

---

## 18. What already exists in tests (re-run during this audit)

`npm test` in `backend/` → **89 / 89 passed** [TEST]. Two integration scripts (`test:e2e`, `test:e2e:cancel`) ran on a scratch PostgreSQL in earlier work (55 and 46 checks, all passing); they were **not** re-run in this audit because they write to a database.

| File | Covers |
|---|---|
| `accounting.test.ts` | prepare / ship / collect / re-save / correct collection / cancel / season isolation / permissions |
| `allocation.test.ts` | FIFO reservations, shortages, production fulfilment, shipping blocks |
| `cancellation.test.ts` | full cancellation, dispositions, obligations, reopening, idempotency |
| `dashboard.test.ts` | real Dashboard handler: stock, receivables, cash, assets reconciliation, pending/missing stock, cancelled orders |
| `receivables.test.ts` | valid receivables, double-count detection, audit rows |
| `missingStock.test.ts`, `ledgers.test.ts`, `statusLabel.test.ts`, `guards.test.ts` | summary grouping, planners/charity maths, label mapping, advisory-lock guard |

**Coverage gaps** relative to this audit: nothing tests the Financial Center, snapshots/profit-by-period, Reports, AI figures, debts/client-account cash entries, deletes, duplicate stock cards, fabric rows, WIP overlap, payroll, or fixed assets.

---

## Appendix A — read-only SQL for the reconciliation (run where the database is reachable)

*Validation note:* all queries below were executed (read-only) against a scratch database with the same schema and no business data, to confirm they parse and run. They have **not** been run on production data.

Run inside a read-only transaction, one season at a time:

```sql
BEGIN READ ONLY;
\set season 1          -- selected season id; repeat for each season, then once without the filter for all-season totals
```

**A1 — cash components and cash**
```sql
SELECT
  (SELECT COALESCE(SUM(amount_in),0)  FROM expenses_revenues WHERE season_id=:season)                                   AS expenses_in,
  (SELECT COALESCE(SUM(deposit_paid),0) FROM sales WHERE season_id=:season)                                             AS deposits,
  (SELECT COALESCE(SUM(shipping_collected),0) FROM sales WHERE season_id=:season AND order_status IN ('تم الصرف','تم الإلغاء')) AS shipping_collected,
  (SELECT COALESCE(SUM(amount),0) FROM payment_logs WHERE season_id=:season AND type='client_payment')                  AS client_payments,
  (SELECT COALESCE(SUM(amount_out),0) FROM expenses_revenues WHERE season_id=:season)                                   AS expenses_out,
  (SELECT COALESCE(SUM(amount),0) FROM payment_logs WHERE season_id=:season AND type='debt_payment')                    AS debt_payments,
  (SELECT COALESCE(SUM(refund_amount),0) FROM return_items WHERE season_id=:season)                                     AS refunds;
-- cash = (expenses_in + deposits + shipping_collected + client_payments) - (expenses_out + debt_payments + refunds)
```

**A2 — collection ledger vs the stored total (must return no rows)**
```sql
SELECT s.id, s.order_number, s.order_status, s.shipping_collected, COALESCE(SUM(c.amount),0) AS ledger_total
FROM sales s LEFT JOIN shipping_collections c ON c.sale_id = s.id
WHERE s.season_id=:season
GROUP BY s.id HAVING ROUND(s.shipping_collected::numeric,2) <> ROUND(COALESCE(SUM(c.amount),0)::numeric,2);
```

**A3 — receivables (valid, outstanding only)**
```sql
SELECT
  (SELECT COALESCE(SUM(GREATEST(0,remaining)),0) FROM sales WHERE season_id=:season AND order_status='لم يتم الصرف')                       AS shipped_unpaid,
  (SELECT COALESCE(SUM(GREATEST(0,remaining - shipping_collected)),0) FROM sales WHERE season_id=:season AND order_status='تم الصرف')     AS paid_out_gap,
  (SELECT COALESCE(SUM(GREATEST(0,remaining)),0) FROM client_accounts WHERE season_id=:season)                                           AS client_accounts;
```

**A4 — customer deposit liabilities and refund obligations**
```sql
SELECT
  (SELECT COALESCE(SUM(deposit_paid),0) FROM sales WHERE season_id=:season AND order_status='تم الحجز') AS deposits_on_prepared_orders,
  (SELECT COALESCE(SUM(GREATEST(0, s.deposit_paid - COALESCE(r.refunded,0))),0)
     FROM sales s LEFT JOIN (SELECT lower(trim(order_number)) o, SUM(refund_amount) refunded FROM return_items WHERE season_id=:season GROUP BY 1) r
       ON r.o = lower(trim(s.order_number))
    WHERE s.season_id=:season AND s.order_status='تم الإلغاء')                                          AS deposits_owed_back_on_cancelled,
  (SELECT COALESCE(SUM(shipping_collected),0) FROM sales WHERE season_id=:season AND order_status='تم الإلغاء') AS held_for_shipping_company;
```

**A5 — recognised sales**
```sql
SELECT COALESCE(SUM(invoice_value),0) AS recognised_sales
FROM sales WHERE season_id=:season AND order_status NOT IN ('تم الحجز','تم الإلغاء');
```

**A6 — cost of goods sold from the cost ledger, and what is missing a cost**
```sql
SELECT COALESCE(SUM(CASE WHEN movement_type='SHIP' THEN total_cost ELSE -total_cost END),0) AS cogs_ledger
FROM inventory_movements WHERE season_id=:season;
-- (returns of recorded orders credit COGS in the app; not reproduced here)
```

**A7 — what makes up "profit": inflows by operation type**
```sql
SELECT operation_type, SUM(amount_in) AS inflow, SUM(amount_out) AS outflow, COUNT(*) AS rows
FROM expenses_revenues WHERE season_id=:season GROUP BY operation_type ORDER BY 2 DESC;
```

**A8 — shipped orders with no cost record, and zero-cost cost rows**
```sql
SELECT s.id, s.order_number, s.order_status, s.invoice_value
FROM sales s
WHERE s.season_id=:season AND s.order_status NOT IN ('تم الحجز','تم الإلغاء')
  AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.sale_id = s.id AND m.movement_type='SHIP');
```

**A9 — duplicate stock cards (exact match; the app also merges near-spellings)**
```sql
SELECT model_code, color, COUNT(*) AS cards, SUM(opening_balance) AS opening_sum
FROM ready_stock WHERE season_id=:season GROUP BY model_code, color HAVING COUNT(*) > 1;
```

**A10 — zero-cost cards and zero-cost shipments**
```sql
SELECT id, model_code, color, opening_balance FROM ready_stock WHERE season_id=:season AND cost_per_piece = 0;
SELECT sale_id, model_code, color, qty FROM inventory_movements WHERE season_id=:season AND movement_type='SHIP' AND unit_cost = 0;
```

**A11 — physical stock and value per card (exact-match approximation of the app's fuzzy matching)**
```sql
WITH prod AS (SELECT model_code, color, SUM(qty_received) q FROM model_productions WHERE season_id=:season GROUP BY 1,2),
slots AS (
  SELECT model1_code c, model1_color col, model1_qty q, order_status, cancel_disposition FROM sales WHERE season_id=:season
  UNION ALL SELECT model2_code, model2_color, model2_qty, order_status, cancel_disposition FROM sales WHERE season_id=:season
  UNION ALL SELECT model3_code, model3_color, model3_qty, order_status, cancel_disposition FROM sales WHERE season_id=:season
  UNION ALL SELECT model4_code, model4_color, model4_qty, order_status, cancel_disposition FROM sales WHERE season_id=:season
  UNION ALL SELECT model5_code, model5_color, model5_qty, order_status, cancel_disposition FROM sales WHERE season_id=:season),
sold AS (SELECT c, col, SUM(q) q FROM slots
         WHERE c <> '' AND q > 0
           AND (order_status NOT IN ('تم الحجز','تم الإلغاء') OR (order_status='تم الإلغاء' AND cancel_disposition IN ('not_returned','returned_damaged')))
         GROUP BY 1,2),
ret AS (SELECT model_code, model_color col, SUM(model_qty) q FROM return_items WHERE season_id=:season AND model_code <> '' GROUP BY 1,2)
SELECT rs.id, rs.model_code, rs.color, rs.opening_balance,
       COALESCE(p.q,0) AS produced, COALESCE(s.q,0) AS shipped, COALESCE(r.q,0) AS returned,
       rs.opening_balance + COALESCE(p.q,0) - COALESCE(s.q,0) + COALESCE(r.q,0)                   AS physical_raw,
       GREATEST(0, rs.opening_balance + COALESCE(p.q,0) - COALESCE(s.q,0) + COALESCE(r.q,0))       AS physical,
       rs.cost_per_piece,
       GREATEST(0, rs.opening_balance + COALESCE(p.q,0) - COALESCE(s.q,0) + COALESCE(r.q,0)) * rs.cost_per_piece AS value
FROM ready_stock rs
LEFT JOIN prod p ON p.model_code = rs.model_code AND p.color = rs.color
LEFT JOIN sold s ON s.c = rs.model_code AND s.col = rs.color
LEFT JOIN ret  r ON r.model_code = rs.model_code AND r.col = rs.color
WHERE rs.season_id=:season ORDER BY physical_raw;       -- negative physical_raw = shipped more than exists
```

**A12 — stored `reserved_quantity` cache vs reservations still requested (compare with the app's allocation)**
```sql
SELECT rs.id, rs.model_code, rs.color, rs.reserved_quantity,
       (SELECT COALESCE(SUM(x.q),0) FROM (
          SELECT model1_qty q FROM sales WHERE season_id=:season AND order_status='تم الحجز' AND model1_code=rs.model_code AND model1_color=rs.color
          UNION ALL SELECT model2_qty FROM sales WHERE season_id=:season AND order_status='تم الحجز' AND model2_code=rs.model_code AND model2_color=rs.color
          UNION ALL SELECT model3_qty FROM sales WHERE season_id=:season AND order_status='تم الحجز' AND model3_code=rs.model_code AND model3_color=rs.color
          UNION ALL SELECT model4_qty FROM sales WHERE season_id=:season AND order_status='تم الحجز' AND model4_code=rs.model_code AND model4_color=rs.color
          UNION ALL SELECT model5_qty FROM sales WHERE season_id=:season AND order_status='تم الحجز' AND model5_code=rs.model_code AND model5_color=rs.color) x) AS requested_by_prepared_orders
FROM ready_stock rs WHERE rs.season_id=:season;
```

**A13 — fabric: more than one warehouse row per material + colour**
```sql
SELECT material_type, color, COUNT(*) AS rows, SUM(qty_in) AS qty_in FROM fabric_warehouse
WHERE season_id=:season GROUP BY 1,2 HAVING COUNT(*) > 1;
```

**A14 — "paid" amounts that never reached cash**
```sql
SELECT d.id, d.name, d.amount_paid, COALESCE(SUM(p.amount),0) AS logged_payments
FROM debts d LEFT JOIN debt_payments p ON p.debt_id = d.id
WHERE d.season_id=:season GROUP BY d.id HAVING ROUND(d.amount_paid::numeric,2) <> ROUND(COALESCE(SUM(p.amount),0)::numeric,2);

SELECT a.id, a.client_name, a.amount_paid, COALESCE(SUM(p.amount),0) AS logged_payments
FROM client_accounts a LEFT JOIN client_account_payments p ON p.account_id = a.id
WHERE a.season_id=:season GROUP BY a.id HAVING ROUND(a.amount_paid::numeric,2) <> ROUND(COALESCE(SUM(p.amount),0)::numeric,2);
```

**A15 — stale remaining, collections on unpaid statuses**
```sql
SELECT id, order_number, order_status, invoice_value, deposit_paid, remaining, shipping_collected
FROM sales WHERE season_id=:season
  AND (ROUND(remaining::numeric,2) <> ROUND((invoice_value - deposit_paid)::numeric,2)
       OR (order_status NOT IN ('تم الصرف','تم الإلغاء') AND shipping_collected <> 0));
```

**A16 — shipped-order receivable also entered as a client-account invoice**
```sql
SELECT s.id, s.order_number, s.order_status, s.remaining, i.amount AS invoice_amount, i.account_id
FROM sales s JOIN client_account_invoices i ON lower(trim(i.order_number)) = lower(trim(s.order_number)) AND i.season_id = s.season_id
WHERE s.season_id=:season AND s.order_status IN ('لم يتم الصرف','تم الصرف') AND s.remaining > 0;
```

**A17 — snapshot history (which definition wrote which day?)**
```sql
SELECT snapshot_date, total_current_assets, cash, fabric_assets, ready_stock_assets, accessories_assets, receivables, debts,
       (total_current_assets - (cash + fabric_assets + ready_stock_assets + accessories_assets + receivables)) AS unexplained_by_helper_formula
FROM financial_snapshots WHERE season_id=:season ORDER BY snapshot_date;
-- a non-zero last column = the row was written by the Dashboard (definition A: + cutting + WIP, gross cash)
```

**A18 — payroll vs recorded expenses (payroll never posts to cash)**
```sql
SELECT year, month, SUM(net_salary) AS payroll_net FROM payroll GROUP BY 1,2 ORDER BY 1,2;
SELECT date, statement, amount_out FROM expenses_revenues WHERE season_id=:season AND (statement ILIKE '%مرتب%' OR statement ILIKE '%اجور%' OR statement ILIKE '%أجور%');
```

**A19 — cancelled orders without a disposition (pre-feature rows keep the old behaviour)**
```sql
SELECT id, order_number, shipping_collected, deposit_paid FROM sales
WHERE season_id=:season AND order_status='تم الإلغاء' AND cancel_disposition IS NULL;
```

**A20 — estimated receipt dates**
```sql
SELECT collected_date, COUNT(*) AS rows, SUM(amount) AS amount FROM shipping_collections
WHERE season_id=:season AND date_estimated GROUP BY 1 ORDER BY 1;
```

**A21 — charity payments vs linked expenses (must match 1:1)**
```sql
SELECT p.id, p.charity_month, p.amount, e.amount_out, e.operation_type
FROM charity_payments p LEFT JOIN expenses_revenues e ON e.id = p.expense_id
WHERE p.season_id=:season AND (e.id IS NULL OR ROUND(e.amount_out::numeric,2) <> ROUND(p.amount::numeric,2) OR e.operation_type <> 'صدقة');
```

```sql
ROLLBACK;
```

---

## Appendix B — evidence index

| Source | Where |
|---|---|
| Dashboard calculation | `backend/src/routes/dashboard.ts` (lines cited above) |
| Cash flow function | `backend/src/services/financialMetrics.ts:128-143` |
| Financial Center | `backend/src/routes/financialCenter.ts` |
| Snapshots / profit by period | `backend/src/routes/snapshots.ts`, `services/snapshotHelper.ts`, `components/ProfitByPeriod.tsx` |
| Reports / cash-flow report | `backend/src/routes/reports.ts` |
| Orders, statuses, cancellation | `backend/src/routes/sales.ts`, `services/orderLedgers.ts`, `shippingCollections.ts`, `inventoryMovements.ts`, `orderCancellation.ts`, `readyStockPositions.ts` |
| Entities (stock, fabric, debts, accounts, purchases, print, fixed assets) | `backend/src/routes/entities.ts` |
| Payroll | `backend/src/routes/payroll.ts`, `services/payrollCalc.ts` |
| Schema and migrations | `backend/prisma/schema.prisma`, `backend/prisma/migrations/*` |
| Synthetic experiments | scratch script (not in the repository), results in §13.2 |
