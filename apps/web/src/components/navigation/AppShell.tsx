import DashboardRoundedIcon from "@mui/icons-material/DashboardRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import BadgeRoundedIcon from "@mui/icons-material/BadgeRounded";
import FamilyRestroomRoundedIcon from "@mui/icons-material/FamilyRestroomRounded";
import ClassRoundedIcon from "@mui/icons-material/ClassRounded";
import AssignmentIndRoundedIcon from "@mui/icons-material/AssignmentIndRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import QuizRoundedIcon from "@mui/icons-material/QuizRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import ApprovalRoundedIcon from "@mui/icons-material/ApprovalRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import BeachAccessRoundedIcon from "@mui/icons-material/BeachAccessRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import BusinessRoundedIcon from "@mui/icons-material/BusinessRounded";
import WorkspacePremiumRoundedIcon from "@mui/icons-material/WorkspacePremiumRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import {
  Badge,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/AuthProvider";
import { api } from "../../lib/api";

type NavItem = { to: string; label: string; icon: any };

type NavigationBadges = {
  approvals: number;
  notifications: number;
  leave: number;
  feeHandovers: number;
};

type Role =
  "SUPER_ADMIN" | "PRINCIPAL" | "STAFF" | "TEACHER" | "STUDENT" | "PARENT";

const nav: Record<Role, NavItem[]> = {
  SUPER_ADMIN: [
    { to: "/super-admin", label: "Dashboard", icon: DashboardRoundedIcon },
    { to: "/super-admin/schools", label: "Schools", icon: BusinessRoundedIcon },
    {
      to: "/super-admin/plans",
      label: "Plans",
      icon: WorkspacePremiumRoundedIcon,
    },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
    { to: "/support", label: "Support", icon: SupportAgentRoundedIcon },
  ],
  PRINCIPAL: [
    { to: "/principal", label: "Dashboard", icon: DashboardRoundedIcon },
    {
      to: "/principal/operations",
      label: "Students · Teachers · Staff",
      icon: GroupsRoundedIcon,
    },
    {
      to: "/principal/operations",
      label: "Classes & Subjects",
      icon: ClassRoundedIcon,
    },
    {
      to: "/principal/assignments",
      label: "Teacher Assignments",
      icon: AssignmentIndRoundedIcon,
    },
    {
      to: "/principal/timetable",
      label: "Timetable",
      icon: CalendarMonthRoundedIcon,
    },
    {
      to: "/principal/attendance",
      label: "Attendance",
      icon: FactCheckRoundedIcon,
    },
    {
      to: "/principal/coursework",
      label: "Coursework",
      icon: MenuBookRoundedIcon,
    },
    {
      to: "/principal/manual-tests",
      label: "Manual Tests",
      icon: AssessmentRoundedIcon,
    },
    { to: "/teacher/exams/new", label: "Exam Studio", icon: QuizRoundedIcon },
    {
      to: "/principal/report-card",
      label: "Report Cards",
      icon: AssessmentRoundedIcon,
    },
    { to: "/principal/finance", label: "Finance", icon: PaymentsRoundedIcon },
    { to: "/principal/fees", label: "Fee Recovery", icon: PaymentsRoundedIcon },
    {
      to: "/principal/approvals",
      label: "Approvals",
      icon: ApprovalRoundedIcon,
    },
    {
      to: "/principal/announcements",
      label: "Announcements",
      icon: CampaignRoundedIcon,
    },
    { to: "/principal/calendar", label: "Calendar", icon: EventRoundedIcon },
    {
      to: "/principal/leave",
      label: "Leave Center",
      icon: BeachAccessRoundedIcon,
    },
    {
      to: "/principal/analytics",
      label: "Analytics",
      icon: InsightsRoundedIcon,
    },
    {
      to: "/principal/advanced-analytics",
      label: "Advanced Analytics",
      icon: InsightsRoundedIcon,
    },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
    {
      to: "/principal/settings",
      label: "School Settings",
      icon: SettingsRoundedIcon,
    },
    { to: "/support", label: "Support", icon: SupportAgentRoundedIcon },
  ],
  STAFF: [
    { to: "/staff", label: "Dashboard", icon: DashboardRoundedIcon },
    {
      to: "/staff/students",
      label: "Student Records",
      icon: GroupsRoundedIcon,
    },
    { to: "/staff/requests", label: "Requests", icon: ApprovalRoundedIcon },
    { to: "/staff/fees", label: "Fee Recovery", icon: PaymentsRoundedIcon },
    {
      to: "/staff/student-fees",
      label: "Student Fees",
      icon: PaymentsRoundedIcon,
    },
    {
      to: "/staff/timetable",
      label: "Timetable",
      icon: CalendarMonthRoundedIcon,
    },
    {
      to: "/staff/announcements",
      label: "Announcements",
      icon: CampaignRoundedIcon,
    },
    { to: "/staff/calendar", label: "Calendar", icon: EventRoundedIcon },
    { to: "/staff/leave", label: "Leave Center", icon: BeachAccessRoundedIcon },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
    { to: "/support", label: "Support", icon: SupportAgentRoundedIcon },
  ],
  TEACHER: [
    { to: "/teacher", label: "Dashboard", icon: DashboardRoundedIcon },
    {
      to: "/teacher/timetable",
      label: "Timetable",
      icon: CalendarMonthRoundedIcon,
    },
    {
      to: "/teacher/attendance",
      label: "Attendance",
      icon: FactCheckRoundedIcon,
    },
    {
      to: "/teacher/coursework",
      label: "Coursework",
      icon: MenuBookRoundedIcon,
    },
    {
      to: "/teacher/manual-tests",
      label: "Manual Tests",
      icon: AssessmentRoundedIcon,
    },
    { to: "/teacher/exams/new", label: "Exam Studio", icon: QuizRoundedIcon },
    { to: "/teacher/grading", label: "Grading", icon: AssessmentRoundedIcon },
    {
      to: "/teacher/submissions",
      label: "Submissions",
      icon: FactCheckRoundedIcon,
    },
    {
      to: "/teacher/report-card",
      label: "Report Cards",
      icon: AssessmentRoundedIcon,
    },
    { to: "/teacher/calendar", label: "Calendar", icon: EventRoundedIcon },
    { to: "/teacher/leave", label: "Leave", icon: BeachAccessRoundedIcon },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
  ],
  STUDENT: [
    { to: "/student", label: "Dashboard", icon: DashboardRoundedIcon },
    {
      to: "/student/timetable",
      label: "Timetable",
      icon: CalendarMonthRoundedIcon,
    },
    {
      to: "/student/coursework",
      label: "Coursework",
      icon: MenuBookRoundedIcon,
    },
    {
      to: "/student/assignments",
      label: "Assignments",
      icon: FactCheckRoundedIcon,
    },
    {
      to: "/student/manual-tests",
      label: "Test Results",
      icon: AssessmentRoundedIcon,
    },
    { to: "/student/exams", label: "Exams", icon: QuizRoundedIcon },
    {
      to: "/student/report-card",
      label: "Report Card",
      icon: AssessmentRoundedIcon,
    },
    { to: "/student/fees", label: "Fees", icon: PaymentsRoundedIcon },
    { to: "/student/calendar", label: "Calendar", icon: EventRoundedIcon },
    { to: "/student/leave", label: "Leave", icon: BeachAccessRoundedIcon },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
  ],
  PARENT: [
    { to: "/parent", label: "Dashboard", icon: DashboardRoundedIcon },
    {
      to: "/parent/coursework",
      label: "Coursework",
      icon: MenuBookRoundedIcon,
    },
    {
      to: "/parent/report-card",
      label: "Report Card",
      icon: AssessmentRoundedIcon,
    },
    { to: "/parent/fees", label: "Fees", icon: PaymentsRoundedIcon },
    {
      to: "/parent/timetable",
      label: "Timetable",
      icon: CalendarMonthRoundedIcon,
    },
    { to: "/parent/calendar", label: "Calendar", icon: EventRoundedIcon },
    {
      to: "/notifications",
      label: "Notifications",
      icon: NotificationsRoundedIcon,
    },
  ],
};

const roleTitle: Record<Role, string> = {
  SUPER_ADMIN: "Platform Control",
  PRINCIPAL: "Principal Portal",
  STAFF: "Staff Workspace",
  TEACHER: "Teacher Studio",
  STUDENT: "Student Hub",
  PARENT: "Parent Portal",
};

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [badges, setBadges] = useState<NavigationBadges | null>(null);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (user?.role !== "PRINCIPAL") {
      setBadges(null);
      return;
    }
    let active = true;
    const loadBadges = () =>
      api
        .get<NavigationBadges>("/dashboard/navigation-badges")
        .then(({ data }) => active && setBadges(data))
        .catch(() => undefined);
    void loadBadges();
    const timer = window.setInterval(loadBadges, 45_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.role, location.pathname]);
  const items = useMemo(() => (user ? nav[user.role] : []), [user]);
  if (!user) return <>{children}</>;
  const schoolName = user.school?.name ?? "Nexora LMS";
  const initials =
    `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const doLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 lg:grid lg:grid-cols-[290px_minmax(0,1fr)]">
      <Tooltip title="Open navigation">
        <IconButton
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
          className="fixed! left-4 top-4 z-[70] h-12! w-12! bg-blue-600! text-white! shadow-[0_14px_34px_rgba(37,99,235,.28)]! lg:hidden!"
        >
          <MenuRoundedIcon />
        </IconButton>
      </Tooltip>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-[90] flex w-[290px] flex-col overflow-hidden border-r border-white/70 bg-white/80 p-4 shadow-[24px_0_80px_rgba(30,41,59,.15)] backdrop-blur-2xl transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="pointer-events-none absolute -left-24 -top-20 h-56 w-56 rounded-full bg-blue-400/25 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-40 h-56 w-56 rounded-full bg-emerald-300/15 blur-3xl" />
        <div className="relative rounded-[26px] border border-slate-200 bg-white p-[1px] shadow-[0_18px_45px_rgba(51,65,85,.12)]">
          <div className="rounded-[24px] bg-slate-50 p-4 text-slate-900">
            <div className="flex items-start justify-between">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg">
                <SchoolRoundedIcon />
              </div>
              <IconButton
                aria-label="Close navigation"
                onClick={() => setOpen(false)}
                className="bg-white/10! text-white! lg:hidden!"
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </div>
            <Typography
              component="p"
              variant="overline"
              className="mt-4! text-blue-600!"
            >
              Nexora LMS
            </Typography>
            <Typography
              component="h2"
              variant="h6"
              noWrap
              className="mt-1! text-slate-900!"
            >
              {schoolName}
            </Typography>
            <div className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500">
              <AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />
              <span>{roleTitle[user.role]}</span>
            </div>
          </div>
        </div>
        <nav className="relative mt-4 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          <List disablePadding className="space-y-1">
            {items.map(({ to, label, icon: Icon }) => {
              const rootRoute = [
                "/principal",
                "/staff",
                "/teacher",
                "/student",
                "/parent",
                "/super-admin",
              ].includes(to);
              const active = rootRoute
                ? location.pathname === to
                : location.pathname === to ||
                  location.pathname.startsWith(`${to}/`);
              const pendingCount =
                to === "/principal/approvals"
                  ? badges?.approvals
                  : to === "/principal/leave"
                    ? badges?.leave
                    : to === "/principal/fees"
                      ? badges?.feeHandovers
                      : to === "/notifications"
                        ? badges?.notifications
                        : 0;
              return (
                <ListItemButton
                  key={`${to}-${label}`}
                  selected={active}
                  onClick={() => navigate(to)}
                  sx={{
                    borderRadius: 3,
                    minHeight: 48,
                    color: "#64748b",
                    "&:hover": {
                      bgcolor: "#eff6ff",
                      color: "#1d4ed8",
                      transform: "translateX(4px)",
                    },
                    "&.Mui-selected": {
                      bgcolor: "#ecfdf5",
                      color: "#047857",
                      boxShadow: "inset 3px 0 #10b981",
                      "&:hover": { bgcolor: "#d1fae5" },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40, color: "inherit" }}>
                    <Badge
                      color="error"
                      variant="dot"
                      invisible={!pendingCount}
                      overlap="circular"
                    >
                      <Icon sx={{ fontSize: 21 }} />
                    </Badge>
                  </ListItemIcon>
                  <ListItemText
                    primary={label}
                    primaryTypographyProps={{
                      fontSize: 14,
                      fontWeight: 850,
                      noWrap: true,
                    }}
                  />
                  <ChevronRightRoundedIcon
                    sx={{ fontSize: 18, opacity: active ? 1 : 0.3 }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </nav>
        <div className="relative mt-3 rounded-[24px] border border-white bg-white/80 p-3 shadow-[0_14px_40px_rgba(15,23,42,.08)]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-600 font-black text-white shadow-lg">
              {initials}
            </div>
            <div className="min-w-0">
              <Typography variant="subtitle2" noWrap fontWeight={900}>
                {user.firstName} {user.lastName}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                className="uppercase tracking-wide! text-slate-400!"
              >
                {user.role.replaceAll("_", " ")}
              </Typography>
            </div>
          </div>
          <Button
            variant="contained"
            color="error"
            fullWidth
            startIcon={<LogoutRoundedIcon fontSize="small" />}
            onClick={() => void doLogout()}
            className="mt-3!"
          >
            Logout
          </Button>
        </div>
      </aside>
      <section className="min-w-0 pt-16 lg:pt-0">
        <header className="sticky top-0 z-[60] border-b border-white/70 bg-white/75 px-4 py-3 shadow-[0_12px_40px_rgba(15,23,42,.08)] backdrop-blur-2xl sm:px-7">
          <div className="mx-auto flex max-w-[1500px] items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-blue-600 text-white shadow-lg">
              {user.school?.logoUrl ? (
                <img
                  src={user.school.logoUrl}
                  alt={`${schoolName} logo`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <SchoolRoundedIcon />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Typography variant="h6" component="p" noWrap fontWeight={900}>
                {schoolName}
              </Typography>
              <Typography
                variant="caption"
                component="p"
                noWrap
                color="text.secondary"
                fontWeight={600}
              >
                {user.school?.description ||
                  (user.role === "SUPER_ADMIN"
                    ? "Secure multi-school administration"
                    : "Learning, progress and school operations")}
              </Typography>
            </div>
            <div className="hidden rounded-2xl bg-blue-50 px-4 py-2 text-right sm:block">
              <Typography
                variant="overline"
                component="p"
                className="text-blue-600!"
              >
                Current workspace
              </Typography>
              <Typography variant="subtitle2" component="p" fontWeight={900}>
                {roleTitle[user.role]}
              </Typography>
            </div>
          </div>
        </header>
        <div key={location.pathname} className="page-transition">
          {children}
        </div>
      </section>
    </div>
  );
}
