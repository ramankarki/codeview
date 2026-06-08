import { createFileRoute } from "@tanstack/react-router";
import type { Product } from "../../shared/src/index";
import { ProductGrid } from "../components/ProductGrid";
import { apiClient, useRPC } from "../lib/api-client";

export const productsRoute = createFileRoute("/products")({
  component: ProductsPage,
});

function ProductsPage() {
  const { data: products, isLoading } = useRPC<Product[]>(
    client => client.api.products.$get()
  );

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Products</h1>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-gray-200 animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <ProductGrid products={products ?? []} />
      )}
    </div>
  );
}
