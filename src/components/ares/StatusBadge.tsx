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
  neutral: "bg-slate-100 text-slate-700 border-slate-300",
  info: "bg-sky-50 text-sky-800 border-sky-200",
  success: "bg-emerald-50 text-emerald-800 border-emerald-200",
  warning: "bg-amber-50 text-amber-900 border-amber-200",
  danger: "bg-red-50 text-red-800 border-red-200",
  accent: "bg-slate-800 text-white border-slate-700",
  purple: "bg-violet-50 text-violet-800 border-violet-200",
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
