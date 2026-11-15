-- CreateTable
CREATE TABLE `StudentRemark` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NULL,
    `category` ENUM('ACADEMIC', 'BEHAVIOR', 'DISCIPLINE', 'APPRECIATION', 'HEALTH', 'OTHER') NOT NULL,
    `text` VARCHAR(1000) NOT NULL,
    `date` DATE NOT NULL,
    `shared` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `StudentRemark_schoolId_studentId_idx`(`schoolId`, `studentId`),
    INDEX `StudentRemark_schoolId_date_idx`(`schoolId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MonthlyReport` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `data` JSON NOT NULL,
    `comment` VARCHAR(600) NULL,
    `commentById` VARCHAR(191) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,
    `sentById` VARCHAR(191) NULL,

    INDEX `MonthlyReport_schoolId_period_idx`(`schoolId`, `period`),
    UNIQUE INDEX `MonthlyReport_studentId_period_key`(`studentId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HonorType` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `icon` VARCHAR(8) NOT NULL DEFAULT '🏅',
    `scope` VARCHAR(6) NOT NULL DEFAULT 'CLASS',
    `rule` VARCHAR(20) NULL,
    `publicDefault` BOOLEAN NOT NULL DEFAULT true,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HonorType_schoolId_name_key`(`schoolId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Honor` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `period` VARCHAR(30) NOT NULL,
    `citation` VARCHAR(300) NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notifiedAt` DATETIME(3) NULL,

    INDEX `Honor_schoolId_period_idx`(`schoolId`, `period`),
    INDEX `Honor_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Honor` ADD CONSTRAINT `Honor_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `HonorType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
