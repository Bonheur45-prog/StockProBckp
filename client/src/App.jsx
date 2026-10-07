import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute.jsx";
import Landing from "./pages/Landing/Landing.jsx";
import Terms from "./pages/Legal/Terms.jsx";
import Privacy from "./pages/Legal/Privacy.jsx";
import PublicProduct from "./pages/PublicProduct/PublicProduct.jsx";
import Login from "./pages/Auth/Login.jsx";
import Register from "./pages/Auth/Register.jsx";
import AdminProtectedRoute from "./components/AdminProtectedRoute/AdminProtectedRoute.jsx";
import AdminLayout from "./components/AdminLayout/AdminLayout.jsx";
import AdminDashboard from "./pages/Admin/AdminDashboard.jsx";
import AdminStores from "./pages/Admin/AdminStores.jsx";
import AdminStoreDetail from "./pages/Admin/AdminStoreDetail.jsx";
import AdminSupport from "./pages/Admin/AdminSupport.jsx";
import Dashboard from "./pages/Dashboard/Dashboard.jsx";
import Products from "./pages/Products/Products.jsx";
import POS from "./pages/POS/POS.jsx";
import Stock from "./pages/Stock/Stock.jsx";
import Reports from "./pages/Reports/Reports.jsx";
import Customers from "./pages/Customers/Customers.jsx";
import Staff from "./pages/Staff/Staff.jsx";
import Settings from "./pages/Settings/Settings.jsx";
import Suppliers from "./pages/Suppliers/Suppliers.jsx";
import Expenses from "./pages/Expenses/Expenses.jsx";
import PurchaseOrders from "./pages/PurchaseOrders/PurchaseOrders.jsx";
import SyncIssues from "./pages/SyncIssues/SyncIssues.jsx";
import { useAuth } from "./context/AuthContext.jsx";

export default function App() {
  const { isAuthenticated, user } = useAuth();
  const homeRoute = user?.isPlatformAdmin ? "/admin" : "/app";

  return (
    <Routes>
      {/* The public site stays browsable even when logged in — an owner
          might come back to check pricing or share the link. Only the
          auth forms redirect away, since showing a login form to someone
          already logged in is just a confusing dead end. */}
      <Route path="/" element={<Landing />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/p/:storeSlug/:barcode" element={<PublicProduct />} />

      <Route path="/login" element={isAuthenticated ? <Navigate to={homeRoute} replace /> : <Login />} />
      <Route path="/register" element={isAuthenticated ? <Navigate to={homeRoute} replace /> : <Register />} />

      {/* The product itself lives under /app, separate from the public site. */}
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="pos" element={<POS />} />
        <Route path="products" element={<Products />} />
        <Route path="stock" element={<Stock />} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="staff" element={<Staff />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        {/* No role restriction, and deliberately not in the main nav — a
            stuck record never reached the server, so resolving one's own
            is a local action, same trust level regardless of role (see
            discardStuckRecord's docstring). Reached via the sync badge. */}
        <Route path="sync-issues" element={<SyncIssues />} />
      </Route>

      {/* Platform-admin shell — BrightLink Technologies staff only, never
          reachable through public signup. Completely separate from /app:
          no storeId scoping, no offline/Dexie, just live API calls. */}
      <Route
        path="/admin"
        element={
          <AdminProtectedRoute>
            <AdminLayout />
          </AdminProtectedRoute>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="stores" element={<AdminStores />} />
        <Route path="stores/:id" element={<AdminStoreDetail />} />
        <Route path="support" element={<AdminSupport />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}