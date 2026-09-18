export const Session = {
  cookieName: "ares_sid",
  maxAgeMs: 8 * 60 * 60 * 1000,
} as const;

export const ErrorMessages = {
  unauthenticated: "Se requiere una sesión autenticada.",
  insufficientRole: "El rol de usuario no tiene permiso para esta operación.",
} as const;

export const Paths = {
  login: "/login",
  oauthCallback: "/api/oauth/callback",
} as const;
