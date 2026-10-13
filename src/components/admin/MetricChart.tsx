import { lazy, Suspense, useMemo } from 'react';
import { fmt } from '@/lib/activeCurrency';

const MetricChartPlot = lazy(() => import('./MetricChartPlot').then((m) => ({ default: m.MetricChartPlot })));

interface DataPoint {
  date: string;
  value: number;
}

interface MetricChartProps {
  title: string;
  value: string | number;
  data: DataPoint[];
  dateRange: string;
  isCurrency?: boolean;
  color?: string;
}

export function MetricChart({ 
  title, 
  value, 
  data, 
  dateRange,
  isCurrency = false,
  color = 'hsl(var(--primary))'
}: MetricChartProps) {
  const maxValue = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map(d => d.value));
  }, [data]);

  const maxPoint = useMemo(() => {
    if (data.length === 0) return null;
    const max = data.reduce((prev, curr) => curr.value > prev.value ? curr : prev, data[0]);
    const index = data.findIndex(d => d.date === max.date);
    return { ...max, index };
  }, [data]);

  const formatValue = (val: number) => {
    if (isCurrency) {
      if (val >= 1000) {
        return `${fmt((val / 1000))}K`;
      }
      return `${fmt(val)}`;
    }
    return val.toString();
  };

  return (
    <div className="min-w-0 overflow-hidden border-t border-border py-5">
      <h4 className="truncate text-sm text-muted-foreground font-medium">{title}</h4>
      <p className="mt-1 truncate text-2xl font-bold text-primary md:text-3xl">
        {typeof value === 'number' && isCurrency ? formatValue(value) : value}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{dateRange}</p>
      
      <div className="relative mt-4 h-36 min-w-0 overflow-hidden rounded-lg border border-border/60">
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/40" />}>
          <MetricChartPlot
            data={data}
            maxValue={maxValue}
            color={color}
            isCurrency={isCurrency}
            title={title}
          />
        </Suspense>
        
        {/* Max value label */}
        {maxPoint && maxPoint.value > 0 && (
          <div 
            className="absolute bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded"
            style={{
              left: `clamp(2.5rem, ${(maxPoint.index / Math.max(data.length - 1, 1)) * 100}%, calc(100% - 2.5rem))`,
              top: '0.5rem',
              transform: 'translateX(-50%)',
            }}
          >
            {isCurrency ? formatValue(maxPoint.value) : maxPoint.value}
          </div>
        )}
        
        {/* Min value label */}
        {data.length > 0 && (
          <div 
            className="absolute bg-primary/80 text-primary-foreground text-xs px-2 py-0.5 rounded"
            style={{
              left: '0.5rem',
              bottom: '0.5rem',
            }}
          >
            {isCurrency ? '$0.00' : '0'}
          </div>
        )}
      </div>
    </div>
  );
}
