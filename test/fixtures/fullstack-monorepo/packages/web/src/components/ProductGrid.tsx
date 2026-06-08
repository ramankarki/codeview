import type { Product } from "../../shared/src/index";

interface ProductGridProps {
  products: Product[];
}

export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return <p className="text-gray-500">No products available.</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map(product => (
        <a key={product.id} href={`/products/${product.id}`} className="group">
          <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-md transition-shadow">
            {product.images[0] && (
              <img src={product.images[0]} alt={product.name} className="w-full h-48 object-cover" />
            )}
            <div className="p-4">
              <h3 className="font-semibold text-lg group-hover:text-blue-600">{product.name}</h3>
              <p className="text-gray-500 text-sm mt-1 line-clamp-2">{product.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xl font-bold">${product.price.toFixed(2)}</span>
                <span className={`text-sm px-2 py-1 rounded ${product.inStock ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                  {product.inStock ? "In Stock" : "Out of Stock"}
                </span>
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

interface ProductDetailProps {
  product: Product;
}

export function ProductDetail({ product }: ProductDetailProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
      {product.images[0] && (
        <img src={product.images[0]} alt={product.name} className="w-full h-64 object-cover rounded-lg mb-6" />
      )}
      <h1 className="text-3xl font-bold mb-2">{product.name}</h1>
      <p className="text-2xl font-bold text-blue-600 mb-4">${product.price.toFixed(2)} {product.currency}</p>
      <p className="text-gray-700 mb-4">{product.description}</p>
      <span className={`inline-block px-3 py-1 rounded-full text-sm ${product.inStock ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
        {product.inStock ? "In Stock" : "Out of Stock"}
      </span>
    </div>
  );
}
