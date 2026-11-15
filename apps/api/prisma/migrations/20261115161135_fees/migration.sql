-- CreateTable
CREATE TABLE `FeeHead` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `frequency` ENUM('MONTHLY', 'SELECTED_MONTHS', 'ONE_TIME') NOT NULL DEFAULT 'MONTHLY',
    `months` JSON NULL,
    `discountable` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeeHead_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClassFee` (
    `classId` VARCHAR(191) NOT NULL,
    `headId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`classId`, `headId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeeSettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `dueDay` INTEGER NOT NULL DEFAULT 10,
    `lateFeeType` VARCHAR(10) NOT NULL DEFAULT 'NONE',
    `lateFeeAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lateFeeMax` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `autoGenerate` BOOLEAN NOT NULL DEFAULT false,
    `bankDetails` JSON NULL,
    `voucherNote` VARCHAR(500) NULL,
    `receiptPrefix` VARCHAR(10) NOT NULL DEFAULT 'R',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeeInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `period` VARCHAR(7) NULL,
    `title` VARCHAR(120) NOT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `paidAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'UNPAID',
    `lateFeeApplied` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FeeInvoice_schoolId_period_idx`(`schoolId`, `period`),
    INDEX `FeeInvoice_studentId_status_idx`(`studentId`, `status`),
    INDEX `FeeInvoice_familyId_status_idx`(`familyId`, `status`),
    UNIQUE INDEX `FeeInvoice_schoolId_invoiceNo_key`(`schoolId`, `invoiceNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeeInvoiceLine` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `headId` VARCHAR(191) NULL,
    `kind` VARCHAR(20) NOT NULL,
    `description` VARCHAR(160) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeePayment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `receiptNo` VARCHAR(30) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` VARCHAR(20) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `source` VARCHAR(10) NOT NULL DEFAULT 'COUNTER',
    `receivedAt` DATETIME(3) NOT NULL,
    `collectedById` VARCHAR(191) NULL,
    `handoverId` VARCHAR(191) NULL,
    `status` ENUM('VALID', 'CANCEL_REQUESTED', 'CANCELLED') NOT NULL DEFAULT 'VALID',
    `cancelReason` VARCHAR(300) NULL,
    `cancelRequestedById` VARCHAR(191) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `note` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeePayment_schoolId_receivedAt_idx`(`schoolId`, `receivedAt`),
    INDEX `FeePayment_familyId_idx`(`familyId`),
    INDEX `FeePayment_collectedById_handoverId_idx`(`collectedById`, `handoverId`),
    UNIQUE INDEX `FeePayment_schoolId_receiptNo_key`(`schoolId`, `receiptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeePaymentAllocation` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    INDEX `FeePaymentAllocation_invoiceId_idx`(`invoiceId`),
    INDEX `FeePaymentAllocation_paymentId_idx`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FeeHandover` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `staffId` VARCHAR(191) NOT NULL,
    `expectedAmount` DECIMAL(12, 2) NOT NULL,
    `declaredAmount` DECIMAL(12, 2) NOT NULL,
    `byMethod` JSON NOT NULL,
    `note` VARCHAR(300) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FeeHandover_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `FeeHandover_staffId_idx`(`staffId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentGatewaySettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(20) NOT NULL DEFAULT 'NONE',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `merchantId` VARCHAR(60) NULL,
    `passwordEnc` TEXT NULL,
    `integritySaltEnc` TEXT NULL,
    `sandbox` BOOLEAN NOT NULL DEFAULT true,
    `allowPartial` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlinePayment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `invoiceIds` JSON NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `txnRef` VARCHAR(40) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'INITIATED',
    `message` VARCHAR(300) NULL,
    `response` JSON NULL,
    `paymentId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `OnlinePayment_txnRef_key`(`txnRef`),
    INDEX `OnlinePayment_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `OnlinePayment_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClassFee` ADD CONSTRAINT `ClassFee_headId_fkey` FOREIGN KEY (`headId`) REFERENCES `FeeHead`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeeInvoiceLine` ADD CONSTRAINT `FeeInvoiceLine_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `FeeInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeePayment` ADD CONSTRAINT `FeePayment_handoverId_fkey` FOREIGN KEY (`handoverId`) REFERENCES `FeeHandover`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeePaymentAllocation` ADD CONSTRAINT `FeePaymentAllocation_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `FeePayment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FeePaymentAllocation` ADD CONSTRAINT `FeePaymentAllocation_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `FeeInvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
