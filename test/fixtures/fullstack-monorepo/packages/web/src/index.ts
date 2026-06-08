import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root";
import { indexRoute } from "./routes/index";
import { usersRoute } from "./routes/users";
import { userDetailRoute } from "./routes/users.$id";
import { productsRoute } from "./routes/products";
import { productDetailRoute } from "./routes/products.$id";
import { dashboardRoute } from "./routes/dashboard";
import type { User, Product } from "../../shared/src/index";

// Build route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  usersRoute.addChildren([userDetailRoute]),
  productsRoute.addChildren([productDetailRoute]),
  dashboardRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  context: {
    currentUser: null as User | null,
    cart: [] as Product[],
  },
});

// Type-safe router hooks
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
