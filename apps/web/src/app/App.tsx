import { Navigate, Route, Routes } from 'react-router-dom';
import SuperAdminDashboard from '../pages/super-admin/SuperAdminDashboard';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/super-admin" replace />} />
      <Route path="/super-admin" element={<SuperAdminDashboard />} />
    </Routes>
  );
}
