-- 0015: Uniform procedure authority — break-glass two-person, grant override metadata, outbox delivery attempts

-- break_glass: REQUESTED → APPROVED (second person)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'break_glass_grants' AND COLUMN_NAME = 'status');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `break_glass_grants` ADD COLUMN `status` enum(''REQUESTED'',''APPROVED'',''REVOKED'') NOT NULL DEFAULT ''APPROVED'' AFTER `justificacion`, ADD COLUMN `requested_by` bigint(20) unsigned NULL AFTER `granted_by`, ADD COLUMN `approved_by` bigint(20) unsigned NULL AFTER `requested_by`, ADD COLUMN `approved_at` timestamp NULL AFTER `approved_by`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill: existing active grants are APPROVED; requested_by/approved_by ← granted_by (legacy single-step)
UPDATE `break_glass_grants`
SET `requested_by` = COALESCE(`requested_by`, `granted_by`),
    `approved_by` = COALESCE(`approved_by`, `granted_by`),
    `approved_at` = COALESCE(`approved_at`, `valid_from`),
    `status` = IF(`revoked_at` IS NOT NULL, 'REVOKED', COALESCE(`status`, 'APPROVED'))
WHERE `requested_by` IS NULL OR `approved_by` IS NULL;

-- user_capabilities: SoD override metadata
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_capabilities' AND COLUMN_NAME = 'override_sod');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `user_capabilities` ADD COLUMN `override_sod` tinyint(1) NOT NULL DEFAULT 0 AFTER `granted_by`, ADD COLUMN `justificacion` text NULL AFTER `override_sod`, ADD COLUMN `expires_at` timestamp NULL AFTER `justificacion`, ADD COLUMN `approved_by` bigint(20) unsigned NULL AFTER `expires_at`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- procedimiento_asignaciones: approved_by for self-assign override
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procedimiento_asignaciones' AND COLUMN_NAME = 'approved_by');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `procedimiento_asignaciones` ADD COLUMN `approved_by` bigint(20) unsigned NULL AFTER `asignado_por`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- outbox delivery attempts (at-least-once audit)
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'domain_outbox' AND COLUMN_NAME = 'delivery_attempts');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `domain_outbox` ADD COLUMN `delivery_attempts` json NULL AFTER `provider_message_id`', 'SELECT 1');
PREPARE stmt FROM @sqlstmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;
