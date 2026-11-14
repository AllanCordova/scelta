/**
 * Slices an array for the requested 1-based page and clamps `currentPage`
 * within `[1, totalPages]`.
 */
export function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): { items: readonly T[]; currentPage: number; totalPages: number } {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  return {
    items: items.slice(startIndex, startIndex + safePageSize),
    currentPage,
    totalPages,
  };
}

type PaginationBarProps = {
  currentPage: number;
  totalPages: number;
  onPageChange: (nextPage: number) => void;
  ariaLabel?: string;
};

/**
 * Renders previous/next pagination controls when there is more than one page.
 */
export function PaginationBar({
  currentPage,
  totalPages,
  onPageChange,
  ariaLabel = "Paginação",
}: PaginationBarProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="pagination-bar" aria-label={ariaLabel}>
      <button
        type="button"
        className="ghost round-action"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(Math.max(1, currentPage - 1))}
      >
        Anterior
      </button>
      <span className="muted">
        Página {currentPage} de {totalPages}
      </span>
      <button
        type="button"
        className="ghost round-action"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
      >
        Próxima
      </button>
    </div>
  );
}
