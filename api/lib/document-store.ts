import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { institutionalEnv } from "./institutional-env";

export type StoredObject = {
  backend: "filesystem" | "s3";
  storageKey: string;
  objectKey: string;
  objectVersionId: string;
  sha256: string;
  byteLength: number;
};

export interface ObjectStore {
  put(input: { tenantId: number; filename: string; bytes: Buffer }): Promise<StoredObject>;
  get(object: { storageKey: string; objectKey?: string | null }): Promise<Buffer>;
  remove(object: { storageKey: string }): Promise<void>;
}

class FilesystemVersionedStore implements ObjectStore {
  async put(input: { tenantId: number; filename: string; bytes: Buffer }): Promise<StoredObject> {
    const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const versionId = `${randomUUID()}.v1`;
    const objectKey = `tenants/${input.tenantId}/objects/${versionId}-${safe}`;
    const fullPath = path.resolve(env.storagePath, objectKey);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.bytes, { flag: "wx" });
    return {
      backend: "filesystem",
      storageKey: objectKey,
      objectKey,
      objectVersionId: versionId,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      byteLength: input.bytes.byteLength,
    };
  }
  async get(object: { storageKey: string }): Promise<Buffer> {
    return readFile(path.resolve(env.storagePath, object.storageKey));
  }
  async remove(object: { storageKey: string }): Promise<void> {
    try { await unlink(path.resolve(env.storagePath, object.storageKey)); } catch { /* orphan */ }
  }
}

export function getObjectStore(): ObjectStore {
  void institutionalEnv;
  return new FilesystemVersionedStore();
}
