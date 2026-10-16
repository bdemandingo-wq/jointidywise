import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircleQuestion, X, Send, Bot, User, Loader2, ImagePlus, History, Plus, Trash2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { demoAwareFetch } from "@/lib/demo/edgeFetch";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/contexts/OrganizationContext";

type MsgContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
type Msg = { role: "user" | "assistant"; content: string; image_url?: string };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-help-chat`;

export default function AdminHelpChat() {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (open && textareaRef.current && view === "chat") {
      textareaRef.current.focus();
    }
  }, [open, view]);

  const loadConversations = useCallback(async () => {
    if (!organization?.id) return;
    setLoadingHistory(true);
    const { data } = await supabase
      .from("admin_chat_conversations")
      .select("id, title, created_at, updated_at")
      .eq("organization_id", organization.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    setConversations((data as Conversation[]) || []);
    setLoadingHistory(false);
  }, [organization?.id]);

  const loadConversation = async (convId: string) => {
    const { data } = await supabase
      .from("admin_chat_messages")
      .select("role, content, image_url")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    setMessages((data as Msg[]) || []);
    setActiveConversationId(convId);
    setView("chat");
  };

  const saveMessage = async (convId: string, msg: Msg) => {
    if (!organization?.id) return;
    await supabase.from("admin_chat_messages").insert({
      conversation_id: convId,
      organization_id: organization.id,
      role: msg.role,
      content: msg.content,
      image_url: msg.image_url || null,
    });
  };

  const createConversation = async (firstMsg: string): Promise<string | null> => {
    if (!organization?.id || !user?.id) return null;
    const title = firstMsg.slice(0, 60) || "New Chat";
    const { data, error } = await supabase
      .from("admin_chat_conversations")
      .insert({ organization_id: organization.id, user_id: user.id, title })
      .select("id")
      .single();
    if (error || !data) return null;
    return data.id;
  };

  const updateConversationTitle = async (convId: string, title: string) => {
    await supabase
      .from("admin_chat_conversations")
      .update({ title: title.slice(0, 60) })
      .eq("id", convId);
  };

  const deleteConversation = async (convId: string) => {
    await supabase.from("admin_chat_conversations").delete().eq("id", convId);
    if (activeConversationId === convId) {
      setActiveConversationId(null);
      setMessages([]);
    }
    setConversations((prev) => prev.filter((c) => c.id !== convId));
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setPendingImage(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && !pendingImage) || isLoading) return;

    const userMsg: Msg = { role: "user", content: text || "(image attached)", image_url: pendingImage || undefined };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const imageToSend = pendingImage;
    setPendingImage(null);
    setIsLoading(true);

    // Create or reuse conversation
    let convId = activeConversationId;
    if (!convId) {
      convId = await createConversation(text || "Image question");
      if (!convId) {
        toast({ title: "Error", description: "Failed to create conversation", variant: "destructive" });
        setIsLoading(false);
        return;
      }
      setActiveConversationId(convId);
    }

    // Save user message
    await saveMessage(convId, userMsg);

    // Build messages for API (multimodal support)
    const apiMessages = [...messages, userMsg].map((msg) => {
      if (msg.image_url) {
        const content: MsgContent = [];
        if (msg.content && msg.content !== "(image attached)") {
          content.push({ type: "text", text: msg.content });
        }
        content.push({ type: "image_url", image_url: { url: msg.image_url } });
        return { role: msg.role, content };
      }
      return { role: msg.role, content: msg.content };
    });

    let assistantSoFar = "";

    try {
      const resp = await demoAwareFetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${resp.status})`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      };

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch { /* ignore */ }
        }
      }

      // Save assistant message
      if (assistantSoFar) {
        await saveMessage(convId, { role: "assistant", content: assistantSoFar });
        // Update conversation title with first user message if it's the first exchange
        if (messages.length === 0) {
          await updateConversationTitle(convId, text || "Image question");
        }
      }
    } catch (e: any) {
      console.error("Chat error:", e);
      toast({ title: "Chat Error", description: e.message || "Failed to get response", variant: "destructive" });
      if (!assistantSoFar) setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const startNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setView("chat");
  };

  const openHistory = () => {
    loadConversations();
    setView("history");
  };

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 md:bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:scale-105"
          aria-label="Open help chat"
        >
          <MessageCircleQuestion className="h-6 w-6" />
        </button>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 md:bottom-6 right-6 z-50 flex w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-2xl border bg-background shadow-2xl" style={{ height: "min(600px, calc(100vh - 6rem))" }}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            {view === "history" && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setView("chat")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold">{view === "history" ? "Chat History" : "TidyWise Help"}</h3>
              <p className="text-xs text-muted-foreground truncate">
                {view === "history" ? "Previous conversations" : "Ask anything • Attach photos"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {view === "chat" && (
                <>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={startNewChat} title="New chat">
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openHistory} title="Chat history">
                    <History className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* History View */}
          {view === "history" && (
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No previous conversations</p>
              ) : (
                <div className="space-y-1">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-muted/80 transition-colors group ${activeConversationId === conv.id ? "bg-muted" : ""}`}
                      onClick={() => loadConversation(conv.id)}
                    >
                      <MessageCircleQuestion className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{conv.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {/* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant, not a business-day boundary */}
                          {new Date(conv.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat View */}
          {view === "chat" && (
            <>
              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground max-w-[260px]">
                      Hi! I know everything about TidyWise. Ask me anything or send a photo for me to analyze.
                    </p>
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.role === "assistant" && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={`max-w-[80%] space-y-2`}>
                      {msg.image_url && (
                        <img
                          src={msg.image_url}
                          alt="Uploaded"
                          className={`max-w-full max-h-48 rounded-xl object-cover ${msg.role === "user" ? "ml-auto" : ""}`}
                          loading="lazy"
                        />
                      )}
                      {msg.content && msg.content !== "(image attached)" && (
                        <div
                          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : "bg-muted rounded-bl-md"
                          }`}
                        >
                          {msg.content}
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
                        <User className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>

              {/* Pending image preview */}
              {pendingImage && (
                <div className="px-4 pb-1">
                  <div className="relative inline-block">
                    <img src={pendingImage} alt="Pending" className="h-16 rounded-lg object-cover border" height={64} />
                    <button
                      onClick={() => setPendingImage(null)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-xs"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              {/* Input */}
              <div className="border-t px-3 py-3">
                <div className="flex items-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    title="Attach image"
                  >
                    <ImagePlus className="h-4 w-4" />
                  </Button>
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question..."
                    className="min-h-[40px] max-h-[100px] resize-none rounded-xl text-sm"
                    rows={1}
                    disabled={isLoading}
                  />
                  <Button
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-xl"
                    onClick={send}
                    disabled={(!input.trim() && !pendingImage) || isLoading}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
