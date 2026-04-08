import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, Settings, Eye, EyeOff, Maximize, Minimize } from "lucide-react";
import { WidgetProps } from "./widget-types";
import { cn } from "@/lib/utils";

interface BaseWidgetProps extends WidgetProps {
  children: React.ReactNode;
  isLoading?: boolean;
  onConfigure?: () => void;
}

export function BaseWidget({
  definition,
  preference,
  onConfigChange,
  onSizeChange,
  onVisibilityChange,
  children,
  isLoading = false,
  onConfigure,
}: BaseWidgetProps) {
  const getSizeClasses = (size: string) => {
    switch (size) {
      case 'small':
        return 'col-span-1 row-span-1';
      case 'medium':
        return 'col-span-2 row-span-1';
      case 'large':
        return 'col-span-3 row-span-2';
      default:
        return 'col-span-2 row-span-1';
    }
  };

  const handleSizeToggle = () => {
    const sizes = ['small', 'medium', 'large'] as const;
    const currentIndex = sizes.indexOf(preference.size);
    const nextSize = sizes[(currentIndex + 1) % sizes.length];
    onSizeChange(nextSize);
  };

  if (!preference.is_visible) {
    return null;
  }

  return (
    <Card className={cn(
      "widget-card transition-all duration-200 hover:shadow-md",
      isLoading && "opacity-60"
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-gray-700">
          {definition.name}
        </CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleSizeToggle}>
              {preference.size === 'large' ? (
                <>
                  <Minimize className="mr-2 h-4 w-4" />
                  Make Smaller
                </>
              ) : (
                <>
                  <Maximize className="mr-2 h-4 w-4" />
                  Make Larger
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onVisibilityChange(false)}>
              <EyeOff className="mr-2 h-4 w-4" />
              Hide Widget
            </DropdownMenuItem>
            {definition.configurable.length > 0 && onConfigure && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onConfigure}>
                  <Settings className="mr-2 h-4 w-4" />
                  Configure
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="pb-4">
        {children}
      </CardContent>
    </Card>
  );
}