import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/lib/supabase';
import { Search, FileDown, Loader2, Clock, CalendarDays, Activity, Timer, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatTimestampWithZone } from '@/lib/timezoneUtils';

// Nullable in the database. The interface claimed otherwise, which is why
// assigning a query result to it failed — the interface was the wrong half.
interface SessionRow {
  id: string;
  session_start: string;
  session_end: string | null;
  duration_seconds: number | null;
  is_active: boolean | null;
}

interface PageView {
  page_path: string;
  page_title: string | null;
  visited_at: string;
  session_id: string | null;
}

interface PageSummary {
  page_path: string;
  page_title: string;
  visit_count: number;
  first_visit: string;
  last_visit: string;
}

interface SessionReport {
  email: string;
  totalSessions: number;
  firstSession: string;
  lastSession: string;
  totalDurationSeconds: number;
  sessions: SessionRow[];
  pageViews: PageView[];
  pageSummary: PageSummary[];
}

// duration_seconds is nullable; a session still in progress has none.
function formatDuration(seconds: number | null): string {
  // `!seconds` already covered null before the type said so — widening the
  // parameter changes nothing at runtime, which is the point.
  if (!seconds || seconds <= 0) return '< 1m';
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${mins}m`;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function UserSessionEvidence() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      toast.error('Please enter an email address');
      return;
    }

    setLoading(true);
    setSearched(true);
    setReport(null);

    try {
      // Fetch sessions and page views in parallel
      const [sessionsRes, pageViewsRes] = await Promise.all([
        supabase
          .from('user_sessions')
          .select('id, session_start, session_end, duration_seconds, is_active')
          .eq('user_email', trimmed)
          .order('session_start', { ascending: false }),
        supabase
          .from('user_page_views')
          .select('page_path, page_title, visited_at, session_id')
          .eq('user_email', trimmed)
          .order('visited_at', { ascending: false })
          .limit(5000),
      ]);

      if (sessionsRes.error) throw sessionsRes.error;

      const sessions: SessionRow[] = sessionsRes.data || [];
      const pageViews: PageView[] = pageViewsRes.data || [];

      if (sessions.length === 0) {
        setReport(null);
        return;
      }

      const totalDuration = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
      const sorted = [...sessions].sort((a, b) => new Date(a.session_start).getTime() - new Date(b.session_start).getTime());

      // Build page summary
      const pageMap = new Map<string, PageSummary>();
      for (const pv of pageViews) {
        const key = pv.page_path;
        const existing = pageMap.get(key);
        if (existing) {
          existing.visit_count++;
          if (pv.visited_at < existing.first_visit) existing.first_visit = pv.visited_at;
          if (pv.visited_at > existing.last_visit) existing.last_visit = pv.visited_at;
        } else {
          pageMap.set(key, {
            page_path: pv.page_path,
            page_title: pv.page_title || pv.page_path,
            visit_count: 1,
            first_visit: pv.visited_at,
            last_visit: pv.visited_at,
          });
        }
      }
      const pageSummary = Array.from(pageMap.values()).sort((a, b) => b.visit_count - a.visit_count);

      setReport({
        email: trimmed,
        totalSessions: sessions.length,
        firstSession: sorted[0].session_start,
        lastSession: sorted[sorted.length - 1].session_start,
        totalDurationSeconds: totalDuration,
        sessions,
        pageViews,
        pageSummary,
      });
    } catch (err: any) {
      toast.error('Failed to fetch session data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!report) return;

    const { default: jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;

    const doc = new jsPDF({ orientation: 'landscape' });
    const now = formatTimestampWithZone(new Date(), 'America/New_York');

    // Header
    doc.setFontSize(18);
    doc.text('TidyWise Usage Report', 14, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated ${now}. For dispute reference.`, 14, 28);
    doc.text(`User: ${report.email}`, 14, 34);

    // Summary
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Summary', 14, 46);

    autoTable(doc, {
      startY: 50,
      head: [['Metric', 'Value']],
      body: [
        ['Total Sessions', String(report.totalSessions)],
        ['First Session', formatTimestampWithZone(report.firstSession, 'America/New_York')],
        ['Last Session', formatTimestampWithZone(report.lastSession, 'America/New_York')],
        ['Total Time in Platform', formatDuration(report.totalDurationSeconds)],
        ['Unique Pages Accessed', String(report.pageSummary.length)],
        ['Total Page Views', String(report.pageViews.length)],
      ],
      theme: 'grid',
      headStyles: { fillColor: [30, 30, 30] },
      margin: { left: 14 },
    });

    // Features / Pages Accessed
    let finalY = (doc as any).lastAutoTable?.finalY || 100;
    doc.setFontSize(12);
    doc.text('Features & Pages Accessed', 14, finalY + 12);

    if (report.pageSummary.length > 0) {
      autoTable(doc, {
        startY: finalY + 16,
        head: [['Page / Feature', 'Path', 'Times Visited', 'First Visit', 'Last Visit']],
        body: report.pageSummary.map((p) => [
          p.page_title,
          p.page_path,
          String(p.visit_count),
          formatTimestampWithZone(p.first_visit, 'America/New_York'),
          formatTimestampWithZone(p.last_visit, 'America/New_York'),
        ]),
        theme: 'grid',
        headStyles: { fillColor: [30, 30, 30] },
        margin: { left: 14 },
        styles: { fontSize: 9 },
      });
    } else {
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text('No page view data recorded yet (tracking started recently).', 14, finalY + 18);
    }

    // Session details
    finalY = (doc as any).lastAutoTable?.finalY || finalY + 30;
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Session Log', 14, finalY + 12);

    autoTable(doc, {
      startY: finalY + 16,
      head: [['#', 'Date', 'Start Time', 'End Time', 'Duration', 'Status']],
      body: report.sessions.map((s, i) => [
        String(i + 1),
        format(new Date(s.session_start), 'MMM d, yyyy'),
        formatTimestampWithZone(s.session_start, 'America/New_York'),
        s.session_end ? formatTimestampWithZone(s.session_end, 'America/New_York') : '—',
        formatDuration(s.duration_seconds),
        s.is_active ? 'Active' : 'Ended',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [30, 30, 30] },
      margin: { left: 14 },
      styles: { fontSize: 9 },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `TidyWise Usage Report, ${report.email}, Page ${i} of ${pageCount}`,
        14,
        doc.internal.pageSize.height - 10
      );
    }

    /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
    const fileName = `TidyWise_Usage_Report_${report.email.replace(/[^a-z0-9]/gi, '_')}_${format(new Date(), 'yyyy-MM-dd')}.pdf`;
    doc.save(fileName);
    toast.success('PDF exported');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          User Session Evidence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Search by email to view session history and pages accessed. Export as PDF for dispute reference.
        </p>

        {/* Search */}
        <div className="flex gap-2">
          <Input
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="max-w-sm"
          />
          <Button onClick={handleSearch} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">Search</span>
          </Button>
        </div>

        {/* No results */}
        {searched && !loading && !report && (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>No session data found for this email</p>
          </div>
        )}

        {/* Results */}
        {report && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Activity className="h-3.5 w-3.5" />
                  Total Sessions
                </div>
                <p className="text-xl font-bold">{report.totalSessions}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  First Session
                </div>
                <p className="text-sm font-semibold">{format(new Date(report.firstSession), 'MMM d, yyyy')}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Clock className="h-3.5 w-3.5" />
                  Last Session
                </div>
                <p className="text-sm font-semibold">{format(new Date(report.lastSession), 'MMM d, yyyy')}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Timer className="h-3.5 w-3.5" />
                  Total Time
                </div>
                <p className="text-xl font-bold">{formatDuration(report.totalDurationSeconds)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Globe className="h-3.5 w-3.5" />
                  Pages Accessed
                </div>
                <p className="text-xl font-bold">{report.pageSummary.length}</p>
              </div>
            </div>

            {/* Export button */}
            <Button variant="outline" onClick={handleExportPDF} className="gap-2">
              <FileDown className="h-4 w-4" />
              Export as PDF
            </Button>

            {/* Pages accessed */}
            {report.pageSummary.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-2">Features & Pages Accessed ({report.pageSummary.length})</h4>
                <ScrollArea className="h-[200px] rounded-md border">
                  <div className="divide-y">
                    {report.pageSummary.map((p) => (
                      <div key={p.page_path} className="flex items-center justify-between p-3 text-sm">
                        <div>
                          <p className="font-medium">{p.page_title}</p>
                          <p className="text-xs text-muted-foreground">{p.page_path}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">{p.visit_count}x</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Session list */}
            <div>
              <h4 className="text-sm font-medium mb-2">Session Log ({report.sessions.length})</h4>
              <ScrollArea className="h-[300px] rounded-md border">
                <div className="divide-y">
                  {report.sessions.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between p-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground text-xs w-6">{i + 1}</span>
                        <div>
                          <p className="font-medium">
                            {format(new Date(s.session_start), 'MMM d, yyyy')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTimestampWithZone(s.session_start, 'America/New_York')}
                            {s.session_end && ` to ${formatTimestampWithZone(s.session_end, 'America/New_York')}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{formatDuration(s.duration_seconds)}</span>
                        <Badge variant={s.is_active ? 'default' : 'secondary'} className="text-xs">
                          {s.is_active ? 'Active' : 'Ended'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
