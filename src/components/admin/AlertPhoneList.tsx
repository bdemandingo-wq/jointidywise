import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const MAX = 5;
const split = (v: string) => v.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
const digits = (v: string) => v.replace(/\D/g, '').length;

interface Props {
  value: string;
  onChange: (joined: string) => void;
}

/** Edits business_settings.notification_phone as a list of numbers (stored comma-separated). */
export function AlertPhoneList({ value, onChange }: Props) {
  const [items, setItems] = useState<string[]>(() => {
    const s = split(value);
    return s.length ? s : [''];
  });
  const lastEmitted = useRef(value);

  // Pick up values loaded after mount (settings fetch).
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const s = split(value);
    setItems(s.length ? s : ['']);
  }, [value]);

  const commit = (next: string[]) => {
    setItems(next);
    // Only valid numbers are saved; blanks/too-short entries stay on screen, flagged.
    const joined = next.map(s => s.trim()).filter(s => digits(s) >= 10).join(', ');
    lastEmitted.current = joined;
    onChange(joined);
  };

  return (
    <div className="space-y-2">
      {items.map((num, i) => {
        const invalid = num.trim() !== '' && digits(num) < 10;
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                id={i === 0 ? 'notification_phone' : undefined}
                value={num}
                inputMode="tel"
                placeholder="e.g. 813-236-4513"
                aria-label={`Alert phone ${i + 1}`}
                aria-invalid={invalid}
                className={invalid ? 'border-destructive' : undefined}
                onChange={(e) => commit(items.map((v, j) => (j === i ? e.target.value : v)))}
              />
              {items.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label={`Remove alert phone ${i + 1}`}
                  onClick={() => commit(items.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {invalid && <p className="text-xs text-destructive">Enter a full 10-digit phone number.</p>}
          </div>
        );
      })}
      {items.length < MAX && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setItems([...items, ''])}>
          <Plus className="h-4 w-4" /> Add another number
        </Button>
      )}
    </div>
  );
}
