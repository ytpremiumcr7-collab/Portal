import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("ares-empty", className)}>
      {icon && <div className="mb-1 text-slate-500">{icon}</div>}
      <p className="ares-empty-title">{title}</p>
      {description && <p className="ares-empty-desc">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
