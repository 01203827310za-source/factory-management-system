-- Read-only verification for the safe season migration.
-- Run after add_seasons.sql. No data is modified.

SELECT id, name, year, type, status, is_active
FROM "seasons"
WHERE name = 'Summer 2026' AND year = 2026;

SELECT 'sales' AS table_name, COUNT(*) FILTER (WHERE season_id IS NULL) AS null_season_rows, COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) AS summer_rows FROM sales
UNION ALL SELECT 'expenses_revenues', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM expenses_revenues
UNION ALL SELECT 'ready_stock', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM ready_stock
UNION ALL SELECT 'fabric_warehouse', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM fabric_warehouse
UNION ALL SELECT 'fabric_purchases', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM fabric_purchases
UNION ALL SELECT 'accessories_warehouse', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM accessories_warehouse
UNION ALL SELECT 'cutting_orders', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM cutting_orders
UNION ALL SELECT 'model_productions', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM model_productions
UNION ALL SELECT 'model_parts', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM model_parts
UNION ALL SELECT 'debts', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM debts
UNION ALL SELECT 'debt_payments', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM debt_payments
UNION ALL SELECT 'client_accounts', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM client_accounts
UNION ALL SELECT 'client_account_payments', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM client_account_payments
UNION ALL SELECT 'client_account_invoices', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM client_account_invoices
UNION ALL SELECT 'return_items', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM return_items
UNION ALL SELECT 'payment_logs', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM payment_logs
UNION ALL SELECT 'financial_snapshots', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM financial_snapshots
UNION ALL SELECT 'print_orders', COUNT(*) FILTER (WHERE season_id IS NULL), COUNT(*) FILTER (WHERE season_id = (SELECT id FROM seasons WHERE name = 'Summer 2026' AND year = 2026)) FROM print_orders
ORDER BY table_name;