import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HOW_HEARD_OTHER_MAX, HOW_HEARD_VALUES, OPTION_LABELS } from '@/lib/onboardingAnswers';
import { cn } from '@/lib/utils';

/**
 * One-tap source buttons shared by onboarding step 1 and the owner dashboard
 * prompt. Other reveals a required free-text field (max 200).
 */
export function HowHeardChoices({
  value,
  other,
  onChange,
  disabled = false,
  showLabel = true,
}: {
  value: string;
  other: string;
  onChange: (value: string, other: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
}) {
  return (
    <div className="space-y-2">
      {showLabel && <Label>How did you hear about us?</Label>}
      <div className="grid grid-cols-2 gap-2">
        {HOW_HEARD_VALUES.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(option, option === 'other' ? other : '')}
              className={cn(
                'min-h-11 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors',
                selected
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50',
                disabled && 'pointer-events-none opacity-60',
              )}
            >
              {OPTION_LABELS.howHeard[option]}
            </button>
          );
        })}
      </div>
      {value === 'other' && (
        <Input
          value={other}
          maxLength={HOW_HEARD_OTHER_MAX}
          disabled={disabled}
          placeholder="Where did you hear about us?"
          aria-label="Where did you hear about us?"
          onChange={(event) => onChange('other', event.target.value)}
        />
      )}
    </div>
  );
}
