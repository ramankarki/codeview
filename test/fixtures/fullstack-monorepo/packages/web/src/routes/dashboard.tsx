import { createFileRoute } from "@tanstack/react-router";
import type { UserRole } from "../../shared/src/index";
import { requireAuth } from "../lib/auth-guard";

export const dashboardRoute = createFileRoute("/dashboard")({
  component: DashboardPage,
  beforeLoad: () => {
    requireAuth({ minRole: "admin" as UserRole });
  },
});

function DashboardPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold">Total Users</h2>
          <p className="text-4xl font-bold text-blue-600 mt-2">1,234</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-semibold">Revenue</h2>
          <p className="text-4xl font-bold text-green-600 mt-2">$45,678</p>
        </div>
      </div>
    </div>
  );
}
