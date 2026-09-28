import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { SchedulerCalendar } from '@/components/admin/SchedulerCalendar';
import { useStaff, useBookings } from '@/hooks/useBookings';
import { Button } from '@/components/ui/button';
import { Filter, Download, Loader2, Users, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { saveBlob } from '@/lib/fileActions';
import { matrixToCsv } from '@/lib/orgDataExport';
import { format } from 'date-fns';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { formatInTimezone, formatTimestampWithZone } from '@/lib/timezoneUtils';
import { useTestMode } from '@/contexts/TestModeContext';
import { SEOHead } from '@/components/SEOHead';

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

const filterLabels: Record<StatusFilter, string> = {
  all: 'All Bookings',
  pending: 'Pending',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function SchedulerPage() {
  const { data: staff = [] } = useStaff();
  const { data: bookings = [] } = useBookings();
  const { timezone: orgTz } = useOrgTimezone();
  const [exporting, setExporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [staffFilter, setStaffFilter] = useState<string | null>(null);
  const { maskName } = useTestMode();

  const getExportRows = () => {
    const headers = ['Booking #', 'Customer', 'Service', 'Date', 'Time', 'Staff', 'Status', 'Amount'];
    const rows = bookings.map(b => [
      String(b.booking_number),
      b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
      b.service?.name || (b.total_amount === 0 ? 'Re-clean' : 'Service'),
      formatInTimezone(b.scheduled_at, orgTz, { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2'),
      formatInTimezone(b.scheduled_at, orgTz, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }),
      b.staff?.name || 'Unassigned',
      b.status,
      `$${b.total_amount}`
    ]);
    return { headers, rows };
  };

  const handleExport = async (type: 'csv' | 'json' | 'xlsx' | 'pdf' | 'print') => {
    setExporting(true);
    try {
      const { headers, rows } = getExportRows();
      /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
      const filename = `bookings-${format(new Date(), 'yyyy-MM-dd')}`;

      if (type === 'csv') {
        // Quoted every cell but never doubled inner quotes, so any " ended its
        // field early and shifted the rest of the row.
        const csvContent = matrixToCsv([headers, ...rows]);
        const blob = new Blob([csvContent], { type: 'text/csv' });
        await saveBlob(blob, `${filename}.csv`);
      } else if (type === 'json') {
        const blob = new Blob([JSON.stringify(bookings, null, 2)], { type: 'application/json' });
        await saveBlob(blob, `${filename}.json`);
      } else if (type === 'xlsx') {
        // xlsx (SheetJS) is write-only here. The outstanding CVEs
        // (GHSA-4r6h-8v6p-xvw6 prototype pollution, GHSA-5pgg-2g8v-p4x9
        // ReDoS) only trigger on XLSX.read() of attacker-controlled input.
        // We only call writeFile() with server-constructed data, so the
        // audit warnings do not apply to this usage. See PR discussion.
        const XLSX = await import('xlsx');
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = headers.map(() => ({ wch: 18 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
        // writeFile() performs its own browser download, which is a no-op in
        // WKWebView — write to an array and hand the blob to saveBlob instead.
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([out], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        await saveBlob(blob, `${filename}.xlsx`);
      } else if (type === 'pdf' || (type === 'print' && Capacitor.isNativePlatform())) {
        // Native has no print dialog — export the PDF to the iOS share sheet,
        // which offers Print (AirPrint) alongside Save to Files.
        const { default: jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        const doc = new jsPDF({ orientation: 'landscape' });
        doc.setFontSize(18);
        doc.setTextColor(40, 40, 40);
        doc.text('TidyWise: Bookings Report', 14, 18);
        doc.setFontSize(10);
        doc.setTextColor(120, 120, 120);
        doc.text(`Generated ${formatTimestampWithZone(new Date(), orgTz)}  •  ${bookings.length} bookings`, 14, 26);
        autoTable(doc, {
          head: [headers],
          body: rows,
          startY: 32,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [245, 247, 250] },
          margin: { left: 14, right: 14 },
        });
        // doc.save() is also an anchor download under the hood.
        await saveBlob(doc.output('blob') as Blob, `${filename}.pdf`);
      } else if (type === 'print') {
        const printWin = window.open('', '_blank');
        if (!printWin) { toast.error('Popup blocked. Please allow popups.'); return; }
        const escHtml = (s: unknown) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const tableRows = rows.map(r => `<tr>${r.map(c => `<td style="padding:6px 10px;border:1px solid #ddd;font-size:13px">${escHtml(c)}</td>`).join('')}</tr>`).join('');
        printWin.document.write(`<!DOCTYPE html><html><head><title>Bookings</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th{background:#2563eb;color:#fff;padding:8px 10px;font-size:13px;text-align:left}h1{font-size:20px;margin-bottom:4px}p{color:#888;font-size:13px;margin-bottom:16px}@media print{body{margin:0}}</style></head><body><h1>TidyWise: Bookings Report</h1><p>Generated ${formatTimestampWithZone(new Date(), orgTz)} • ${bookings.length} bookings</p><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
        printWin.document.close();
        printWin.focus();
        printWin.print();
      }
      if (type !== 'print') toast.success('Export completed');
    } catch (error) {
      toast.error('Failed to export');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminLayout
      title="Scheduler"
      subtitle="Manage your bookings and appointments"
      actions={
        <div className="flex items-center gap-2">
      <SEOHead title="Scheduler | TidyWise" description="Schedule and assign cleaning jobs" noIndex />
          {/* Staff Filter Dropdown */}
          <Select
            value={staffFilter || 'all'}
            onValueChange={(v) => setStaffFilter(v === 'all' ? null : v)}
          >
            <SelectTrigger className="w-[140px] h-9 text-sm">
              <Users className="w-4 h-4 mr-1.5 shrink-0" />
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staff.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {maskName(s.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="w-4 h-4" />
                {filterLabels[statusFilter]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatusFilter('all')}>
                All Bookings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setStatusFilter('pending')}>
                Pending
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('confirmed')}>
                Confirmed
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('in_progress')}>
                In Progress
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('completed')}>
                Completed
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('cancelled')}>
                Cancelled
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={exporting}>
                {exporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <Download className="w-4 h-4 mr-2" /> Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('json')}>
                <Download className="w-4 h-4 mr-2" /> Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Export as Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('pdf')}>
                <FileText className="w-4 h-4 mr-2" /> Export as PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('print')}>
                <Printer className="w-4 h-4 mr-2" /> Print View
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    >
      <div className="portal-v2 portal-v2-scroll pv-compact">
        <SchedulerCalendar statusFilter={statusFilter} staffFilter={staffFilter} />
      </div>
    </AdminLayout>
  );
}
