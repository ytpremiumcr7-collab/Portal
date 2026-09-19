import { cn } from "@/lib/utils";

type Tone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent"
  | "purple";

const toneClass: Record<Tone, string> = {
  neutral: "bg-slate-700/80 text-slate-200 border-slate-600/60",
  info: "bg-sky-950/70 text-sky-200 border-sky-800/60",
  success: "bg-emerald-950/70 text-emerald-200 border-emerald-800/60",
  warning: "bg-amber-950/60 text-amber-200 border-amber-800/50",
  danger: "bg-red-950/70 text-red-200 border-red-800/60",
  accent: "bg-amber-900/40 text-amber-100 border-amber-700/50",
  purple: "bg-violet-950/70 text-violet-200 border-violet-800/60",
};

const estadoTone: Record<string, Tone> = {
  BORRADOR: "neutral",
  CONSULTAS: "info",
  PUBLICADA: "success",
  EN_EVALUACION: "info",
  ADJUDICADA: "purple",
  FINALIZADA: "neutral",
  CANCELADA: "danger",
  DESIERTA: "warning",
  ARCHIVADA: "neutral",
  PRESENTADA: "info",
  EN_REVISION: "warning",
  AUTORIZADA: "success",
  PAGADA: "success",
  RECHAZADA: "danger",
  APROBADA: "success",
  BAJA: "info",
  MEDIA: "warning",
  ALTA: "warning",
  CRITICA: "danger",
};

type StatusBadgeProps = {
  label?: string;
  status?: string;
  tone?: Tone;
  className?: string;
};

export function StatusBadge({ label, status, tone, className }: StatusBadgeProps) {
  const text = label ?? (status ? status.replace(/_/g, " ") : "");
  const resolved = tone ?? (status ? estadoTone[status] ?? "neutral" : "neutral");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        toneClass[resolved],
        className,
      )}
    >
      {text}
    </span>
  );
}

export function statusToneFor(status: string): Tone {
  return estadoTone[status] ?? "neutral";
}
