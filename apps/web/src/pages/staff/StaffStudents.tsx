import EditRounded from "@mui/icons-material/EditRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Skeleton,
  TextField,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const blankProfile = {
  nationality: "",
  religion: "",
  sect: "",
  bloodGroup: "",
};

export default function StaffStudents() {
  const [data, setData] = useState<any>({ students: [], classes: [] });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    try {
      setData((await api.get("/staff-students")).data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not load students.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const rows = useMemo(
    () =>
      data.students.filter((s: any) =>
        `${s.user.firstName} ${s.user.lastName} ${s.admissionNo} ${s.class?.name ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data.students, query],
  );
  const edit = (s: any) =>
    setEditing({
      id: s.id,
      firstName: s.user.firstName,
      lastName: s.user.lastName,
      email: s.user.email,
      admissionNo: s.admissionNo,
      classId: s.classId ?? "",
      guardianPhone: s.guardianPhone ?? "",
      cnic: s.user.cnic ?? "",
      phone: s.user.phone ?? "",
      alternatePhone: s.user.alternatePhone ?? "",
      whatsappNo: s.user.whatsappNo ?? "",
      address: s.user.address ?? "",
      dateOfBirth: s.user.dateOfBirth
        ? new Date(s.user.dateOfBirth).toISOString().slice(0, 10)
        : "",
      gender: s.user.gender ?? "",
      profileData: { ...blankProfile, ...(s.user.profileData ?? {}) },
      note: "",
    });
  const set = (key: string, value: any) =>
    setEditing((x: any) => ({ ...x, [key]: value }));
  const setProfile = (key: string, value: string) =>
    setEditing((x: any) => ({
      ...x,
      profileData: { ...x.profileData, [key]: value },
    }));
  const submit = async () => {
    if (!editing) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.patch(`/staff-students/${editing.id}`, editing);
      setEditing(null);
      setMessage(
        "Student changes sent to the Principal. Current data remains unchanged until approval.",
      );
    } catch (e: any) {
      setError(
        e?.response?.data?.message ?? "Could not submit the student update.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#edf5ff,transparent_32%),#f8faff] p-4 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header>
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-600">
            Staff Workspace
          </p>
          <h1 className="mt-2 text-3xl font-black">Student records</h1>
          <p className="mt-2 text-sm text-slate-500">
            Propose corrections for Principal review. Live student data is never
            changed before approval.
          </p>
        </header>
        {error && (
          <Alert severity="error" className="mt-4" onClose={() => setError("")}>
            {error}
          </Alert>
        )}
        {message && (
          <Alert
            severity="success"
            className="mt-4"
            onClose={() => setMessage("")}
          >
            {message}
          </Alert>
        )}
        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-white px-4 shadow">
          <SearchRounded className="text-slate-400" />
          <input
            className="h-12 flex-1 outline-none"
            placeholder="Search name, admission number or class"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {loading ? (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} height={170} variant="rounded" />
            ))}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((s: any) => (
              <article
                key={s.id}
                className="rounded-[24px] bg-white p-5 shadow-lg"
              >
                <h2 className="text-lg font-black">
                  {s.user.firstName} {s.user.lastName}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {s.admissionNo} · {s.class?.name ?? "No class"}
                  {s.class?.section ? ` - ${s.class.section}` : ""}
                </p>
                <p className="mt-2 text-xs text-slate-400">{s.user.email}</p>
                <Button
                  className="mt-4"
                  startIcon={<EditRounded />}
                  onClick={() => edit(s)}
                >
                  Propose edit
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>
      <Dialog
        open={Boolean(editing)}
        onClose={() => !saving && setEditing(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 5 } }}
      >
        <DialogTitle sx={{ fontWeight: 900 }}>
          Propose student changes
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" className="mb-4">
            The existing record stays active until the Principal approves this
            proposal.
          </Alert>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="First name"
                value={editing.firstName}
                set={(v) => set("firstName", v)}
              />
              <Field
                label="Last name"
                value={editing.lastName}
                set={(v) => set("lastName", v)}
              />
              <Field
                label="Email"
                value={editing.email}
                set={(v) => set("email", v)}
              />
              <Field
                label="Admission number"
                value={editing.admissionNo}
                set={(v) => set("admissionNo", v)}
              />
              <TextField
                select
                label="Class & section"
                value={editing.classId}
                onChange={(e) => set("classId", e.target.value)}
              >
                {data.classes.map((c: any) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                    {c.section ? ` - ${c.section}` : ""}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Gender"
                value={editing.gender}
                onChange={(e) => set("gender", e.target.value)}
              >
                <MenuItem value="">Not specified</MenuItem>
                <MenuItem value="MALE">Male</MenuItem>
                <MenuItem value="FEMALE">Female</MenuItem>
                <MenuItem value="OTHER">Other</MenuItem>
              </TextField>
              <Field
                label="CNIC / B-Form"
                value={editing.cnic}
                set={(v) => set("cnic", v)}
              />
              <Field
                label="Guardian phone"
                value={editing.guardianPhone}
                set={(v) => set("guardianPhone", v)}
              />
              <Field
                label="Phone"
                value={editing.phone}
                set={(v) => set("phone", v)}
              />
              <Field
                label="Second phone"
                value={editing.alternatePhone}
                set={(v) => set("alternatePhone", v)}
              />
              <Field
                label="WhatsApp"
                value={editing.whatsappNo}
                set={(v) => set("whatsappNo", v)}
              />
              <TextField
                type="date"
                label="Date of birth"
                value={editing.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <Field
                label="Nationality"
                value={editing.profileData.nationality}
                set={(v) => setProfile("nationality", v)}
              />
              <Field
                label="Religion"
                value={editing.profileData.religion}
                set={(v) => setProfile("religion", v)}
              />
              <Field
                label="Sect"
                placeholder="Sunni, Shia"
                value={editing.profileData.sect}
                set={(v) => setProfile("sect", v)}
              />
              <TextField
                select
                label="Blood group"
                value={editing.profileData.bloodGroup}
                onChange={(e) => setProfile("bloodGroup", e.target.value)}
              >
                <MenuItem value="">Not specified</MenuItem>
                {bloodGroups.map((x) => (
                  <MenuItem key={x} value={x}>
                    {x}
                  </MenuItem>
                ))}
              </TextField>
              <div className="sm:col-span-2">
                <Field
                  label="Address"
                  value={editing.address}
                  set={(v) => set("address", v)}
                />
              </div>
              <div className="sm:col-span-2">
                <Field
                  label="Reason / note for Principal"
                  value={editing.note}
                  set={(v) => set("note", v)}
                />
              </div>
            </div>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setEditing(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={saving || !editing?.classId}
          >
            {saving ? <CircularProgress size={20} /> : "Send for approval"}
          </Button>
        </DialogActions>
      </Dialog>
    </main>
  );
}
function Field({
  label,
  value,
  set,
  placeholder,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <TextField
      fullWidth
      label={label}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => set(e.target.value)}
    />
  );
}
