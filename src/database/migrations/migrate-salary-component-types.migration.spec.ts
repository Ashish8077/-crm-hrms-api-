/* eslint-disable @typescript-eslint/unbound-method */
import { Model } from 'mongoose';
import { MigrateSalaryComponentTypesMigration } from './migrate-salary-component-types.migration';
import { SalaryComponent } from '../../modules/salary-components/schemas/salary-component.schema';
import { SalaryComponentType } from '../../modules/salary-components/constants/salary-component.constant';

describe('MigrateSalaryComponentTypesMigration', () => {
  let migration: MigrateSalaryComponentTypesMigration;
  let mockModel: jest.Mocked<Model<SalaryComponent>>;

  beforeEach(() => {
    mockModel = {
      countDocuments: jest.fn(),
      updateMany: jest.fn(),
    } as unknown as jest.Mocked<Model<SalaryComponent>>;

    migration = new MigrateSalaryComponentTypesMigration(mockModel);
  });

  it('successfully migrates legacy DEDUCTION records with pre and post verification', async () => {
    mockModel.countDocuments
      .mockResolvedValueOnce(3) // pre-migration check
      .mockResolvedValueOnce(0); // post-migration check

    mockModel.updateMany.mockResolvedValueOnce({
      modifiedCount: 3,
      acknowledged: true,
      matchedCount: 3,
      upsertedCount: 0,
      upsertedId: null,
    });

    const result = await migration.run();

    expect(result.preMigrationLegacyCount).toBe(3);
    expect(result.migratedCount).toBe(3);
    expect(result.postMigrationLegacyCount).toBe(0);
    expect(result.verified).toBe(true);

    expect(mockModel.updateMany).toHaveBeenCalledWith(
      { type: 'DEDUCTION' },
      { $set: { type: SalaryComponentType.EMPLOYEE_DEDUCTION } },
    );
  });

  it('runs cleanly without updates when no legacy records exist', async () => {
    mockModel.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await migration.run();

    expect(result.preMigrationLegacyCount).toBe(0);
    expect(result.migratedCount).toBe(0);
    expect(result.postMigrationLegacyCount).toBe(0);
    expect(result.verified).toBe(true);
    expect(mockModel.updateMany).not.toHaveBeenCalled();
  });

  it('throws an error if post-migration verification fails', async () => {
    mockModel.countDocuments.mockResolvedValueOnce(2).mockResolvedValueOnce(1); // still 1 left!

    mockModel.updateMany.mockResolvedValueOnce({
      modifiedCount: 1,
    } as never);

    await expect(migration.run()).rejects.toThrow(
      "Migration verification failed: 1 legacy 'DEDUCTION' records still remain.",
    );
  });
});
