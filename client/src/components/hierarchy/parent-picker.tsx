import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface ParentOption {
  id: number;
  label: string;
  hint?: string;
}

interface ParentPickerProps {
  value: string;
  onChange: (next: string) => void;
  options: ParentOption[];
  placeholder?: string;
  emptyText?: string;
  testId?: string;
}

export function ParentPicker({
  value,
  onChange,
  options,
  placeholder = "None (top-level)",
  emptyText = "No matches found.",
  testId,
}: ParentPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => String(o.id) === value);
  const buttonLabel = !value || value === "__none__" ? placeholder : selected ? selected.label : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className="truncate text-left">{buttonLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search) => {
            const needle = search.trim().toLowerCase();
            if (!needle) return 1;
            return itemValue.toLowerCase().includes(needle) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={`__none__ ${placeholder}`}
                onSelect={() => {
                  onChange("__none__");
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === "__none__" || !value ? "opacity-100" : "opacity-0")} />
                {placeholder}
              </CommandItem>
              {options.map((o) => {
                const itemValue = `${o.id} ${o.label} ${o.hint ?? ""}`;
                const isSelected = String(o.id) === value;
                return (
                  <CommandItem
                    key={o.id}
                    value={itemValue}
                    onSelect={() => {
                      onChange(String(o.id));
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span>{o.label}</span>
                      {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
