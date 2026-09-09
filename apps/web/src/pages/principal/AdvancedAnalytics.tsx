import {
  EmojiEventsRounded,
  InsightsRounded,
  WarningAmberRounded,
} from "@mui/icons-material";
import { Alert, MenuItem, Skeleton, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../lib/api";
type Term = {
  id: string;
  name: string;
  academicYear: string;
  isCurrent: boolean;
};
type StudentRow = {
  rank: number;
  studentId: string;
  name: string;
  admissionNo: string;
  class: string;
  examAverage: number;
  assignmentAverage: number;
  attendance: number;
  composite: number;
  needsAttention: boolean;
};
type TeacherRow = {
  teacherId: string;
  name: string;
  classes: number;
  attendanceSessions: number;
  examsCreated: number;
  assignmentsCreated: number;
  gradedExamAverage: number;
  gradedAssignmentSubmissions: number;
};
export default function AdvancedAnalytics() {
  const [terms, setTerms] = useState<Term[]>([]),
    [termId, setTermId] = useState(""),
    [ranking, setRanking] = useState<{
      top: StudentRow[];
      weak: StudentRow[];
    } | null>(null),
    [teachers, setTeachers] = useState<TeacherRow[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api
      .get("/reports/terms")
      .then(({ data }) => {
        setTerms(data);
        const t = data.find((x: Term) => x.isCurrent) ?? data[0];
        if (t) setTermId(t.id);
        else setLoading(false);
      })
      .catch(() => {
        setError("Could not load academic terms.");
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (!termId) return;
    setLoading(true);
    setError("");
    Promise.all([
      api.get("/advanced-analytics/rankings", { params: { termId } }),
      api.get("/advanced-analytics/teacher-performance", {
        params: { termId },
      }),
    ])
      .then(([a, b]) => {
        setRanking(a.data);
        setTeachers(b.data.rows ?? []);
      })
      .catch((e: any) =>
        setError(e?.response?.data?.message ?? "Could not load analytics."),
      )
      .finally(() => setLoading(false));
  }, [termId]);
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eaf2ff,transparent_36%),radial-gradient(circle_at_top_right,#fff2ea,transparent_30%),#f8faff] p-4 text-slate-800 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[32px] border border-white bg-white/80 p-6 shadow-[0_30px_90px_rgba(70,90,140,.12)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[.2em] text-indigo-600">
                Performance intelligence
              </p>
              <h1 className="mt-2 text-3xl font-black md:text-4xl">
                Rankings & intervention
              </h1>
              <p className="mt-2 text-slate-500">
                Term-scoped learning signals. Composite is 85% academics and 15%
                attendance and should support—not replace—educator judgment.
              </p>
            </div>
            <TextField
              select
              label="Academic term"
              value={termId}
              onChange={(e) => setTermId(e.target.value)}
              sx={{ minWidth: 230 }}
            >
              {terms.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} · {t.academicYear}
                </MenuItem>
              ))}
            </TextField>
          </div>
        </header>
        {error && (
          <Alert severity="error" className="mt-5">
            {error}
          </Alert>
        )}
        {!loading && terms.length === 0 ? (
          <Alert severity="info" className="mt-5">
            Create an academic term in Academic analytics before viewing
            rankings.
          </Alert>
        ) : loading ? (
          <div className="mt-6 grid gap-4">
            {[1, 2, 3, 4].map((x) => (
              <Skeleton
                key={x}
                height={130}
                variant="rounded"
                sx={{ borderRadius: 5 }}
              />
            ))}
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-[30px] border border-white bg-white/85 p-6 shadow-xl">
              <h2 className="font-black">Top student composite</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ranking?.top.slice(0, 8) ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="composite" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <section className="rounded-[30px] border border-white bg-white/85 p-6 shadow-xl">
                <div className="mb-4 flex items-center gap-2">
                  <EmojiEventsRounded className="text-amber-500" />
                  <h2 className="text-xl font-black">Top students</h2>
                </div>
                <div className="grid gap-3">
                  {ranking?.top.map((s) => (
                    <article
                      key={s.studentId}
                      className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 p-4"
                    >
                      <div>
                        <p className="font-black">
                          #{s.rank} · {s.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {s.class} · {s.admissionNo}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-indigo-700">
                          {s.composite}%
                        </p>
                        <p className="text-xs text-slate-400">
                          Attendance {s.attendance}%
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="rounded-[30px] border border-white bg-white/85 p-6 shadow-xl">
                <div className="mb-4 flex items-center gap-2">
                  <WarningAmberRounded className="text-rose-500" />
                  <h2 className="text-xl font-black">Needs attention</h2>
                </div>
                <div className="grid gap-3">
                  {ranking?.weak.length ? (
                    ranking.weak.map((s) => (
                      <article
                        key={s.studentId}
                        className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4"
                      >
                        <div className="flex justify-between gap-4">
                          <div>
                            <p className="font-black">{s.name}</p>
                            <p className="text-xs text-slate-500">{s.class}</p>
                          </div>
                          <p className="text-xl font-black text-rose-600">
                            {s.composite}%
                          </p>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <span>Exam {s.examAverage}%</span>
                          <span>Work {s.assignmentAverage}%</span>
                          <span>Attend {s.attendance}%</span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">
                      No students currently cross the intervention thresholds.
                    </p>
                  )}
                </div>
              </section>
            </div>
            <section className="mt-6 rounded-[30px] border border-white bg-white/85 p-6 shadow-xl">
              <div className="mb-4 flex items-center gap-2">
                <InsightsRounded className="text-indigo-600" />
                <h2 className="text-xl font-black">
                  Teacher activity & outcomes
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="p-4">Teacher</th>
                      <th className="p-4">Classes</th>
                      <th className="p-4">Attendance</th>
                      <th className="p-4">Exams</th>
                      <th className="p-4">Assignments</th>
                      <th className="p-4">Exam Avg</th>
                      <th className="p-4">Graded Work</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((t) => (
                      <tr
                        key={t.teacherId}
                        className="border-t border-slate-100"
                      >
                        <td className="p-4 font-black">{t.name}</td>
                        <td className="p-4">{t.classes}</td>
                        <td className="p-4">{t.attendanceSessions}</td>
                        <td className="p-4">{t.examsCreated}</td>
                        <td className="p-4">{t.assignmentsCreated}</td>
                        <td className="p-4 font-bold">
                          {t.gradedExamAverage}%
                        </td>
                        <td className="p-4">{t.gradedAssignmentSubmissions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
