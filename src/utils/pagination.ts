export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  offset: number;
}

export function paginate<T>(items: T[], requestedPage = 1, pageSize = 10): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    page,
    totalPages,
    offset
  };
}
