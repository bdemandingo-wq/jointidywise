import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { fmt } from '@/lib/activeCurrency';

interface DataPoint {
  date: string;
  value: number;
}

export function MetricChartPlot({
  data,
  maxValue,
  color,
  isCurrency,
  title,
}: {
  data: DataPoint[];
  maxValue: number;
  color: string;
  isCurrency: boolean;
  title: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 26, right: 14, left: 14, bottom: 10 }}>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={[0, maxValue * 1.2]} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
          }}
          labelFormatter={(label) => {
            try {
              return format(parseISO(String(label)), 'MMM d, yyyy');
            } catch {
              return String(label);
            }
          }}
          formatter={(val: number) => [isCurrency ? `${fmt(val)}` : val, title]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: color }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
