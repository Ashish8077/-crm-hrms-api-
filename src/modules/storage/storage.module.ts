import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StorageService } from './storage.service';
import {
  FailedStorageOperation,
  FailedStorageOperationSchema,
} from './schemas/failed-storage-operation.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FailedStorageOperation.name, schema: FailedStorageOperationSchema },
    ]),
  ],
  providers: [StorageService],
  exports: [StorageService, MongooseModule],
})
export class StorageModule {}

