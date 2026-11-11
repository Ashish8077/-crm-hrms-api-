import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductCategoryDocument = HydratedDocument<ProductCategory>;
export type ProductCategoryLean = ProductCategory & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

@Schema({
  collection: 'product_categories',
  timestamps: true,
  versionKey: false,
})
export class ProductCategory {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  code!: string; // e.g., 'SAAS', 'HW', 'CONS'

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({
    type: Types.ObjectId,
    ref: 'ProductCategory',
    default: null,
  })
  parentCategoryId?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const ProductCategorySchema =
  SchemaFactory.createForClass(ProductCategory);

// Optimized Compound Indexes (ESR Compliance)
ProductCategorySchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
ProductCategorySchema.index(
  { parentCategoryId: 1, isActive: 1, deletedAt: 1 },
  { name: 'idx_categories_hierarchy' },
);
ProductCategorySchema.index(
  { name: 'text', description: 'text' },
  { name: 'idx_categories_text_search' },
);
