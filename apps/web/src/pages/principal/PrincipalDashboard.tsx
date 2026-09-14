import AccountBalanceWalletRoundedIcon from "@mui/icons-material/AccountBalanceWalletRounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";
import ClassRoundedIcon from "@mui/icons-material/ClassRounded";
import Groups2RoundedIcon from "@mui/icons-material/Groups2Rounded";
import SchoolRoundedIcon from "@mui/icons-material/SchoolRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { api } from "../../lib/api";

type RecentApproval = {
  id: string;
  requestType: string;
  status: string;
  revision: number;
  updatedAt: string;
};
type PrincipalMetrics = {
  students: number;
  teachers: number;
  pendingApprovals: number;
  classes: number;
  recentApprovals: RecentApproval[];
};
type Attendance = {
  total: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  attendanceRate: number;
};
type Finance = {
  expected: number;
  received: number;
  remaining: number;
  principalCollected: number;
  cashPendingWithStaff: number;
  paidStudents: number;
  totalStudents: number;
  unconfiguredStudents: number;
};

const money = (value: number) =>
  `Rs ${Number(value || 0).toLocaleString("en-PK")}`;
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

function ProgressRing({
  label,
  value,
  color,
  icon,
  details,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  details: React.ReactNode;
}) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnimated(safeValue), 120);
    return () => window.clearTimeout(timer);
  }, [safeValue]);

  return (
    <Tooltip
      arrow
      enterTouchDelay={0}
      leaveTouchDelay={4000}
      title={<Box sx={{ p: 0.75 }}>{details}</Box>}
    >
      <Card
        tabIndex={0}
        sx={{
          height: "100%",
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "0 18px 45px rgba(15,23,42,.08)",
          transition: "transform .22s ease, box-shadow .22s ease",
          "&:hover, &:focus-visible": {
            transform: "translateY(-5px)",
            boxShadow: "0 24px 58px rgba(15,23,42,.14)",
          },
        }}
      >
        <CardContent
          sx={{
            p: { xs: 3, md: 4 },
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            "&:last-child": { pb: { xs: 3, md: 4 } },
          }}
        >
          <Box sx={{ position: "relative", display: "inline-flex" }}>
            <CircularProgress
              variant="determinate"
              value={100}
              size={176}
              thickness={5}
              sx={{ color: "#e2e8f0" }}
            />
            <CircularProgress
              variant="determinate"
              value={animated}
              size={176}
              thickness={5}
              sx={{
                color,
                position: "absolute",
                left: 0,
                transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)",
                "& .MuiCircularProgress-circle": { strokeLinecap: "round" },
              }}
            />
            <Box
              sx={{
                inset: 0,
                position: "absolute",
                display: "grid",
                placeItems: "center",
              }}
            >
              <Box>
                <Box sx={{ color, mb: 0.5 }}>{icon}</Box>
                <Typography variant="h4" fontWeight={900}>
                  {safeValue.toFixed(1)}%
                </Typography>
              </Box>
            </Box>
          </Box>
          <Typography variant="h6" fontWeight={900} sx={{ mt: 2 }}>
            {label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Hover or tap for exact figures
          </Typography>
        </CardContent>
      </Card>
    </Tooltip>
  );
}

export default function PrincipalDashboard() {
  const root = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<PrincipalMetrics | null>(null);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7);
    Promise.all([
      api.get<PrincipalMetrics>("/dashboard/principal"),
      api.get<Attendance>("/attendance/summary"),
      api.get<Finance>("/fees/recovery-dashboard", { params: { month } }),
    ])
      .then(([dashboardResult, attendanceResult, financeResult]) => {
        setMetrics(dashboardResult.data);
        setAttendance(attendanceResult.data);
        setFinance(financeResult.data);
      })
      .catch((requestError: any) =>
        setError(
          requestError?.response?.data?.message ??
            "Dashboard information could not be loaded.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const ctx = gsap.context(() => {
      gsap.from(".principal-section", {
        y: 20,
        opacity: 0,
        stagger: 0.08,
        duration: 0.55,
        ease: "power3.out",
      });
    }, root);
    return () => ctx.revert();
  }, [loading]);

  const cards = useMemo(
    () =>
      metrics
        ? [
            {
              label: "Students",
              value: metrics.students,
              hint: "Active student accounts",
              icon: Groups2RoundedIcon,
              color: "#2563eb",
              background: "#eff6ff",
            },
            {
              label: "Teachers",
              value: metrics.teachers,
              hint: "Active teachers",
              icon: SchoolRoundedIcon,
              color: "#7c3aed",
              background: "#f5f3ff",
            },
            {
              label: "Pending approvals",
              value: metrics.pendingApprovals,
              hint: "Awaiting your review",
              icon: AssignmentTurnedInRoundedIcon,
              color: metrics.pendingApprovals ? "#dc2626" : "#059669",
              background: metrics.pendingApprovals ? "#fef2f2" : "#ecfdf5",
            },
            {
              label: "Classes",
              value: metrics.classes,
              hint: "Configured classes",
              icon: ClassRoundedIcon,
              color: "#059669",
              background: "#ecfdf5",
            },
          ]
        : [],
    [metrics],
  );

  const recoveryRate = finance?.expected
    ? Math.min(100, (finance.received / finance.expected) * 100)
    : 0;

  return (
    <main ref={root} className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 lg:px-10">
      <Box className="mx-auto" sx={{ maxWidth: 1450 }}>
        <Card
          className="principal-section"
          sx={{
            border: "1px solid #dbeafe",
            bgcolor: "#ffffff",
            boxShadow: "0 20px 60px rgba(37,99,235,.09)",
          }}
        >
          <CardContent sx={{ p: { xs: 3, md: 5 }, "&:last-child": { pb: { xs: 3, md: 5 } } }}>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", justifyContent: "space-between" }}>
              <Box>
                <Chip label="Principal command center" color="primary" variant="outlined" />
                <Typography component="h1" variant="h3" sx={{ mt: 2, maxWidth: 760 }}>
                  Everything important, at one glance.
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1.5, maxWidth: 760 }}>
                  Live approvals, attendance, fee recovery and school operations in one clear workspace.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                <Button component={Link} to="/principal/finance" variant="contained" color="success" startIcon={<AccountBalanceWalletRoundedIcon />}>
                  Finance center
                </Button>
                <Button component={Link} to="/principal/approvals" variant="contained" startIcon={<AssignmentTurnedInRoundedIcon />}>
                  Approval center
                </Button>
                <Button component={Link} to="/support" variant="contained" color="secondary" startIcon={<SupportAgentRoundedIcon />}>
                  Support
                </Button>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        <Box className="principal-section" sx={{ mt: 3, display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr 1fr", xl: "repeat(4,1fr)" } }}>
          {loading
            ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} variant="rounded" height={142} />)
            : cards.map((item) => {
                const Icon = item.icon;
                return (
                  <Card key={item.label} sx={{ border: "1px solid", borderColor: "divider", boxShadow: "0 12px 34px rgba(15,23,42,.06)" }}>
                    <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                        <Box>
                          <Typography variant="body2" color="text.secondary" fontWeight={700}>{item.label}</Typography>
                          <Typography variant="h4" fontWeight={900} sx={{ mt: 0.5 }}>{item.value.toLocaleString()}</Typography>
                        </Box>
                        <Box sx={{ width: 46, height: 46, borderRadius: 3, display: "grid", placeItems: "center", color: item.color, bgcolor: item.background }}>
                          <Icon />
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" fontWeight={600}>{item.hint}</Typography>
                    </CardContent>
                  </Card>
                );
              })}
        </Box>

        <Box className="principal-section" sx={{ mt: 3 }}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="overline" color="primary" fontWeight={900}>Live school pulse</Typography>
            <Typography variant="h5" fontWeight={900}>Fees and attendance</Typography>
            <Typography variant="body2" color="text.secondary">Percentages animate on load. Hover or tap a circle to inspect the real totals.</Typography>
          </Box>
          {loading ? (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { md: "1fr 1fr" } }}>
              <Skeleton variant="rounded" height={330} />
              <Skeleton variant="rounded" height={330} />
            </Box>
          ) : (
            <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { md: "1fr 1fr" } }}>
              <ProgressRing
                label="Monthly fee recovery"
                value={recoveryRate}
                color="#059669"
                icon={<AccountBalanceWalletRoundedIcon />}
                details={
                  <>
                    <Typography variant="subtitle2" fontWeight={900}>Monthly fee results</Typography>
                    <Typography variant="body2">Received: {money(finance?.received ?? 0)}</Typography>
                    <Typography variant="body2">Expected: {money(finance?.expected ?? 0)}</Typography>
                    <Typography variant="body2">Outstanding: {money(finance?.remaining ?? 0)}</Typography>
                    <Typography variant="body2">Cash with staff: {money(finance?.cashPendingWithStaff ?? 0)}</Typography>
                  </>
                }
              />
              <ProgressRing
                label="30-day attendance"
                value={attendance?.attendanceRate ?? 0}
                color="#2563eb"
                icon={<TrendingUpRoundedIcon />}
                details={
                  <>
                    <Typography variant="subtitle2" fontWeight={900}>Attendance results</Typography>
                    <Typography variant="body2">Present: {attendance?.present ?? 0}</Typography>
                    <Typography variant="body2">Late: {attendance?.late ?? 0}</Typography>
                    <Typography variant="body2">Absent: {attendance?.absent ?? 0}</Typography>
                    <Typography variant="body2">Leave: {attendance?.leave ?? 0}</Typography>
                    <Typography variant="body2">Total records: {attendance?.total ?? 0}</Typography>
                  </>
                }
              />
            </Box>
          )}
        </Box>

        {!loading && metrics && finance && (
          <Box className="principal-section" sx={{ mt: 3, display: "grid", gap: 2, gridTemplateColumns: { lg: "1fr 1fr" } }}>
            <Card sx={{ border: "1px solid", borderColor: metrics.pendingApprovals ? "#fecaca" : "divider", boxShadow: "0 12px 34px rgba(15,23,42,.06)" }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={900}>Needs attention</Typography>
                <Box sx={{ mt: 2, display: "grid", gap: 1.25 }}>
                  <Alert severity={metrics.pendingApprovals ? "error" : "success"}>
                    {metrics.pendingApprovals
                      ? `${metrics.pendingApprovals} approval request${metrics.pendingApprovals === 1 ? "" : "s"} waiting for review.`
                      : "No approval requests are waiting."}
                  </Alert>
                  {finance.cashPendingWithStaff > 0 && (
                    <Alert severity="warning">{money(finance.cashPendingWithStaff)} is awaiting staff cash handover.</Alert>
                  )}
                  {finance.unconfiguredStudents > 0 && (
                    <Alert severity="info">{finance.unconfiguredStudents} student fee profile{finance.unconfiguredStudents === 1 ? " is" : "s are"} not configured.</Alert>
                  )}
                </Box>
              </CardContent>
            </Card>
            <Card sx={{ border: "1px solid", borderColor: "divider", boxShadow: "0 12px 34px rgba(15,23,42,.06)" }}>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" fontWeight={900}>Recent approval activity</Typography>
                <Box sx={{ mt: 2, display: "grid", gap: 1 }}>
                  {metrics.recentApprovals.length ? metrics.recentApprovals.map((row) => (
                    <Box key={row.id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, bgcolor: "#f8fafc", borderRadius: 3, px: 2, py: 1.5 }}>
                      <Box>
                        <Typography variant="body2" fontWeight={800}>{titleCase(row.requestType)}</Typography>
                        <Typography variant="caption" color="text.secondary">Revision {row.revision}</Typography>
                      </Box>
                      <Chip size="small" label={titleCase(row.status)} color={row.status === "APPROVED" ? "success" : row.status === "REJECTED" ? "error" : "warning"} />
                    </Box>
                  )) : <Typography variant="body2" color="text.secondary">No approval activity yet.</Typography>}
                </Box>
              </CardContent>
            </Card>
          </Box>
        )}
      </Box>
    </main>
  );
}
