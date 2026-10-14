import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useTestMode } from '@/contexts/TestModeContext';
import { fmt } from '@/lib/activeCurrency';

interface TodayStatsProps {
  grossVolume: number;
  payments: number;
  customers: number;
}

export function TodayStats({ grossVolume, payments, customers }: TodayStatsProps) {
  const [isPulsing, setIsPulsing] = useState(false);
  // #6 flicker fix: previous values live in a ref. The old version kept
  // them in state AND in the effect deps, so every pulse re-ran the
  // effect and — with realtime updates arriving after adding a client —
  // the card pulsed continuously until you left the page.
  const prevValuesRef = useRef({ grossVolume, payments, customers });
  const { isTestMode } = useTestMode();

  // Pulse once when a value actually changes
  useEffect(() => {
    const prev = prevValuesRef.current;
    if (
      prev.grossVolume !== grossVolume ||
      prev.payments !== payments ||
      prev.customers !== customers
    ) {
      prevValuesRef.current = { grossVolume, payments, customers };
      setIsPulsing(true);
      const timeout = setTimeout(() => setIsPulsing(false), 1000);
      return () => clearTimeout(timeout);
    }
  }, [grossVolume, payments, customers]);

  return (
    <div className="mb-5 min-w-0" data-tour-id="today-stats">
      <h2 className="text-lg font-semibold text-foreground mb-3">Today</h2>
      <div
        className={cn(
          "min-w-0 bg-card border border-border rounded-xl p-3 shadow-sm transition-all duration-300 md:p-4",
          isPulsing && "ring-2 ring-primary/50 animate-pulse"
        )}
      >
        <div className="grid min-w-0 grid-cols-3 divide-x divide-border">
          <div id="demo-revenue" data-tour-id="demo-revenue" className="min-w-0 text-center px-2 md:px-4">
            <p className="truncate text-xs text-muted-foreground mb-1 md:text-sm">Gross Volume</p>
            <p className={cn(
              "truncate text-base md:text-2xl font-bold transition-colors duration-300",
              isPulsing && "text-primary"
            )}>
              {isTestMode ? '$X,XXX.XX' : `${fmt(grossVolume)}`}
            </p>
          </div>
          <div className="min-w-0 text-center px-2 md:px-4">
            <p className="truncate text-xs text-muted-foreground mb-1 md:text-sm">Payments</p>
            <p className={cn(
              "truncate text-base md:text-2xl font-bold transition-colors duration-300",
              isPulsing && "text-primary"
            )}>
              {isTestMode ? 'XX' : payments}
            </p>
          </div>
          <div className="min-w-0 text-center px-2 md:px-4">
            <p className="truncate text-xs text-muted-foreground mb-1 md:text-sm">Customers</p>
            <p className={cn(
              "truncate text-base md:text-2xl font-bold transition-colors duration-300",
              isPulsing && "text-primary"
            )}>
              {isTestMode ? 'XX' : customers}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
