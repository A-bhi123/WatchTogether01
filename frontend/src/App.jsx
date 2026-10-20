import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';

import Register from './pages/Register';
import Login from './pages/Login';
import OtpVerify from './pages/OtpVerify';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';
import JoinRoom from './pages/JoinRoom';
import Join from './pages/Join';
import Room from './pages/Room';
import NotFound from './pages/NotFound';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* "/" par: logged-in ko dashboard, nahi to ProtectedRoute login par bhej dega */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/verify-otp" element={<OtpVerify />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />

            {/* Invite link: logged-out banda bhi yahan aata hai, isliye protected nahi */}
            <Route path="/join/:code" element={<Join />} />

            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/join-room" element={<ProtectedRoute><JoinRoom /></ProtectedRoute>} />
            <Route path="/room/:code" element={<ProtectedRoute><Room /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;