import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import PipelinePage from './pages/PipelinePage';
import LeadsPage from './pages/LeadsPage';
import ContactsPage from './pages/ContactsPage';
import InboxPage from './pages/InboxPage';
import TasksPage from './pages/TasksPage';
import AutomationsPage from './pages/AutomationsPage';
import ChatbotsPage from './pages/ChatbotsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TemplatesPage from './pages/TemplatesPage';
import IntegrationsPage from './pages/IntegrationsPage';
import SettingsPage from './pages/SettingsPage';
import TeamPage from './pages/TeamPage';
import BroadcastsPage from './pages/BroadcastsPage';
import CallsPage from './pages/CallsPage';
import ProductsPage from './pages/ProductsPage';
import QuotesPage from './pages/QuotesPage';
import CsatPublicPage from './pages/CsatPublicPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import AcceptInvitePage from './pages/auth/AcceptInvitePage';

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}
function Public({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  return !isAuthenticated ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ style: { fontFamily: 'Manrope, sans-serif', fontSize: 14, borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0/0.1)' }, success: { iconTheme: { primary: '#10B981', secondary: '#fff' } }, error: { iconTheme: { primary: '#EF4444', secondary: '#fff' } } }} />
      <Routes>
        <Route path="/login" element={<Public><LoginPage /></Public>} />
        <Route path="/register" element={<Public><RegisterPage /></Public>} />
        <Route path="/csat/:token" element={<CsatPublicPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="/" element={<Protected><AppLayout /></Protected>}>
          <Route index element={<DashboardPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="leads" element={<LeadsPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="quotes" element={<QuotesPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="chatbots" element={<ChatbotsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="templates" element={<TemplatesPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="broadcasts" element={<BroadcastsPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
