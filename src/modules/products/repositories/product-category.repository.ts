import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ProductCategory,
  ProductCategoryDocument,
  ProductCategoryLean,
} from '../schemas/product-category.schema';

@Injectable()
export class ProductCategoryRepository {
  constructor(
    @InjectModel(ProductCategory.name)
    private readonly categoryModel: Model<ProductCategoryDocument>,
  ) {}

  async create(
    data: Partial<ProductCategory>,
    session?: ClientSession,
  ): Promise<ProductCategoryLean> {
    const docs = await this.categoryModel.create([data], { session });
    return docs[0].toObject();
  }

  async findById(
    id: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ProductCategoryLean | null> {
    const query = this.categoryModel.findOne({ _id: id, deletedAt: null });
    if (session) query.session(session);
    return query.lean<ProductCategoryLean>().exec();
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<ProductCategoryLean | null> {
    const query = this.categoryModel.findOne({
      code: code.trim().toUpperCase(),
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<ProductCategoryLean>().exec();
  }

  async findByName(
    name: string,
    session?: ClientSession,
  ): Promise<ProductCategoryLean | null> {
    const query = this.categoryModel.findOne({
      name: new RegExp(`^${name.trim()}$`, 'i'),
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<ProductCategoryLean>().exec();
  }

  async findActiveByIds(
    ids: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<ProductCategoryLean[]> {
    const query = this.categoryModel.find({
      _id: { $in: ids },
      deletedAt: null,
      isActive: true,
    });
    if (session) query.session(session);
    return query.lean<ProductCategoryLean[]>().exec();
  }

  async findAll(
    filter: Record<string, unknown>,
    skip: number,
    limit: number,
    sort: Record<string, 1 | -1> = { createdAt: -1 },
  ): Promise<ProductCategoryLean[]> {
    return this.categoryModel
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean<ProductCategoryLean[]>()
      .exec();
  }

  async count(filter: Record<string, unknown>): Promise<number> {
    return this.categoryModel.countDocuments(filter).exec();
  }

  async updateById(
    id: Types.ObjectId,
    update: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<ProductCategoryLean | null> {
    const query = this.categoryModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      update,
      { new: true },
    );
    if (session) query.session(session);
    return query.lean<ProductCategoryLean>().exec();
  }

  async findActiveTree(): Promise<ProductCategoryLean[]> {
    return this.categoryModel
      .find({ deletedAt: null, isActive: true })
      .sort({ name: 1 })
      .lean<ProductCategoryLean[]>()
      .exec();
  }

  async findChildren(
    parentCategoryId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<ProductCategoryLean[]> {
    const query = this.categoryModel.find({
      parentCategoryId,
      deletedAt: null,
    });
    if (session) query.session(session);
    return query.lean<ProductCategoryLean[]>().exec();
  }
}
