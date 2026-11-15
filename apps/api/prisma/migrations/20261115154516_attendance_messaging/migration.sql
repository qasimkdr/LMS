-- CreateTable
CREATE TABLE `AttendanceSession` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `markedById` VARCHAR(191) NOT NULL,
    `markedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AttendanceSession_schoolId_date_idx`(`schoolId`, `date`),
    UNIQUE INDEX `AttendanceSession_sectionId_date_key`(`sectionId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AttendanceRecord` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'LEAVE', 'HALF_DAY') NOT NULL,
    `remark` VARCHAR(200) NULL,
    `alertSentAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AttendanceRecord_schoolId_date_idx`(`schoolId`, `date`),
    INDEX `AttendanceRecord_sectionId_date_idx`(`sectionId`, `date`),
    UNIQUE INDEX `AttendanceRecord_studentId_date_key`(`studentId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessagingSettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `whatsappEnabled` BOOLEAN NOT NULL DEFAULT false,
    `phoneNumberId` VARCHAR(40) NULL,
    `businessAccountId` VARCHAR(40) NULL,
    `accessTokenEnc` TEXT NULL,
    `appSecretEnc` TEXT NULL,
    `verifyToken` VARCHAR(64) NOT NULL,
    `displayPhone` VARCHAR(40) NULL,
    `verifiedName` VARCHAR(160) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'NOT_SET',
    `lastError` VARCHAR(500) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `countryCode` VARCHAR(4) NOT NULL DEFAULT '92',
    `rules` JSON NULL,
    `templates` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageBatch` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` JSON NOT NULL,
    `channels` JSON NOT NULL,
    `total` INTEGER NOT NULL DEFAULT 0,
    `createdById` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MessageBatch_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Message` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NULL,
    `type` VARCHAR(30) NOT NULL,
    `toPhone` VARCHAR(20) NOT NULL,
    `toName` VARCHAR(160) NULL,
    `studentId` VARCHAR(191) NULL,
    `templateName` VARCHAR(120) NULL,
    `templateLanguage` VARCHAR(10) NULL,
    `params` JSON NULL,
    `body` TEXT NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `error` VARCHAR(500) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `providerMessageId` VARCHAR(120) NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Message_providerMessageId_key`(`providerMessageId`),
    INDEX `Message_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `Message_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `Message_batchId_idx`(`batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(30) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `link` VARCHAR(300) NULL,
    `batchId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    INDEX `Notification_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `MessageBatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
