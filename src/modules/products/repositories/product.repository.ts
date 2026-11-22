import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PriceHistoryEntry,
  Product,
  ProductDocument,
  ProductLean,
} from '../schemas/product.schema';
import { ProductType } from '../constants/product-type.constant';
import { BillingCycle } from '../constants/billing-cycle.constant';

export interface ProductSummaryResult {
  totalProducts: number;
  activeCount: number;
  inactiveCount: number;
  byType: {
    product: number;
    service: number;
    bundle: number;
  };
  byBillingCycle: {
    oneOff: number;
    monthly: number;
    quarterly: number;
    annually: number;
  };
  averageGrossMarginPercent: number;
}

@Injectable()
export class ProductRepository {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async create(
    data: Partial<Product>,
    session?: ClientSession,
  ): Promise<ProductLean> {
    const docs = await this.productModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ProductLean | null> {
    const query = this.productModel
      .findOne({ _id: id, deletedAt: null })
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .populate('bundleItems.productId', 'name sku unitPrice type');
    if (session) query.session(session);
    return query.lean<ProductLean>().exec();
  }

  async findByIdWithHistory(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ProductLean | null> {
    const query = this.productModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<ProductLean>().exec();
  }

  async findBySku(
    sku: string,
    session?: ClientSession,
  ): Promise<ProductLean | null> {
    const query = this.productModel
      .findOne({
        sku: new RegExp(`^${sku.trim()}$`, 'i'),
        deletedAt: null,
      })
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .populate('bundleItems.productId', 'name sku unitPrice type');
    if (session) query.session(session);
    return query.lean<ProductLean>().exec();
  }

  async findActiveByIds(
    ids: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<ProductLean[]> {
    const query = this.productModel
      .find({
        _id: { $in: ids },
        deletedAt: null,
        isActive: true,
      })
      .select('-priceHistory');
    if (session) query.session(session);
    return query.lean<ProductLean[]>().exec();
  }

  async findActiveCatalog(
    filter: Record<string, unknown>,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1> = { name: 1 },
  ): Promise<ProductLean[]> {
    return this.productModel
      .find({ deletedAt: null, isActive: true, ...filter })
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean<ProductLean[]>()
      .exec();
  }

  async findBundles(
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<ProductLean[]> {
    return this.productModel
      .find({ type: ProductType.BUNDLE, deletedAt: null })
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .populate('bundleItems.productId', 'name sku unitPrice type')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean<ProductLean[]>()
      .exec();
  }

  async findAll(
    filter: Record<string, unknown>,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<ProductLean[]> {
    return this.productModel
      .find(filter)
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean<ProductLean[]>()
      .exec();
  }

  async count(filter: Record<string, unknown>): Promise<number> {
    return this.productModel.countDocuments(filter).exec();
  }

  async countActiveByCategoryId(categoryId: Types.ObjectId): Promise<number> {
    return this.productModel
      .countDocuments({
        categoryId,
        deletedAt: null,
        isActive: true,
      })
      .exec();
  }

  async countActiveBundleReferences(
    productId: Types.ObjectId,
  ): Promise<number> {
    return this.productModel
      .countDocuments({
        'bundleItems.productId': productId,
        deletedAt: null,
      })
      .exec();
  }

  async updateById(
    id: Types.ObjectId,
    update: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<ProductLean | null> {
    const query = this.productModel
      .findOneAndUpdate({ _id: id, deletedAt: null }, update, { new: true })
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .populate('bundleItems.productId', 'name sku unitPrice type');
    if (session) query.session(session);
    return query.lean<ProductLean>().exec();
  }

  async updatePricing(
    id: Types.ObjectId,
    updateFields: Record<string, unknown>,
    historyEntry: PriceHistoryEntry,
    session?: ClientSession,
  ): Promise<ProductLean | null> {
    const query = this.productModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      {
        $set: updateFields,
        $push: {
          priceHistory: {
            $each: [historyEntry],
            $slice: -100, // Capped at the last 100 entries to prevent BSON overflow
          },
        },
      },
      { new: true },
    );
    if (session) query.session(session);
    return query
      .select('-priceHistory')
      .populate('categoryId', 'name code')
      .lean<ProductLean>()
      .exec();
  }

  async bulkUpdateStatus(
    ids: Types.ObjectId[],
    isActive: boolean,
    updatedBy: Types.ObjectId,
    session?: ClientSession,
  ): Promise<{ modifiedCount: number }> {
    const result = await this.productModel
      .updateMany(
        { _id: { $in: ids }, deletedAt: null },
        { $set: { isActive, updatedBy } },
        { session },
      )
      .exec();
    return { modifiedCount: result.modifiedCount };
  }

  async getPriceHistory(
    id: Types.ObjectId,
  ): Promise<PriceHistoryEntry[] | null> {
    const doc = await this.productModel
      .findOne({ _id: id, deletedAt: null })
      .select('priceHistory')
      .lean<{ priceHistory: PriceHistoryEntry[] }>()
      .exec();
    return doc ? doc.priceHistory || [] : null;
  }

  async getSummary(): Promise<ProductSummaryResult> {
    interface AggregateGroupItem {
      _id: string | boolean | null;
      count: number;
    }

    interface AggregationFacetResult {
      total: Array<{ count: number }>;
      active: AggregateGroupItem[];
      types: AggregateGroupItem[];
      billingCycles: AggregateGroupItem[];
      margin: Array<{ _id: null; avgMargin: number }>;
    }

    const [facetResult] =
      (await this.productModel.aggregate<AggregationFacetResult>([
        { $match: { deletedAt: null } },
        {
          $facet: {
            total: [{ $count: 'count' }],
            active: [{ $group: { _id: '$isActive', count: { $sum: 1 } } }],
            types: [{ $group: { _id: '$type', count: { $sum: 1 } } }],
            billingCycles: [
              { $group: { _id: '$billingCycle', count: { $sum: 1 } } },
            ],
            margin: [
              {
                $match: {
                  unitPrice: { $gt: 0 },
                  costPrice: { $gte: 0 },
                },
              },
              {
                $project: {
                  margin: {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: ['$unitPrice', '$costPrice'] },
                          '$unitPrice',
                        ],
                      },
                      100,
                    ],
                  },
                },
              },
              {
                $group: {
                  _id: null,
                  avgMargin: { $avg: '$margin' },
                },
              },
            ],
          },
        },
      ])) as [AggregationFacetResult];

    const totalProducts = facetResult?.total?.[0]?.count || 0;
    let activeCount = 0;
    let inactiveCount = 0;

    for (const item of facetResult?.active || []) {
      if (item._id === true) activeCount = item.count;
      if (item._id === false) inactiveCount = item.count;
    }

    const byType = {
      product: 0,
      service: 0,
      bundle: 0,
    };
    for (const item of facetResult?.types || []) {
      if (item._id === ProductType.PRODUCT) byType.product = item.count;
      if (item._id === ProductType.SERVICE) byType.service = item.count;
      if (item._id === ProductType.BUNDLE) byType.bundle = item.count;
    }

    const byBillingCycle = {
      oneOff: 0,
      monthly: 0,
      quarterly: 0,
      annually: 0,
    };
    for (const item of facetResult?.billingCycles || []) {
      if (item._id === BillingCycle.ONE_OFF) byBillingCycle.oneOff = item.count;
      if (item._id === BillingCycle.MONTHLY)
        byBillingCycle.monthly = item.count;
      if (item._id === BillingCycle.QUARTERLY)
        byBillingCycle.quarterly = item.count;
      if (item._id === BillingCycle.ANNUALLY)
        byBillingCycle.annually = item.count;
    }

    const rawAvgMargin = facetResult?.margin?.[0]?.avgMargin || 0;
    const averageGrossMarginPercent =
      Math.round((rawAvgMargin + Number.EPSILON) * 100) / 100;

    return {
      totalProducts,
      activeCount,
      inactiveCount,
      byType,
      byBillingCycle,
      averageGrossMarginPercent,
    };
  }
}
