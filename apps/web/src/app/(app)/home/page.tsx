'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/auth';
import { useData } from '@/components/useData';
import { Avatar } from '@/components/Avatar';
import { AreaChart, CountUp, Gauge, Hero, HeroAction, KpiCard, Panel, PanelLink, Tilt, TodoRow } from '@/components/fx';
import { Badge, Empty, ErrorBox, Loading } from '@/components/ui';
import { TodayList } from '@/components/TimetableGrid';
import { CATEGORY_LABEL, categoryTone, type RemarkCategory } from '@/components/progress/Remarks';
import { fileUrl } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import type { MyTimetable } from './timetable/page';

interface TeacherDash {
  role: 'TEACHER';
  today: string;
  sections: { id: string; label: string; students: number; classTeacher: boolean; subjects: string[]; attendanceMarked: boolean; attendancePercent: number | null; absent: number; homeworkToday: number }[];
  students: number;
  attendanceTrend: { date: string; percent: number }[];
  pendingSheets: { id: string; paperId: string; title: string; status: string; sectionLabel: string }[];
  pendingSheetCount: number;
  unreadMessages: number;
  onlineToCheck: number;
  reportedChat: number;
  syllabus: number | null;
  top: { title: string; rows: { id: string; fullName: string; classLabel: string; photoFileId: string | null; percent: number; position: number }[] } | null;
  upcomingExams: { id: string; title: string; date: string | null; subject: string; classLabel: string }[];
}
interface Child {
  student: { id: string; fullName: string; photoFileId: string | null; rollNo: string | null; classLabel: string };
  attendance: { percent: number | null; days: number; absent: number; today: string | null };
  fees: { due: number; overdue: boolean } | null;
  results: { assessmentId: string; title: string; percent: number; grade: string; position: number | null }[];
  homeworkToday: number;
  remarks: { id: string; category: RemarkCategory; text: string; date: string }[];
  honors: { id: string; name: string; icon: string; period: string }[];
  onlineExams: { id: string; title: string; startAt: string | null; endAt: string | null }[];
}
interface FamilyDash {
  role: 'FAMILY';
  today: string;
  children: Child[];
  circulars: { unread: number; latest: { id: string; title: string; createdAt: string; read: boolean }[] };
  albums: { id: string; title: string; cover: string | null }[];
}

const dayShort = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const statusText: Record<string, { label: string; tone: string }> = {
  PRESENT: { label: 'Present today', tone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  LATE: { label: 'Late today', tone: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
  ABSENT: { label: 'Absent today', tone: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  LEAVE: { label: 'On leave today', tone: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200' },
  HALF_DAY: { label: 'Half day today', tone: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
};
const medal = ['🥇', '🥈', '🥉'];

function greet() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomePage() {
  const { me } = useAuth();
  const { data, error, loading } = useData<TeacherDash | FamilyDash>('/dashboard');
  const hasTT = (me?.school?.plan.modules ?? []).includes('timetable');
  const { data: tt } = useData<MyTimetable>(hasTT ? '/timetable/my' : null);
  if (!me) return null;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return data.role === 'TEACHER' ? <Teacher d={data} tt={tt} /> : <Family d={data} tt={tt} />;
}

function Teacher({ d, tt }: { d: TeacherDash; tt?: MyTimetable | null }) {
  const { me } = useAuth();
  const mods = me?.school?.plan.modules ?? [];
  const own = d.sections.filter((s) => s.classTeacher);
  const unmarked = own.filter((s) => !s.attendanceMarked);
  const todo = [
    mods.includes('attendance') && unmarked.length > 0 && { href: '/home/attendance', icon: '✓', label: `Mark attendance: ${unmarked.map((s) => s.label).join(', ')}`, count: unmarked.length, tone: 'amber' as const },
    d.pendingSheetCount > 0 && { href: '/home/marks', icon: '✎', label: 'Marks to enter or correct', count: d.pendingSheetCount, tone: 'blue' as const },
    d.onlineToCheck > 0 && { href: '/online-exams', icon: '⌨', label: 'Online exams to check', count: d.onlineToCheck, tone: 'teal' as const },
    d.unreadMessages > 0 && { href: '/conversations', icon: '✉', label: 'Unread parent messages', count: d.unreadMessages, tone: 'emerald' as const },
    d.reportedChat > 0 && { href: '/chat', icon: '⚑', label: 'Reported chat messages', count: d.reportedChat, tone: 'rose' as const },
  ].filter(Boolean) as { href: string; icon: string; label: string; count: number; tone: 'amber' | 'blue' | 'teal' | 'emerald' | 'rose' }[];
  return (
    <>
      <Hero eyebrow={new Date(`${d.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} title={`${greet()}, ${me?.user.fullName.split(' ')[0]}`} subtitle={`You teach ${d.students} students in ${d.sections.length} class${d.sections.length === 1 ? '' : 'es'}.`}>
        {mods.includes('attendance') && own.length > 0 && <HeroAction href="/home/attendance" icon="✓">Mark attendance</HeroAction>}
        {mods.includes('lms') && <HeroAction href="/homework" icon="✐">Post homework</HeroAction>}
        {mods.includes('exams') && <HeroAction href="/home/marks" icon="✎">Enter marks</HeroAction>}
        {mods.includes('class_chat') && <HeroAction href="/chat" icon="❝">Class chat</HeroAction>}
      </Hero>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard i={0} label="My students" icon="☺" tone="blue" value={<CountUp value={d.students} />} hint={`${d.sections.length} classes`} />
          <KpiCard i={1} label="Marks pending" icon="✎" tone="amber" href="/home/marks" value={<CountUp value={d.pendingSheetCount} />} hint="sheets to enter or fix" />
          <KpiCard i={2} label="Parent messages" icon="✉" tone="emerald" href={mods.includes('parent_messaging') ? '/conversations' : undefined} value={<CountUp value={d.unreadMessages} />} hint="unread" />
          <KpiCard i={3} label={d.syllabus !== null ? 'Syllabus covered' : 'Online to check'} icon={d.syllabus !== null ? '☷' : '⌨'} tone="teal" href={d.syllabus !== null ? '/syllabus' : '/online-exams'} value={d.syllabus !== null ? <CountUp value={d.syllabus} decimals={1} suffix="%" /> : <CountUp value={d.onlineToCheck} />} hint={d.syllabus !== null ? 'in your classes' : 'papers'} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <Panel i={1} className="lg:col-span-2" title="My classes today">
            {!d.sections.length ? (
              <Empty title="No classes assigned yet">The principal assigns classes in Teacher assignments.</Empty>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {d.sections.map((s, i) => (
                  <Tilt key={s.id} max={6} className="rounded-2xl" style={{ '--i': i } as CSSProperties}>
                    <Link href={`/home/sections/${s.id}`} className={`group block h-full rounded-2xl border p-4 transition-shadow duration-300 hover:shadow-xl ${s.classTeacher ? 'border-sky-200 bg-sky-50/50 hover:shadow-sky-600/10' : 'border-gray-200 bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">{s.classTeacher ? 'Class teacher' : s.subjects.join(', ')}</div>
                          <div className="mt-0.5 text-lg font-semibold tracking-tight">{s.label}</div>
                          <div className="text-sm text-gray-500">{s.students} students</div>
                        </div>
                        {s.attendancePercent !== null ? <Gauge value={s.attendancePercent} size={60} stroke={6} /> : s.classTeacher && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not marked</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {s.attendancePercent !== null && <span className="rounded-full bg-white px-2 py-1 shadow-sm ring-1 ring-gray-200">{s.absent} absent</span>}
                        <span className={`rounded-full px-2 py-1 ring-1 ${s.homeworkToday ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-gray-500 ring-gray-200'}`}>{s.homeworkToday ? `✓ ${s.homeworkToday} homework posted` : 'No homework yet'}</span>
                      </div>
                    </Link>
                  </Tilt>
                ))}
              </div>
            )}
          </Panel>
          <Panel i={2} title="To do">
            {todo.length ? (
              <div className="-mx-2 space-y-0.5">
                {todo.map((t) => (
                  <TodoRow key={t.label} {...t} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <span className="mb-2 flex h-12 w-12 animate-pop items-center justify-center rounded-2xl bg-emerald-50 text-xl text-emerald-600">✓</span>
                <p className="text-sm font-medium">All caught up</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {tt?.week && (
            <Panel i={3} title="Today’s timetable" action={<PanelLink href="/home/timetable">Full week</PanelLink>}>
              <TodayList week={tt.week} mode="teacher" now={tt.now} />
            </Panel>
          )}
          {d.attendanceTrend.length > 1 && (
            <Panel i={4} className={tt?.week ? 'lg:col-span-2' : 'lg:col-span-3'} title={`Attendance · ${own.map((s) => s.label).join(', ')}`}>
              <AreaChart data={d.attendanceTrend.map((x) => ({ label: dayShort(x.date), value: x.percent }))} max={100} format={(v) => `${v}%`} height={180} color="#059669" />
            </Panel>
          )}
          {d.top && d.top.rows.length > 0 && (
            <Panel i={5} title={`Top students · ${d.top.title}`} action={<PanelLink href="/rankings">Rankings</PanelLink>}>
              <ol className="space-y-2.5">
                {d.top.rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3">
                    <span className="w-6 text-center text-lg">{medal[r.position - 1] ?? r.position}</span>
                    <Avatar fileId={r.photoFileId} name={r.fullName} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.fullName}</span>
                      <span className="block truncate text-xs text-gray-500">{r.classLabel}</span>
                    </span>
                    <span className="text-sm font-semibold">{r.percent}%</span>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
          {d.upcomingExams.length > 0 && (
            <Panel i={6} title="Upcoming exam papers">
              <ul className="space-y-2.5">
                {d.upcomingExams.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex items-center gap-3 text-sm">
                    <span className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                      <span className="text-[10px] uppercase">{e.date ? new Date(`${e.date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '—'}</span>
                      <span className="text-sm font-bold leading-none">{e.date ? Number(e.date.slice(8)) : ''}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {e.subject} · {e.classLabel}
                      </span>
                      <span className="block truncate text-xs text-gray-500">{e.title}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function Family({ d, tt }: { d: FamilyDash; tt?: MyTimetable | null }) {
  const { me } = useAuth();
  const mods = me?.school?.plan.modules ?? [];
  const [idx, setIdx] = useState(0);
  const c = d.children[idx];
  const isParent = me?.user.role === 'PARENT';
  if (!c) return <Empty title="No children linked to this account" />;
  const latest = c.results[c.results.length - 1];
  const childTT = tt?.children?.find((x) => x.student.id === c.student.id);
  const st = c.attendance.today ? statusText[c.attendance.today] : null;
  return (
    <>
      <Hero
        eyebrow={new Date(`${d.today}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
        title={isParent ? `${greet()}, ${me?.user.fullName.split(' ')[0]}` : `${greet()}, ${c.student.fullName.split(' ')[0]}`}
        subtitle={isParent ? `Here is how ${d.children.length > 1 ? 'your children are' : `${c.student.fullName.split(' ')[0]} is`} doing.` : `${c.student.classLabel} · ${me?.school?.name}`}
        aside={
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm backdrop-blur">
            <span className="rounded-full ring-4 ring-slate-100">
              <Avatar fileId={c.student.photoFileId} name={c.student.fullName} size={64} />
            </span>
            <div>
              <div className="font-semibold text-slate-900">{c.student.fullName}</div>
              <div className="text-sm text-slate-500">
                {c.student.classLabel}
                {c.student.rollNo && ` · Roll ${c.student.rollNo}`}
              </div>
              {st && <span className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${st.tone}`}>{st.label}</span>}
            </div>
          </div>
        }
      >
        {d.children.length > 1 &&
          d.children.map((k, i) => (
            <button key={k.student.id} onClick={() => setIdx(i)} className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition duration-300 active:scale-95 ${i === idx ? 'bg-slate-900 text-white shadow-md' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <Avatar fileId={k.student.photoFileId} name={k.student.fullName} size={22} />
              {k.student.fullName.split(' ')[0]}
            </button>
          ))}
        {d.children.length <= 1 && mods.includes('lms') && <HeroAction href="/home/homework" icon="✐">Today’s homework</HeroAction>}
        {d.children.length <= 1 && mods.includes('exams') && <HeroAction href="/home/results" icon="✎">Results</HeroAction>}
        {d.children.length <= 1 && isParent && mods.includes('parent_messaging') && <HeroAction href="/conversations" icon="✉">Message a teacher</HeroAction>}
      </Hero>

      <div key={c.student.id} className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard i={0} label="Attendance this month" icon="✓" tone="emerald" href="/home/attendance" value={c.attendance.percent === null ? '—' : <CountUp value={c.attendance.percent} decimals={c.attendance.percent % 1 ? 1 : 0} suffix="%" />} hint={c.attendance.days ? `${c.attendance.absent} absent of ${c.attendance.days} days` : 'Not marked yet'} />
          {c.fees ? (
            <KpiCard i={1} label="Fee due" icon="₨" tone={c.fees.due > 0 ? 'rose' : 'emerald'} href="/home/fees" value={c.fees.due > 0 ? <CountUp value={c.fees.due} prefix={`${me?.school?.currency ?? 'PKR'} `} /> : 'All clear'} hint={c.fees.due > 0 ? (c.fees.overdue ? 'Overdue – please pay' : 'Pay before the due date') : 'No dues'} />
          ) : (
            <KpiCard i={1} label="Remarks" icon="✍" tone="teal" href="/home/remarks" value={<CountUp value={c.remarks.length} />} hint="recent" />
          )}
          <KpiCard i={2} label="Latest result" icon="✎" tone="blue" href="/home/results" value={latest ? <CountUp value={latest.percent} decimals={latest.percent % 1 ? 1 : 0} suffix="%" /> : '—'} hint={latest ? `${latest.title} · grade ${latest.grade}${latest.position ? ` · position ${latest.position}` : ''}` : 'No results yet'} />
          <KpiCard i={3} label="Homework today" icon="✐" tone="amber" href="/home/homework" value={<CountUp value={c.homeworkToday} />} hint={c.homeworkToday ? 'subjects – tap to see' : 'Nothing posted yet'} />
        </div>

        {c.onlineExams.length > 0 && !isParent && (
          <div className="reveal flex flex-wrap items-center gap-3 rounded-2xl bg-teal-600 p-4 text-white shadow-lg shadow-teal-600/20">
            <span className="text-2xl">⌨</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Online exam: {c.onlineExams[0].title}</div>
              <div className="text-sm text-white/80">Open until {dateTime(c.onlineExams[0].endAt)}</div>
            </div>
            <Link href="/home/online-exams" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-teal-700 shadow transition hover:-translate-y-0.5 active:scale-95">
              Go to exam
            </Link>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {c.results.length > 1 ? (
            <Panel i={1} className="lg:col-span-2" title="Results over time" action={<PanelLink href="/home/results">All results</PanelLink>}>
              <AreaChart data={c.results.map((r) => ({ label: r.title.length > 12 ? `${r.title.slice(0, 11)}…` : r.title, value: r.percent }))} max={100} format={(v) => `${v}%`} color="#d97706" height={190} />
            </Panel>
          ) : (
            childTT && (
              <Panel i={1} className="lg:col-span-2" title="Today’s timetable" action={<PanelLink href="/home/timetable">Full week</PanelLink>}>
                {childTT.hasSection ? <TodayList week={childTT.week} mode="class" now={tt!.now} /> : <p className="text-sm text-gray-500">No section assigned yet.</p>}
              </Panel>
            )
          )}
          <Panel i={2} title="Notices" action={<PanelLink href="/circulars" />}>
            {!d.circulars.latest.length ? (
              <p className="text-sm text-gray-500">No circulars yet.</p>
            ) : (
              <ul className="space-y-2">
                {d.circulars.latest.map((x) => (
                  <li key={x.id}>
                    <Link href={`/circulars?id=${x.id}`} className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-gray-50">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.read ? 'bg-gray-200' : 'animate-pulse bg-brand-500'}`} />
                      <span className="min-w-0">
                        <span className={`block truncate text-sm ${x.read ? 'text-gray-600' : 'font-semibold'}`}>{x.title}</span>
                        <span className="text-xs text-gray-400">{date(x.createdAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {c.results.length > 1 && childTT && (
            <Panel i={3} title="Today’s timetable" action={<PanelLink href="/home/timetable">Full week</PanelLink>}>
              {childTT.hasSection ? <TodayList week={childTT.week} mode="class" now={tt!.now} /> : <p className="text-sm text-gray-500">No section assigned yet.</p>}
            </Panel>
          )}
          <Panel i={4} title="Teachers’ remarks" action={<PanelLink href="/home/remarks" />}>
            {!c.remarks.length ? (
              <p className="text-sm text-gray-500">No remarks yet.</p>
            ) : (
              <ul className="space-y-3">
                {c.remarks.map((r) => (
                  <li key={r.id} className="text-sm">
                    <Badge tone={categoryTone[r.category]}>{CATEGORY_LABEL[r.category]}</Badge> <span className="text-xs text-gray-400">{date(r.date)}</span>
                    <p className="mt-1 line-clamp-3 text-gray-700">{r.text}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {mods.includes('honors') && (
            <Panel i={5} title="Honors" action={<PanelLink href="/honors">Honor board</PanelLink>}>
              {!c.honors.length ? (
                <p className="text-sm text-gray-500">Keep going – honors appear here.</p>
              ) : (
                <ul className="grid gap-2">
                  {c.honors.map((h, i) => (
                    <li key={h.id} className="flex animate-pop items-center gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200" style={{ animationDelay: `${i * 90}ms` }}>
                      <span className="text-2xl">{h.icon}</span>
                      <span className="text-sm">
                        <span className="block font-semibold text-amber-900">{h.name}</span>
                        <span className="text-xs text-amber-800">{/^\d{4}-\d{2}$/.test(h.period) ? new Date(`${h.period}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : h.period}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {d.albums.length > 0 && (
            <Panel i={6} title="From the gallery" action={<PanelLink href="/gallery" />}>
              <div className="grid grid-cols-2 gap-2">
                {d.albums.map((a) => (
                  <Link key={a.id} href={`/gallery/${a.id}`} className="group relative aspect-[4/3] overflow-hidden rounded-xl bg-gray-100">
                    {a.cover && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(a.cover)} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-110" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-xs font-medium text-white">{a.title}</span>
                  </Link>
                ))}
              </div>
            </Panel>
          )}
          {c.fees && c.fees.due > 0 && (
            <Panel i={7} title="Fees">
              <p className="text-sm text-gray-600">
                {money(c.fees.due, me?.school?.currency)} is due{c.fees.overdue ? ' and overdue' : ''}.
              </p>
              <Link href="/home/fees" className="mt-3 inline-flex rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-md shadow-brand-600/25 transition hover:-translate-y-px active:scale-95">
                View vouchers & pay
              </Link>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
