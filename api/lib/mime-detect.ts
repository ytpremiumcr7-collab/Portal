import { TRPCError } from "@trpc/server";

/** Magic-byte MIME allowlist for evidence uploads (no client-declared trust). */
const RULES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", test: (b) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-" },
  { mime: "image/png", test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "application/xml", test: (b) => /^\s*<\?xml/i.test(b.subarray(0, 64).toString("utf8")) },
  { mime: "text/xml", test: (b) => /^\s*<\?xml/i.test(b.subarray(0, 64).toString("utf8")) },
  {
    mime: "application/zip",
    test: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) && (b[3] === 0x04 || b[3] === 0x06 || b[3] === 0x08),
  },
];

export const ALLOWED_UPLOAD_MIMES = new Set(RULES.map((r) => r.mime).concat(["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]));

/** DOCX/XLSX are ZIP containers — accept ZIP magic when client claims OOXML. */
export function detectMimeFromMagic(buffer: Buffer, claimedMime?: string): string {
  for (const rule of RULES) {
    if (rule.test(buffer)) {
      if (rule.mime === "application/zip" && claimedMime && ALLOWED_UPLOAD_MIMES.has(claimedMime) && claimedMime.includes("openxmlformats")) {
        return claimedMime;
      }
      return rule.mime;
    }
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Tipo de archivo no permitido o no reconocible por firma mágica (allowlist: PDF, PNG, JPEG, XML, OOXML/ZIP).",
  });
}

export function assertMimeAllowed(detected: string) {
  if (!ALLOWED_UPLOAD_MIMES.has(detected) && detected !== "application/zip") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `MIME detectado no permitido: ${detected}` });
  }
}
