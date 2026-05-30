import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // ===== USERS =====
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 12);
  const hatemPassword = await bcrypt.hash('hatem123', 12);
  const midoPassword = await bcrypt.hash('mido123', 12);

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: process.env.ADMIN_USERNAME || 'admin',
      password: adminPassword,
      full_name: process.env.ADMIN_FULLNAME || 'مدير النظام',
      role: Role.admin,
    },
  });

  await prisma.user.upsert({
    where: { username: 'hatem' },
    update: {},
    create: { username: 'hatem', password: hatemPassword, full_name: 'حاتم', role: Role.manager },
  });

  await prisma.user.upsert({
    where: { username: 'mido' },
    update: {},
    create: { username: 'mido', password: midoPassword, full_name: 'ميدو', role: Role.manager },
  });

  console.log('✅ Users created: admin / hatem / mido');

  // ===== MARKETERS =====
  const marketers = ['أحمد', 'محمد', 'خالد', 'عمر', 'يوسف'];
  for (const name of marketers) {
    await prisma.marketer.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log('✅ Marketers seeded');

  // ===== READY STOCK =====
  const stockCount = await prisma.readyStock.count();
  if (stockCount === 0) {
    await prisma.readyStock.createMany({
      data: [
        { model_code: 'M001', product_name: 'تيشيرت قطن', color: 'أبيض', opening_balance: 50, cost_per_piece: 45, location: 'مخزن ميدو', mido_stock: 50, hatem_stock: 0 },
        { model_code: 'M001', product_name: 'تيشيرت قطن', color: 'أسود', opening_balance: 30, cost_per_piece: 45, location: 'مخزن ميدو', mido_stock: 30, hatem_stock: 0 },
        { model_code: 'M002', product_name: 'قميص كاجوال', color: 'أزرق', opening_balance: 25, cost_per_piece: 85, location: 'مخزن حاتم', mido_stock: 0, hatem_stock: 25 },
        { model_code: 'M003', product_name: 'بلكشت صوف', color: 'رمادي', opening_balance: 40, cost_per_piece: 120, location: 'مخزن ميدو', mido_stock: 40, hatem_stock: 0 },
        { model_code: 'M004', product_name: 'جاكيت جينز', color: 'أزرق', opening_balance: 15, cost_per_piece: 200, location: 'مخزن حاتم', mido_stock: 0, hatem_stock: 15 },
      ],
    });
    console.log('✅ Ready stock seeded');
  }

  // ===== FABRIC =====
  const fabricCount = await prisma.fabricWarehouse.count();
  if (fabricCount === 0) {
    await prisma.fabricWarehouse.createMany({
      data: [
        { date: '2025-01-15', material_type: 'قطن', color: 'أبيض', qty_in: 500, cost_per_kg: 25 },
        { date: '2025-01-20', material_type: 'قطن', color: 'أسود', qty_in: 300, cost_per_kg: 25 },
        { date: '2025-02-01', material_type: 'صوف', color: 'رمادي', qty_in: 200, cost_per_kg: 60 },
        { date: '2025-02-10', material_type: 'جينز', color: 'أزرق', qty_in: 350, cost_per_kg: 35 },
      ],
    });
    console.log('✅ Fabric warehouse seeded');
  }

  // ===== ACCESSORIES =====
  const accCount = await prisma.accessoriesWarehouse.count();
  if (accCount === 0) {
    await prisma.accessoriesWarehouse.createMany({
      data: [
        { date: '2025-01-10', item_name: 'أزرار معدنية', qty_in: 1000, qty_consumed: 200, cost: 2 },
        { date: '2025-01-10', item_name: 'خيوط', qty_in: 500, qty_consumed: 100, cost: 15 },
        { date: '2025-02-01', item_name: 'سوستة', qty_in: 300, qty_consumed: 50, cost: 8 },
      ],
    });
    console.log('✅ Accessories warehouse seeded');
  }

  // ===== EXPENSES =====
  const expCount = await prisma.expenseRevenue.count();
  if (expCount === 0) {
    await prisma.expenseRevenue.createMany({
      data: [
        { date: '2025-01-01', operation_type: 'راس مالى', statement: 'رأس المال المبدئى', hatem_in: 50000, hatem_out: 0, mido_in: 50000, mido_out: 0 },
        { date: '2025-01-15', operation_type: 'مصروف تشغيل', statement: 'إيجار المصنع', hatem_in: 0, hatem_out: 3000, mido_in: 0, mido_out: 3000 },
        { date: '2025-02-01', operation_type: 'مصروف تشغيل', statement: 'رواتب العمالة', hatem_in: 0, hatem_out: 5000, mido_in: 0, mido_out: 5000 },
        { date: '2025-02-15', operation_type: 'ايراد مبيعات', statement: 'مبيعات فبراير', hatem_in: 8000, hatem_out: 0, mido_in: 8000, mido_out: 0 },
      ],
    });
    console.log('✅ Expenses seeded');
  }

  // ===== SALES =====
  const salesCount = await prisma.sale.count();
  if (salesCount === 0) {
    await prisma.sale.createMany({
      data: [
        {
          order_number: 'ORD-001', row_number: 1, marketer: 'أحمد', client: 'سوق شعبي',
          model1_code: 'M001', model1_qty: 10, model1_color: 'أبيض',
          model2_code: 'M001', model2_qty: 5, model2_color: 'أسود',
          invoice_value: 725, deposit_paid: 300, deposit_receiver: 'ميدو', remaining: 425,
          shipping_number: 'SHP-001', order_status: 'لم يتم الصرف', delivery_method: 'ايرجنت',
          mobile: '01012345678', warehouse: 'مخزن ميدو', shipping_collected: 0,
        },
        {
          order_number: 'ORD-002', row_number: 2, marketer: 'محمد', client: 'متجر أزياء',
          model1_code: 'M002', model1_qty: 15, model1_color: 'أزرق',
          invoice_value: 1275, deposit_paid: 1275, deposit_receiver: 'حاتم', remaining: 0,
          shipping_number: 'SHP-002', order_status: 'تم الصرف', delivery_method: 'مصنع',
          mobile: '01198765432', warehouse: 'مخزن حاتم', shipping_collected: 50,
        },
        {
          order_number: 'ORD-003', row_number: 3, marketer: 'أحمد', client: 'عبد الرحمن',
          model1_code: 'M003', model1_qty: 8, model1_color: 'رمادي',
          model2_code: 'M004', model2_qty: 3, model2_color: 'أزرق',
          invoice_value: 1560, deposit_paid: 500, deposit_receiver: 'حاتم', remaining: 1060,
          order_status: 'حساب عميل', delivery_method: 'البريد',
          mobile: '01234567890', warehouse: 'مخزن ميدو', shipping_collected: 0,
        },
      ],
    });
    console.log('✅ Sales seeded');
  }

  // ===== CUTTING =====
  const cutCount = await prisma.cuttingOrder.count();
  if (cutCount === 0) {
    await prisma.cuttingOrder.createMany({
      data: [
        { date: '2025-01-20', cut_number: 1001, cut_description: 'قص تيشيرت قطن', material_type: 'قطن', layers_count: 20, spread_length_m: 100, total_pieces: 400, color: 'أبيض', kg_consumed: 150, notes: 'جودة عالية' },
        { date: '2025-02-05', cut_number: 1002, cut_description: 'قص بلكشت صوف', material_type: 'صوف', layers_count: 15, spread_length_m: 80, total_pieces: 240, color: 'رمادي', kg_consumed: 80, notes: '' },
      ],
    });
    console.log('✅ Cutting orders seeded');
  }

  // ===== MODEL PRODUCTION =====
  const prodCount = await prisma.modelProduction.count();
  if (prodCount === 0) {
    await prisma.modelProduction.createMany({
      data: [
        { date: '2025-01-25', cut_number: 1001, model_code: 'M001', qty_from_cutting: 400, model_description: 'تيشيرت قطن', color: 'أبيض', sizes: 'S,M,L,XL', status: 'تام', wastage: 10, qty_received: 390, warehouse_entry_date: '2025-01-28' },
        { date: '2025-02-10', cut_number: 1002, model_code: 'M003', qty_from_cutting: 240, model_description: 'بلكشت صوف', color: 'رمادي', sizes: 'M,L,XL', status: 'تام', wastage: 5, qty_received: 235, warehouse_entry_date: '2025-02-15' },
      ],
    });
    console.log('✅ Model production seeded');
  }

  // ===== DEBTS =====
  const debtCount = await prisma.debt.count();
  if (debtCount === 0) {
    await prisma.debt.createMany({
      data: [
        { date: '2025-01-10', name: 'مورد القماش', total_amount: 10000, amount_paid: 4000, remaining: 6000 },
        { date: '2025-02-01', name: 'كهرباء', total_amount: 2500, amount_paid: 2500, remaining: 0 },
      ],
    });
    console.log('✅ Debts seeded');
  }

  // ===== CLIENT ACCOUNTS =====
  const clientCount = await prisma.clientAccount.count();
  if (clientCount === 0) {
    await prisma.clientAccount.create({
      data: { date: '2025-02-05', client_name: 'عبد الرحمن', model_name: 'بلكشت صوف', quantity: 8, total_amount: 960, amount_paid: 500, remaining: 460, notes: 'دفعة أولى' },
    });
    console.log('✅ Client accounts seeded');
  }

  console.log('\n🎉 Database seeded successfully!');
  console.log('📋 Default users:');
  console.log('   admin / admin123  → مدير النظام (Admin)');
  console.log('   hatem / hatem123  → حاتم (Manager)');
  console.log('   mido  / mido123   → ميدو (Manager)');
}

main()
  .catch((e) => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(async () => await prisma.$disconnect());
