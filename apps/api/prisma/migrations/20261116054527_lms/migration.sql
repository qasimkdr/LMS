-- AlterTable
ALTER TABLE `HonorType` MODIFY `icon` VARCHAR(8) NOT NULL DEFAULT '🏅';

-- CreateTable
CREATE TABLE `SyllabusItem` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `title` VARCHAR(200) NOT NULL,
    `term` VARCHAR(40) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SyllabusItem_schoolId_classId_subjectId_idx`(`schoolId`, `classId`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyllabusProgress` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `completedOn` DATE NOT NULL,
    `completedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SyllabusProgress_schoolId_sectionId_idx`(`schoolId`, `sectionId`),
    UNIQUE INDEX `SyllabusProgress_sectionId_itemId_key`(`sectionId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudyMaterial` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NULL,
    `sectionIds` JSON NULL,
    `chapterId` VARCHAR(191) NULL,
    `kind` ENUM('NOTES', 'WORKSHEET', 'BOOK', 'VIDEO', 'LINK', 'SYLLABUS', 'OTHER') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(2000) NULL,
    `fileIds` JSON NOT NULL,
    `url` VARCHAR(500) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `StudyMaterial_schoolId_classId_idx`(`schoolId`, `classId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolDocument` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `category` VARCHAR(60) NULL,
    `fileId` VARCHAR(191) NOT NULL,
    `audience` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `SchoolDocument_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Homework` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NULL,
    `date` DATE NOT NULL,
    `dueDate` DATE NULL,
    `text` VARCHAR(3000) NOT NULL,
    `fileIds` JSON NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `Homework_schoolId_sectionId_date_idx`(`schoolId`, `sectionId`, `date`),
    INDEX `Homework_schoolId_date_idx`(`schoolId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HomeworkDigest` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentById` VARCHAR(191) NULL,
    `items` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `HomeworkDigest_sectionId_date_key`(`sectionId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LmsSettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `digestTime` VARCHAR(5) NOT NULL DEFAULT '16:00',
    `classTeacherAllSubjects` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
