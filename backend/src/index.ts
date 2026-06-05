import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import financialCenterRouter from './routes/financialCenter';
import reportsRouter from './routes/reports';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import salesRouter from './routes/sales';
import dashboardRouter from './routes/dashboard';
import {
  expensesRouter, readyStockRouter, fabricRouter, accessoriesRouter,
  cuttingRouter, modelProdRouter, debtsRouter, clientAccountsRouter,
  returnsRouter, paymentLogRouter, marketersRouter, fixedAssetsRouter,
  fabricPurchasesRouter,
} from './routes/entities';

const app = express();
const PORT = process.env.PORT || 3001;

// ===== Middleware =====
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://laudable-reflection-production-904d.up.railway.app'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));

// ===== Health Check =====
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ===== Routes =====
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/sales', salesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/ready-stock', readyStockRouter);
app.use('/api/fabric', fabricRouter);
app.use('/api/accessories', accessoriesRouter);
app.use('/api/cutting', cuttingRouter);
app.use('/api/model-prod', modelProdRouter);
app.use('/api/debts', debtsRouter);
app.use('/api/client-accounts', clientAccountsRouter);
app.use('/api/returns', returnsRouter);
app.use('/api/payment-log', paymentLogRouter);
app.use('/api/marketers', marketersRouter);
app.use('/api/fixed-assets', fixedAssetsRouter);
app.use('/api/fabric-purchases', fabricPurchasesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/financial-center', financialCenterRouter);

// ===== 404 =====
app.use((_req, res) => {
  res.status(404).json({ message: 'المسار غير موجود' });
});

// ===== Error Handler =====
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ message: 'خطأ داخلي في الخادم' });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.DATABASE_URL?.split('@')[1] || 'configured'}\n`);
});
