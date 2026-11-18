import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import FacultyList from './pages/FacultyList';
import FacultyProfile from './pages/FacultyProfile';
import Publications from './pages/Publications';
import PublicationDetail from './pages/PublicationDetail';
import Journals from './pages/Journals';
import Coauthors from './pages/Coauthors';
import Verification from './pages/Verification';
import Sync from './pages/Sync';
import FacultyManage from './pages/FacultyManage';
import Reports from './pages/Reports';
import Definitions from './pages/Definitions';
import { Skeleton } from './components/ui/Ui';

function Guard({ children, admin, viewAll }) {
  const { user, isAdmin, canViewAll } = useAuth();
  if (admin && !isAdmin) return <Navigate to="/" replace />;
  if (viewAll && !canViewAll) return <Navigate to={`/faculty/${user.faculty}`} replace />;
  return children;
}

export default function App() {
  const { user, ready, canViewAll } = useAuth();
  if (!ready) return <div className="p-10"><Skeleton className="h-6 w-48" /></div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={canViewAll ? <Dashboard /> : <Navigate to={`/faculty/${user.faculty}`} replace />} />
        <Route path="faculty" element={<Guard viewAll><FacultyList /></Guard>} />
        <Route path="faculty/:id" element={<FacultyProfile />} />
        <Route path="publications" element={<Publications />} />
        <Route path="publications/:id" element={<PublicationDetail />} />
        <Route path="coauthors" element={<Guard viewAll><Coauthors /></Guard>} />
        <Route path="journals" element={<Guard viewAll><Journals /></Guard>} />
        <Route path="verification" element={<Guard admin><Verification /></Guard>} />
        <Route path="sync" element={<Guard admin><Sync /></Guard>} />
        <Route path="manage" element={<Guard admin><FacultyManage /></Guard>} />
        <Route path="reports" element={<Reports />} />
        <Route path="definitions" element={<Definitions />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
