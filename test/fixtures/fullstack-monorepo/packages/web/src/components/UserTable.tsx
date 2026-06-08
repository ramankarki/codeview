import type { User } from "../../shared/src/index";

interface UserTableProps {
  users: User[];
}

export function UserTable({ users }: UserTableProps) {
  if (users.length === 0) {
    return <p className="text-gray-500">No users found.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full bg-white rounded-lg shadow">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-3 text-left">Name</th>
            <th className="px-4 py-3 text-left">Email</th>
            <th className="px-4 py-3 text-left">Role</th>
            <th className="px-4 py-3 text-left">Joined</th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <tr key={user.id} className="border-t hover:bg-gray-50">
              <td className="px-4 py-3">
                <a href={`/users/${user.id}`} className="text-blue-600 hover:underline font-medium">
                  {user.name}
                </a>
              </td>
              <td className="px-4 py-3 text-gray-600">{user.email}</td>
              <td className="px-4 py-3">
                <span className="inline-block px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                  {user.role}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-500">{new Date(user.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface UserProfileProps {
  user: User;
}

export function UserProfile({ user }: UserProfileProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-lg">
      <div className="flex items-center gap-4 mb-6">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name} className="w-16 h-16 rounded-full" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-2xl font-bold">
            {user.name.charAt(0)}
          </div>
        )}
        <div>
          <h2 className="text-2xl font-bold">{user.name}</h2>
          <p className="text-gray-500">{user.email}</p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4">
        <div><dt className="text-sm text-gray-500">Role</dt><dd className="font-medium">{user.role}</dd></div>
        <div><dt className="text-sm text-gray-500">Joined</dt><dd className="font-medium">{new Date(user.createdAt).toLocaleDateString()}</dd></div>
      </dl>
    </div>
  );
}
