-- CreateTable
CREATE TABLE `Plan` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(500) NULL,
    `monthlyPrice` DECIMAL(12, 2) NOT NULL,
    `includedStudents` INTEGER NOT NULL,
    `perStudentPrice` DECIMAL(12, 2) NOT NULL,
    `maxStudents` INTEGER NULL,
    `maxStaff` INTEGER NULL,
    `maxCampuses` INTEGER NOT NULL DEFAULT 1,
    `storageLimitMb` INTEGER NOT NULL,
    `maxFileSizeMb` INTEGER NOT NULL,
    `modules` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Plan_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `School` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `address` VARCHAR(300) NULL,
    `city` VARCHAR(80) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(160) NULL,
    `logoFileId` VARCHAR(191) NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'READ_ONLY', 'SUSPENDED') NOT NULL DEFAULT 'TRIAL',
    `trialEndsAt` DATETIME(3) NULL,
    `planId` VARCHAR(191) NOT NULL,
    `customStorageLimitMb` INTEGER NULL,
    `customMaxStudents` INTEGER NULL,
    `customMaxStaff` INTEGER NULL,
    `timezone` VARCHAR(60) NOT NULL DEFAULT 'Asia/Karachi',
    `currency` VARCHAR(8) NOT NULL DEFAULT 'PKR',
    `billingDay` INTEGER NOT NULL DEFAULT 10,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `School_code_key`(`code`),
    INDEX `School_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Campus` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `address` VARCHAR(300) NULL,
    `isMain` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Campus_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `role` ENUM('SUPER_ADMIN', 'PRINCIPAL', 'STAFF', 'TEACHER', 'STUDENT', 'PARENT') NOT NULL,
    `username` VARCHAR(80) NOT NULL,
    `email` VARCHAR(160) NULL,
    `phone` VARCHAR(40) NULL,
    `fullName` VARCHAR(160) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `permissions` JSON NULL,
    `photoFileId` VARCHAR(191) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `tokenVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_schoolId_role_idx`(`schoolId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RefreshSession` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedBy` VARCHAR(191) NULL,
    `userAgent` VARCHAR(300) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RefreshSession_tokenHash_key`(`tokenHash`),
    INDEX `RefreshSession_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` ENUM('SUPER_ADMIN', 'PRINCIPAL', 'STAFF', 'TEACHER', 'STUDENT', 'PARENT') NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(60) NOT NULL,
    `entityId` VARCHAR(40) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoredFile` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(191) NOT NULL,
    `category` ENUM('LOGO', 'PROFILE_PHOTO', 'STUDENT_DOCUMENT', 'STAFF_DOCUMENT', 'SYLLABUS', 'STUDY_MATERIAL', 'SCHOOL_DOCUMENT', 'GALLERY', 'CHAT', 'HOMEWORK', 'EXAM', 'OTHER') NOT NULL,
    `storageKey` VARCHAR(300) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `StoredFile_storageKey_key`(`storageKey`),
    INDEX `StoredFile_schoolId_deletedAt_idx`(`schoolId`, `deletedAt`),
    INDEX `StoredFile_schoolId_category_idx`(`schoolId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `planName` VARCHAR(80) NOT NULL,
    `basePrice` DECIMAL(12, 2) NOT NULL,
    `includedStudents` INTEGER NOT NULL,
    `activeStudents` INTEGER NOT NULL,
    `extraStudents` INTEGER NOT NULL,
    `perStudentPrice` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('UNPAID', 'PAID', 'VOID') NOT NULL DEFAULT 'UNPAID',
    `dueDate` DATETIME(3) NOT NULL,
    `paidAmount` DECIMAL(12, 2) NULL,
    `paidAt` DATETIME(3) NULL,
    `paymentMethod` VARCHAR(40) NULL,
    `paymentRef` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SchoolInvoice_status_dueDate_idx`(`status`, `dueDate`),
    UNIQUE INDEX `SchoolInvoice_schoolId_period_key`(`schoolId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `School` ADD CONSTRAINT `School_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Campus` ADD CONSTRAINT `Campus_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RefreshSession` ADD CONSTRAINT `RefreshSession_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoredFile` ADD CONSTRAINT `StoredFile_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolInvoice` ADD CONSTRAINT `SchoolInvoice_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
