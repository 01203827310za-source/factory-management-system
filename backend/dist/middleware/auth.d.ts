import { Request, Response, NextFunction } from 'express';
export interface AuthPayload {
    userId: number;
    username: string;
    role: string;
    permissions?: string[];
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}
export declare const authenticate: (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
export declare const requireAdmin: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requireManager: (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requirePermission: (permission: string) => (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
export declare const requireRoutePermission: (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>;
//# sourceMappingURL=auth.d.ts.map