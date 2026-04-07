import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Code, Search, BookOpen } from "lucide-react";

interface Variable {
  name: string;
  description: string;
  example?: string;
}

interface VariablePickerProps {
  onInsert: (variable: string) => void;
  variables?: Record<string, string>;
  commonVariables?: Variable[];
}

const defaultCommonVariables: Variable[] = [
  { name: "userName", description: "User's full name", example: "John Doe" },
  { name: "firstName", description: "User's first name", example: "John" },
  { name: "lastName", description: "User's last name", example: "Doe" },
  { name: "email", description: "User's email address", example: "user@example.com" },
  { name: "companyName", description: "Company name", example: "Acme Corp" },
  { name: "merchantName", description: "Merchant business name", example: "Coffee Shop Inc" },
  { name: "agentName", description: "Agent's full name", example: "Jane Smith" },
  { name: "date", description: "Current date", example: "2025-10-10" },
  { name: "time", description: "Current time", example: "14:30:00" },
  { name: "applicationId", description: "Application ID", example: "APP-12345" },
  { name: "transactionAmount", description: "Transaction amount", example: "$100.00" },
  { name: "status", description: "Current status", example: "approved" },
  { name: "verificationLink", description: "Verification link URL", example: "https://..." },
  { name: "resetLink", description: "Password reset link", example: "https://..." },
  { name: "loginUrl", description: "Login page URL", example: "https://..." },
];

export function VariablePicker({ onInsert, variables, commonVariables = defaultCommonVariables }: VariablePickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  // Combine custom variables with common ones
  const customVars: Variable[] = variables 
    ? Object.entries(variables).map(([name, desc]) => ({
        name,
        description: desc,
      }))
    : [];

  const allVariables = [...customVars, ...commonVariables];

  // Filter variables based on search
  const filteredVariables = allVariables.filter(
    (v) =>
      v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.description.toLowerCase().includes(search.toLowerCase())
  );

  const handleInsert = (variableName: string) => {
    onInsert(`{{${variableName}}}`);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          data-testid="button-variable-picker"
        >
          <Code className="h-4 w-4" />
          Insert Variable
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold text-sm">Available Variables</h4>
          </div>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search variables..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              data-testid="input-variable-search"
            />
          </div>

          <ScrollArea className="h-64">
            <div className="space-y-2">
              {filteredVariables.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No variables found
                </p>
              ) : (
                filteredVariables.map((variable) => (
                  <button
                    key={variable.name}
                    onClick={() => handleInsert(variable.name)}
                    className="w-full text-left p-3 rounded-lg border hover:bg-accent transition-colors"
                    data-testid={`variable-item-${variable.name}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            {`{{${variable.name}}}`}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {variable.description}
                        </p>
                        {variable.example && (
                          <p className="text-xs text-muted-foreground/60 mt-1">
                            Example: {variable.example}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>

          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Click a variable to insert it at your cursor position
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
