import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PaginationQueryDto } from '../../common/pagination/dto/pagination-query.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';
import { PermissionKeys } from '../permissions/constants/permission.constant';
import { BulkUpdateProductStatusDto } from './dto/bulk-update-product-status.dto';
import { CalculateQuotePriceDto } from './dto/calculate-quote-price.dto';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductCategoriesQueryDto } from './dto/list-product-categories-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ToggleProductStatusDto } from './dto/toggle-product-status.dto';
import { UpdateBundleItemsDto } from './dto/update-bundle-items.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { UpdateProductPricingDto } from './dto/update-product-pricing.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductCategoriesService } from './services/product-categories.service';
import { ProductsService } from './services/products.service';

@ApiTags('CRM - Products & Services')
@ApiBearerAuth('access-token')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productCategoriesService: ProductCategoriesService,
  ) {}

  private parseObjectId(id: string, entityName: string = 'ID'): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid ${entityName} format: '${id}'`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return new Types.ObjectId(id);
  }

  // =========================================================================
  // Part A: Product Categories (5 APIs) - MUST BE DECLARED FIRST
  // =========================================================================

  @Post('categories')
  @RequirePermissions(PermissionKeys.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Create a new product/service category' })
  @ApiCreatedResponse({ description: 'Category created successfully' })
  async createCategory(
    @Body() dto: CreateProductCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productCategoriesService.create(
      dto,
      new Types.ObjectId(req.user.userId),
    );
  }

  @Get('categories')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'List categories (flat paginated or hierarchical tree)',
  })
  @ApiOkResponse({ description: 'List of categories' })
  async listCategories(@Query() queryDto: ListProductCategoriesQueryDto) {
    return this.productCategoriesService.findAll(queryDto);
  }

  @Get('categories/:id')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Get category details and linked active product count',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiOkResponse({ description: 'Category details with product count' })
  async getCategoryById(@Param('id') id: string) {
    return this.productCategoriesService.findById(
      this.parseObjectId(id, 'Category ID'),
    );
  }

  @Patch('categories/:id')
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Update category details and parent hierarchy' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiOkResponse({ description: 'Category updated successfully' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productCategoriesService.update(
      this.parseObjectId(id, 'Category ID'),
      dto,
      new Types.ObjectId(req.user.userId),
    );
  }

  @Delete('categories/:id')
  @RequirePermissions(PermissionKeys.PRODUCTS_DELETE)
  @ApiOperation({
    summary: 'Soft delete category (enforces no active products linked)',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiOkResponse({ description: 'Category deleted successfully' })
  async deleteCategory(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productCategoriesService.delete(
      this.parseObjectId(id, 'Category ID'),
      new Types.ObjectId(req.user.userId),
    );
  }

  // =========================================================================
  // Part B: Static Product Endpoints & Collections (8 APIs)
  // MUST BE DECLARED ABOVE @Get(':id'), @Patch(':id'), @Delete(':id')
  // =========================================================================

  @Post()
  @RequirePermissions(PermissionKeys.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Create a product, service, or bundle' })
  @ApiCreatedResponse({ description: 'Product created successfully' })
  async createProduct(
    @Body() dto: CreateProductDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.create(
      dto,
      new Types.ObjectId(req.user.userId),
      isManagerOrAdmin,
    );
  }

  @Get()
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'List and filter product catalog with pagination',
  })
  @ApiOkResponse({ description: 'Paginated product catalog' })
  async listProducts(
    @Query() queryDto: ListProductsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.findAll(queryDto, isManagerOrAdmin);
  }

  @Get('active')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary:
      'Fast active catalog dropdown list for deals and quotations line items',
  })
  @ApiOkResponse({ description: 'Active product catalog' })
  async listActiveCatalog(
    @Query() queryDto: ListProductsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.findActiveCatalog(queryDto, isManagerOrAdmin);
  }

  @Get('bundles')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'List combo bundles with populated components',
  })
  @ApiOkResponse({ description: 'Bundle catalog list' })
  async listBundles(
    @Query() queryDto: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.findBundles(
      queryDto.page,
      queryDto.limit,
      isManagerOrAdmin,
    );
  }

  @Get('summary')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Get catalog aggregate summary, margins, and breakdown',
  })
  @ApiOkResponse({ description: 'Product catalog summary metrics' })
  async getCatalogSummary() {
    return this.productsService.getSummary();
  }

  @Get('sku/:sku')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({ summary: 'Find product by unique SKU code' })
  @ApiParam({ name: 'sku', description: 'Product SKU (e.g. PRD-SAAS-8F2A)' })
  @ApiOkResponse({ description: 'Product details' })
  async getProductBySku(
    @Param('sku') sku: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.findBySku(sku, isManagerOrAdmin);
  }

  @Post('calculate-price')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary:
      'CPQ Pricing Engine: Calculate tiered prices, discount guardrails, and GST split',
  })
  @ApiOkResponse({ description: 'CPQ quote calculation result' })
  async calculateQuotePrice(
    @Body() dto: CalculateQuotePriceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.calculatePrice(dto, isManagerOrAdmin);
  }

  @Post('bulk-status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({
    summary: 'Bulk activate/deactivate up to 50 products atomically',
  })
  @ApiOkResponse({ description: 'Bulk status update result' })
  async bulkUpdateStatus(
    @Body() dto: BulkUpdateProductStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productsService.bulkUpdateStatus(
      dto,
      new Types.ObjectId(req.user.userId),
    );
  }

  // =========================================================================
  // Part C: Dynamic Parameter Routes (7 APIs)
  // (@Get(':id'), @Patch(':id'), @Delete(':id'))
  // =========================================================================

  @Get(':id')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Get product detail by ID (masks financial fields for sales reps)',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product details' })
  async getProductById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.findById(
      this.parseObjectId(id, 'Product ID'),
      isManagerOrAdmin,
    );
  }

  @Get(':id/price-history')
  @RequirePermissions(PermissionKeys.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Get chronological price revision ledger for a product',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product price revision history' })
  async getPriceHistory(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.getPriceHistory(
      this.parseObjectId(id, 'Product ID'),
      isManagerOrAdmin,
    );
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({
    summary:
      'Update product general metadata (pricing and status strictly locked)',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product metadata updated' })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.update(
      this.parseObjectId(id, 'Product ID'),
      dto,
      new Types.ObjectId(req.user.userId),
      isManagerOrAdmin,
    );
  }

  @Patch(':id/pricing')
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({
    summary:
      'Dedicated product pricing update (appends to price ledger with $slice: -100)',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product pricing updated' })
  async updateProductPricing(
    @Param('id') id: string,
    @Body() dto: UpdateProductPricingDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.updatePricing(
      this.parseObjectId(id, 'Product ID'),
      dto,
      new Types.ObjectId(req.user.userId),
      isManagerOrAdmin,
    );
  }

  @Patch(':id/bundle-items')
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({
    summary: 'Configure bundle components (enforces Max Depth = 1)',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Bundle components updated' })
  async updateBundleItems(
    @Param('id') id: string,
    @Body() dto: UpdateBundleItemsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.updateBundleItems(
      this.parseObjectId(id, 'Product ID'),
      dto,
      new Types.ObjectId(req.user.userId),
      isManagerOrAdmin,
    );
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.PRODUCTS_EDIT)
  @ApiOperation({ summary: 'Toggle product active/inactive status' })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product status changed' })
  async toggleProductStatus(
    @Param('id') id: string,
    @Body() dto: ToggleProductStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const isManagerOrAdmin = await this.productsService.isUserAdminOrManager(
      req.user,
    );
    return this.productsService.toggleStatus(
      this.parseObjectId(id, 'Product ID'),
      dto,
      new Types.ObjectId(req.user.userId),
      isManagerOrAdmin,
    );
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.PRODUCTS_DELETE)
  @ApiOperation({
    summary: 'Soft delete product (rejects if part of active bundle)',
  })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiOkResponse({ description: 'Product soft deleted' })
  async deleteProduct(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.productsService.delete(
      this.parseObjectId(id, 'Product ID'),
      new Types.ObjectId(req.user.userId),
    );
  }
}
