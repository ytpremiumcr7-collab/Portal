import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest, requestMeta } from "./lib/security";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
};

export async function createContext(opts: FetchCreateContextFnOptions): Promise<TrpcContext> {
  const meta = requestMeta(opts.req);
  const ctx: TrpcContext = {
    req: opts.req,
    resHeaders: opts.resHeaders,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    requestId: meta.requestId,
  };
  try {
    ctx.user = (await authenticateRequest(opts.req.headers)) ?? undefined;
  } catch {
    ctx.user = undefined;
  }
  return ctx;
}
