import { useState, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Image as ImageIcon,
  Link2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Reply,
  Send,
  Trash2,
  Upload,
  X,
  Bell,
  BellOff,
} from "lucide-react";
import { toast, Toaster } from "sonner";

const AUTHOR_TYPES = [
  { value: "project_lead", label: "Project Lead" },
  { value: "architectural", label: "Architectural" },
  { value: "structural", label: "Structural" },
  { value: "civil", label: "Civil" },
  { value: "mechanical", label: "Mechanical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "landscaping", label: "Landscaping" },
  { value: "other", label: "Other" },
] as const;

type AuthorType = typeof AUTHOR_TYPES[number]["value"];

const AUTHOR_TYPE_COLORS: Record<string, string> = {
  project_lead: "bg-indigo-100 text-indigo-700 border-indigo-200",
  architectural: "bg-blue-100 text-blue-700 border-blue-200",
  structural: "bg-orange-100 text-orange-700 border-orange-200",
  civil: "bg-green-100 text-green-700 border-green-200",
  mechanical: "bg-red-100 text-red-700 border-red-200",
  plumbing: "bg-cyan-100 text-cyan-700 border-cyan-200",
  landscaping: "bg-emerald-100 text-emerald-700 border-emerald-200",
  other: "bg-slate-100 text-slate-700 border-slate-200",
};

function getAuthorTypeLabel(type: string) {
  return AUTHOR_TYPES.find(t => t.value === type)?.label ?? type;
}

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateShort(date: string | Date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function CoordinationSheet() {
  const { token } = useParams<{ token: string }>();
  const [showAddressed, setShowAddressed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [filterDiscipline, setFilterDiscipline] = useState<string>("all");

  // Saved identity (persisted in localStorage)
  const [savedName, setSavedName] = useState(() => localStorage.getItem("coord_author_name") || "");
  const [savedType, setSavedType] = useState<AuthorType>(() => (localStorage.getItem("coord_author_type") as AuthorType) || "other");

  const { data, isLoading, refetch } = trpc.coordination.getByToken.useQuery(
    { token: token! },
    { enabled: !!token }
  );

  const addItem = trpc.coordination.addItem.useMutation({
    onSuccess: () => { refetch(); setNewItemOpen(false); setReplyingTo(null); toast.success("Item posted"); },
    onError: (e) => toast.error(e.message),
  });

  const updateItem = trpc.coordination.updateItem.useMutation({
    onSuccess: () => { refetch(); toast.success("Updated"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteItem = trpc.coordination.deleteItem.useMutation({
    onSuccess: () => { refetch(); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const uploadAttachment = trpc.coordination.uploadAttachment.useMutation({
    onSuccess: () => { refetch(); toast.success("Image uploaded"); },
    onError: (e) => toast.error(e.message),
  });

  const addLink = trpc.coordination.addLinkAttachment.useMutation({
    onSuccess: () => { refetch(); toast.success("Link added"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteAttachment = trpc.coordination.deleteAttachment.useMutation({
    onSuccess: () => { refetch(); toast.success("Attachment deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const subscribe = trpc.coordination.subscribe.useMutation({
    onSuccess: () => { refetch(); setSubscribeOpen(false); toast.success("Subscribed to notifications"); },
    onError: (e) => toast.error(e.message),
  });

  const unsubscribe = trpc.coordination.unsubscribe.useMutation({
    onSuccess: () => { refetch(); toast.success("Unsubscribed"); },
    onError: (e) => toast.error(e.message),
  });

  const toggleExpanded = (id: number) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Organize items into threads
  const { topLevelItems, repliesByParent, addressedItems } = useMemo(() => {
    if (!data?.items) return { topLevelItems: [], repliesByParent: new Map(), addressedItems: [] };
    const top: typeof data.items = [];
    const addressed: typeof data.items = [];
    const replies = new Map<number, typeof data.items>();

    for (const item of data.items) {
      if (item.parentId) {
        const existing = replies.get(item.parentId) ?? [];
        existing.push(item);
        replies.set(item.parentId, existing);
      } else if (item.isAddressed) {
        addressed.push(item);
      } else {
        top.push(item);
      }
    }
    // Sort: urgent first, then by date desc
    top.sort((a, b) => {
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    addressed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return { topLevelItems: top, repliesByParent: replies, addressedItems: addressed };
  }, [data?.items]);

  // Apply discipline filter
  const filteredTopItems = useMemo(() => {
    if (filterDiscipline === "all") return topLevelItems;
    return topLevelItems.filter(item => item.authorType === filterDiscipline);
  }, [topLevelItems, filterDiscipline]);

  const filteredAddressedItems = useMemo(() => {
    if (filterDiscipline === "all") return addressedItems;
    return addressedItems.filter(item => item.authorType === filterDiscipline);
  }, [addressedItems, filterDiscipline]);

  // Attachments grouped by item
  const attachmentsByItem = useMemo(() => {
    const map = new Map<number, typeof data.attachments>();
    if (!data?.attachments) return map;
    for (const att of data.attachments) {
      const existing = map.get(att.itemId) ?? [];
      existing.push(att);
      map.set(att.itemId, existing);
    }
    return map;
  }, [data?.attachments]);



  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (data?.error || !data?.sheet) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold mb-2">Sheet Not Found</h2>
            <p className="text-sm text-muted-foreground">{data?.error || "This coordination sheet is unavailable."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sheet = data.sheet;

  return (
    <div className="min-h-screen bg-slate-50">
      <Toaster position="top-center" />
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 truncate">{sheet.projectName}</h1>
              <p className="text-xs text-muted-foreground">Coordination Sheet</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Dialog open={subscribeOpen} onOpenChange={setSubscribeOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Bell className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Notify</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Email Notifications</DialogTitle>
                  </DialogHeader>
                  <SubscribeForm
                    token={token!}
                    subscribers={data.subscribers}
                    onSubscribe={(email, name) => subscribe.mutate({ token: token!, email, name })}
                    onUnsubscribe={(email) => unsubscribe.mutate({ token: token!, email })}
                    isPending={subscribe.isPending || unsubscribe.isPending}
                  />
                </DialogContent>
              </Dialog>
              <Button size="sm" className="gap-1.5" onClick={() => setNewItemOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Item</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-4 sm:py-6 space-y-2">
        {/* Identity banner */}
        {!savedName && (
          <Card className="border-blue-200 bg-blue-50/50 mb-4">
            <CardContent className="p-4">
              <p className="text-sm font-medium text-blue-900 mb-3">Set your identity to start posting:</p>
              <IdentityForm
                onSave={(name, type) => {
                  setSavedName(name);
                  setSavedType(type);
                  localStorage.setItem("coord_author_name", name);
                  localStorage.setItem("coord_author_type", type);
                }}
              />
            </CardContent>
          </Card>
        )}

        {savedName && (
          <div className="flex items-center gap-2 text-sm mb-4">
            <span className="text-muted-foreground">Posting as:</span>
            <Badge className={AUTHOR_TYPE_COLORS[savedType]}>{savedName}</Badge>
            <Badge variant="outline" className="text-[10px]">{getAuthorTypeLabel(savedType)}</Badge>
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline ml-auto"
              onClick={() => {
                setSavedName("");
                setSavedType("other");
                localStorage.removeItem("coord_author_name");
                localStorage.removeItem("coord_author_type");
              }}
            >
              Change
            </button>
          </div>
        )}

        {/* Discipline filter */}
        {(topLevelItems.length > 0 || addressedItems.length > 0) && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">Filter:</span>
            <Select value={filterDiscipline} onValueChange={setFilterDiscipline}>
              <SelectTrigger className="h-7 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Disciplines</SelectItem>
                {AUTHOR_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filterDiscipline !== "all" && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => setFilterDiscipline("all")}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Active items */}
        {topLevelItems.length === 0 && addressedItems.length === 0 && (
          <div className="text-center py-12">
            <MessageSquare className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <h3 className="text-base font-medium text-muted-foreground">No items yet</h3>
            <p className="text-sm text-muted-foreground mt-1">Post the first coordination item to get started.</p>
          </div>
        )}

        {filteredTopItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            replies={repliesByParent.get(item.id) ?? []}
            attachments={attachmentsByItem}
            token={token!}
            savedName={savedName}
            savedType={savedType}
            replyingTo={replyingTo}
            setReplyingTo={setReplyingTo}
            expanded={expandedItems.has(item.id)}
            onToggleExpand={() => toggleExpanded(item.id)}
            onAddItem={addItem}
            onUpdateItem={updateItem}
            onDeleteItem={deleteItem}
            onUploadAttachment={uploadAttachment}
            onAddLink={addLink}
            onDeleteAttachment={deleteAttachment}
          />
        ))}

        {/* Addressed (collapsed) */}
        {filteredAddressedItems.length > 0 && (
          <div className="pt-2">
            <button
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              onClick={() => setShowAddressed(v => !v)}
            >
              {showAddressed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Addressed ({filteredAddressedItems.length})
            </button>
            {showAddressed && (
              <div className="space-y-2 mt-2 opacity-70">
                {filteredAddressedItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    replies={repliesByParent.get(item.id) ?? []}
                    attachments={attachmentsByItem}
                    token={token!}
                    savedName={savedName}
                    savedType={savedType}
                    replyingTo={replyingTo}
                    setReplyingTo={setReplyingTo}
                    expanded={expandedItems.has(item.id)}
                    onToggleExpand={() => toggleExpanded(item.id)}
                    onAddItem={addItem}
                    onUpdateItem={updateItem}
                    onDeleteItem={deleteItem}
                    onUploadAttachment={uploadAttachment}
                    onAddLink={addLink}
                    onDeleteAttachment={deleteAttachment}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* New Item Dialog */}
      <Dialog open={newItemOpen} onOpenChange={setNewItemOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Coordination Item</DialogTitle>
          </DialogHeader>
          <NewItemForm
            token={token!}
            savedName={savedName}
            savedType={savedType}
            onSubmit={(data) => addItem.mutate(data)}
            isPending={addItem.isPending}
            onSaveIdentity={(name, type) => {
              setSavedName(name);
              setSavedType(type);
              localStorage.setItem("coord_author_name", name);
              localStorage.setItem("coord_author_type", type);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function IdentityForm({ onSave }: { onSave: (name: string, type: AuthorType) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AuthorType>("other");
  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <Input
        placeholder="Your name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1"
      />
      <Select value={type} onValueChange={(v) => setType(v as AuthorType)}>
        <SelectTrigger className="w-full sm:w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AUTHOR_TYPES.map(t => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!name.trim()} onClick={() => onSave(name.trim(), type)}>
        Set
      </Button>
    </div>
  );
}

function NewItemForm({
  token,
  savedName,
  savedType,
  onSubmit,
  isPending,
  onSaveIdentity,
  parentId,
}: {
  token: string;
  savedName: string;
  savedType: AuthorType;
  onSubmit: (data: any) => void;
  isPending: boolean;
  onSaveIdentity: (name: string, type: AuthorType) => void;
  parentId?: number;
}) {
  const [content, setContent] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [authorName, setAuthorName] = useState(savedName);
  const [authorType, setAuthorType] = useState<AuthorType>(savedType);

  const handleSubmit = () => {
    if (!content.trim() || !authorName.trim()) return;
    onSaveIdentity(authorName.trim(), authorType);
    onSubmit({
      token,
      parentId: parentId ?? null,
      authorName: authorName.trim(),
      authorType,
      content: content.trim(),
      isUrgent,
    });
    setContent("");
    setIsUrgent(false);
  };

  return (
    <div className="space-y-3">
      {!savedName && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Your Name</Label>
            <Input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <Label className="text-xs">Discipline</Label>
            <Select value={authorType} onValueChange={(v) => setAuthorType(v as AuthorType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AUTHOR_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <Textarea
        placeholder={parentId ? "Write a reply..." : "Describe the coordination item..."}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="resize-none"
      />
      <div className="flex items-center justify-between">
        {!parentId && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={isUrgent}
              onChange={(e) => setIsUrgent(e.target.checked)}
              className="rounded border-slate-300"
            />
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            Mark as urgent
          </label>
        )}
        <Button
          size="sm"
          disabled={!content.trim() || !authorName.trim() || isPending}
          onClick={handleSubmit}
          className="ml-auto gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          {isPending ? "Posting..." : "Post"}
        </Button>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────
// Get displayable image URL from attachment (supports DB-stored base64 and legacy filesystem URLs)
function getImageUrl(att: any): string {
  if (att.fileData && att.mimeType) return `data:${att.mimeType};base64,${att.fileData}`;
  return att.url; // fallback for legacy or link attachments
}

// ── Collapsible Item Row ──────────────────────────────────────────────

function ItemRow({
  item,
  replies,
  attachments,
  token,
  savedName,
  savedType,
  replyingTo,
  setReplyingTo,
  expanded,
  onToggleExpand,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onUploadAttachment,
  onAddLink,
}: {
  item: any;
  replies: any[];
  attachments: Map<number, any[]>;
  token: string;
  savedName: string;
  savedType: AuthorType;
  replyingTo: number | null;
  setReplyingTo: (id: number | null) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  onAddItem: any;
  onUpdateItem: any;
  onDeleteItem: any;
  onUploadAttachment: any;
  onAddLink: any;
  onDeleteAttachment: any;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(item.content);
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [editReplyContent, setEditReplyContent] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");
  const itemAttachments = attachments.get(item.id) ?? [];

  const handleSaveEdit = () => {
    if (!editContent.trim()) return;
    onUpdateItem.mutate(
      { token, itemId: item.id, content: editContent.trim() },
      { onSuccess: () => setEditing(false) }
    );
  };

  const handleSaveReplyEdit = (replyId: number) => {
    if (!editReplyContent.trim()) return;
    onUpdateItem.mutate(
      { token, itemId: replyId, content: editReplyContent.trim() },
      { onSuccess: () => setEditingReplyId(null) }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File must be under 10MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      onUploadAttachment.mutate({
        token,
        itemId: item.id,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleAddLink = () => {
    if (!linkUrl.trim()) return;
    onAddLink.mutate({ token, itemId: item.id, url: linkUrl.trim() });
    setLinkUrl("");
    setShowLinkInput(false);
  };

  // First line of content for collapsed preview
  const firstLine = item.content.split("\n")[0].slice(0, 120);
  const hasMore = item.content.length > 120 || item.content.includes("\n");

  return (
    <div
      className={`rounded-xl border transition-all ${
        item.isUrgent
          ? "border-amber-300 bg-amber-50/30 shadow-sm shadow-amber-100"
          : item.isAddressed
          ? "border-emerald-200 bg-emerald-50/20"
          : "border-slate-200 bg-white"
      }`}
    >
      {/* ── Collapsed row (always visible) ── */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        {/* Expand chevron */}
        <div className="shrink-0 text-muted-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>

        {/* Urgent indicator */}
        {item.isUrgent && (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        )}

        {/* Author badge */}
        <Badge className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${AUTHOR_TYPE_COLORS[item.authorType]}`}>
          {item.authorName}
        </Badge>

        {/* Content preview */}
        <span className="text-sm text-slate-700 truncate flex-1 min-w-0">
          {firstLine}{hasMore && !expanded ? "…" : ""}
        </span>

        {/* Reply count */}
        {replies.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
            <Reply className="h-3 w-3" />{replies.length}
          </span>
        )}

        {/* Date */}
        <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
          {formatDateShort(item.createdAt)}
        </span>

        {/* Inline action buttons (always visible, stop propagation) */}
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-blue-600 hover:bg-blue-50"
            title="Edit"
            onClick={() => {
              setEditContent(item.content);
              setEditing(true);
              if (!expanded) onToggleExpand();
            }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          {!item.parentId && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${item.isUrgent ? "text-amber-600 bg-amber-50" : "text-muted-foreground"} hover:text-amber-700 hover:bg-amber-50`}
              title={item.isUrgent ? "Remove urgent flag" : "Mark as urgent"}
              onClick={() => onUpdateItem.mutate({ token, itemId: item.id, isUrgent: !item.isUrgent })}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
            </Button>
          )}
          {!item.isAddressed ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              title="Mark as addressed"
              onClick={() => onUpdateItem.mutate({ token, itemId: item.id, isAddressed: true })}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-slate-700"
              title="Reopen"
              onClick={() => onUpdateItem.mutate({ token, itemId: item.id, isAddressed: false })}
            >
              <Clock className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-red-600 hover:bg-red-50"
            title="Delete"
            onClick={() => {
              if (window.confirm("Delete this item and all its replies?")) {
                onDeleteItem.mutate({ token, itemId: item.id });
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* ── Expanded content ── */}
      {expanded && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4 border-t border-slate-100">
          {/* Full header */}
          <div className="flex items-center gap-2 flex-wrap pt-3 mb-2">
            <span className="font-semibold text-sm">{item.authorName}</span>
            <Badge className={`text-[10px] px-1.5 py-0 h-4 ${AUTHOR_TYPE_COLORS[item.authorType]}`}>
              {getAuthorTypeLabel(item.authorType)}
            </Badge>
            {item.isUrgent && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-amber-100 text-amber-700 border-amber-200">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Urgent
              </Badge>
            )}
            {item.isAddressed && (
              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Addressed
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              {formatDate(item.createdAt)}
              {item.editedAt && <span className="ml-1">(edited)</span>}
            </span>
          </div>

          {/* Content */}
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={4}
                className="resize-none text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setEditing(false); setEditContent(item.content); }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleSaveEdit}
                  disabled={onUpdateItem.isPending || !editContent.trim()}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setEditing(false); setEditContent(item.content); }}
                >
                  Cancel
                </Button>
                <span className="text-[10px] text-muted-foreground">⌘↵ to save · Esc to cancel</span>
              </div>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap text-slate-700 leading-relaxed">{item.content}</p>
          )}

          {/* Attachments */}
          {itemAttachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {itemAttachments.map((att: any) => (
                att.type === "image" ? (
                  <div key={att.id} className="relative group">
                    <button
                      type="button"
                      onClick={() => { setLightboxUrl(getImageUrl(att)); setLightboxName(att.fileName || "Image"); }}
                      className="block rounded-lg overflow-hidden border hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <img
                        src={getImageUrl(att)}
                        alt={att.fileName || "Attachment"}
                        className="h-20 w-20 object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this image attachment?")) {
                          onDeleteAttachment.mutate({ token, attachmentId: att.id });
                        }
                      }}
                      className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                      title="Delete image"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <a
                    key={att.id}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-slate-50 hover:bg-slate-100 text-xs text-blue-600 transition-colors"
                  >
                    <Link2 className="h-3 w-3" />
                    {att.fileName || "Link"}
                  </a>
                )
              ))}
            </div>
          )}

          {/* Attachment actions */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={onUploadAttachment.isPending}
            >
              <Upload className="h-3 w-3" />
              {onUploadAttachment.isPending ? "Uploading..." : "Image"}
            </Button>
            {showLinkInput ? (
              <div className="flex items-center gap-1">
                <Input
                  placeholder="https://..."
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="h-7 text-xs w-48"
                  onKeyDown={(e) => e.key === "Enter" && handleAddLink()}
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleAddLink}>
                  <Plus className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setShowLinkInput(false); setLinkUrl(""); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={() => setShowLinkInput(true)}
              >
                <Link2 className="h-3 w-3" /> Link
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground ml-auto"
              onClick={() => setReplyingTo(replyingTo === item.id ? null : item.id)}
            >
              <Reply className="h-3 w-3" /> Reply {replies.length > 0 && `(${replies.length})`}
            </Button>
          </div>

          {/* Replies */}
          {replies.length > 0 && (
            <div className="mt-3 ml-4 pl-3 border-l-2 border-slate-200 space-y-3">
              {replies.map((reply: any) => {
                const replyAttachments = attachments.get(reply.id) ?? [];
                return (
                  <div key={reply.id} className="text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-xs">{reply.authorName}</span>
                      <Badge className={`text-[9px] px-1 py-0 h-3.5 ${AUTHOR_TYPE_COLORS[reply.authorType]}`}>
                        {getAuthorTypeLabel(reply.authorType)}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{formatDate(reply.createdAt)}</span>
                      {reply.editedAt && <span className="text-[10px] text-muted-foreground">(edited)</span>}
                      <div className="ml-auto flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-blue-600 hover:bg-blue-50"
                          title="Edit reply"
                          onClick={() => {
                            setEditingReplyId(reply.id);
                            setEditReplyContent(reply.content);
                          }}
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          title="Delete reply"
                          onClick={() => {
                            if (window.confirm("Delete this reply?")) {
                              onDeleteItem.mutate({ token, itemId: reply.id });
                            }
                          }}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      </div>
                    </div>
                    {editingReplyId === reply.id ? (
                      <div className="mt-1 space-y-1.5">
                        <Textarea
                          value={editReplyContent}
                          onChange={(e) => setEditReplyContent(e.target.value)}
                          rows={3}
                          className="resize-none text-xs"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingReplyId(null);
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSaveReplyEdit(reply.id);
                          }}
                        />
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={() => handleSaveReplyEdit(reply.id)}
                            disabled={onUpdateItem.isPending || !editReplyContent.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] px-2"
                            onClick={() => setEditingReplyId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{reply.content}</p>
                    )}
                    {replyAttachments.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {replyAttachments.map((att: any) => (
                          att.type === "image" ? (
                            <div key={att.id} className="relative group">
                              <button
                                type="button"
                                onClick={() => { setLightboxUrl(getImageUrl(att)); setLightboxName(att.fileName || "Image"); }}
                                className="block rounded overflow-hidden border hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-blue-400"
                              >
                                <img src={getImageUrl(att)} alt="" className="h-14 w-14 object-cover" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm("Delete this image attachment?")) {
                                    onDeleteAttachment.mutate({ token, attachmentId: att.id });
                                  }
                                }}
                                className="absolute top-0.5 right-0.5 bg-black/60 hover:bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                                title="Delete image"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 underline">
                              {att.fileName || "Link"}
                            </a>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Reply form */}
          {replyingTo === item.id && savedName && (
            <div className="mt-3 ml-4 pl-3 border-l-2 border-blue-200">
              <NewItemForm
                token={token}
                savedName={savedName}
                savedType={savedType}
                onSubmit={(data: any) => onAddItem.mutate(data)}
                isPending={onAddItem.isPending}
                onSaveIdentity={() => {}}
                parentId={item.id}
              />
            </div>
          )}
          {replyingTo === item.id && !savedName && (
            <p className="mt-3 text-xs text-muted-foreground ml-4">Set your identity above to reply.</p>
          )}
        </div>
      )}

      {/* Lightbox modal for full-size image preview */}
      <Dialog open={!!lightboxUrl} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
        <DialogContent className="max-w-3xl w-full p-2 sm:p-4">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-sm font-medium truncate">{lightboxName}</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <div className="flex items-center justify-center">
              <img
                src={lightboxUrl}
                alt={lightboxName}
                className="max-h-[75vh] max-w-full object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubscribeForm({
  token,
  subscribers,
  onSubscribe,
  onUnsubscribe,
  isPending,
}: {
  token: string;
  subscribers: any[];
  onSubscribe: (email: string, name?: string) => void;
  onUnsubscribe: (email: string) => void;
  isPending: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter your email to receive notifications when new items or replies are posted.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="your@email.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          disabled={!email.trim() || isPending}
          onClick={() => { onSubscribe(email.trim(), name.trim() || undefined); setEmail(""); setName(""); }}
          className="gap-1.5"
        >
          <Bell className="h-3.5 w-3.5" /> Subscribe
        </Button>
      </div>
      {subscribers.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Current subscribers:</p>
            {subscribers.map((sub: any) => (
              <div key={sub.id} className="flex items-center justify-between gap-2 text-sm py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{sub.email}</span>
                  {sub.name && <span className="text-xs text-muted-foreground">({sub.name})</span>}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-red-600 shrink-0"
                  onClick={() => onUnsubscribe(sub.email)}
                  disabled={isPending}
                >
                  <BellOff className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
