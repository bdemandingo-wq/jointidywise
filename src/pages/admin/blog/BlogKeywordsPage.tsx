import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Plus, Trash2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { QueryError } from "@/components/QueryError";
import { confirmDialog } from "@/components/AppDialogs";

type Status = "all" | "queued" | "in_progress" | "completed" | "failed";
type Intent = "top_funnel" | "middle_funnel" | "bottom_funnel" | "";

interface KeywordRow {
  id: string;
  keyword: string;
  intent: string | null;
  priority: number;
  search_volume: string | null;
  opportunity: string | null;
  status: string;
  attempts: number;
  error_message: string | null;
  generated_post_id: string | null;
  created_at: string;
}

const statusVariant: Record<string, string> = {
  queued: "bg-info/10 text-info",
  in_progress: "bg-warning/10 text-warning",
  completed: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
};

// Same threshold as generate-daily-blogs and the badge on /admin/blog.
const LOW_QUEUE_THRESHOLD = 7;

const opportunityVariant: Record<string, string> = {
  High: "bg-success/10 text-success",
  Medium: "bg-warning/10 text-warning",
  Low: "bg-muted text-muted-foreground",
};

export default function BlogKeywordsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<Status>("all");
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkIntent, setBulkIntent] = useState<Intent>("middle_funnel");
  const [bulkPriority, setBulkPriority] = useState(5);
  const [editing, setEditing] = useState<KeywordRow | null>(null);

  const { data: queuedTotal, error: queuedTotalError } = useQuery({
    queryKey: ["blog-keywords", "queued-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("blog_keyword_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: rows = [], isLoading, error: rowsError } = useQuery({
    queryKey: ["blog-keywords", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("blog_keyword_queue")
        .select("*")
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as KeywordRow[];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter((r) => r.keyword.toLowerCase().includes(s));
  }, [rows, search]);

  const counts = useMemo(() => {
    const c = { queued: 0, in_progress: 0, completed: 0, failed: 0 };
    rows.forEach((r) => {
      if (r.status in c) c[r.status as keyof typeof c]++;
    });
    return c;
  }, [rows]);

  const bulkInsert = useMutation({
    mutationFn: async () => {
      const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) throw new Error("Add at least one keyword");
      const inserts = lines.map((keyword) => ({
        keyword,
        intent: bulkIntent || null,
        priority: bulkPriority,
        status: "queued",
      }));
      const { error } = await supabase.from("blog_keyword_queue").insert(inserts);
      if (error) throw error;
      return lines.length;
    },
    onSuccess: (n) => {
      toast.success(`Added ${n} keyword${n === 1 ? "" : "s"}`);
      setBulkOpen(false);
      setBulkText("");
      qc.invalidateQueries({ queryKey: ["blog-keywords"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-queued-keywords"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateRow = useMutation({
    mutationFn: async (row: KeywordRow) => {
      const { error } = await supabase
        .from("blog_keyword_queue")
        .update({
          keyword: row.keyword,
          intent: row.intent,
          priority: row.priority,
          search_volume: row.search_volume,
          opportunity: row.opportunity,
          status: row.status,
        })
        .eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["blog-keywords"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-queued-keywords"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteRow = useMutation({
    mutationFn: async (id: string) => {
      if (!(await confirmDialog("Delete this keyword?"))) throw new Error("Cancelled");
      const { error } = await supabase.from("blog_keyword_queue").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["blog-keywords"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-queued-keywords"] });
    },
    onError: (e: Error) => { if (e.message !== "Cancelled") toast.error(e.message); },
  });

  const requeueFailed = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("blog_keyword_queue")
        .update({ status: "queued", error_message: null, attempts: 0 })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Re-queued");
      qc.invalidateQueries({ queryKey: ["blog-keywords"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-queued-keywords"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (rowsError || queuedTotalError) return <QueryError subject="keyword queue" />;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin/blog"><ArrowLeft className="h-4 w-4 mr-2" />Back to Blog</Link>
          </Button>
        </div>

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Keyword Queue</h1>
            <p className="text-sm text-muted-foreground">
              {counts.queued} queued · {counts.in_progress} in progress · {counts.completed} completed · {counts.failed} failed
            </p>
            {queuedTotal != null && queuedTotal < LOW_QUEUE_THRESHOLD && (
              <p className="text-sm text-destructive mt-1">
                Keyword queue is low ({queuedTotal} queued). The daily publisher needs at least {LOW_QUEUE_THRESHOLD} keywords or it runs dry within a week.
              </p>
            )}
          </div>
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Bulk Add</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Add keywords</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Textarea
                  placeholder="One keyword per line..."
                  rows={8}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Intent</label>
                    <Select value={bulkIntent} onValueChange={(v: Intent) => setBulkIntent(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bottom_funnel">Bottom funnel</SelectItem>
                        <SelectItem value="middle_funnel">Middle funnel</SelectItem>
                        <SelectItem value="top_funnel">Top funnel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Priority (1-10)</label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={bulkPriority}
                      onChange={(e) => setBulkPriority(Number(e.target.value) || 5)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
                <Button onClick={() => bulkInsert.mutate()} disabled={bulkInsert.isPending}>
                  {bulkInsert.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add to queue
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="p-4 mb-4">
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search keywords..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select value={statusFilter} onValueChange={(v: Status) => setStatusFilter(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No keywords yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="text-left p-3 font-medium">Keyword</th>
                    <th className="text-left p-3 font-medium">Intent</th>
                    <th className="text-left p-3 font-medium">Priority</th>
                    <th className="text-left p-3 font-medium">Volume</th>
                    <th className="text-left p-3 font-medium">Opp</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-border hover:bg-muted/20">
                      <td className="p-3">
                        <div className="font-medium text-foreground line-clamp-2 max-w-md">{r.keyword}</div>
                        {r.error_message && (
                          <div className="text-xs text-destructive mt-1 line-clamp-1">{r.error_message}</div>
                        )}
                        {r.generated_post_id && (
                          <Link
                            to={`/admin/blog/${r.generated_post_id}/edit`}
                            className="text-xs text-primary hover:underline"
                          >
                            View generated post →
                          </Link>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{r.intent?.replace("_", " ") || "—"}</td>
                      <td className="p-3 text-muted-foreground">{r.priority}</td>
                      <td className="p-3 text-muted-foreground">{r.search_volume || "—"}</td>
                      <td className="p-3">
                        {r.opportunity ? (
                          <span className={`px-2 py-0.5 rounded text-xs ${opportunityVariant[r.opportunity] || ""}`}>
                            {r.opportunity}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${statusVariant[r.status] || ""}`}>
                          {r.status.replace("_", " ")}
                        </span>
                        {r.attempts > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">({r.attempts}x)</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex gap-1">
                          {r.status === "failed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => requeueFailed.mutate(r.id)}
                              title="Re-queue"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => setEditing(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteRow.mutate(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {editing && (
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Edit keyword</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Keyword</label>
                  <Input value={editing.keyword} onChange={(e) => setEditing({ ...editing, keyword: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Intent</label>
                    <Select value={editing.intent || ""} onValueChange={(v) => setEditing({ ...editing, intent: v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bottom_funnel">Bottom funnel</SelectItem>
                        <SelectItem value="middle_funnel">Middle funnel</SelectItem>
                        <SelectItem value="top_funnel">Top funnel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={editing.priority}
                      onChange={(e) => setEditing({ ...editing, priority: Number(e.target.value) || 5 })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Search volume</label>
                    <Input
                      value={editing.search_volume || ""}
                      onChange={(e) => setEditing({ ...editing, search_volume: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Opportunity</label>
                    <Select
                      value={editing.opportunity || ""}
                      onValueChange={(v) => setEditing({ ...editing, opportunity: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="Low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                  <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="queued">Queued</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={() => updateRow.mutate(editing)} disabled={updateRow.isPending}>
                  {updateRow.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
