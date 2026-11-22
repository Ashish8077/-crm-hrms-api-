import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RolesModule } from '../roles/roles.module';
import { ProductsController } from './products.controller';
import { ProductCategoryRepository } from './repositories/product-category.repository';
import { ProductRepository } from './repositories/product.repository';
import {
  ProductCategory,
  ProductCategorySchema,
} from './schemas/product-category.schema';
import { Product, ProductSchema } from './schemas/product.schema';
import { PriceCalculatorService } from './services/price-calculator.service';
import { ProductCategoriesService } from './services/product-categories.service';
import { ProductsService } from './services/products.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductCategory.name, schema: ProductCategorySchema },
      { name: Product.name, schema: ProductSchema },
    ]),
    RolesModule,
    AuditLogsModule,
  ],
  controllers: [ProductsController],
  providers: [
    ProductCategoryRepository,
    ProductRepository,
    ProductCategoriesService,
    ProductsService,
    PriceCalculatorService,
  ],
  exports: [
    ProductsService,
    ProductCategoriesService,
    PriceCalculatorService,
    ProductRepository,
    ProductCategoryRepository,
  ],
})
export class ProductsModule {}
