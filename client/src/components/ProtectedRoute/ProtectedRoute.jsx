import { Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Platform admins have no store, so every store route would fail for them.
  // The admin panel is their home (same destination App.jsx uses after login).
  if (user?.isPlatformAdmin) return <Navigate to="/admin" replace />;
  return children;
}