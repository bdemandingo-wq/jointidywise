import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Sparkles, Pencil, Eye, Trash2, CheckCircle2, Archive, ListChecks } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { BlogStatusBadge } from "@/components/admin/blog/StatusBadge";
import { cn } from "@/lib/utils";
import { QueryError } from "@/components/QueryError";
import { confirmDialog } from "@/components/AppDialogs";

type Status = "draft" | "review" | "published" | "archived" | "all";

function qualityClass(score: number | null | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600 font-semibold";
  if (score >= 60) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

export default function BlogAdminListPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialStatus = (searchParams.get("status") as Status) || "draft";
  const [statusFilter, setStatusFilter] = useState<Status>(initialStatus);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (statusFilter === "all") next.delete("status");
      else next.set("status", statusFilter);
      return next;
    }, { replace: true });
    setSelected(new Set());
  }, [statusFilter, setSearchParams]);

  // Counts for tab badges (one query, all statuses)
  const { data: counts, error: countsError } = useQuery({
    queryKey: ["admin-blog-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("status")
        .limit(2000);
      if (error) throw error;
      const map: Record<string, number> = { draft: 0, review: 0, published: 0, archived: 0 };
      (data || []).forEach((r) => { if (r.status && map[r.status] != null) map[r.status]++; });
      return map;
    },
    refetchInterval: 30000,
  });

  const { data: posts = [], isLoading, error: postsError } = useQuery({
    queryKey: ["admin-blog-posts", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("blog_posts")
        .select("id, title, slug, status, target_keyword, word_count, author, created_at, published_at, category, quality_score")
        .order("created_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return posts;
    const s = search.toLowerCase();
    return posts.filter(
      (p) => p.title?.toLowerCase().includes(s) || p.slug?.toLowerCase().includes(s) || p.target_keyword?.toLowerCase().includes(s)
    );
  }, [posts, search]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const bulkUpdate = useMutation({
    mutationFn: async (newStatus: "published" | "archived") => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      const patch: Record<string, unknown> = { status: newStatus };
      if (newStatus === "published") {
        patch.is_published = true;
        patch.approved_at = new Date().toISOString();
      } else {
        patch.is_published = false;
      }
      const { error } = await supabase.from("blog_posts").update(patch).in("id", ids);
      if (error) throw error;
      if (newStatus === "published") {
        const toCache = posts.filter((p) => ids.includes(p.id));
        await Promise.all(
          toCache.map((p) => supabase.functions.invoke("recache-blog-post", { body: { slug: p.slug } }))
        );
      }
    },
    onSuccess: (_d, status) => {
      toast.success(`${selected.size} post(s) ${status === "published" ? "published" : "archived"}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-counts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      if (!(await confirmDialog(`Permanently delete ${ids.length} post(s)? This cannot be undone.`))) {
        throw new Error("Cancelled");
      }
      const { error } = await supabase.from("blog_posts").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["admin-blog-posts"] });
      qc.invalidateQueries({ queryKey: ["admin-blog-counts"] });
    },
    onError: (e: Error) => { if (e.message !== "Cancelled") toast.error(e.message); },
  });

  if (countsError || postsError) return <QueryError subject="blog posts" />;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Blog Admin</h1>
            <p className="text-sm text-muted-foreground">Manage TIDYWISE marketing blog posts</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button asChild variant="outline">
              <Link to="/admin/blog/keywords"><ListChecks className="h-4 w-4 mr-2" />Keywords Queue</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/admin/blog/generate"><Sparkles className="h-4 w-4 mr-2" />Bulk Generate</Link>
            </Button>
            <Button asChild>
              <Link to="/admin/blog/new"><Plus className="h-4 w-4 mr-2" />New Post</Link>
            </Button>
          </div>
        </div>

        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as Status)} className="mb-4">
          <TabsList>
            <TabsTrigger value="draft">Drafts ({counts?.draft ?? 0})</TabsTrigger>
            <TabsTrigger value="published">Published ({counts?.published ?? 0})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({counts?.archived ?? 0})</TabsTrigger>
            <TabsTrigger value="review">In Review ({counts?.review ?? 0})</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>

        <Card className="p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Search by title, slug, or keyword…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            {selected.size > 0 && (
              <div className="flex gap-2 ml-auto flex-wrap">
                <span className="text-sm text-muted-foreground self-center">{selected.size} selected</span>
                <Button size="sm" variant="outline" onClick={() => bulkUpdate.mutate("published")} disabled={bulkUpdate.isPending}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />Approve & Publish
                </Button>
                <Button size="sm" variant="outline" onClick={() => bulkUpdate.mutate("archived")} disabled={bulkUpdate.isPending}>
                  <Archive className="h-4 w-4 mr-2" />Archive
                </Button>
                <Button size="sm" variant="destructive" onClick={() => bulkDelete.mutate()} disabled={bulkDelete.isPending}>
                  <Trash2 className="h-4 w-4 mr-2" />Delete
                </Button>
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No posts found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b border-border">
                  <tr>
                    <th className="p-3 w-10"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                    <th className="text-left p-3 font-medium">Title</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Quality</th>
                    <th className="text-left p-3 font-medium">Keyword</th>
                    <th className="text-left p-3 font-medium">Words</th>
                    <th className="text-left p-3 font-medium">Created</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-b border-border hover:bg-muted/20">
                      <td className="p-3"><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} /></td>
                      <td className="p-3">
                        <div className="font-medium text-foreground line-clamp-1 max-w-md">{p.title}</div>
                        <div className="text-xs text-muted-foreground">/{p.slug}</div>
                      </td>
                      <td className="p-3"><BlogStatusBadge status={p.status} /></td>
                      <td className={cn("p-3", qualityClass(p.quality_score))}>
                        {p.quality_score != null ? `${p.quality_score}/100` : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{p.target_keyword || "—"}</td>
                      <td className="p-3 text-muted-foreground">{p.word_count?.toLocaleString() || "—"}</td>
                      <td className="p-3 text-muted-foreground">{p.created_at ? format(new Date(p.created_at), "MMM d, yyyy") : "—"}</td>
                      <td className="p-3 text-right">
                        <div className="inline-flex gap-1">
                          <Button asChild variant="ghost" size="icon"><Link to={`/admin/blog/${p.id}/preview`}><Eye className="h-4 w-4" /></Link></Button>
                          <Button asChild variant="ghost" size="icon"><Link to={`/admin/blog/${p.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
