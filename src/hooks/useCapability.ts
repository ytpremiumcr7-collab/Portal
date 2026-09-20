import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";

/**
 * UI mirror of server capabilities from auth.me — never invents authority.
 * Server procedureMutation remains the source of truth.
 */
export function useCapability(code: string | string[]) {
  const { user, isLoading } = useAuth();
  const required = Array.isArray(code) ? code : [code];
  return useMemo(() => {
    const caps = new Set<string>((user as { capabilities?: string[] } | null)?.capabilities ?? []);
    const isAdmin = user?.role === "admin";
    // Admin does NOT auto-get procedural caps (server ROLE_CAPABILITIES); only mirror listed caps.
    // Exception: for SoD admin screens, callers pass "auditar" / break_glass explicitly.
    const allowed = required.some((c) => caps.has(c));
    return {
      allowed,
      isLoading,
      capabilities: caps,
      user,
      /** Convenience: admin role alone is NOT enough for procedural mutations. */
      isAdmin,
    };
  }, [user, isLoading, required.join("|")]);
}

export function useCapabilities() {
  const { user, isLoading } = useAuth();
  return useMemo(() => {
    const caps = new Set<string>((user as { capabilities?: string[] } | null)?.capabilities ?? []);
    return {
      has: (code: string) => caps.has(code),
      hasAny: (...codes: string[]) => codes.some((c) => caps.has(c)),
      caps,
      isLoading,
      user,
    };
  }, [user, isLoading]);
}
