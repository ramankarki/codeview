import { Hono } from "hono";
import type { Context } from "hono";
import type { Product, ApiResponse } from "../../shared/src/index";
import { ERROR_CODES } from "../../shared/src/index";

export const productRoutes = new Hono()
  /**
   * GET /api/products
   * List all products.
   */
  .get("/", async (c: Context) => {
    const products: Product[] = [
      { id: "1", name: "Widget Pro", description: "Professional widget", price: 29.99, currency: "USD", inStock: true, categoryId: "cat-1", images: ["/img/widget.png"] },
      { id: "2", name: "Gadget X", description: "Next-gen gadget", price: 199.99, currency: "USD", inStock: false, categoryId: "cat-2", images: ["/img/gadget.png"] },
    ];

    return c.json({ success: true, data: products, timestamp: Date.now() } satisfies ApiResponse<Product[]>);
  })
  /**
   * GET /api/products/:id
   * Get a single product by ID.
   */
  .get("/:id", async (c: Context) => {
    const id = c.req.param("id");
    const product: Product | null = null; // DB lookup

    if (!product) {
      return c.json({ success: false, error: ERROR_CODES.NOT_FOUND, data: null, timestamp: Date.now() } satisfies ApiResponse<null>, 404);
    }

    return c.json({ success: true, data: product, timestamp: Date.now() } satisfies ApiResponse<Product>);
  })
  /**
   * POST /api/products
   * Create a new product (admin only).
   */
  .post("/", async (c: Context) => {
    const body = await c.req.json<Partial<Product>>();
    const product: Product = {
      id: crypto.randomUUID(),
      name: body.name ?? "Untitled",
      description: body.description ?? "",
      price: body.price ?? 0,
      currency: body.currency ?? "USD",
      inStock: body.inStock ?? false,
      categoryId: body.categoryId ?? "",
      images: body.images ?? [],
    };

    return c.json({ success: true, data: product, timestamp: Date.now() } satisfies ApiResponse<Product>, 201);
  });
