-- AlterTable
ALTER TABLE `HonorType` MODIFY `icon` VARCHAR(8) NOT NULL DEFAULT '🏅';

-- CreateTable
CREATE TABLE `ChatRoom` (
    `sectionId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(14) NOT NULL DEFAULT 'OPEN',
    `updatedAt` DATETIME(3) NOT NULL,
    `updatedBy` VARCHAR(191) NULL,

    PRIMARY KEY (`sectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(2000) NULL,
    `fileId` VARCHAR(191) NULL,
    `replyToId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,
    `deletedById` VARCHAR(191) NULL,
    `reportedById` VARCHAR(191) NULL,
    `reportReason` VARCHAR(300) NULL,
    `reportReviewedAt` DATETIME(3) NULL,

    INDEX `ChatMessage_sectionId_createdAt_idx`(`sectionId`, `createdAt`),
    INDEX `ChatMessage_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMute` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `sectionId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `until` DATETIME(3) NOT NULL,
    `byId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `ChatMute_sectionId_userId_key`(`sectionId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommSettings` (
    `schoolId` VARCHAR(191) NOT NULL,
    `classChatEnabled` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`schoolId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversation` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `parentUserId` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(10) NOT NULL DEFAULT 'GENERAL',
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `forwardedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `Conversation_schoolId_teacherId_idx`(`schoolId`, `teacherId`),
    UNIQUE INDEX `Conversation_parentUserId_teacherId_studentId_key`(`parentUserId`, `teacherId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConversationMessage` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(3000) NOT NULL,
    `fileIds` JSON NOT NULL,
    `isAuto` BOOLEAN NOT NULL DEFAULT false,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConversationMessage_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageHours` (
    `userId` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `start` VARCHAR(5) NOT NULL DEFAULT '08:00',
    `end` VARCHAR(5) NOT NULL DEFAULT '15:00',

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Complaint` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `ticketNo` INTEGER NOT NULL,
    `parentUserId` VARCHAR(191) NOT NULL,
    `studentId` VARCHAR(191) NULL,
    `category` VARCHAR(30) NOT NULL,
    `subject` VARCHAR(200) NOT NULL,
    `description` VARCHAR(4000) NOT NULL,
    `fileIds` JSON NOT NULL,
    `privateFromTeachers` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(12) NOT NULL DEFAULT 'NEW',
    `assignedToId` VARCHAR(191) NULL,
    `sourceConversationId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `resolvedAt` DATETIME(3) NULL,

    INDEX `Complaint_schoolId_status_idx`(`schoolId`, `status`),
    UNIQUE INDEX `Complaint_schoolId_ticketNo_key`(`schoolId`, `ticketNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComplaintEntry` (
    `id` VARCHAR(191) NOT NULL,
    `complaintId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `text` VARCHAR(3000) NOT NULL,
    `fileIds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Circular` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `fileIds` JSON NOT NULL,
    `audience` VARCHAR(10) NOT NULL,
    `classIds` JSON NULL,
    `sectionIds` JSON NULL,
    `includeStaff` BOOLEAN NOT NULL DEFAULT false,
    `recipientIds` JSON NOT NULL,
    `whatsapp` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `Circular_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CircularRead` (
    `id` VARCHAR(191) NOT NULL,
    `circularId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CircularRead_circularId_userId_key`(`circularId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GatePass` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `passNo` INTEGER NOT NULL,
    `studentId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(300) NOT NULL,
    `pickedUpBy` VARCHAR(120) NOT NULL,
    `relation` VARCHAR(40) NOT NULL,
    `pickerPhone` VARCHAR(20) NULL,
    `leftAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `issuedById` VARCHAR(191) NOT NULL,
    `notifiedAt` DATETIME(3) NULL,

    INDEX `GatePass_schoolId_leftAt_idx`(`schoolId`, `leftAt`),
    INDEX `GatePass_studentId_idx`(`studentId`),
    UNIQUE INDEX `GatePass_schoolId_passNo_key`(`schoolId`, `passNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Album` (
    `id` VARCHAR(191) NOT NULL,
    `schoolId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `eventDate` DATE NULL,
    `visibility` VARCHAR(8) NOT NULL DEFAULT 'SCHOOL',
    `classIds` JSON NULL,
    `coverFileId` VARCHAR(191) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `Album_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumPhoto` (
    `id` VARCHAR(191) NOT NULL,
    `albumId` VARCHAR(191) NOT NULL,
    `fileId` VARCHAR(191) NOT NULL,
    `thumbFileId` VARCHAR(191) NULL,
    `caption` VARCHAR(200) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AlbumPhoto_albumId_idx`(`albumId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConversationMessage` ADD CONSTRAINT `ConversationMessage_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `Conversation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplaintEntry` ADD CONSTRAINT `ComplaintEntry_complaintId_fkey` FOREIGN KEY (`complaintId`) REFERENCES `Complaint`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CircularRead` ADD CONSTRAINT `CircularRead_circularId_fkey` FOREIGN KEY (`circularId`) REFERENCES `Circular`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumPhoto` ADD CONSTRAINT `AlbumPhoto_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
