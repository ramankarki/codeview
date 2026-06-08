import { createFileRoute } from "@tanstack/react-router";
import type { User } from "../../shared/src/index";
import { UserProfile } from "../components/UserProfile";

export const userDetailRoute = createFileRoute("/users/$id")({
  component: UserDetailPage,
  loader: async ({ params }) => {
    return fetch(`/api/users/${params.id}`).then(r => r.json());
  },
});

function UserDetailPage() {
  const { id } = userDetailRoute.useParams();
  const user = userDetailRoute.useLoaderData() as { data: User };

  return (
    <div>
      <a href="/users" className="text-blue-600 hover:underline mb-4 inline-block">← Back to Users</a>
      <UserProfile user={user.data} />
    </div>
  );
}
