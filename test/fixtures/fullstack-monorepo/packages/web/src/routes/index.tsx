import { createFileRoute } from "@tanstack/react-router";
import { HeroSection } from "../components/HeroSection";

export const indexRoute = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  return (
    <div>
      <HeroSection
        title="Fullstack Monorepo"
        subtitle="Hono API + TanStack Start + Shared Types"
        cta={{ label: "Browse Products", href: "/products" }}
      />
    </div>
  );
}
