interface NavbarProps {
  logo?: string;
}

export function Navbar({ logo = "Monorepo" }: NavbarProps) {
  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="text-xl font-bold text-gray-900">{logo}</a>
        <div className="flex gap-6">
          <a href="/users" className="text-gray-600 hover:text-gray-900">Users</a>
          <a href="/products" className="text-gray-600 hover:text-gray-900">Products</a>
          <a href="/dashboard" className="text-gray-600 hover:text-gray-900">Dashboard</a>
        </div>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="bg-white border-t py-6 mt-auto">
      <div className="container mx-auto px-4 text-center text-gray-500 text-sm">
        © 2026 Monorepo Inc. All rights reserved.
      </div>
    </footer>
  );
}
