import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Check } from 'lucide-react';
import { format, startOfDay } from 'date-fns';
// The calendar widget is a device-local day grid. The cell the user taps is
// the calendar day to store; orgDateKey() on that instant would shift it when
// the device zone and the org zone disagree. Presets above use orgAddDays.
import { orgAddDays, orgDateKey } from '@/lib/orgDateRange';
import { parseCalendarDate } from '@/lib/invoiceDraft';

interface DueDateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  timeZone: string;
  onChange: (date: string, label: string) => void;
}

const DUE_DATE_OPTIONS = [
  { label: 'Upon receipt', days: 0 },
  { label: 'In 7 days', days: 7 },
  { label: 'In 14 days', days: 14 },
  { label: 'In 30 days', days: 30 },
  { label: 'In 45 days', days: 45 },
  { label: 'In 60 days', days: 60 },
  { label: 'In 90 days', days: 90 },
];

export function DueDateSheet({ open, onOpenChange, value, timeZone, onChange }: DueDateSheetProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    value ? parseCalendarDate(value) ?? undefined : undefined
  );

  // Whole org-calendar days. `new Date(yyyy-mm-dd)` is UTC midnight and lands
  // a day early west of UTC, which is how "In 7 days" showed as 6 days out.
  const dateForDays = (days: number) =>
    orgDateKey(orgAddDays(new Date(), days, timeZone), timeZone);

  const handleSelect = (days: number, label: string) => {
    if (days === 0) {
      onChange('', 'Upon receipt');
    } else {
      onChange(dateForDays(days), label);
    }
    onOpenChange(false);
  };

  const handleCustomDate = (date: Date | undefined) => {
    if (date) {
      setSelectedDate(date);
      // eslint-disable-next-line local/no-device-local-dates -- picker cell, not an org-midnight instant
      onChange(format(date, 'yyyy-MM-dd'), format(date, 'MMM d, yyyy'));
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle>Due Date</SheetTitle>
        </SheetHeader>

        {showCalendar ? (
          <div className="py-4 flex flex-col items-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleCustomDate}
              // eslint-disable-next-line local/no-device-local-dates -- same grid as the picker cells
              disabled={(date) => date < startOfDay(new Date())}
              className="rounded-md border"
            />
            <Button 
              variant="outline" 
              className="mt-4"
              onClick={() => setShowCalendar(false)}
            >
              Back to options
            </Button>
          </div>
        ) : (
          <div className="py-4 space-y-1">
            {DUE_DATE_OPTIONS.map((option) => {
              const isSelected = option.days === 0
                ? !value
                : value === dateForDays(option.days);

              return (
                <button
                  key={option.days}
                  className="flex items-center justify-between w-full py-3 px-4 hover:bg-muted rounded-lg transition-colors"
                  onClick={() => handleSelect(option.days, option.label)}
                >
                  <span className={isSelected ? 'font-medium text-primary' : ''}>
                    {option.label}
                  </span>
                  {isSelected && <Check className="w-5 h-5 text-primary" />}
                </button>
              );
            })}
            
            <div className="border-t pt-2 mt-2">
              <button
                className="flex items-center justify-between w-full py-3 px-4 hover:bg-muted rounded-lg transition-colors"
                onClick={() => setShowCalendar(true)}
              >
                <span>Choose a date...</span>
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
