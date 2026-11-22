import { ProductCategoryLean } from '../schemas/product-category.schema';

export interface ProductCategoryResponse {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  parentCategoryId?: string | null;
  isActive: boolean;
  productCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCategoryTreeResponse extends ProductCategoryResponse {
  children: ProductCategoryTreeResponse[];
}

export class ProductCategoryMapper {
  static toResponse(
    doc: ProductCategoryLean,
    productCount?: number,
  ): ProductCategoryResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      code: doc.code,
      description: doc.description ?? null,
      parentCategoryId: doc.parentCategoryId
        ? doc.parentCategoryId.toString()
        : null,
      isActive: doc.isActive,
      ...(productCount !== undefined ? { productCount } : {}),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  static toTreeResponse(
    categories: ProductCategoryLean[],
  ): ProductCategoryTreeResponse[] {
    const map = new Map<string, ProductCategoryTreeResponse>();
    const roots: ProductCategoryTreeResponse[] = [];

    // First pass: create all tree nodes
    for (const cat of categories) {
      const id = cat._id.toString();
      map.set(id, {
        ...ProductCategoryMapper.toResponse(cat),
        children: [],
      });
    }

    // Second pass: wire parents and children
    for (const cat of categories) {
      const id = cat._id.toString();
      const node = map.get(id);
      if (!node) continue;

      if (cat.parentCategoryId) {
        const parentId = cat.parentCategoryId.toString();
        const parentNode = map.get(parentId);
        if (parentNode) {
          parentNode.children.push(node);
        } else {
          // If parent is not found or deleted, treat as root
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
