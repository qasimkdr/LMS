import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../features/auth/ProtectedRoute';
import LoginPage from '../pages/auth/LoginPage';
import SuperAdminDashboard from '../pages/super-admin/SuperAdminDashboard';
import SuperAdminSchools from '../pages/super-admin/SuperAdminSchools';

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
      <Route element={<ProtectedRoute roles={['PRINCIPAL', 'STAFF', 'TEACHER', 'STUDENT', 'PARENT']} />}>
        <Route path="/dashboard" element={<DashboardPlaceholder />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
