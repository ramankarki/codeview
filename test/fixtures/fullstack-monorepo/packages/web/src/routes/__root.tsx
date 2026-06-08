import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

export const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Navbar />
      <main className="flex-1 container mx-auto px-4 py-8">
        <Outlet />
      </main>
      <Footer />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
      <p className="mt-2 text-gray-600">{error.message}</p>
    </div>
  ),
});
