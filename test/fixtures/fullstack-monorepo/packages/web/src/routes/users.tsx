import { createFileRoute } from "@tanstack/react-router";
import type { User } from "../../shared/src/index";
import { UserTable } from "../components/UserTable";
import { apiClient, useRPC } from "../lib/api-client";

export const usersRoute = createFileRoute("/users")({
  component: UsersPage,
});

function UsersPage() {
  const { data: users, isLoading, error } = useRPC<User[]>(
    client => client.api.users.$get()
  );

  if (isLoading) return <div className="p-8">Loading users...</div>;
  if (error) return <div className="p-8 text-red-500">Failed: {error}</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Users</h1>
      <UserTable users={users ?? []} />
    </div>
  );
}
