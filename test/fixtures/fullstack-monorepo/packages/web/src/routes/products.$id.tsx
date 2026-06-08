import { createFileRoute } from "@tanstack/react-router";
import type { Product } from "../../shared/src/index";
import { ProductDetail } from "../components/ProductDetail";

export const productDetailRoute = createFileRoute("/products/$id")({
  component: ProductDetailPage,
  loader: async ({ params }) => {
    return fetch(`/api/products/${params.id}`).then(r => r.json());
  },
});

function ProductDetailPage() {
  const data = productDetailRoute.useLoaderData() as { data: Product };

  return (
    <div>
      <a href="/products" className="text-blue-600 hover:underline mb-4 inline-block">← Back to Products</a>
      <ProductDetail product={data.data} />
    </div>
  );
}
