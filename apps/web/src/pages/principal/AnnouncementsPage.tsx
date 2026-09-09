import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Skeleton,
  TextField,
} from "@mui/material";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import PortableDateField from "../../components/forms/PortableDateField";

type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: string[];
  isPinned: boolean;
  publishAt?: string | null;
  expiresAt?: string | null;
  class?: { name: string; section?: string | null } | null;
};
type Directory = {
  classes: Array<{ id: string; name: string; section?: string | null }>;
};
export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [classes, setClasses] = useState<Directory["classes"]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState({
    title: "",
    body: "",
    classId: "",
    audience: ["STUDENT", "PARENT"] as string[],
    isPinned: false,
    publishAt: "",
    expiresAt: "",
  });
  const load = async () => {
    setLoading(true);
    try {
      const [{ data: a }, { data: d }] = await Promise.all([
        api.get<Announcement[]>("/announcements/manage"),
        api.get<Directory>("/school-directory"),
      ]);
      setItems(a);
      setClasses(d.classes);
    } catch {
      setError("Could not load announcements.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        ...form,
        classId: form.classId || undefined,
        publishAt: form.publishAt || undefined,
        expiresAt: form.expiresAt || undefined,
      };
      const { data } = editingId
        ? await api.patch(`/announcements/${editingId}`, payload)
        : await api.post("/announcements", payload);
      setMessage(
        editingId
          ? "Announcement updated."
          : data.approvalRequired
            ? "Announcement sent for Principal approval."
            : "Announcement published.",
      );
      setEditingId("");
      setForm({
        title: "",
        body: "",
        classId: "",
        audience: ["STUDENT", "PARENT"],
        isPinned: false,
        publishAt: "",
        expiresAt: "",
      });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create announcement.");
    } finally {
      setSaving(false);
    }
  };
  const edit = (item: Announcement) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      classId: "",
      audience: item.audience,
      isPinned: item.isPinned,
      publishAt: item.publishAt?.slice(0, 16).replace("T", " ") ?? "",
      expiresAt: item.expiresAt?.slice(0, 16).replace("T", " ") ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = async (item: Announcement) => {
    if (
      !window.confirm(
        `Delete announcement “${item.title}”? This cannot be undone.`,
      )
    )
      return;
    setError("");
    try {
      await api.delete(`/announcements/${item.id}`);
      setMessage("Announcement deleted.");
      if (editingId === item.id) setEditingId("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not delete announcement.");
    }
  };
  const roles = ["PRINCIPAL", "STAFF", "TEACHER", "STUDENT", "PARENT"];
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eef5ff,#fff_48%,#fff8ed)] px-4 py-6 sm:px-8">
      <section className="mx-auto max-w-6xl">
        <header className="mb-6">
          <span className="text-xs font-black uppercase tracking-[.22em] text-rose-600">
            Communication
          </span>
          <h1 className="mt-2 text-3xl font-black text-slate-950">
            Announcements
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Publish school-wide or class-specific updates with role targeting.
          </p>
        </header>
        {error && (
          <Alert severity="error" className="mb-4" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert
            severity="success"
            className="mb-4"
            onClose={() => setMessage("")}
          >
            {message}
          </Alert>
        )}
        <section className="mb-6 rounded-[28px] border border-white bg-white/80 p-5 shadow-xl">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Title"
              value={form.title}
              onChange={(e) =>
                setForm((v) => ({ ...v, title: e.target.value }))
              }
            />
            <TextField
              select
              label="Class target"
              value={form.classId}
              onChange={(e) =>
                setForm((v) => ({ ...v, classId: e.target.value }))
              }
            >
              <MenuItem value="">Whole school</MenuItem>
              {classes.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                  {c.section ? ` - ${c.section}` : ""}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              className="md:col-span-2"
              multiline
              minRows={4}
              label="Message"
              value={form.body}
              onChange={(e) => setForm((v) => ({ ...v, body: e.target.value }))}
            />
            <PortableDateField
              kind="datetime"
              label="Publish at"
              value={form.publishAt}
              onValueChange={(publishAt) =>
                setForm((v) => ({ ...v, publishAt }))
              }
            />
            <PortableDateField
              kind="datetime"
              label="Expires at"
              value={form.expiresAt}
              onValueChange={(expiresAt) =>
                setForm((v) => ({ ...v, expiresAt }))
              }
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {roles.map((r) => (
              <button
                key={r}
                onClick={() =>
                  setForm((v) => ({
                    ...v,
                    audience: v.audience.includes(r)
                      ? v.audience.filter((x) => x !== r)
                      : [...v.audience, r],
                  }))
                }
                className={`rounded-full px-3 py-2 text-xs font-black ${form.audience.includes(r) ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="mt-5">
            <Button
              startIcon={<CampaignRoundedIcon />}
              variant="contained"
              disabled={
                saving || !form.title || !form.body || !form.audience.length
              }
              onClick={() => void save()}
              sx={{
                borderRadius: 3,
                fontWeight: 900,
                background: "linear-gradient(90deg,#e11d48,#7c3aed)",
              }}
            >
              {saving ? (
                <CircularProgress size={18} color="inherit" />
              ) : editingId ? (
                "Save changes"
              ) : (
                "Publish announcement"
              )}
            </Button>
            {editingId && (
              <Button onClick={() => setEditingId("")} sx={{ ml: 1 }}>
                Cancel editing
              </Button>
            )}
          </div>
        </section>
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton
                key={i}
                variant="rounded"
                height={120}
                sx={{ borderRadius: 4 }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <article
                key={a.id}
                className="rounded-[24px] border border-white bg-white/75 p-5 shadow-sm"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="font-black text-slate-900">{a.title}</h2>
                    <p className="mt-1 text-sm text-slate-600">{a.body}</p>
                    <p className="mt-2 text-xs font-bold text-slate-400">
                      Audience: {a.audience.join(", ")}
                      {a.class
                        ? ` · ${a.class.name}${a.class.section ? ` ${a.class.section}` : ""}`
                        : ""}
                    </p>
                  </div>
                  {a.isPinned && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">
                      Pinned
                    </span>
                  )}
                  <div className="flex gap-1">
                    <Button
                      size="small"
                      startIcon={<EditRoundedIcon />}
                      onClick={() => edit(a)}
                    >
                      Edit
                    </Button>
                    <Button
                      color="error"
                      size="small"
                      startIcon={<DeleteRoundedIcon />}
                      onClick={() => void remove(a)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </article>
            ))}
            {!items.length && (
              <div className="rounded-[24px] border border-dashed border-slate-300 py-14 text-center text-slate-500">
                No announcements yet.
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
