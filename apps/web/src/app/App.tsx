import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../features/auth/ProtectedRoute';
import LoginPage from '../pages/auth/LoginPage';
import PrincipalApprovalCenter from '../pages/principal/PrincipalApprovalCenter';
import PrincipalDashboard from '../pages/principal/PrincipalDashboard';
import StaffRequests from '../pages/staff/StaffRequests';
import SuperAdminDashboard from '../pages/super-admin/SuperAdminDashboard';
import SuperAdminSchools from '../pages/super-admin/SuperAdminSchools';
import ExamStudio from '../pages/teacher/ExamStudio';

function DashboardPlaceholder() {
  return <div className="grid min-h-screen place-items-center bg-[#f7f9ff] text-slate-700">School dashboard modules are being connected.</div>;
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
        <Route path="/principal/approvals" element={<PrincipalApprovalCenter />} />
      </Route>
      <Route element={<ProtectedRoute roles={['STAFF']} />}>
        <Route path="/staff/requests" element={<StaffRequests />} />
      </Route>
      <Route element={<ProtectedRoute roles={['TEACHER','PRINCIPAL']} />}>
        <Route path="/teacher/exams/new" element={<ExamStudio />} />
      </Route>
      <Route element={<ProtectedRoute roles={['STAFF', 'TEACHER', 'STUDENT', 'PARENT']} />}>
        <Route path="/dashboard" element={<DashboardPlaceholder />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
