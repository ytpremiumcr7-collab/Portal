import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "default" | "ok" | "warn" | "accent";

const toneBorder: Record<Tone, string> = {
  default: "border-slate-200 border-l-[3px] border-l-slate-700",
  ok: "border-slate-200 border-l-[3px] border-l-emerald-600",
  warn: "border-slate-200 border-l-[3px] border-l-red-600",
  accent: "border-slate-200 border-l-[3px] border-l-sky-700",
};

const toneIcon: Record<Tone, string> = {
  default: "bg-slate-100 text-slate-700",
  ok: "bg-emerald-50 text-emerald-700",
  warn: "bg-red-50 text-red-700",
  accent: "bg-sky-50 text-sky-800",
};

export function StatCard({
  title,
  value,
  icon,
  tone = "default",
  hint,
  className,
}: {
  title: string;
  value: string | number;
  icon?: ReactNode;
  tone?: Tone;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("shadow-none bg-white", toneBorder[tone], className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
            <p className="mt-1.5 truncate text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
            {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
          </div>
          {icon ? <div className={cn("rounded p-2.5", toneIcon[tone])}>{icon}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default StatCard;
