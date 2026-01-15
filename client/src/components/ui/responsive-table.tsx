import { cn } from "@/lib/utils";
import { Table } from "@/components/ui/table";

interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveTable({ children, className }: ResponsiveTableProps) {
  return (
    <div className={cn(
      "w-full overflow-x-auto rounded-lg border",
      "-mx-4 sm:mx-0 px-4 sm:px-0",
      className
    )}>
      <div className="min-w-[640px]">
        <Table>{children}</Table>
      </div>
    </div>
  );
}

export function ResponsiveTableContainer({ children, className }: ResponsiveTableProps) {
  return (
    <div className={cn(
      "w-full overflow-x-auto",
      "scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100",
      className
    )}>
      {children}
    </div>
  );
}
