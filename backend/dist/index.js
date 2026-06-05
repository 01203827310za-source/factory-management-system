"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const financialCenter_1 = __importDefault(require("./routes/financialCenter"));
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const sales_1 = __importDefault(require("./routes/sales"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const entities_1 = require("./routes/entities");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// ===== Middleware =====
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: [
        'http://localhost:5173',
        'https://laudable-reflection-production-904d.up.railway.app'
    ],
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use((0, morgan_1.default)(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
// ===== Health Check =====
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ===== Routes =====
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/sales', sales_1.default);
app.use('/api/expenses', entities_1.expensesRouter);
app.use('/api/ready-stock', entities_1.readyStockRouter);
app.use('/api/fabric', entities_1.fabricRouter);
app.use('/api/accessories', entities_1.accessoriesRouter);
app.use('/api/cutting', entities_1.cuttingRouter);
app.use('/api/model-prod', entities_1.modelProdRouter);
app.use('/api/debts', entities_1.debtsRouter);
app.use('/api/client-accounts', entities_1.clientAccountsRouter);
app.use('/api/returns', entities_1.returnsRouter);
app.use('/api/payment-log', entities_1.paymentLogRouter);
app.use('/api/marketers', entities_1.marketersRouter);
app.use('/api/fixed-assets', entities_1.fixedAssetsRouter);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/financial-center', financialCenter_1.default);
// ===== 404 =====
app.use((_req, res) => {
    res.status(404).json({ message: 'المسار غير موجود' });
});
// ===== Error Handler =====
app.use((err, _req, res, _next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ message: 'خطأ داخلي في الخادم' });
});
// ===== Start =====
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1] || 'configured'}\n`);
});
//# sourceMappingURL=index.js.map