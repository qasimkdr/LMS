-- CreateTable
CREATE TABLE `BankQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NULL,
    `chapter` VARCHAR(120) NULL,
    `type` ENUM('MCQ', 'MULTI', 'TRUE_FALSE', 'FILL', 'MATCH', 'SHORT', 'LONG') NOT NULL,
    `text` TEXT NOT NULL,
    `imageFileId` VARCHAR(191) NULL,
    `options` JSON NULL,
    `answer` JSON NULL,
    `marks` DECIMAL(6, 2) NOT NULL DEFAULT 1,
    `createdById` VARCHAR(191) NOT NULL,
    `usedCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BankQuestion_schoolId_subjectId_idx`(`schoolId`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlinePaper` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `classId` VARCHAR(191) NOT NULL,
    `sectionIds` JSON NOT NULL,
    `instructions` TEXT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `durationMinutes` INTEGER NOT NULL DEFAULT 30,
    `shuffleQuestions` BOOLEAN NOT NULL DEFAULT true,
    `shuffleOptions` BOOLEAN NOT NULL DEFAULT true,
    `negativeMarking` DECIMAL(4, 2) NOT NULL DEFAULT 0,
    `showAnswers` BOOLEAN NOT NULL DEFAULT true,
    `passMarks` DECIMAL(7, 2) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `linkPaperId` VARCHAR(191) NULL,
    `assessmentId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OnlinePaper_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `OnlinePaper_classId_idx`(`classId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlinePaperSection` (
    `id` VARCHAR(191) NOT NULL,
    `paperId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `instructions` VARCHAR(500) NULL,
    `attemptAny` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlinePaperQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `paperId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `bankId` VARCHAR(191) NULL,
    `type` ENUM('MCQ', 'MULTI', 'TRUE_FALSE', 'FILL', 'MATCH', 'SHORT', 'LONG') NOT NULL,
    `text` TEXT NOT NULL,
    `imageFileId` VARCHAR(191) NULL,
    `options` JSON NULL,
    `answer` JSON NULL,
    `marks` DECIMAL(6, 2) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OnlineAttempt` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `paperId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deadline` DATETIME(3) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `autoSubmitted` BOOLEAN NOT NULL DEFAULT false,
    `questionOrder` JSON NOT NULL,
    `optionOrder` JSON NOT NULL,
    `answers` JSON NOT NULL,
    `marking` JSON NULL,
    `overallRemark` VARCHAR(500) NULL,
    `score` DECIMAL(8, 2) NULL,
    `tabSwitches` INTEGER NOT NULL DEFAULT 0,
    `lastSavedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `OnlineAttempt_studentId_idx`(`studentId`),
    UNIQUE INDEX `OnlineAttempt_paperId_studentId_key`(`paperId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OnlinePaperSection` ADD CONSTRAINT `OnlinePaperSection_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `OnlinePaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnlinePaperQuestion` ADD CONSTRAINT `OnlinePaperQuestion_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `OnlinePaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnlinePaperQuestion` ADD CONSTRAINT `OnlinePaperQuestion_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `OnlinePaperSection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OnlineAttempt` ADD CONSTRAINT `OnlineAttempt_paperId_fkey` FOREIGN KEY (`paperId`) REFERENCES `OnlinePaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
