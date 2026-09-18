# Auditoría ARES — portal transaccional de contratación pública (solo ARES)

Fuente: diagnóstico del ZIP AresEngine_MX_Phase1_ExpedienteGovernado (15 sep 2026).
Regla: NO cruzar con Megalodon. MEGALODON prepara; ARES contrata, administra y gobierna.

## Dictamen
ARES NO es aún portal de punta a punta. Tiene núcleo hasta adjudicación + expediente gobernado.
Faltan dominios transaccionales reales (no hitos/documentos disfrazados).

## Estados por etapa
- Planeación: PARCIAL (comprimida en licitaciones)
- Investigación de mercado: AUSENTE (proveedores cotizan; distinto de participación)
- Procedimiento: PARCIAL (estado+etapa, no máquina de estados jurídica)
- Convocatoria: IMPLEMENTADA CON CONTROL (gates sólidos)
- Aclaraciones: AUSENTE como proceso (solo hito)
- Recepción propuestas: PARCIAL (participación sin vínculo fuerte a oferta documental)
- Apertura: NO GOBERNADA (ACTA_APERTURA sustituye al evento)
- Evaluación: BUENA BASE, incompleta (en participaciones; roles pobres)
- Dictamen: DOCUMENTAL, no procesal
- Fallo: AUSENTE como workflow (adjudicar salta el acto)
- Adjudicación: IMPLEMENTADA con gates, pero secuencia incompleta
- Contrato / Garantías / Admin contractual / Modificaciones / Ejecución / Pagos / Incidencias / Sanciones / Inconformidades / Notificaciones / Consulta pública: AUSENTES
- Expediente electrónico: BUENA BASE (hash-chain events) — CONSERVAR
- Inalterabilidad: PARCIAL (audit_log sin chain; writeAudit post-commit)
- Anticorrupción: motor inicial de alertas — no es sistema de investigación/sanción
- Roles: solo admin/licitante/proveedor — segregación insuficiente
- CASCADE en tenant destruye evidencia — INACEPTABLE para conservación

## Regla de diseño
NO rellenar 🔴 con más hitos/tipo_documento/campos en licitaciones.
Cada acto = dominio: identidad, estados, transiciones, actores, plazos, evidencia, permisos, versionado, vínculo a expediente.

Aclaración ≠ Hito(PREGUNTAS_RESPUESTAS)
Fallo ≠ Documento(FALLO_ADJUDICACION)
Contrato ≠ Documento(CONTRATO)
Garantía ≠ Documento(GARANTIA)
Pago ≠ Documento(FACTURA)
Sanción ≠ Alerta
Apertura ≠ ACTA_APERTURA

## Secuencia correcta post-evaluación
EVALUACIÓN → DICTAMEN → APROBACIÓN → FALLO → ADJUDICACIÓN → CONTRATO → …

## Evidencia atómica
Ningún acto material sin evidencia durable en la MISMA transacción (acto + estado + actor + evidencia + evento auditable). No: commit → writeAudit opcional.

## Conservar
expediente gobernado, eventos encadenados, hashes, versionado documental, requisitos/gates, tenant isolation, evaluación existente, alertas de integridad.
