import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProductType } from '../constants/product-type.constant';
import { PricingType } from '../constants/pricing-type.constant';
import { BillingCycle } from '../constants/billing-cycle.constant';
import { ProductCategoryLean } from './product-category.schema';

export type ProductDocument = HydratedDocument<Product>;

// Subdocument: Tiered Volume Pricing Slabs
@Schema({ _id: false })
export class PricingTier {
  @Prop({ type: Number, required: true, min: 1 })
  minQuantity!: number;

  @Prop({ type: Number, default: null }) // null means unbounded (e.g. 51+)
  maxQuantity?: number | null;

  @Prop({ type: Number, required: true, min: 0 })
  unitPrice!: number;
}
export const PricingTierSchema = SchemaFactory.createForClass(PricingTier);

// Subdocument: Bundle Child Items (Max Depth = 1)
@Schema({ _id: false })
export class BundleItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, default: 1 })
  quantity!: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discountPercent!: number;
}
export const BundleItemSchema = SchemaFactory.createForClass(BundleItem);

// Subdocument: Immutable Price Revision Ledger (Capped at 100 via $slice)
@Schema({ _id: false })
export class PriceHistoryEntry {
  @Prop({ type: Number, required: true })
  oldUnitPrice!: number;

  @Prop({ type: Number, required: true })
  newUnitPrice!: number;

  @Prop({ type: Number, default: null })
  oldCostPrice?: number | null;

  @Prop({ type: Number, default: null })
  newCostPrice?: number | null;

  @Prop({ type: String, required: true, trim: true })
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  changedBy!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  changedAt!: Date;
}
export const PriceHistoryEntrySchema =
  SchemaFactory.createForClass(PriceHistoryEntry);

@Schema({
  collection: 'products',
  timestamps: true,
  versionKey: false,
})
export class Product {
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  sku!: string; // e.g., 'PRD-SAAS-904F'

  @Prop({
    type: String,
    enum: Object.values(ProductType),
    required: true,
  })
  type!: ProductType; // 'PRODUCT' | 'SERVICE' | 'BUNDLE'

  @Prop({
    type: Types.ObjectId,
    ref: 'ProductCategory',
    required: true,
  })
  categoryId!: Types.ObjectId;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  // Financials & Pricing (Enforced: floorPrice <= unitPrice)
  @Prop({ type: Number, required: true, min: 0 })
  unitPrice!: number;

  @Prop({ type: Number, min: 0, default: 0 })
  costPrice!: number;

  @Prop({ type: Number, min: 0, default: 0 })
  floorPrice!: number;

  @Prop({ type: String, default: 'INR', uppercase: true, trim: true })
  currency!: string;

  @Prop({
    type: String,
    enum: Object.values(PricingType),
    default: PricingType.ONE_TIME,
  })
  pricingType!: PricingType; // 'ONE_TIME' | 'RECURRING' | 'USAGE_BASED'

  @Prop({
    type: String,
    enum: Object.values(BillingCycle),
    default: BillingCycle.ONE_OFF,
  })
  billingCycle!: BillingCycle;

  @Prop({ type: String, default: 'UNIT', trim: true, uppercase: true })
  unit!: string; // 'LICENSE', 'HOUR', 'USER', 'DEVICE', 'UNIT'

  // Non-Overlapping Tiered Pricing Slabs
  @Prop({ type: [PricingTierSchema], default: [] })
  pricingTiers!: PricingTier[];

  // Discount Guardrails (Enforced: repMaxDiscountPercent <= managerMaxDiscountPercent)
  @Prop({ type: Number, default: 10, min: 0, max: 100 })
  repMaxDiscountPercent!: number;

  @Prop({ type: Number, default: 25, min: 0, max: 100 })
  managerMaxDiscountPercent!: number;

  // Indian GST / Tax Compliance
  @Prop({ type: String, trim: true, uppercase: true, default: null })
  hsnSacCode?: string | null;

  @Prop({ type: Number, default: 18, min: 0, max: 100 })
  taxRate!: number;

  @Prop({ type: Boolean, default: false })
  isTaxInclusive!: boolean;

  // HRMS Effort & Delivery Matrix (For Services)
  @Prop({ type: Number, default: null, min: 0 })
  estimatedDeliveryHours?: number | null;

  @Prop({ type: String, default: null, trim: true })
  requiredSkillRole?: string | null;

  // Combo Bundle Items (Only PRODUCT and SERVICE allowed; Max Depth = 1)
  @Prop({ type: [BundleItemSchema], default: [] })
  bundleItems!: BundleItem[];

  // Price Ledger (Capped at 100 entries via $slice)
  @Prop({ type: [PriceHistoryEntrySchema], default: [] })
  priceHistory!: PriceHistoryEntry[];

  @Prop({ type: [String], default: [] })
  tags!: string[];

  // Soft Delete & Auditing
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export type ProductLean = Product & {
  _id: Types.ObjectId;
  category?: ProductCategoryLean;
  createdAt?: Date;
  updatedAt?: Date;
};

export const ProductSchema = SchemaFactory.createForClass(Product);

// Optimized Compound Indexes (ESR Rules & Bundle Guard)
ProductSchema.index(
  { sku: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: null },
    name: 'idx_products_sku_unique',
  },
);
ProductSchema.index(
  { isActive: 1, deletedAt: 1, type: 1, categoryId: 1, unitPrice: 1 },
  { name: 'idx_products_catalog_filter' },
);
ProductSchema.index(
  { categoryId: 1, deletedAt: 1, isActive: 1 },
  { name: 'idx_products_category_active' },
);
ProductSchema.index(
  { 'bundleItems.productId': 1, deletedAt: 1 },
  { name: 'idx_products_bundle_children' },
);
ProductSchema.index(
  { name: 'text', sku: 'text', description: 'text', hsnSacCode: 'text' },
  { name: 'idx_products_text_search' },
);
