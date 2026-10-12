import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OFFLINE_PAYMENT_METHODS, type OfflinePaymentMethod } from "@/lib/invoiceDraft";

interface MarkPaidButtonProps {
  disabled?: boolean;
  onPick: (method: OfflinePaymentMethod) => void;
  compact?: boolean;
  className?: string;
}

/** Records cash, check, or Zelle. Does not call Stripe. */
export function MarkPaidButton({ disabled, onPick, compact, className }: MarkPaidButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant={compact ? "ghost" : "outline"}
          size={compact ? "icon" : "default"}
          className={className ?? (compact ? "h-8 w-8 text-success hover:text-success/80" : undefined)}
          disabled={disabled}
          title="Mark as paid (cash, check, or Zelle)"
        >
          <CheckCircle2 className={compact ? "w-4 h-4" : "w-4 h-4 mr-2"} />
          {compact ? null : (
            <>
              Mark as paid
              <ChevronDown className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OFFLINE_PAYMENT_METHODS.map((method) => (
          <DropdownMenuItem key={method.id} onClick={() => onPick(method.id)}>
            {method.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
