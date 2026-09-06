import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../features/auth/ProtectedRoute';
import LoginPage from '../pages/auth/LoginPage';
import ParentDashboard from '../pages/parent/ParentDashboard';
import PrincipalApprovalCenter from '../pages/principal/PrincipalApprovalCenter';
import PrincipalAttendance from '../pages/principal/PrincipalAttendance';
import PrincipalDashboard from '../pages/principal/PrincipalDashboard';
import PrincipalOperations from '../pages/principal/PrincipalOperations';
import PrincipalSettings from '../pages/principal/PrincipalSettings';
import TeacherAssignmentsPage from '../pages/principal/TeacherAssignmentsPage';
import StaffRequests from '../pages/staff/StaffRequests';
import StudentDashboard from '../pages/student/StudentDashboard';
import StudentExamCenter from '../pages/student/StudentExamCenter';
import SuperAdminDashboard from '../pages/super-admin/SuperAdminDashboard';
import SuperAdminSchools from '../pages/super-admin/SuperAdminSchools';
import ExamStudio from '../pages/teacher/ExamStudio';
import TeacherAttendance from '../pages/teacher/TeacherAttendance';
import TeacherDashboard from '../pages/teacher/TeacherDashboard';
import TeacherGrading from '../pages/teacher/TeacherGrading';

function DashboardPlaceholder() {
  return <div className="grid min-h-screen place-items-center bg-[#f7f9ff] text-slate-700">This Nexora portal module is being connected.</div>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute roles={['SUPER_ADMIN']} />}>
        <Route path="/super-admin" element={<SuperAdminDashboard />} />
        <Route path="/super-admin/schools" element={<SuperAdminSchools />} />
      </Route>
      <Route element={<ProtectedRoute roles={['PRINCIPAL']} />}>
        <Route path="/principal" element={<PrincipalDashboard />} />
        <Route path="/principal/operations" element={<PrincipalOperations />} />
        <Route path="/principal/assignments" element={<TeacherAssignmentsPage />} />
        <Route path="/principal/attendance" element={<PrincipalAttendance />} />
        <Route path="/principal/settings" element={<PrincipalSettings />} />
        <Route path="/principal/approvals" element={<PrincipalApprovalCenter />} />
      </Route>
      <Route element={<ProtectedRoute roles={['STAFF']} />}>
        <Route path="/staff/requests" element={<StaffRequests />} />
        <Route path="/dashboard" element={<DashboardPlaceholder />} />
      </Route>
      <Route element={<ProtectedRoute roles={['TEACHER']} />}>
        <Route path="/teacher" element={<TeacherDashboard />} />
        <Route path="/teacher/attendance" element={<TeacherAttendance />} />
        <Route path="/teacher/grading" element={<TeacherGrading />} />
      </Route>
      <Route element={<ProtectedRoute roles={['TEACHER','PRINCIPAL']} />}>
        <Route path="/teacher/exams/new" element={<ExamStudio />} />
      </Route>
      <Route element={<ProtectedRoute roles={['STUDENT']} />}>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/student/exams" element={<StudentExamCenter />} />
      </Route>
      <Route element={<ProtectedRoute roles={['PARENT']} />}>
        <Route path="/parent" element={<ParentDashboard />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
