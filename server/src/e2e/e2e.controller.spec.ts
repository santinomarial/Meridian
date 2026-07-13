import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../prisma/prisma.service';
import { E2eController } from './e2e.controller';

function makeController() {
  const prisma = mockDeep<PrismaService>();
  const transaction = mockDeep<Prisma.TransactionClient>();
  const logger = { info: jest.fn() };
  (prisma.$transaction as unknown as jest.Mock).mockImplementation(
    async (
      callback: (
        tx: DeepMockProxy<Prisma.TransactionClient>,
      ) => Promise<unknown>,
    ) => callback(transaction),
  );
  const controller = new E2eController(prisma, logger as never);
  return { controller, logger, prisma, transaction };
}

describe('E2eController cleanup', () => {
  it('rejects a broad prefix before opening a transaction', async () => {
    const { controller, prisma } = makeController();

    await expect(controller.cleanup({ emailPrefix: '' })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('constrains selection to the test prefix and example.com domain', async () => {
    const { controller, logger, prisma, transaction } = makeController();
    transaction.user.findMany.mockResolvedValue([]);

    await expect(
      controller.cleanup({ emailPrefix: 'e2e-' }),
    ).resolves.toEqual({ deletedUsers: 0 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.user.findMany).toHaveBeenCalledWith({
      where: {
        email: { startsWith: 'e2e-', endsWith: '@example.com' },
      },
      select: { id: true },
    });
    expect(transaction.workspace.deleteMany).not.toHaveBeenCalled();
    expect(transaction.user.deleteMany).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { deletedUsers: 0 },
      'E2E cleanup complete',
    );
  });

  it('deletes owned workspaces and users inside the same transaction', async () => {
    const { controller, prisma, transaction } = makeController();
    transaction.user.findMany.mockResolvedValue([
      { id: 'user-1' },
      { id: 'user-2' },
    ]);
    transaction.workspace.deleteMany.mockResolvedValue({ count: 2 });
    transaction.user.deleteMany.mockResolvedValue({ count: 2 });

    await expect(
      controller.cleanup({ emailPrefix: 'e2e-' }),
    ).resolves.toEqual({ deletedUsers: 2 });

    expect(prisma.workspace.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(transaction.workspace.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: { in: ['user-1', 'user-2'] } },
    });
    expect(transaction.user.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-1', 'user-2'] } },
    });
  });
});
