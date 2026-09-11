import AddRoundedIcon from "@mui/icons-material/AddRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import PersonAddAlt1RoundedIcon from "@mui/icons-material/PersonAddAlt1Rounded";
import DeleteRoundedIcon from "@mui/icons-material/DeleteRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import {
  Alert,
  Avatar,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  TextField,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import FileUpload from "../../components/storage/FileUpload";

type Overview = {
  school: {
    id: string;
    name: string;
    logoUrl?: string | null;
    description?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    timezone: string;
  } | null;
  users: Array<{
    id: string;
    role: string;
    firstName: string;
    lastName: string;
    email: string;
    isActive: boolean;
  }>;
  students: Array<{
    id: string;
    admissionNo: string;
    section?: string | null;
    user: {
      firstName: string;
      lastName: string;
      email: string;
      isActive: boolean;
    };
    class?: { id: string; name: string; section?: string | null } | null;
  }>;
  classes: Array<{
    id: string;
    name: string;
    section?: string | null;
    academicYear?: string | null;
  }>;
  subjects: Array<{ id: string; name: string; code?: string | null }>;
};
type PersonCard = {
  id: string;
  role: "STUDENT" | "TEACHER" | "STAFF";
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  cnic?: string | null;
  avatarUrl?: string | null;
  isActive: boolean;
  studentProfile?: {
    id: string;
    admissionNo: string;
    class?: { name: string; section?: string | null } | null;
  } | null;
  performance?: {
    term?: { id: string; name: string } | null;
    attendanceRate: number;
    academicAverage: number;
    examAverage: number;
    assignmentAverage: number;
    manualTestAverage: number;
    examsTaken: number;
    gradedAssignments: number;
    manualTestsTaken: number;
  } | null;
};

export default function PrincipalOperations() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<
    "class" | "subject" | "user" | "student" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});
  const [people, setPeople] = useState<PersonCard[]>([]);
  const [peopleCursor, setPeopleCursor] = useState<string | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected] = useState<any>(null);
  const [editPerson, setEditPerson] = useState<any>(null);
  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get<Overview>("/school-operations/overview");
      setData(r.data);
    } catch {
      setError("Could not load school operations.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const loadPeople = async (reset = false) => {
    if (peopleLoading) return;
    setPeopleLoading(true);
    try {
      const { data } = await api.get("/school-operations/people", {
        params: {
          q: query || undefined,
          role: roleFilter,
          status: statusFilter,
          cursor: reset ? undefined : peopleCursor || undefined,
          limit: 12,
        },
      });
      setPeople((current) =>
        reset ? data.items : [...current, ...data.items],
      );
      setPeopleCursor(data.nextCursor);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not load people.");
    } finally {
      setPeopleLoading(false);
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void loadPeople(true), 250);
    return () => window.clearTimeout(timer);
  }, [query, roleFilter, statusFilter]);
  useEffect(() => {
    const sentinel = document.getElementById("people-load-more");
    if (!sentinel || !peopleCursor) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadPeople(false);
      },
      { rootMargin: "240px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [peopleCursor, peopleLoading]);
  const openPerson = async (id: string) => {
    try {
      const { data } = await api.get(`/school-operations/people/${id}`);
      setSelected(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not load person details.");
    }
  };
  const beginPersonEdit = () => {
    if (!selected) return;
    setEditPerson({
      ...selected,
      dateOfBirth: selected.dateOfBirth
        ? new Date(selected.dateOfBirth).toISOString().slice(0, 10)
        : "",
      admissionNo: selected.studentProfile?.admissionNo ?? "",
      classId: selected.studentProfile?.classId ?? selected.studentProfile?.class?.id ?? "",
      section: selected.studentProfile?.section ?? "",
      guardianPhone: selected.studentProfile?.guardianPhone ?? "",
      profileData: selected.profileData ?? {},
    });
  };
  const savePersonEdit = async () => {
    if (!editPerson) return;
    setSaving(true);
    setError("");
    try {
      const isStudent = editPerson.role === "STUDENT";
      const path = isStudent
        ? `/school-operations/students/${editPerson.studentProfile.id}`
        : `/school-operations/users/${editPerson.id}`;
      const payload = {
        firstName: editPerson.firstName,
        lastName: editPerson.lastName,
        email: editPerson.email,
        ...(isStudent ? {} : { username: editPerson.username, role: editPerson.role }),
        cnic: editPerson.cnic || undefined,
        phone: editPerson.phone || undefined,
        alternatePhone: editPerson.alternatePhone || undefined,
        whatsappNo: editPerson.whatsappNo || undefined,
        address: editPerson.address || undefined,
        dateOfBirth: editPerson.dateOfBirth || undefined,
        gender: editPerson.gender || undefined,
        profileData: editPerson.profileData ?? {},
        ...(isStudent
          ? {
              admissionNo: editPerson.admissionNo,
              classId: editPerson.classId || null,
              section: editPerson.section || null,
              guardianPhone: editPerson.guardianPhone || null,
            }
          : {}),
      };
      await api.patch(path, payload);
      const { data: refreshed } = await api.get(
        `/school-operations/people/${editPerson.id}`,
      );
      setSelected(refreshed);
      setEditPerson(null);
      await loadPeople(true);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not update this profile.");
    } finally {
      setSaving(false);
    }
  };
  const deletePerson = async () => {
    if (!selected) return;
    if (!window.confirm(`Permanently delete ${selected.firstName} ${selected.lastName}? Accounts with school history will be protected.`)) return;
    try {
      const path = selected.role === "STUDENT"
        ? `/school-operations/students/${selected.studentProfile.id}`
        : `/school-operations/users/${selected.id}`;
      await api.delete(path);
      setSelected(null);
      await load();
      await loadPeople(true);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not delete this profile.");
    }
  };
  const stats = useMemo(
    () => [
      {
        label: "Students",
        value: data?.students.length ?? 0,
        icon: GroupsRoundedIcon,
        accent: "from-blue-500 to-cyan-400",
      },
      {
        label: "Teachers",
        value: data?.users.filter((x) => x.role === "TEACHER").length ?? 0,
        icon: SchoolRoundedIcon,
        accent: "from-violet-500 to-fuchsia-400",
      },
      {
        label: "Classes",
        value: data?.classes.length ?? 0,
        icon: MenuBookRoundedIcon,
        accent: "from-emerald-500 to-lime-400",
      },
      {
        label: "Staff",
        value: data?.users.filter((x) => x.role === "STAFF").length ?? 0,
        icon: PersonAddAlt1RoundedIcon,
        accent: "from-amber-400 to-rose-500",
      },
    ],
    [data],
  );
  const submit = async () => {
    if (!modal) return;
    setSaving(true);
    setError("");
    try {
      const path =
        modal === "class"
          ? "/school-operations/classes"
          : modal === "subject"
            ? "/school-operations/subjects"
            : modal === "user"
              ? "/school-operations/users"
              : "/school-operations/students";
      await api.post(path, form);
      setModal(null);
      setForm({});
      await load();
      await loadPeople(true);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };
  const patchRecord = async (path: string, current: string, field = "name") => {
    const value = window.prompt(`New ${field}`, current);
    if (value === null || !value.trim()) return;
    try {
      await api.patch(path, { [field]: value.trim() });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not update record.");
    }
  };
  const deleteRecord = async (path: string, label: string) => {
    if (
      !window.confirm(
        `Delete ${label}? Records with history will be protected.`,
      )
    )
      return;
    try {
      await api.delete(path);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not delete record.");
    }
  };
  const toggleUser = async (id: string, active: boolean) => {
    try {
      await api.patch(`/school-operations/users/${id}`, { isActive: !active });
      await load();
    } catch (e: any) {
      setError(
        e?.response?.data?.message ?? "Could not change account status.",
      );
    }
  };
  return (
    <>
      <main className="px-4 py-6 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[1450px]">
          <section className="relative overflow-hidden rounded-[36px] bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-800 p-7 text-white shadow-[0_30px_90px_rgba(49,46,129,.32)] md:p-10">
            <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="relative flex flex-wrap items-center gap-6">
              <SchoolLogo
                reference={data?.school?.logoUrl}
                name={data?.school?.name ?? "School"}
              />
              <div>
                <span className="text-xs font-black uppercase tracking-[.24em] text-cyan-300">
                  Principal people command center
                </span>
                <h1 className="mt-2 text-3xl font-black tracking-tight md:text-5xl">
                  {data?.school?.name ?? "Your school"}
                </h1>
                <p className="mt-3 max-w-3xl text-sm text-indigo-100 md:text-base">
                  {data?.school?.description ||
                    "Manage admissions, staff hiring and complete school records from one secure directory."}
                </p>
                <p className="mt-3 text-xs font-bold text-white/60">
                  {data?.school?.address || "School address not added"}
                  {data?.school?.email ? ` · ${data.school.email}` : ""}
                </p>
              </div>
            </div>
          </section>
          {error && (
            <Alert
              severity="error"
              className="mt-5"
              onClose={() => setError("")}
            >
              {error}
            </Alert>
          )}
          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    variant="rounded"
                    height={130}
                    sx={{ borderRadius: 6 }}
                  />
                ))
              : stats.map(({ label, value, icon: Icon, accent }) => (
                  <article
                    key={label}
                    className="card-3d glass-panel group rounded-[26px] p-5 transition hover:-translate-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-500">
                          {label}
                        </p>
                        <div className="mt-2 text-3xl font-black text-slate-950">
                          {value}
                        </div>
                      </div>
                      <div
                        className={`rounded-2xl bg-gradient-to-br ${accent} p-3 text-white shadow-lg transition group-hover:rotate-3 group-hover:scale-110`}
                      >
                        <Icon />
                      </div>
                    </div>
                  </article>
                ))}
          </section>
          <section className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {[
              ["class", "Add class", "Create grade, section and academic year"],
              ["subject", "Add subject", "Create reusable subject records"],
              ["user", "Add teacher/staff", "Create school team credentials"],
              ["student", "Add student", "Enroll student into a class"],
            ].map(([key, title, desc]) => (
              <button
                key={key}
                onClick={() => {
                  setModal(key as any);
                  setForm({ role: key === "user" ? "TEACHER" : undefined });
                }}
                className="glass-panel rounded-[26px] p-5 text-left transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(30,64,175,.14)]"
              >
                <AddRoundedIcon className="text-blue-600" />
                <h2 className="mt-3 text-lg font-black text-slate-900">
                  {title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">{desc}</p>
              </button>
            ))}
          </section>
          <section className="mt-6 grid gap-5 xl:grid-cols-2">
            <div className="glass-panel rounded-[30px] p-5 xl:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-slate-900">
                    People directory
                  </h2>
                  <p className="text-sm text-slate-500">
                    Cards load in small pages as you scroll. Select a card for
                    the full record.
                  </p>
                </div>
                <div className="grid w-full gap-2 md:grid-cols-3 xl:w-auto">
                  <TextField
                    size="small"
                    label="Search name, ID, email or phone"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <SearchRoundedIcon className="mr-2 text-slate-400" />
                      ),
                    }}
                  />
                  <TextField
                    size="small"
                    select
                    SelectProps={{ native: true }}
                    label="Role"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="ALL">All roles</option>
                    <option value="STUDENT">Students</option>
                    <option value="TEACHER">Teachers</option>
                    <option value="STAFF">Staff</option>
                  </TextField>
                  <TextField
                    size="small"
                    select
                    SelectProps={{ native: true }}
                    label="Status"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="ALL">All statuses</option>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                  </TextField>
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((person) => (
                  <button
                    key={person.id}
                    onClick={() => void openPerson(person.id)}
                    className="rounded-[24px] border border-white bg-white/80 p-4 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
                  >
                    <div className="flex items-center gap-3">
                      <ProfileAvatar
                        reference={person.avatarUrl}
                        name={`${person.firstName} ${person.lastName}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-900">
                          {person.firstName} {person.lastName}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {person.email}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Chip
                        size="small"
                        label={person.role}
                        color={
                          person.role === "STUDENT"
                            ? "info"
                            : person.role === "TEACHER"
                              ? "secondary"
                              : "warning"
                        }
                      />
                      <Chip
                        size="small"
                        label={person.isActive ? "Active" : "Inactive"}
                        color={person.isActive ? "success" : "default"}
                      />
                    </div>
                    {person.studentProfile ? (
                      <div className="mt-3">
                        <p className="text-xs font-bold text-slate-500">
                          {person.studentProfile.admissionNo} · {person.studentProfile.class
                            ? `${person.studentProfile.class.name}${person.studentProfile.class.section ? ` - ${person.studentProfile.class.section}` : ""}`
                            : "No class"}
                        </p>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div className="rounded-xl bg-blue-50 px-2 py-2"><b className="block text-blue-700">{person.performance?.attendanceRate ?? 0}%</b><span className="text-[10px] text-slate-500">Attendance</span></div>
                          <div className="rounded-xl bg-violet-50 px-2 py-2"><b className="block text-violet-700">{person.performance?.academicAverage ?? 0}%</b><span className="text-[10px] text-slate-500">Academic</span></div>
                          <div className="rounded-xl bg-emerald-50 px-2 py-2"><b className="block text-emerald-700">{person.performance?.examsTaken ?? 0}</b><span className="text-[10px] text-slate-500">Exams</span></div>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs font-bold text-slate-500">{person.phone || person.cnic || "Open full record"}</p>
                    )}
                  </button>
                ))}
              </div>
              {!people.length && !peopleLoading && (
                <div className="py-12 text-center text-slate-500">
                  No matching people.
                </div>
              )}
              <div id="people-load-more" className="py-4 text-center">
                {peopleLoading && <CircularProgress size={24} />}
                {!peopleCursor && people.length > 0 && (
                  <span className="text-xs font-bold text-slate-400">
                    All matching records loaded
                  </span>
                )}
              </div>
            </div>
            <div className="glass-panel rounded-[30px] p-5">
              <h2 className="text-xl font-black text-slate-900">
                Classes & subjects
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  {data?.classes.map((c) => (
                    <div
                      key={c.id}
                      className="mb-2 rounded-2xl bg-blue-50 p-3 text-sm font-black text-blue-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {c.name}
                          {c.section ? ` · ${c.section}` : ""}
                        </span>
                        <span>
                          <Button
                            size="small"
                            onClick={() =>
                              void patchRecord(
                                `/school-operations/classes/${c.id}`,
                                c.name,
                              )
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              void deleteRecord(
                                `/school-operations/classes/${c.id}`,
                                c.name,
                              )
                            }
                          >
                            Delete
                          </Button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  {data?.subjects.map((s) => (
                    <div
                      key={s.id}
                      className="mb-2 rounded-2xl bg-violet-50 p-3 text-sm font-black text-violet-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {s.name}
                          {s.code ? ` · ${s.code}` : ""}
                        </span>
                        <span>
                          <Button
                            size="small"
                            onClick={() =>
                              void patchRecord(
                                `/school-operations/subjects/${s.id}`,
                                s.name,
                              )
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              void deleteRecord(
                                `/school-operations/subjects/${s.id}`,
                                s.name,
                              )
                            }
                          >
                            Delete
                          </Button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Dialog
        open={Boolean(modal)}
        onClose={() => !saving && setModal(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 5 } }}
      >
        <DialogTitle sx={{ fontWeight: 900 }}>Create {modal}</DialogTitle>
        <DialogContent>
          <div className="grid gap-4 pt-2">
            {modal === "class" && (
              <>
                <F
                  label="Class name"
                  v={form.name}
                  s={(v) => setForm({ ...form, name: v })}
                />
                <F
                  label="Section"
                  v={form.section}
                  s={(v) => setForm({ ...form, section: v })}
                />
                <F
                  label="Academic year"
                  v={form.academicYear}
                  s={(v) => setForm({ ...form, academicYear: v })}
                />
              </>
            )}
            {modal === "subject" && (
              <>
                <F
                  label="Subject name"
                  v={form.name}
                  s={(v) => setForm({ ...form, name: v })}
                />
                <F
                  label="Code"
                  v={form.code}
                  s={(v) => setForm({ ...form, code: v })}
                />
              </>
            )}
            {modal === "user" && (
              <>
                <TextField
                  select
                  SelectProps={{ native: true }}
                  label="Role"
                  value={form.role ?? "TEACHER"}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                >
                  <option value="TEACHER">Teacher</option>
                  <option value="STAFF">Staff</option>
                </TextField>
                <PersonFields form={form} setForm={setForm} />
              </>
            )}
            {modal === "student" && (
              <>
                <PersonFields form={form} setForm={setForm} />
                <F
                  label="Admission no"
                  v={form.admissionNo}
                  s={(v) => setForm({ ...form, admissionNo: v })}
                />
                <TextField
                  select
                  SelectProps={{ native: true }}
                  label="Class"
                  value={form.classId ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, classId: e.target.value || undefined })
                  }
                >
                  <option value="">Select class</option>
                  {data?.classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.section ? ` - ${c.section}` : ""}
                    </option>
                  ))}
                </TextField>
                <F
                  label="Guardian phone"
                  v={form.guardianPhone}
                  s={(v) => setForm({ ...form, guardianPhone: v })}
                />
                <F
                  label="Guardian name"
                  v={form.profileData?.guardianName}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, guardianName: v },
                    })
                  }
                />
                <F
                  label="Guardian CNIC"
                  v={form.profileData?.guardianCnic}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, guardianCnic: v },
                    })
                  }
                />
                <F
                  label="Guardian relation and occupation"
                  v={form.profileData?.guardianDetails}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, guardianDetails: v },
                    })
                  }
                />
                <F
                  label="Mother name, CNIC, occupation and phone"
                  v={form.profileData?.motherDetails}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, motherDetails: v },
                    })
                  }
                />
                <F
                  label="Emergency contact (name, relation, phone)"
                  v={form.profileData?.emergencyContact}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, emergencyContact: v },
                    })
                  }
                />
                <F
                  label="Previous school, last class and leaving reason"
                  v={form.profileData?.previousSchool}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, previousSchool: v },
                    })
                  }
                />
                <F
                  label="Nationality / religion / blood group"
                  v={form.profileData?.identityDetails}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, identityDetails: v },
                    })
                  }
                />
                <F
                  label="Medical conditions, allergies and accessibility needs"
                  v={form.profileData?.medicalNotes}
                  s={(v) =>
                    setForm({
                      ...form,
                      profileData: { ...form.profileData, medicalNotes: v },
                    })
                  }
                />
              </>
            )}
          </div>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setModal(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void submit()}
            disabled={saving}
            sx={{ borderRadius: 3, fontWeight: 900 }}
          >
            {saving ? <CircularProgress size={20} color="inherit" /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 5 } }}
      >
        {selected && (
          <>
            <DialogTitle sx={{ fontWeight: 900 }}>
              <div className="flex items-center gap-4">
                <ProfileAvatar
                  reference={selected.avatarUrl}
                  name={`${selected.firstName} ${selected.lastName}`}
                  size={72}
                />
                <div>
                  <div>
                    {selected.firstName} {selected.lastName}
                  </div>
                  <div className="mt-1 flex gap-2">
                    <Chip size="small" label={selected.role} />
                    <Chip
                      size="small"
                      color={selected.isActive ? "success" : "default"}
                      label={selected.isActive ? "Active" : "Inactive"}
                    />
                  </div>
                </div>
              </div>
            </DialogTitle>
            <DialogContent>
              <div className="mb-5">
                <FileUpload
                  category="profile-image"
                  accept="image/jpeg,image/png,image/webp"
                  label="Change profile picture"
                  value={selected.avatarUrl ?? ""}
                  onChange={async (reference) => {
                    if (!reference) return;
                    await api.patch(`/storage/profile-image/${selected.id}`, {
                      reference,
                    });
                    setSelected({ ...selected, avatarUrl: reference });
                    await loadPeople(true);
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Email", selected.email],
                  ["Username", selected.username],
                  ["CNIC / B-Form", selected.cnic],
                  ["Phone", selected.phone],
                  ["Alternate phone", selected.alternatePhone],
                  ["WhatsApp", selected.whatsappNo],
                  [
                    "Date of birth",
                    selected.dateOfBirth
                      ? new Date(selected.dateOfBirth).toLocaleDateString()
                      : "",
                  ],
                  ["Gender", selected.gender],
                  ["Address", selected.address],
                  ["Admission no", selected.studentProfile?.admissionNo],
                  [
                    "Class",
                    selected.studentProfile?.class
                      ? `${selected.studentProfile.class.name}${selected.studentProfile.class.section ? ` · ${selected.studentProfile.class.section}` : ""}`
                      : "",
                  ],
                ]
                  .filter(([, value]) => value)
                  .map(([label, value]) => (
                    <div key={label} className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 font-bold text-slate-800">
                        {String(value)}
                      </p>
                    </div>
                  ))}
              </div>
              {selected.profileData && (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {Object.entries(selected.profileData)
                    .filter(([, value]) => value)
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-2xl border border-slate-100 p-4"
                      >
                        <p className="text-xs font-black uppercase tracking-wider text-indigo-500">
                          {key.replace(/([A-Z])/g, " $1")}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                          {String(value)}
                        </p>
                      </div>
                    ))}
                </div>
              )}
              {selected.performance && (
                <div className="mt-5 rounded-[24px] bg-gradient-to-r from-blue-50 via-violet-50 to-emerald-50 p-5">
                  <p className="text-xs font-black uppercase tracking-wider text-indigo-600">Class performance · {selected.performance.term?.name ?? "All time"}</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      ["Attendance", `${selected.performance.attendanceRate}%`],
                      ["Academic average", `${selected.performance.academicAverage}%`],
                      ["Exam average", `${selected.performance.examAverage}%`],
                      ["Assignment average", `${selected.performance.assignmentAverage}%`],
                      ["Manual test average", `${selected.performance.manualTestAverage}%`],
                      ["Exams taken", selected.performance.examsTaken],
                      ["Graded assignments", selected.performance.gradedAssignments],
                      ["Manual tests", selected.performance.manualTestsTaken],
                    ].map(([label, value]) => <div key={label} className="rounded-2xl bg-white/80 p-3"><p className="text-[10px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}
                  </div>
                </div>
              )}
            </DialogContent>
            <DialogActions sx={{ p: 3 }}>
              <Button onClick={() => setSelected(null)}>Close</Button>
              <Button startIcon={<EditRoundedIcon />} onClick={beginPersonEdit}>
                Edit profile
              </Button>
              <Button
                color={selected.isActive ? "warning" : "success"}
                onClick={async () => {
                  const path =
                    selected.role === "STUDENT"
                      ? `/school-operations/students/${selected.studentProfile.id}`
                      : `/school-operations/users/${selected.id}`;
                  await api.patch(path, { isActive: !selected.isActive });
                  setSelected({ ...selected, isActive: !selected.isActive });
                  await loadPeople(true);
                }}
              >
                {selected.isActive ? "Deactivate" : "Reactivate"}
              </Button>
              <Button
                color="error"
                startIcon={<DeleteRoundedIcon />}
                onClick={() => void deletePerson()}
              >
                Delete
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      <Dialog
        open={Boolean(editPerson)}
        onClose={() => !saving && setEditPerson(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 5 } }}
      >
        <DialogTitle sx={{ fontWeight: 900 }}>Edit profile</DialogTitle>
        <DialogContent>
          {editPerson && (
            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <PersonEditFields form={editPerson} setForm={setEditPerson} classes={data?.classes ?? []} />
            </div>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setEditPerson(null)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void savePersonEdit()} disabled={saving}>
            {saving ? <CircularProgress size={20} color="inherit" /> : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
function F({
  label,
  v,
  s,
  type = "text",
}: {
  label: string;
  v?: string;
  s: (v: string) => void;
  type?: string;
}) {
  return (
    <TextField
      label={label}
      value={v ?? ""}
      type={type}
      onChange={(e) => s(e.target.value)}
      fullWidth
    />
  );
}
function PersonFields({
  form,
  setForm,
}: {
  form: any;
  setForm: (x: any) => void;
}) {
  return (
    <>
      <F
        label="First name"
        v={form.firstName}
        s={(v) => setForm({ ...form, firstName: v })}
      />
      <F
        label="Last name"
        v={form.lastName}
        s={(v) => setForm({ ...form, lastName: v })}
      />
      <F
        label="Email"
        v={form.email}
        s={(v) => setForm({ ...form, email: v })}
      />
      <F
        label="Username"
        v={form.username}
        s={(v) => setForm({ ...form, username: v })}
      />
      <F
        label="Temporary password"
        type="password"
        v={form.password}
        s={(v) => setForm({ ...form, password: v })}
      />
      <FileUpload
        category="profile-image"
        accept="image/jpeg,image/png,image/webp"
        label="Upload profile picture"
        value={form.avatarUrl ?? ""}
        onChange={(avatarUrl) => setForm({ ...form, avatarUrl })}
      />
      <F
        label="CNIC / B-Form"
        v={form.cnic}
        s={(v) => setForm({ ...form, cnic: v })}
      />
      <F
        label="Date of birth (YYYY-MM-DD)"
        v={form.dateOfBirth}
        s={(v) => setForm({ ...form, dateOfBirth: v })}
      />
      <F
        label="Gender"
        v={form.gender}
        s={(v) => setForm({ ...form, gender: v })}
      />
      <F
        label="Phone number"
        v={form.phone}
        s={(v) => setForm({ ...form, phone: v })}
      />
      <F
        label="Second phone number"
        v={form.alternatePhone}
        s={(v) => setForm({ ...form, alternatePhone: v })}
      />
      <F
        label="WhatsApp number"
        v={form.whatsappNo}
        s={(v) => setForm({ ...form, whatsappNo: v })}
      />
      <F
        label="Residential address"
        v={form.address}
        s={(v) => setForm({ ...form, address: v })}
      />
      {form.role && (
        <>
          <F
            label="Highest qualification and specialization"
            v={form.profileData?.education}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, education: v },
              })
            }
          />
          <F
            label="Institutions, grades and passing years"
            v={form.profileData?.educationHistory}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, educationHistory: v },
              })
            }
          />
          <F
            label="Employment history and experience"
            v={form.profileData?.experience}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, experience: v },
              })
            }
          />
          <F
            label="Training, certifications and skills"
            v={form.profileData?.certifications}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, certifications: v },
              })
            }
          />
          <F
            label="Emergency contact (name, relation, phone)"
            v={form.profileData?.emergencyContact}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, emergencyContact: v },
              })
            }
          />
          <F
            label="References"
            v={form.profileData?.references}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, references: v },
              })
            }
          />
          <F
            label="Position, availability and salary expectation"
            v={form.profileData?.employmentPreferences}
            s={(v) =>
              setForm({
                ...form,
                profileData: { ...form.profileData, employmentPreferences: v },
              })
            }
          />
        </>
      )}
    </>
  );
}

function PersonEditFields({ form, setForm, classes }: { form: any; setForm: (x: any) => void; classes: Overview["classes"] }) {
  const set = (key: string, value: string) => setForm({ ...form, [key]: value });
  const setProfile = (key: string, value: string) =>
    setForm({ ...form, profileData: { ...form.profileData, [key]: value } });
  const profileFields = form.role === "STUDENT"
    ? [
        ["guardianName", "Guardian name"],
        ["guardianCnic", "Guardian CNIC"],
        ["guardianDetails", "Guardian relation and occupation"],
        ["motherDetails", "Mother details"],
        ["emergencyContact", "Emergency contact"],
        ["previousSchool", "Previous school and leaving reason"],
        ["identityDetails", "Nationality / religion / blood group"],
        ["medicalNotes", "Medical and accessibility notes"],
      ]
    : [
        ["education", "Highest qualification and specialization"],
        ["educationHistory", "Education history"],
        ["experience", "Employment history and experience"],
        ["certifications", "Training, certifications and skills"],
        ["emergencyContact", "Emergency contact"],
        ["references", "References"],
        ["employmentPreferences", "Position, availability and salary expectation"],
      ];
  return (
    <>
      <F label="First name" v={form.firstName} s={(v) => set("firstName", v)} />
      <F label="Last name" v={form.lastName} s={(v) => set("lastName", v)} />
      <F label="Email" v={form.email} s={(v) => set("email", v)} />
      {form.role !== "STUDENT" && <F label="Username" v={form.username} s={(v) => set("username", v)} />}
      <F label="CNIC / B-Form" v={form.cnic} s={(v) => set("cnic", v)} />
      <F label="Date of birth (YYYY-MM-DD)" v={form.dateOfBirth} s={(v) => set("dateOfBirth", v)} />
      <F label="Gender" v={form.gender} s={(v) => set("gender", v)} />
      <F label="Phone number" v={form.phone} s={(v) => set("phone", v)} />
      <F label="Second phone number" v={form.alternatePhone} s={(v) => set("alternatePhone", v)} />
      <F label="WhatsApp number" v={form.whatsappNo} s={(v) => set("whatsappNo", v)} />
      <div className="sm:col-span-2"><F label="Residential address" v={form.address} s={(v) => set("address", v)} /></div>
      {form.role === "STUDENT" && (
        <>
          <F label="Admission no" v={form.admissionNo} s={(v) => set("admissionNo", v)} />
          <TextField select SelectProps={{ native: true }} label="Class" value={form.classId ?? ""} onChange={(e) => set("classId", e.target.value)}>
            <option value="">No class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ""}</option>)}
          </TextField>
          <F label="Section" v={form.section} s={(v) => set("section", v)} />
          <F label="Guardian phone" v={form.guardianPhone} s={(v) => set("guardianPhone", v)} />
        </>
      )}
      {profileFields.map(([key, label]) => (
        <F key={key} label={label} v={form.profileData?.[key]} s={(v) => setProfile(key, v)} />
      ))}
    </>
  );
}

function ProfileAvatar({
  reference,
  name,
  size = 54,
}: {
  reference?: string | null;
  name: string;
  size?: number;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!reference) {
      setUrl("");
      return;
    }
    if (!reference.startsWith("storage://")) {
      setUrl(reference);
      return;
    }
    api
      .post("/storage/sign", { reference })
      .then(({ data }) => {
        if (active) setUrl(data.url);
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
    };
  }, [reference]);
  return (
    <Avatar
      src={url || undefined}
      alt={name}
      sx={{ width: size, height: size, bgcolor: "#4f46e5", fontWeight: 900 }}
    >
      {name
        .split(" ")
        .map((x) => x[0])
        .slice(0, 2)
        .join("")}
    </Avatar>
  );
}

function SchoolLogo({
  reference,
  name,
}: {
  reference?: string | null;
  name: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    if (!reference) return;
    if (!reference.startsWith("storage://")) {
      setUrl(reference);
      return;
    }
    api
      .post("/storage/sign", { reference })
      .then(({ data }) => {
        if (active) setUrl(data.url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [reference]);
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[28px] border border-white/25 bg-white/95 p-3 shadow-2xl">
      {url ? (
        <img
          src={url}
          alt={`${name} logo`}
          className="h-full w-full object-contain"
        />
      ) : (
        <SchoolRoundedIcon sx={{ fontSize: 50, color: "#4f46e5" }} />
      )}
    </div>
  );
}
