import { Button } from "@/components/ui/button";
import { X, Trash2, Edit2, Download } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

export interface BulkAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  testId?: string;
}

export interface BulkActionGroup {
  label: string;
  actions: BulkAction[];
}

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  actions?: BulkAction[];
  actionGroups?: BulkActionGroup[];
  position?: "top" | "bottom";
}

export function BulkActionBar({
  selectedCount,
  onClearSelection,
  actions = [],
  actionGroups = [],
  position = "bottom",
}: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  const positionClasses = position === "bottom" 
    ? "bottom-0 border-t" 
    : "top-0 border-b";

  return (
    <div 
      className={`fixed left-0 right-0 ${positionClasses} bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 z-40 transition-all duration-200 ease-in-out`}
      data-testid="bulk-action-bar"
    >
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 text-white font-semibold text-sm">
                {selectedCount}
              </div>
              <span className="font-medium text-blue-900 dark:text-blue-100">
                {selectedCount === 1 ? "1 item selected" : `${selectedCount} items selected`}
              </span>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="text-blue-700 hover:text-blue-900 hover:bg-blue-100 dark:text-blue-300 dark:hover:text-blue-100 dark:hover:bg-blue-900"
              data-testid="button-clear-selection"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* Direct action buttons */}
            {actions.map((action, index) => (
              <Button
                key={index}
                variant={action.variant || "outline"}
                size="sm"
                onClick={action.onClick}
                className={action.variant === "destructive" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                data-testid={action.testId || `button-bulk-action-${index}`}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}

            {/* Grouped actions dropdown */}
            {actionGroups.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    data-testid="button-bulk-actions-menu"
                  >
                    <Edit2 className="h-4 w-4 mr-2" />
                    More Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {actionGroups.map((group, groupIndex) => (
                    <div key={groupIndex}>
                      {groupIndex > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      {group.actions.map((action, actionIndex) => (
                        <DropdownMenuItem
                          key={actionIndex}
                          onClick={action.onClick}
                          data-testid={action.testId || `menu-item-${groupIndex}-${actionIndex}`}
                        >
                          {action.icon && <span className="mr-2">{action.icon}</span>}
                          {action.label}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable checkbox component for selection
interface SelectionCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
  ariaLabel?: string;
}

export function SelectionCheckbox({ 
  checked, 
  onCheckedChange, 
  testId,
  ariaLabel = "Select item"
}: SelectionCheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
      data-testid={testId}
      aria-label={ariaLabel}
    />
  );
}

// Header checkbox for select all
interface SelectAllCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
}

export function SelectAllCheckbox({ 
  checked, 
  indeterminate = false,
  onCheckedChange,
  testId = "checkbox-select-all"
}: SelectAllCheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(input) => {
        if (input) {
          input.indeterminate = indeterminate;
        }
      }}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
      data-testid={testId}
      aria-label="Select all items"
    />
  );
}
