export function pageInput(page?: number, pageSize?: number) {
  const p = Math.max(1, Math.floor(page ?? 1));
  const size = Math.min(100, Math.max(1, Math.floor(pageSize ?? 25)));
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
