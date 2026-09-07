import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../features/auth/ProtectedRoute';
import LoginPage from '../pages/auth/LoginPage';
import CourseworkHub from '../pages/coursework/CourseworkHub';
import FeeRecoveryPage from '../pages/fees/FeeRecoveryPage';
import StudentFeeLedger from '../pages/fees/StudentFeeLedger';
import ParentDashboard from '../pages/parent/ParentDashboard';
import AdvancedAnalytics from '../pages/principal/AdvancedAnalytics';
import AnnouncementsPage from '../pages/principal/AnnouncementsPage';
import PrincipalAnalytics from '../pages/principal/PrincipalAnalytics';
import PrincipalApprovalCenter from '../pages/principal/PrincipalApprovalCenter';
import PrincipalAttendance from '../pages/principal/PrincipalAttendance';
import PrincipalDashboard from '../pages/principal/PrincipalDashboard';
import PrincipalOperations from '../pages/principal/PrincipalOperations';
import PrincipalSettings from '../pages/principal/PrincipalSettings';
import TeacherAssignmentsPage from '../pages/principal/TeacherAssignmentsPage';
import ReportCardPage from '../pages/reports/ReportCardPage';
import NotificationCenter from '../pages/shared/NotificationCenter';
import StaffRequests from '../pages/staff/StaffRequests';
import StudentAssignments from '../pages/student/StudentAssignments';
import StudentDashboard from '../pages/student/StudentDashboard';
import StudentExamCenter from '../pages/student/StudentExamCenter';
import SuperAdminDashboard from '../pages/super-admin/SuperAdminDashboard';
import SuperAdminSchools from '../pages/super-admin/SuperAdminSchools';
import ExamStudio from '../pages/teacher/ExamStudio';
import TeacherAttendance from '../pages/teacher/TeacherAttendance';
import TeacherDashboard from '../pages/teacher/TeacherDashboard';
import TeacherGrading from '../pages/teacher/TeacherGrading';
import TeacherSubmissionReview from '../pages/teacher/TeacherSubmissionReview';

function DashboardPlaceholder() { return <div className="grid min-h-screen place-items-center bg-[#f7f9ff] text-slate-700">This Nexora portal module is being connected.</div>; }
export default function App(){return <Routes>
<Route path="/login" element={<LoginPage/>}/>
<Route element={<ProtectedRoute roles={['SUPER_ADMIN']}/>}> <Route path="/super-admin" element={<SuperAdminDashboard/>}/><Route path="/super-admin/schools" element={<SuperAdminSchools/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route element={<ProtectedRoute roles={['PRINCIPAL']}/>}> <Route path="/principal" element={<PrincipalDashboard/>}/><Route path="/principal/operations" element={<PrincipalOperations/>}/><Route path="/principal/assignments" element={<TeacherAssignmentsPage/>}/><Route path="/principal/attendance" element={<PrincipalAttendance/>}/><Route path="/principal/settings" element={<PrincipalSettings/>}/><Route path="/principal/approvals" element={<PrincipalApprovalCenter/>}/><Route path="/principal/coursework" element={<CourseworkHub/>}/><Route path="/principal/announcements" element={<AnnouncementsPage/>}/><Route path="/principal/analytics" element={<PrincipalAnalytics/>}/><Route path="/principal/advanced-analytics" element={<AdvancedAnalytics/>}/><Route path="/principal/report-card" element={<ReportCardPage/>}/><Route path="/principal/fees" element={<FeeRecoveryPage/>}/><Route path="/principal/student-fees" element={<StudentFeeLedger/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route element={<ProtectedRoute roles={['STAFF']}/>}> <Route path="/staff/requests" element={<StaffRequests/>}/><Route path="/staff/announcements" element={<AnnouncementsPage/>}/><Route path="/staff/fees" element={<FeeRecoveryPage/>}/><Route path="/staff/student-fees" element={<StudentFeeLedger/>}/><Route path="/dashboard" element={<DashboardPlaceholder/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route element={<ProtectedRoute roles={['TEACHER']}/>}> <Route path="/teacher" element={<TeacherDashboard/>}/><Route path="/teacher/attendance" element={<TeacherAttendance/>}/><Route path="/teacher/grading" element={<TeacherGrading/>}/><Route path="/teacher/submissions" element={<TeacherSubmissionReview/>}/><Route path="/teacher/coursework" element={<CourseworkHub/>}/><Route path="/teacher/report-card" element={<ReportCardPage/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route element={<ProtectedRoute roles={['TEACHER','PRINCIPAL']}/>}> <Route path="/teacher/exams/new" element={<ExamStudio/>}/></Route>
<Route element={<ProtectedRoute roles={['STUDENT']}/>}> <Route path="/student" element={<StudentDashboard/>}/><Route path="/student/exams" element={<StudentExamCenter/>}/><Route path="/student/coursework" element={<CourseworkHub/>}/><Route path="/student/assignments" element={<StudentAssignments/>}/><Route path="/student/report-card" element={<ReportCardPage/>}/><Route path="/student/fees" element={<StudentFeeLedger/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route element={<ProtectedRoute roles={['PARENT']}/>}> <Route path="/parent" element={<ParentDashboard/>}/><Route path="/parent/report-card" element={<ReportCardPage/>}/><Route path="/parent/fees" element={<StudentFeeLedger/>}/><Route path="/notifications" element={<NotificationCenter/>}/></Route>
<Route path="/" element={<Navigate to="/login" replace/>}/><Route path="*" element={<Navigate to="/login" replace/>}/>
</Routes>;}