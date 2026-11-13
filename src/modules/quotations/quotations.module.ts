import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import {
  QuotationSequence,
  QuotationSequenceSchema,
} from './schemas/quotation-sequence.schema';
import { SalesOrder, SalesOrderSchema } from './schemas/sales-order.schema';
import {
  SalesOrderSequence,
  SalesOrderSequenceSchema,
} from './schemas/sales-order-sequence.schema';
import { EmailOutbox, EmailOutboxSchema } from './schemas/email-outbox.schema';
import {
  QuotationActivityLog,
  QuotationActivityLogSchema,
} from './schemas/quotation-activity-log.schema';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './services/quotations.service';
import { QuotationRepository } from './repositories/quotation.repository';
import { QuotationSequenceRepository } from './repositories/quotation-sequence.repository';
import { SalesOrderRepository } from './repositories/sales-order.repository';
import { SalesOrderSequenceRepository } from './repositories/sales-order-sequence.repository';
import { EmailOutboxRepository } from './repositories/email-outbox.repository';
import { QuotationActivityLogRepository } from './repositories/quotation-activity-log.repository';
import { PdfGeneratorService } from './services/pdf-generator.service';
import { EmailOutboxProcessorService } from './services/email-outbox-processor.service';
import { QuotationExpiryScheduler } from './schedulers/quotation-expiry.scheduler';
import { ProductsModule } from '../products/products.module';
import { DealsModule } from '../deals/deals.module';
import { RolesModule } from '../roles/roles.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RedisModule } from '../../common/redis/redis.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quotation.name, schema: QuotationSchema },
      { name: QuotationSequence.name, schema: QuotationSequenceSchema },
      { name: SalesOrder.name, schema: SalesOrderSchema },
      { name: SalesOrderSequence.name, schema: SalesOrderSequenceSchema },
      { name: EmailOutbox.name, schema: EmailOutboxSchema },
      { name: QuotationActivityLog.name, schema: QuotationActivityLogSchema },
    ]),
    ScheduleModule.forRoot(),
    ProductsModule,
    DealsModule,
    RolesModule,
    AuditLogsModule,
    RedisModule,
    StorageModule,
  ],
  controllers: [QuotationsController],
  providers: [
    QuotationsService,
    QuotationRepository,
    QuotationSequenceRepository,
    SalesOrderRepository,
    SalesOrderSequenceRepository,
    EmailOutboxRepository,
    QuotationActivityLogRepository,
    PdfGeneratorService,
    EmailOutboxProcessorService,
    QuotationExpiryScheduler,
  ],
  exports: [QuotationsService, QuotationRepository],
})
export class QuotationsModule {}

