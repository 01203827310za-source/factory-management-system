import prisma from '../lib/prisma';
export declare const expensesRouter: import("express-serve-static-core").Router;
export declare const readyStockRouter: import("express-serve-static-core").Router;
export declare const fabricRouter: import("express-serve-static-core").Router;
export declare const accessoriesRouter: import("express-serve-static-core").Router;
export declare const cuttingRouter: import("express-serve-static-core").Router;
export declare const modelProdRouter: import("express-serve-static-core").Router;
export declare const debtsRouter: import("express-serve-static-core").Router;
export declare const clientAccountsRouter: import("express-serve-static-core").Router;
export declare const returnsRouter: import("express-serve-static-core").Router;
export declare const paymentLogRouter: import("express-serve-static-core").Router;
export declare const marketersRouter: import("express-serve-static-core").Router;
export declare const fabricPurchasesRouter: import("express-serve-static-core").Router;
type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export declare function rebuildFabricInventory(client: TxClient | typeof prisma, fabricType: string, color: string): Promise<void>;
export declare const fixedAssetsRouter: import("express-serve-static-core").Router;
export declare const printOrdersRouter: import("express-serve-static-core").Router;
export {};
//# sourceMappingURL=entities.d.ts.map