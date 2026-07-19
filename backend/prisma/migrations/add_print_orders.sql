-- Migration: add_print_orders
-- Creates the print_orders table for tracking print order history.
-- Run this SQL against the database, then: npx prisma generate

CREATE TABLE IF NOT EXISTS "print_orders" (
  "id"                   SERIAL           NOT NULL,
  "order_number"         TEXT             NOT NULL DEFAULT '',
  "date"                 TEXT             NOT NULL DEFAULT '',
  "source_stock_id"      INTEGER          NOT NULL DEFAULT 0,
  "source_model_code"    TEXT             NOT NULL DEFAULT '',
  "source_product_name"  TEXT             NOT NULL DEFAULT '',
  "source_color"         TEXT             NOT NULL DEFAULT '',
  "quantity"             INTEGER          NOT NULL DEFAULT 0,
  "blank_unit_cost"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "print_cost_per_piece" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "final_unit_cost"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dest_stock_id"        INTEGER          NOT NULL DEFAULT 0,
  "dest_model_code"      TEXT             NOT NULL DEFAULT '',
  "dest_product_name"    TEXT             NOT NULL DEFAULT '',
  "dest_color"           TEXT             NOT NULL DEFAULT '',
  "print_type"           TEXT             NOT NULL DEFAULT '',
  "notes"                TEXT             NOT NULL DEFAULT '',
  "created_by"           TEXT             NOT NULL DEFAULT '',
  "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_orders_pkey" PRIMARY KEY ("id")
);
