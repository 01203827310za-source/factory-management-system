# 🏭 نظام إدارة مصنع الملابس - دليل التركيب الكامل

## نظرة عامة على المعمارية

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│              localhost:5173 (Vite)                  │
│                                                     │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │  AuthContext  │    │   src/services/api.ts    │   │
│  │  (JWT State)  │    │  (HTTP Client → Backend) │   │
│  └──────────────┘    └──────────────────────────┘   │
└────────────────────────────┬────────────────────────┘
                             │ HTTP (JWT Bearer)
                             ▼
┌─────────────────────────────────────────────────────┐
│                  Backend (Express.js)                │
│               localhost:3001                        │
│                                                     │
│  /api/auth     → تسجيل الدخول / JWT                │
│  /api/users    → إدارة المستخدمين                   │
│  /api/sales    → المبيعات                           │
│  /api/expenses → المصروفات                          │
│  /api/...      → باقي الـ endpoints                 │
│  /api/dashboard → الإحصائيات المحسوبة               │
│                                                     │
│         Prisma ORM (TypeScript)                     │
└────────────────────────────┬────────────────────────┘
                             │ SQL
                             ▼
┌─────────────────────────────────────────────────────┐
│              PostgreSQL Database                    │
│                                                     │
│  users           sales          expenses_revenues   │
│  ready_stock     fabric_warehouse                   │
│  accessories_warehouse  cutting_orders              │
│  model_productions      debts                       │
│  client_accounts        return_items                │
│  payment_logs    marketers                          │
└─────────────────────────────────────────────────────┘
```

## 📋 المتطلبات

- Node.js 18+
- PostgreSQL 14+
- npm أو yarn

---

## 🗄️ 1. إعداد قاعدة البيانات

### تثبيت PostgreSQL
**على Windows:** حمّل من https://www.postgresql.org/download/windows/

**على Mac:**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**على Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### إنشاء قاعدة البيانات
```bash
# ادخل على PostgreSQL
psql -U postgres

# أنشئ القاعدة والمستخدم
CREATE DATABASE clothing_factory_db;
CREATE USER factory_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE clothing_factory_db TO factory_user;
\q
```

---

## ⚙️ 2. تركيب الـ Backend

```bash
# ادخل على مجلد الباك اند
cd backend

# انسخ ملف الإعدادات
cp .env.example .env
```

### عدّل ملف `.env`:
```env
DATABASE_URL="postgresql://factory_user:your_password@localhost:5432/clothing_factory_db"
JWT_SECRET="اكتب هنا string عشوائي طويل مثلاً: xK9#mP2$qR7@nL5"
JWT_EXPIRES_IN="7d"
PORT=3001
FRONTEND_URL="http://localhost:5173"
ADMIN_PASSWORD="اختار كلمة مرور قوية للأدمن"
```

### تثبيت الحزم وإعداد الداتابيز:
```bash
npm install

# إنشاء جداول قاعدة البيانات
npx prisma migrate dev --name init

# إدخال البيانات الابتدائية (مستخدمين + بيانات تجريبية)
npm run db:seed

# تشغيل الخادم
npm run dev
```

✅ الخادم شغال على: `http://localhost:3001`

---

## 🎨 3. تحديث الـ Frontend

### الملفات المُعدَّلة - انسخها على مشروعك:

| الملف الجديد | مكانه في مشروعك |
|---|---|
| `src/services/api.ts` | **جديد** - أنشئه |
| `src/contexts/AuthContext.tsx` | **جديد** - أنشئ مجلد contexts |
| `src/pages/Login.tsx` | **جديد** - في pages |
| `src/pages/Users.tsx` | **جديد** - في pages |
| `src/App.tsx` | **استبدل** الموجود |
| `src/data/store.ts` | **استبدل** الموجود |
| `src/types/index.ts` | **استبدل** الموجود |

### أنشئ ملف `.env` في مجلد المشروع:
```bash
cp .env.example .env
# محتوى الملف:
# VITE_API_URL=http://localhost:3001/api
```

### ⚠️ تحديث ملفات الصفحات (مهم!)

بسبب أن `store.ts` أصبح async، كل صفحة تحتاج تعديل بسيط.

**النمط القديم (localStorage - sync):**
```tsx
const [sales, setSales] = useState<Sale[]>(salesStore.getAll());

// في handlers:
salesStore.add(form);
setSales(salesStore.getAll());
```

**النمط الجديد (API - async):**
```tsx
const [sales, setSales] = useState<Sale[]>([]);
const [loading, setLoading] = useState(true);

// تحميل البيانات
const loadData = async () => {
  setLoading(true);
  try {
    setSales(await salesStore.getAll());
  } finally {
    setLoading(false);
  }
};

useEffect(() => { loadData(); }, []);

// في handlers:
const handleAdd = async (form) => {
  await salesStore.add(form);
  await loadData(); // أو setSales(await salesStore.getAll())
};

const handleDelete = async (id: number) => {
  await salesStore.remove(id);
  setSales(prev => prev.filter(s => s.id !== id));
};
```

**الصفحات التي تحتاج هذا التعديل:**
- `Sales.tsx`
- `Expenses.tsx`
- `ReadyStock.tsx`
- `FabricWarehouse.tsx`
- `Accessories.tsx`
- `Cutting.tsx`
- `ModelProduction.tsx`
- `ClientAccounts.tsx`
- `Debts.tsx`
- `Dashboard.tsx`

---

## 🚀 4. تشغيل المشروع كاملاً

```bash
# Terminal 1 - Backend
cd backend && npm run dev

# Terminal 2 - Frontend
cd your-frontend-project && npm run dev
```

افتح: `http://localhost:5173`

---

## 👥 نظام المستخدمين

### الحسابات الافتراضية بعد السيد:

| المستخدم | كلمة المرور | الدور | الصلاحيات |
|---|---|---|---|
| `admin` | `admin123` | مدير النظام | كل الصلاحيات + إدارة المستخدمين |
| `hatem` | `hatem123` | مشرف | إضافة وتعديل وحذف البيانات |
| `mido` | `mido123` | مشرف | إضافة وتعديل وحذف البيانات |

### الأدوار:
| الدور | القراءة | الكتابة | إدارة المستخدمين |
|---|---|---|---|
| `admin` | ✅ | ✅ | ✅ |
| `manager` | ✅ | ✅ | ❌ |
| `viewer` | ✅ | ❌ | ❌ |

---

## 📡 API Endpoints

```
POST   /api/auth/login              → تسجيل الدخول
GET    /api/auth/me                 → بيانات المستخدم الحالي
POST   /api/auth/change-password    → تغيير كلمة المرور

GET    /api/users                   → [admin] قائمة المستخدمين
POST   /api/users                   → [admin] إضافة مستخدم
PUT    /api/users/:id               → [admin] تعديل مستخدم
DELETE /api/users/:id               → [admin] حذف مستخدم

GET    /api/sales                   → المبيعات
POST   /api/sales                   → [manager] إضافة
PUT    /api/sales/:id               → [manager] تعديل
DELETE /api/sales/:id               → [manager] حذف

GET    /api/expenses                → المصروفات
GET    /api/ready-stock             → المخزون الجاهز
GET    /api/fabric                  → مخزن الأقمشة
GET    /api/accessories             → الإكسسوارات
GET    /api/cutting                 → أوامر القص
GET    /api/model-prod              → إنتاج الموديلات
GET    /api/debts                   → الديون
GET    /api/client-accounts         → حسابات العملاء
GET    /api/returns                 → المرتجعات
GET    /api/payment-log             → سجل المدفوعات
GET    /api/marketers               → المسوقون
GET    /api/dashboard               → الإحصائيات الكاملة
GET    /api/health                  → فحص الخادم
```

---

## 🛠️ أوامر مفيدة

```bash
# عرض قاعدة البيانات بواجهة رسومية
cd backend && npm run db:studio

# إعادة تعيين قاعدة البيانات
cd backend && npm run db:reset

# بناء الـ backend للإنتاج
cd backend && npm run build && npm start

# بناء الـ frontend للإنتاج
npm run build
```

---

## 🔒 نصائح الأمان للإنتاج

1. **غيّر `JWT_SECRET`** لـ string عشوائي طويل (32+ حرف)
2. **غيّر كلمات المرور الافتراضية** فوراً بعد أول تشغيل
3. **استخدم HTTPS** في الإنتاج
4. **ضع الـ Backend خلف Nginx** كـ reverse proxy
5. **أضف rate limiting** للحماية من هجمات brute-force
