-- CreateTable
CREATE TABLE `AssessmentType` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `kind` ENUM('TEST', 'EXAM') NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AssessmentType_schoolId_idx`(`schoolId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExamSettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `gradeBands` JSON NOT NULL,
    `passPercent` DECIMAL(5, 2) NOT NULL DEFAULT 33,
    `testsNeedApproval` BOOLEAN NOT NULL DEFAULT true,
    `showPositions` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assessment` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `kind` ENUM('TEST', 'EXAM') NOT NULL,
    `typeId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `groupKey` VARCHAR(40) NULL,
    `sessionId` VARCHAR(191) NULL,
    `classId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NULL,
    `topic` VARCHAR(300) NULL,
    `announced` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `publishedById` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Assessment_schoolId_kind_status_idx`(`schoolId`, `kind`, `status`),
    INDEX `Assessment_classId_idx`(`classId`),
    INDEX `Assessment_groupKey_idx`(`groupKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssessmentPaper` (
    `id` VARCHAR(191) NOT NULL,
    `assessmentId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `date` DATE NULL,
    `startTime` VARCHAR(5) NULL,
    `totalMarks` DECIMAL(7, 2) NOT NULL,
    `passMarks` DECIMAL(7, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `AssessmentPaper_assessmentId_subjectId_key`(`assessmentId`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarkSheet` (
    `id` VARCHAR(191) NOT NULL,
    `paperId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    `submittedById` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `returnNote` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarkSheet_paperId_sectionId_key`(`paperId`, `sectionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mark` (
    `id` VARCHAR(191) NOT NULL,
    `paperId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `marks` DECIMAL(7, 2) NULL,
    `isAbsent` BOOLEAN NOT NULL DEFAULT false,
    `remark` VARCHAR(200) NULL,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Mark_studentId_idx`(`studentId`),
    UNIQUE INDEX `Mark_paperId_studentId_key`(`paperId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StudentResult` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `assessmentId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NULL,
    `obtained` DECIMAL(9, 2) NOT NULL,
    `total` DECIMAL(9, 2) NOT NULL,
    `percent` DECIMAL(5, 2) NOT NULL,
    `grade` VARCHAR(5) NOT NULL,
    `passed` BOOLEAN NOT NULL,
    `positionClass` INTEGER NULL,
    `positionSection` INTEGER NULL,
    `absentPapers` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StudentResult_studentId_idx`(`studentId`),
    INDEX `StudentResult_schoolId_idx`(`schoolId`),
    UNIQUE INDEX `StudentResult_assessmentId_studentId_key`(`assessmentId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ResultRemark` (
    `id` VARCHAR(191) NOT NULL,
    `assessmentId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `teacherRemark` VARCHAR(500) NULL,
    `principalRemark` VARCHAR(500) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ResultRemark_assessmentId_studentId_key`(`assessmentId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Assessment` ADD CONSTRAINT `Assessment_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `AssessmentType`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssessmentPaper` ADD CONSTRAINT `AssessmentPaper_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarkSheet` ADD CONSTRAINT `MarkSheet_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `AssessmentPaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mark` ADD CONSTRAINT `Mark_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `AssessmentPaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StudentResult` ADD CONSTRAINT `StudentResult_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ResultRemark` ADD CONSTRAINT `ResultRemark_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `Assessment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
