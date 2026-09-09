import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
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
import { useEffect, useMemo, useState } from "react";
import FileUpload, {
  openStorageReference,
} from "../../components/storage/FileUpload";
import { api } from "../../lib/api";
import { useAuth } from "../../features/auth/AuthProvider";
import PortableDateField from "../../components/forms/PortableDateField";

type Directory = {
  classes: Array<{ id: string; name: string; section?: string | null }>;
  subjects: Array<{ id: string; name: string }>;
};
type Assignment = {
  id: string;
  title: string;
  instructions: string;
  attachmentUrl?: string | null;
  dueAt?: string | null;
  maxMarks?: string | number | null;
  subject: { name: string };
  class?: { name: string; section?: string | null };
  submissions?: Array<{
    id: string;
    status: string;
    score?: string | number | null;
  }>;
  _count?: { submissions: number };
};
type Material = {
  id: string;
  title: string;
  description?: string | null;
  fileUrl?: string | null;
  externalUrl?: string | null;
  subject: { name: string };
};
type Syllabus = {
  id: string;
  title: string;
  isCompleted: boolean;
  subject: { name: string };
};

export default function CourseworkHub() {
  const { user } = useAuth();
  const teacherLike = user?.role === "TEACHER" || user?.role === "PRINCIPAL";
  const [assignments, setAssignments] = useState<Assignment[]>([]),
    [materials, setMaterials] = useState<Material[]>([]),
    [syllabus, setSyllabus] = useState<Syllabus[]>([]),
    [directory, setDirectory] = useState<Directory>({
      classes: [],
      subjects: [],
    });
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"assignments" | "materials" | "syllabus">(
    "assignments",
  );
  const [classId, setClassId] = useState(""),
    [subjectId, setSubjectId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [fileRef, setFileRef] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      const [a, m, s] = await Promise.all([
        api.get("/coursework/assignments"),
        api.get("/coursework/materials"),
        api.get("/coursework/syllabus"),
      ]);
      setAssignments(a.data);
      setMaterials(m.data);
      setSyllabus(s.data);
      if (teacherLike) {
        const d = await api.get("/school-directory");
        setDirectory(d.data);
        setClassId((x) => x || d.data.classes[0]?.id || "");
        setSubjectId((x) => x || d.data.subjects[0]?.id || "");
      }
    } catch {
      setError("Could not load coursework.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const progress = useMemo(
    () =>
      syllabus.length
        ? Math.round(
            (syllabus.filter((x) => x.isCompleted).length / syllabus.length) *
              100,
          )
        : 0,
    [syllabus],
  );
  const create = async () => {
    if (!teacherLike || !title || !classId || !subjectId) return;
    setSaving(true);
    setError("");
    try {
      if (tab === "assignments")
        await api.post("/coursework/assignments", {
          classId,
          subjectId,
          title,
          instructions: body || "Complete the assigned work.",
          dueAt: dueAt || undefined,
          attachmentUrl: fileRef || undefined,
        });
      if (tab === "materials")
        await api.post("/coursework/materials", {
          classId,
          subjectId,
          title,
          description: body,
          fileUrl: fileRef || undefined,
        });
      if (tab === "syllabus")
        await api.post("/coursework/syllabus", {
          classId,
          subjectId,
          title,
          description: body,
        });
      setTitle("");
      setBody("");
      setDueAt("");
      setFileRef("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not create item.");
    } finally {
      setSaving(false);
    }
  };
  const editItem = async (
    kind: "assignments" | "materials" | "syllabus",
    item: Assignment | Material | Syllabus,
  ) => {
    const title = window.prompt("Title", item.title);
    if (title === null || !title.trim()) return;
    const payload: Record<string, unknown> = { title: title.trim() };
    if (kind === "assignments") {
      const assignment = item as Assignment;
      const instructions = window.prompt(
        "Instructions",
        assignment.instructions,
      );
      if (instructions === null) return;
      payload.instructions = instructions;
    } else if (kind === "materials") {
      const material = item as Material;
      const description = window.prompt(
        "Description",
        material.description ?? "",
      );
      if (description === null) return;
      payload.description = description;
    } else {
      payload.isCompleted = window.confirm(
        "Mark this syllabus item as completed?",
      );
    }
    try {
      await api.patch(`/coursework/${kind}/${item.id}`, payload);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not update item.");
    }
  };
  const deleteItem = async (
    kind: "assignments" | "materials" | "syllabus",
    item: Assignment | Material | Syllabus,
  ) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`))
      return;
    try {
      await api.delete(`/coursework/${kind}/${item.id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not delete item.");
    }
  };
  if (loading)
    return (
      <main className="min-h-screen bg-[#f8faff] p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton
              key={i}
              variant="rounded"
              height={130}
              sx={{ borderRadius: 5 }}
            />
          ))}
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf2ff,transparent_35%),radial-gradient(circle_at_top_right,#f4ebff,transparent_30%),#f8faff] px-4 py-6 md:px-8 text-slate-800">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[30px] border border-white bg-white/80 p-6 shadow-[0_24px_70px_rgba(70,90,140,.12)] backdrop-blur-xl">
          <p className="text-xs font-black uppercase tracking-[.2em] text-indigo-600">
            Nexora coursework
          </p>
          <h1 className="mt-2 text-3xl font-black">
            Assignments, materials & syllabus
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            One academic workspace for classroom work, secure resources and
            syllabus progress.
          </p>
        </header>
        {error && (
          <Alert severity="error" className="mt-4" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {[
            [AssignmentRoundedIcon, "Assignments", assignments.length],
            [MenuBookRoundedIcon, "Materials", materials.length],
            [TaskAltRoundedIcon, "Syllabus progress", `${progress}%`],
          ].map(([Icon, label, value]: any) => (
            <article
              key={label}
              className="rounded-[24px] border border-white bg-white/80 p-5 shadow-lg"
            >
              <Icon className="text-indigo-600" />
              <p className="mt-4 text-sm font-bold text-slate-400">{label}</p>
              <p className="text-3xl font-black">{value}</p>
            </article>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {(["assignments", "materials", "syllabus"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setFileRef("");
              }}
              className={`rounded-xl px-4 py-2 text-sm font-black ${tab === t ? "bg-indigo-600 text-white shadow-lg" : "bg-white text-slate-500"}`}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {teacherLike && (
          <section className="mt-5 rounded-[28px] border border-white bg-white/80 p-5 shadow-xl">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <TextField
                select
                label="Class"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                {directory.classes.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                    {c.section ? ` - ${c.section}` : ""}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                {directory.subjects.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <TextField
                label="Description / instructions"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {tab === "assignments" ? (
                <PortableDateField
                  kind="datetime"
                  label="Due"
                  value={dueAt}
                  onValueChange={setDueAt}
                />
              ) : (
                <div />
              )}
            </div>
            {tab !== "syllabus" && (
              <div className="mt-3">
                <FileUpload
                  category={tab === "assignments" ? "assignment" : "material"}
                  value={fileRef}
                  onChange={setFileRef}
                  label={
                    tab === "assignments"
                      ? "Attach assignment file"
                      : "Upload course material"
                  }
                />
              </div>
            )}
            <Button
              onClick={() => void create()}
              variant="contained"
              disabled={saving || !title}
              sx={{
                mt: 2,
                borderRadius: 3,
                fontWeight: 900,
                background: "linear-gradient(90deg,#2563eb,#7c3aed)",
              }}
            >
              {saving ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                `Create ${tab.slice(0, -1)}`
              )}
            </Button>
          </section>
        )}
        <section className="mt-5 grid gap-3">
          {tab === "assignments" &&
            assignments.map((a) => (
              <article
                key={a.id}
                className="rounded-[24px] border border-white bg-white/85 p-5 shadow-lg"
              >
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-indigo-500">
                      {a.subject.name}
                    </p>
                    <h2 className="mt-1 text-xl font-black">{a.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {a.instructions}
                    </p>
                    {a.attachmentUrl && (
                      <Button
                        size="small"
                        sx={{ mt: 1 }}
                        onClick={() =>
                          void openStorageReference(a.attachmentUrl!)
                        }
                      >
                        Open attachment
                      </Button>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-bold text-slate-500">
                      {a.dueAt
                        ? new Date(a.dueAt).toLocaleString()
                        : "No deadline"}
                    </p>
                    {a.submissions?.[0] && (
                      <p className="mt-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-700">
                        {a.submissions[0].status}
                      </p>
                    )}
                    {a._count && (
                      <p className="mt-2 text-xs text-slate-400">
                        {a._count.submissions} submissions
                      </p>
                    )}
                    {teacherLike && (
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="small"
                          startIcon={<EditRoundedIcon />}
                          onClick={() => void editItem("assignments", a)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          startIcon={<DeleteRoundedIcon />}
                          onClick={() => void deleteItem("assignments", a)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          {tab === "materials" &&
            materials.map((m) => (
              <article
                key={m.id}
                className="rounded-[24px] border border-white bg-white/85 p-5 shadow-lg"
              >
                <p className="text-xs font-black text-indigo-500">
                  {m.subject.name}
                </p>
                <h2 className="mt-1 text-lg font-black">{m.title}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {m.description || "Course resource"}
                </p>
                <div className="mt-2 flex gap-2">
                  {m.fileUrl && (
                    <Button
                      size="small"
                      onClick={() => void openStorageReference(m.fileUrl!)}
                    >
                      Open file
                    </Button>
                  )}
                  {teacherLike && (
                    <>
                      <Button
                        size="small"
                        startIcon={<EditRoundedIcon />}
                        onClick={() => void editItem("materials", m)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteRoundedIcon />}
                        onClick={() => void deleteItem("materials", m)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                  {m.externalUrl && (
                    <Button
                      size="small"
                      onClick={() =>
                        window.open(
                          m.externalUrl!,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      External link
                    </Button>
                  )}
                </div>
              </article>
            ))}
          {tab === "syllabus" &&
            syllabus.map((s) => (
              <article
                key={s.id}
                className="flex items-center justify-between rounded-[24px] border border-white bg-white/85 p-5 shadow-lg"
              >
                <div>
                  <p className="text-xs font-black text-indigo-500">
                    {s.subject.name}
                  </p>
                  <h2 className="mt-1 text-lg font-black">{s.title}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${s.isCompleted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                  >
                    {s.isCompleted ? "Completed" : "In progress"}
                  </span>
                  {teacherLike && (
                    <>
                      <Button
                        size="small"
                        startIcon={<EditRoundedIcon />}
                        onClick={() => void editItem("syllabus", s)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteRoundedIcon />}
                        onClick={() => void deleteItem("syllabus", s)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </article>
            ))}
        </section>
      </section>
    </main>
  );
}
