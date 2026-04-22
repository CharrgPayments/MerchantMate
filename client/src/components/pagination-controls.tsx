import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationControlsProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
}

/**
 * Compact prev/next pager used by the list pages.
 * Shows the current row range and the total count, and disables the buttons
 * appropriately at the boundaries.
 */
export function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  isLoading,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div
      className="flex items-center justify-between gap-3 py-3"
      data-testid="pagination-controls"
    >
      <div className="text-sm text-muted-foreground" data-testid="text-pagination-summary">
        {total === 0
          ? "No results"
          : `Showing ${start}-${end} of ${total}`}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground" data-testid="text-pagination-page">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={isLoading || page <= 1}
          data-testid="button-pagination-prev"
        >
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={isLoading || page >= totalPages}
          data-testid="button-pagination-next"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
