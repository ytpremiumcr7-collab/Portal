-- 0018: Piedra Angular P2 audit — reception TOCTOU, consorcio freeze, money helpers (app-side)
-- Consorcio CONGELADO after link/present so membership cannot change under a sealed manifest.

ALTER TABLE consorcios
  MODIFY COLUMN estado ENUM('BORRADOR','ACTIVO','CONGELADO','DISUELTO') NOT NULL DEFAULT 'BORRADOR';
