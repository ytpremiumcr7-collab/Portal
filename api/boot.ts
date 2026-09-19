import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { authenticateRequest } from "./lib/security";
import { getDb } from "./queries/connection";
import { documentos } from "@db/schema";
import { authorizeDocumentRead, assertPublicDocumentReadable } from "./lib/document-access";

const app = new Hono<{ Bindings: HttpBindings }>();
app.use(bodyLimit({ maxSize: 30 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => fetchRequestHandler({ endpoint: "/api/trpc", req: c.req.raw, router: appRouter, createContext }));

app.get("/api/documents/:id/download", async (c) => {
  const user = await authenticateRequest(c.req.raw.headers);
  if (!user) return c.json({ error: "No autenticado" }, 401);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Documento inválido" }, 400);
  const db = getDb();
  const doc = await db.query.documentos.findFirst({
    where: and(eq(documentos.id, id), eq(documentos.tenantId, user.tenantId)),
    with: { proveedor: true },
  });
  if (!doc) return c.json({ error: "Documento no encontrado" }, 404);
    try {
    await authorizeDocumentRead(
      { id: user.id, tenantId: user.tenantId, role: user.role },
      doc as any,
    );
  } catch (e: any) {
    const code = e?.code === "NOT_FOUND" ? 404 : 403;
    return c.json({ error: e?.message ?? "Sin permiso" }, code);
  }
  try {
    const data = await readFile(path.resolve(env.storagePath, doc.storageKey));
    return new Response(data, { headers: { "content-type": doc.mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.nombreArchivo)}`, "cache-control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return c.json({ error: "Archivo no disponible" }, 404);
  }
});

app.get("/api/public/documents/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Documento inválido" }, 400);
  const db = getDb();
  const doc = await db.query.documentos.findFirst({
    where: eq(documentos.id, id),
    with: { licitacion: true, proveedor: true },
  });
  if (!doc) return c.json({ error: "Documento no encontrado" }, 404);
  try {
    await assertPublicDocumentReadable(doc as any);
  } catch (e: any) {
    return c.json({ error: e?.message ?? "No disponible públicamente" }, 403);
  }
  try {
    const data = await readFile(path.resolve(env.storagePath, doc.storageKey));
    return new Response(data, { headers: { "content-type": doc.mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.nombreArchivo)}`, "cache-control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return c.json({ error: "Archivo no disponible" }, 404);
  }
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));
export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);
  const port = parseInt(process.env.PORT || "3000", 10);
  serve({ fetch: app.fetch, port }, () => console.log(`Piedra Angular ejecutándose en http://localhost:${port}/`));
}
