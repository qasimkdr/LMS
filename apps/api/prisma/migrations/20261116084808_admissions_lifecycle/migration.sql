-- AlterTable
ALTER TABLE `HonorType` MODIFY `icon` VARCHAR(8) NOT NULL DEFAULT '🏅';

-- AlterTable
ALTER TABLE `StaffProfile` ADD COLUMN `bloodGroup` VARCHAR(4) NULL,
    ADD COLUMN `experienceYears` INTEGER NULL,
    ADD COLUMN `guardianName` VARCHAR(160) NULL,
    ADD COLUMN `maritalStatus` VARCHAR(12) NULL,
    ADD COLUMN `previousEmployer` VARCHAR(160) NULL,
    ADD COLUMN `qualifications` JSON NULL,
    ADD COLUMN `religion` VARCHAR(40) NULL,
    ADD COLUMN `specialistSubjectIds` JSON NULL,
    ADD COLUMN `specialization` VARCHAR(200) NULL;

-- CreateTable
CREATE TABLE `Enquiry` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `enquiryNo` INTEGER NOT NULL,
    `childName` VARCHAR(160) NOT NULL,
    `gender` ENUM('MALE', 'FEMALE', 'OTHER') NULL,
    `dob` DATE NULL,
    `classId` VARCHAR(191) NULL,
    `parentName` VARCHAR(160) NOT NULL,
    `relation` VARCHAR(20) NULL,
    `phone` VARCHAR(30) NOT NULL,
    `email` VARCHAR(160) NULL,
    `address` VARCHAR(300) NULL,
    `previousSchool` VARCHAR(160) NULL,
    `source` VARCHAR(12) NOT NULL DEFAULT 'WALK_IN',
    `stage` VARCHAR(10) NOT NULL DEFAULT 'NEW',
    `followUpDate` DATE NULL,
    `testAt` DATETIME(3) NULL,
    `testMarks` DECIMAL(6, 2) NULL,
    `testTotal` DECIMAL(6, 2) NULL,
    `testRemarks` VARCHAR(300) NULL,
    `lostReason` VARCHAR(200) NULL,
    `studentId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Enquiry_schoolId_stage_idx`(`schoolId`, `stage`),
    UNIQUE INDEX `Enquiry_schoolId_enquiryNo_key`(`schoolId`, `enquiryNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EnquiryNote` (
    `id` VARCHAR(191) NOT NULL,
    `enquiryId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Withdrawal` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `leavingDate` DATE NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'REQUESTED',
    `requestedById` VARCHAR(191) NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `waivedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `waivedById` VARCHAR(191) NULL,
    `conduct` VARCHAR(40) NULL,
    `remarks` VARCHAR(300) NULL,
    `certificateNo` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `completedById` VARCHAR(191) NULL,
    `classLabel` VARCHAR(80) NULL,

    INDEX `Withdrawal_schoolId_status_idx`(`schoolId`, `status`),
    INDEX `Withdrawal_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PromotionRecord` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `fromSessionId` VARCHAR(191) NULL,
    `toSessionId` VARCHAR(191) NOT NULL,
    `fromClassId` VARCHAR(191) NOT NULL,
    `fromSectionId` VARCHAR(191) NULL,
    `toClassId` VARCHAR(191) NULL,
    `toSectionId` VARCHAR(191) NULL,
    `action` VARCHAR(10) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PromotionRecord_schoolId_batchId_idx`(`schoolId`, `batchId`),
    INDEX `PromotionRecord_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EnquiryNote` ADD CONSTRAINT `EnquiryNote_enquiryId_fkey` FOREIGN KEY (`enquiryId`) REFERENCES `Enquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
