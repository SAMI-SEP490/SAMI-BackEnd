// Updated: 2025-01-10
// Refactored: Compatible with latest schema.prisma + Status Transition Rules + Email Notifications

const prisma = require("../config/prisma");
const s3Service = require("./s3.service");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const path = require("path");
const geminiService = require("./gemini.service");
const tenantService = require("./tenant.service");
const documentAIService = require("./document-ai.service");
const consentService = require("./consent.service");
const emailService = require("../utils/email");
const { getCloudWatchAuditLogger } = require("../utils/cloudwatch-audit");
const auditLogger = getCloudWatchAuditLogger();
// Status Enum từ schema
const CONTRACT_STATUS = {
  PENDING: "pending",
  REJECTED: "rejected",
  PENDING_TRANSACTION: "pending_transaction",
  ACTIVE: "active",
  TERMINATED: "terminated",
  REQUESTED_TERMINATION: "requested_termination",
  EXPIRED: "expired",
};
const MAX_RETROACTIVE_DAYS = 14;
const MAX_DURATION_MONTHS = 60;
// Base URL frontend của bạn (Lấy từ env hoặc hardcode)
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

class ContractService {
  /**
   * Helper: Tính End Date từ Start Date và Duration (months)
   */
  calculateEndDate(startDate, durationMonths) {
    if (!startDate || !durationMonths) return null;

    const start = new Date(startDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + parseInt(durationMonths));

    return end;
  }

  /**
   * Helper: Tính duration từ start và end
   */
  calculateDurationFromDates(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    let months = (end.getFullYear() - start.getFullYear()) * 12;
    months -= start.getMonth();
    months += end.getMonth();

    if (end.getDate() < start.getDate()) {
      months--;
    }

    return Math.max(1, months);
  }

  /**
   * Helper: Kiểm tra conflict hợp đồng
   */
  async checkContractConflict(
      roomId,
      startDate,
      endDate,
      excludeContractId = null
  ) {
    const where = {
      room_id: roomId,
      status: {
        in: [
          CONTRACT_STATUS.ACTIVE,
          CONTRACT_STATUS.PENDING,
          CONTRACT_STATUS.PENDING_TRANSACTION,
        ],
      },
      OR: [
        {
          AND: [
            { start_date: { lte: startDate } },
            { end_date: { gte: startDate } },
          ],
        },
        {
          AND: [
            { start_date: { lte: endDate } },
            { end_date: { gte: endDate } },
          ],
        },
        {
          AND: [
            { start_date: { gte: startDate } },
            { end_date: { lte: endDate } },
          ],
        },
      ],
    };

    if (excludeContractId) {
      where.contract_id = { not: excludeContractId };
    }

    return await prisma.contracts.findFirst({ where });
  }

  /**
   * Helper: Kiểm tra bills chưa thanh toán
   */
  async hasUnpaidBills(contractId) {
    const unpaidBills = await prisma.bills.findMany({
      where: {
        contract_id: contractId,
        status: {
          in: [ "issued", "partially_paid", "overdue"],
        },
        deleted_at: null,
      },
    });

    return unpaidBills.length > 0;
  }
  validateFinancials(rentAmount, depositAmount) {
    // 1. Validate RENT (Tiền thuê)
    // - Phải là số và > 0
    if (isNaN(rentAmount) || rentAmount <= 0) {
      throw new Error("Tiền thuê phải là số dương lớn hơn 0.");
    }
    // - Chặn số quá lớn
    if (rentAmount > 1000000000) {
      throw new Error("Tiền thuê quá lớn bất thường (giới hạn 1 tỷ). Vui lòng kiểm tra lại.");
    }

    // 2. Validate DEPOSIT (Tiền cọc)
    // - Phải là số và >= 0
    if (isNaN(depositAmount) || depositAmount < 0) {
      throw new Error("Tiền cọc không được là số âm.");
    }

    // - [Logic Chéo] Cọc không được vượt quá 12 tháng tiền nhà
    if (depositAmount > rentAmount * 12) {
      throw new Error("Tiền cọc có vẻ quá cao (vượt quá 1 năm tiền nhà). Vui lòng xác minh lại.");
    }

    return true;
  }
  validateDateLogic(startDate, durationMonths, checkPastDate = true) {
    const start = new Date(startDate);
    const duration = parseInt(durationMonths);
    const today = new Date();

    // 1. Kiểm tra ngày bắt đầu không được quá cũ
    if (checkPastDate) {
      const minDate = new Date();
      minDate.setDate(today.getDate() - MAX_RETROACTIVE_DAYS);
      minDate.setHours(0, 0, 0, 0);
      start.setHours(0, 0, 0, 0);

      if (start < minDate) {
        throw new Error(
            `Ngày bắt đầu không được cũ hơn ${MAX_RETROACTIVE_DAYS} ngày so với hiện tại.`
        );
      }
    }

    const maxFutureDate = new Date();
    maxFutureDate.setMonth(today.getMonth() + 1);
    maxFutureDate.setHours(0, 0, 0, 0);

    if (start > maxFutureDate) {
      throw new Error("Ngày bắt đầu không được vượt quá 1 tháng kể từ hiện tại.");
    }

    // 2. Kiểm tra thời hạn không quá lớn (Luôn kiểm tra)
    if (duration > MAX_DURATION_MONTHS) {
      throw new Error(
          `Duration cannot exceed ${MAX_DURATION_MONTHS} months (5 years).`
      );
    }

    // 3. Kiểm tra cơ bản
    if (duration < 1) {
      throw new Error("Duration must be at least 1 month");
    }

    return true;
  }
  /**
   * Helper: Validate status transition
   */
  validateStatusTransition(currentStatus, newStatus, reason = null) {
    const validTransitions = {
      [CONTRACT_STATUS.PENDING]: [
        CONTRACT_STATUS.ACTIVE,
        CONTRACT_STATUS.REJECTED,
      ],
      [CONTRACT_STATUS.REJECTED]: [
        CONTRACT_STATUS.PENDING, // Có thể tạo lại nếu sửa thông tin
      ],
      [CONTRACT_STATUS.ACTIVE]: [
        CONTRACT_STATUS.REQUESTED_TERMINATION,
        CONTRACT_STATUS.PENDING_TRANSACTION,
        CONTRACT_STATUS.TERMINATED,
        CONTRACT_STATUS.EXPIRED,
      ],
      [CONTRACT_STATUS.REQUESTED_TERMINATION]: [
        CONTRACT_STATUS.PENDING_TRANSACTION,
        CONTRACT_STATUS.TERMINATED,
        CONTRACT_STATUS.ACTIVE, // Từ chối yêu cầu chấm dứt
      ],
      [CONTRACT_STATUS.PENDING_TRANSACTION]: [
        CONTRACT_STATUS.TERMINATED,
        CONTRACT_STATUS.EXPIRED,
      ],
    };

    const allowedTransitions = validTransitions[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
          `Invalid status transition from ${currentStatus} to ${newStatus}`
      );
    }

    // REJECTED bắt buộc phải có lý do
    if (newStatus === CONTRACT_STATUS.REJECTED && !reason) {
      throw new Error("Reason is required when rejecting contract");
    }

    return true;
  }

  async _convertImagesToPdf(files) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ autoFirstPage: false });
        const chunks = [];

        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", (err) => reject(err));

        // Duyệt qua từng file ảnh và thêm vào PDF
        for (const file of files) {
          const img = doc.openImage(file.buffer);
          doc.addPage({ size: [img.width, img.height] });
          doc.image(file.buffer, 0, 0);
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Helper xử lý file upload (PDF hoặc Multi-Image)
   */
  async _processUploadFiles(fileOrFiles) {
    if (!fileOrFiles) return null;

    // Chuẩn hóa thành mảng
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    if (files.length === 0) return null;

    let bufferToUpload;
    let originalName = files[0].originalname;

    // Kiểm tra loại file
    const isPdf = files[0].mimetype === "application/pdf";
    const isImage = files[0].mimetype.startsWith("image/");

    if (isPdf) {
      // Nếu là PDF, chỉ lấy file đầu tiên (theo logic frontend gửi)
      bufferToUpload = files[0].buffer;
    } else if (isImage) {
      // Nếu là ảnh (có thể nhiều ảnh), merge hết vào 1 PDF
      try {
        bufferToUpload = await this._convertImagesToPdf(files);
        originalName = originalName.replace(/\.[^/.]+$/, "") + ".pdf";
      } catch (err) {
        throw new Error("Failed to convert images to PDF: " + err.message);
      }
    } else {
      throw new Error("Unsupported file type");
    }

    const uploadResult = await s3Service.uploadFile(
        bufferToUpload,
        originalName,
        "contracts"
    );
    return {
      s3_key: uploadResult.s3_key,
      file_name: uploadResult.file_name,
      checksum: uploadResult.checksum,
      uploaded_at: uploadResult.uploaded_at,
    };
  }

  // ============================================
  // CREATE CONTRACT (Updated: Require File + Validate End Date)
  // ============================================
  async createContract(data, files = null, currentUser = null) {
    const {
      room_id,
      tenant_user_id,
      start_date,
      duration_months,
      rent_amount,
      deposit_amount,
      penalty_rate,
      payment_cycle_months,
      note,
    } = data;

    // --- [NEW] 1. Validate bắt buộc có file ---
    if (!files || files.length === 0) {
      throw new Error("Hợp đồng bắt buộc phải có file đính kèm (PDF hoặc ảnh).");
    }

    // Validation Basics
    if (!room_id || !tenant_user_id || !start_date || !duration_months || !rent_amount) {
      throw new Error("Thiếu thông tin bắt buộc: phòng, người thuê, ngày bắt đầu, thời hạn hoặc tiền thuê.");
    }

    let validPenalty = 0;
    if (penalty_rate) {
      const rate = parseFloat(penalty_rate);
      // Cho phép nhỏ hơn 0.01 nhưng không được quá 0.055
      if (isNaN(rate) || rate < 0 || rate > 0.055) {
        throw new Error("Tỉ lệ phạt vi phạm không được quá 0.055%/ngày (theo luật lãi suất chậm trả).");
      }
      validPenalty = rate;
    }

    const roomId = parseInt(room_id);
    const tenantUserId = parseInt(tenant_user_id);
    const startDate = new Date(start_date);
    const duration = parseInt(duration_months);

    const paymentCycle = payment_cycle_months ? parseInt(payment_cycle_months) : 1;
    if (paymentCycle > duration) {
      throw new Error(`Chu kỳ thanh toán (${paymentCycle} tháng) không được lớn hơn thời hạn hợp đồng (${duration} tháng).`);
    }


    const rent = parseFloat(rent_amount);
    const deposit = deposit_amount ? parseFloat(deposit_amount) : 0;

    this.validateFinancials(rent, deposit);
    // Validate logic ngày bắt đầu (không quá cũ, duration hợp lệ)
    this.validateDateLogic(startDate, duration);

    const endDate = this.calculateEndDate(startDate, duration);
    if (startDate >= endDate) throw new Error("Ngày kết thúc tính toán không hợp lệ (trùng hoặc trước ngày bắt đầu).");

    // --- [NEW] 2. Validate Ngày kết thúc phải sau hiện tại ---
    // (Ngăn chặn tạo hợp đồng đã hết hạn ngay lập tức)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset giờ để so sánh ngày

    // Nếu bạn muốn ngày kết thúc phải LỚN HƠN hôm nay (Tương lai)
    if (endDate <= today) {
      throw new Error("Ngày kết thúc hợp đồng phải sau thời điểm hiện tại.");
    }


    // Logic Check Room & Permission
    const room = await prisma.rooms.findUnique({
      where: { room_id: roomId },
      include: { building: true },
    });
    if (!room || !room.is_active) throw new Error("Room not found or inactive");

    if (currentUser && currentUser.role === "MANAGER") {
      const hasAccess = await this.checkManagerBuildingAccess(
          currentUser.user_id,
          room.building_id
      );
      if (!hasAccess) throw new Error("No permission for this building");
    }

    const conflictingContract = await this.checkContractConflict(roomId, startDate, endDate);
    if (conflictingContract) throw new Error(`Phòng đang có Hợp đồng #${conflictingContract.contract_number} trùng thời gian.`);

    // 3. FILE PROCESSING (Luôn chạy vì đã validate ở bước 1)
    let fileData = {};
    // Không cần check files.length nữa vì đã check ở đầu hàm
    fileData = await this._processUploadFiles(files);

    // 4. DB Creation
    const result = await prisma.$transaction(async (tx) => {
      const count = await tx.contracts.count();
      const contract_number = `CT${Date.now()}-${count + 1}`;

      return await tx.contracts.create({
        data: {
          contract_number,
          room_id: roomId,
          tenant_user_id: tenantUserId,
          start_date: startDate,
          end_date: endDate,
          duration_months: duration,
          rent_amount: parseFloat(rent_amount),
          deposit_amount: deposit_amount ? parseFloat(deposit_amount) : 0,
          penalty_rate: validPenalty,
          payment_cycle_months: payment_cycle_months ? parseInt(payment_cycle_months) : 1,
          status: CONTRACT_STATUS.PENDING,
          note,
          ...fileData, // Spread file data (s3_key, file_name, etc.)
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          room_history: { include: { building: true } },
          tenant: { include: { user: true } },
        },
      });
    });

    // 5. GỬI EMAIL THÔNG BÁO CHO TENANT
    try {
      const tenantUser = result.tenant?.user;
      if (tenantUser?.email) {
        const actionUrl = `${FRONTEND_URL}/contracts/${result.contract_id}`;

        await emailService.sendContractApprovalEmail(
            tenantUser.email,
            tenantUser.full_name,
            {
              contractNumber: result.contract_number,
              roomNumber: result.room_history?.room_number || "N/A",
              startDate: result.start_date,
              duration: result.duration_months
            },
            actionUrl
        );
        console.log(`📧 Contract approval email sent to ${tenantUser.email}`);
      }
    } catch (emailError) {
      console.error("❌ Failed to send contract approval email:", emailError.message);
    }

    return this.formatContractResponse(result);
  }


  // ============================================
  // CONTRACT APPROVAL (Tenant Accept/Reject)
  // ============================================
  async approveContract(contractId, action, reason = null, currentUser = null, ipAddress = null, userAgent = null) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } },
      },
    });

    if (!contract) throw new Error("Contract not found");

    // Chỉ tenant mới được accept/reject
    if (currentUser && currentUser.role === "TENANT") {
      if (contract.tenant_user_id !== currentUser.user_id) {
        throw new Error("You do not have permission to approve this contract");
      }
    }

    // Chỉ contract PENDING mới được accept/reject
    if (contract.status !== CONTRACT_STATUS.PENDING) {
      throw new Error("Only pending contracts can be accepted or rejected");
    }
    try {
      const consentAction = action === "accept" ? "ACCEPTED" : "REVOKED";

      await consentService.logConsent({
        userId: currentUser.user_id,
        contractId: contract.contract_id,
        consentType: "CONTRACT_SIGNING", // Enum ConsentType
        action: consentAction,           // Enum ConsentAction
        ipAddress: ipAddress || "unknown",
        deviceInfo: userAgent || "unknown",
      });
    } catch (error) {
      console.error("Failed to log consent:", error.message);
      // Tùy chọn: Có thể throw error để chặn user ký nếu hệ thống log lỗi
      throw new Error(`Cannot process contract: ${error.message}`);
    }
    const newStatus =
        action === "accept" ? CONTRACT_STATUS.ACTIVE : CONTRACT_STATUS.REJECTED;

    // Validate transition
    this.validateStatusTransition(contract.status, newStatus, reason);

    const result = await prisma.$transaction(async (tx) => {
      // Update contract
      const updatedContract = await tx.contracts.update({
        where: { contract_id: contractId },
        data: {
          status: newStatus,
          tenant_accepted_at: action === "accept" ? new Date() : null,
          note: reason
              ? `${
                  contract.note || ""
              }\n[${action.toUpperCase()}] ${reason}`.trim()
              : contract.note,
          updated_at: new Date(),
        },
        include: {
          room_history: { include: { building: true } },
          tenant: { include: { user: true } },
        },
      });

      // Nếu ACTIVE, cập nhật room và room_tenants
      if (newStatus === CONTRACT_STATUS.ACTIVE) {
        await tx.rooms.update({
          where: { room_id: contract.room_id },
          data: {
            current_contract_id: contractId,
            status: "occupied",
          },
        });

        // Close previous tenant history
        await tx.room_tenants.updateMany({
          where: {
            room_id: contract.room_id,      // <--- BẮT BUỘC THÊM DÒNG NÀY
            tenant_user_id: contract.tenant_user_id,
            is_current: true,
          },
          data: {
            is_current: false,
            moved_out_at: new Date(),
          },
        });

        const currentTenants = await tx.room_tenants.count({
          where: {
            room_id: contract.room_id,
            is_current: true,
          },
        });

        const room = await tx.rooms.findUnique({
          where: { room_id: contract.room_id },
          select: { max_tenants: true },
        });

        const maxTenants = room?.max_tenants ?? 1;

        if (currentTenants + 1 > maxTenants) {
          throw new Error(
              `Phòng đã đủ số người thuê (${currentTenants}/${maxTenants})`
          );
        }
        // Create new tenant history
        await tx.room_tenants.create({
          data: {
            room_id: contract.room_id,
            tenant_user_id: contract.tenant_user_id,
            tenant_type: "primary",
            moved_in_at: contract.start_date,
            is_current: true,
            note: `Contract #${contractId} activated`,
          },
        });
      }

      return updatedContract;
    });

    return this.formatContractResponse(result);
  }

  // ============================================
  // UPDATE CONTRACT (Logic mới xử lý file)
  // ============================================
  async updateContract(contractId, data, files = null, currentUser = null) {
    const existingContract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: { room_history: { include: { building: true } } },
    });

    if (!existingContract) throw new Error("Contract not found");
    if (currentUser)
      await this.checkContractPermission(existingContract, currentUser);

    if (
        ![CONTRACT_STATUS.PENDING, CONTRACT_STATUS.REJECTED].includes(
            existingContract.status
        )
    ) {
      throw new Error("Only pending or rejected contracts can be updated");
    }

    const {
      room_id,
      tenant_user_id,
      start_date,
      duration_months,
      rent_amount,
      deposit_amount,
      penalty_rate,
      payment_cycle_months,
      note,
    } = data;

    // Logic check conflict, validate rate... (tương tự Create)
    let validRate = undefined;
    if (penalty_rate !== undefined) {
      const rate = parseFloat(penalty_rate);
      if (isNaN(rate) || rate < 0 || rate > 0.055)
        throw new Error("Tỉ lệ phạt vi phạm không được quá 0.055%/ngày.");
      validRate = rate;
    }


    const targetRoomId = room_id ? parseInt(room_id) : existingContract.room_id;
    const targetStartDate = start_date
        ? new Date(start_date)
        : existingContract.start_date;
    const targetDuration = duration_months
        ? parseInt(duration_months)
        : existingContract.duration_months;

    const targetPaymentCycle = payment_cycle_months
        ? parseInt(payment_cycle_months)
        : existingContract.payment_cycle_months;

    if (targetPaymentCycle > targetDuration) {
      throw new Error(`Chu kỳ thanh toán (${targetPaymentCycle} tháng) không được lớn hơn thời hạn hợp đồng (${targetDuration} tháng).`);
    }

    const targetEndDate = this.calculateEndDate(
        targetStartDate,
        targetDuration
    );
    const targetRent = rent_amount !== undefined
        ? parseFloat(rent_amount)
        : existingContract.rent_amount;
    const targetDeposit = deposit_amount !== undefined
        ? parseFloat(deposit_amount)
        : existingContract.deposit_amount;
    this.validateFinancials(targetRent, targetDeposit);
    if (start_date || duration_months) {
      const shouldCheckPast = !!start_date;
      this.validateDateLogic(targetStartDate, targetDuration, shouldCheckPast);
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (targetEndDate <= today) {
      throw new Error("Ngày kết thúc hợp đồng (sau khi cập nhật) phải sau thời điểm hiện tại.");
    }
    const conflicting = await this.checkContractConflict(
        targetRoomId,
        targetStartDate,
        targetEndDate,
        contractId
    );
    if (conflicting)
      throw new Error(
          `Room conflict with contract #${conflicting.contract_id}`
      );

    const updateData = { updated_at: new Date() };
    // Map fields...
    if (room_id) updateData.room_id = parseInt(room_id);
    if (tenant_user_id) updateData.tenant_user_id = parseInt(tenant_user_id);
    if (start_date || duration_months) {
      updateData.start_date = targetStartDate;
      updateData.duration_months = targetDuration;
      updateData.end_date = targetEndDate;
    }
    if (rent_amount) updateData.rent_amount = parseFloat(rent_amount);
    if (deposit_amount) updateData.deposit_amount = parseFloat(deposit_amount);
    if (validRate !== undefined) updateData.penalty_rate = validRate;
    if (payment_cycle_months)
      updateData.payment_cycle_months = parseInt(payment_cycle_months);
    if (note !== undefined) updateData.note = note;

    if (existingContract.status === CONTRACT_STATUS.REJECTED) {
      updateData.status = CONTRACT_STATUS.PENDING;
      updateData.tenant_accepted_at = null;
    }

    // --- FILE PROCESSING (FIXED) ---
    if (files && files.length > 0) {
      // Delete old file
      if (existingContract.s3_key) {
        await s3Service.deleteFile(existingContract.s3_key);
      }
      // Process new files
      const uploadResult = await this._processUploadFiles(files);
      Object.assign(updateData, uploadResult);
    }

    const updatedContract = await prisma.contracts.update({
      where: { contract_id: contractId },
      data: updateData,
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } },
      },
    });

    return this.formatContractResponse(updatedContract);
  }

  // ============================================
  // REQUEST TERMINATION (Logic mới + Gửi Email)
  // ============================================
  async requestTermination(contractId, reason, currentUser = null) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } } // Cần lấy thông tin user để gửi mail
      },
    });

    if (!contract) throw new Error("Contract not found");

    // 1. Check Permission: Chỉ MANAGER hoặc OWNER mới được gửi request
    if (currentUser) {
      if (currentUser.role === "TENANT") {
        throw new Error("Tenants cannot initiate termination request. Please contact your manager.");
      }
      if (currentUser.role === "MANAGER") {
        const hasAccess = await this.checkManagerBuildingAccess(currentUser.user_id, contract.room_history.building_id);
        if (!hasAccess) throw new Error("You do not have permission to manage this contract");
      }
    }

    // Chỉ ACTIVE mới request termination
    if (contract.status !== CONTRACT_STATUS.ACTIVE) {
      throw new Error("Only active contracts can request termination");
    }

    if (!reason) {
      throw new Error("Reason is required for termination request");
    }

    const updatedContract = await prisma.contracts.update({
      where: { contract_id: contractId },
      data: {
        status: CONTRACT_STATUS.REQUESTED_TERMINATION,
        note: `${contract.note || ""}\n[REQ-TERM] Request by Manager: ${reason}`.trim(),
        updated_at: new Date(),
      },
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } },
      },
    });

    // 2. [NEW] GỬI EMAIL THÔNG BÁO CHO TENANT
    try {
      const tenantUser = updatedContract.tenant?.user;
      if (tenantUser?.email) {
        // Link xử lý yêu cầu chấm dứt
        const actionUrl = `${FRONTEND_URL}/contracts/${contractId}/termination`;

        await emailService.sendAddendumApprovalEmail(
            tenantUser.email,
            tenantUser.full_name,
            {
              type: 'early_termination', // Sử dụng type này để map với template email
              contractNumber: updatedContract.contract_number,
              effectiveDate: new Date() // Ngày yêu cầu là ngày hiện tại
            },
            actionUrl
        );
        console.log(`📧 Termination request email sent to ${tenantUser.email}`);
      }
    } catch (emailError) {
      console.error("❌ Failed to send termination request email:", emailError.message);
    }

    return this.formatContractResponse(updatedContract);
  }

  // ... (Giữ nguyên các methods còn lại: handleTerminationRequest, checkAndResolvePendingTransaction, v.v...) ...
  // ============================================
  // APPROVE/REJECT TERMINATION (Only Tenant)
  // ============================================
  async handleTerminationRequest(contractId, action, currentUser = null, ipAddress = null, userAgent = null) {
    // action: 'approve' | 'reject'

    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: { room_history: { include: { building: true } } },
    });

    if (!contract) throw new Error("Contract not found");

    // 1. Check Permission: Chỉ TENANT (chính chủ) mới được duyệt
    if (currentUser) {
      if (currentUser.role === "MANAGER" || currentUser.role === "OWNER") {
        throw new Error(
            "Managers cannot approve their own termination request. Waiting for Tenant approval."
        );
      }
      if (currentUser.role === "TENANT") {
        // Phải đúng là tenant của hợp đồng này
        if (contract.tenant_user_id !== currentUser.user_id) {
          throw new Error(
              "You do not have permission to approve this contract"
          );
        }
      }
    }

    if (contract.status !== CONTRACT_STATUS.REQUESTED_TERMINATION) {
      throw new Error("Contract is not in requested termination status");
    }

    try {
      // approve -> Đồng ý chấm dứt -> ACCEPTED
      // reject -> Không đồng ý chấm dứt (giữ lại HĐ) -> REVOKED (từ chối yêu cầu)
      const consentAction = action === "approve" ? "ACCEPTED" : "REVOKED";

      await consentService.logConsent({
        userId: currentUser.user_id,
        contractId: contractId,
        consentType: "CONTRACT_TERMINATION", // Enum ConsentType
        action: consentAction,               // Enum ConsentAction
        ipAddress: ipAddress || "unknown",
        deviceInfo: userAgent || "unknown",
      });
    } catch (error) {
      console.error("Failed to log termination consent:", error.message);
      throw new Error(`Cannot process termination: ${error.message}`);
    }
    if (action === "reject") {
      // Tenant từ chối hủy -> Về ACTIVE
      const updated = await prisma.contracts.update({
        where: { contract_id: contractId },
        data: {
          status: CONTRACT_STATUS.ACTIVE,
          note: `${contract.note || ""}\n[REQ-TERM] Rejected by Tenant`.trim(),
          updated_at: new Date(),
        },
        include: {
          room_history: { include: { building: true } },
          tenant: { include: { user: true } },
        },
      });
      return this.formatContractResponse(updated);
    }

    // Tenant đồng ý -> Check bills
    const hasUnpaid = await this.hasUnpaidBills(contractId);

    const newStatus = hasUnpaid
        ? CONTRACT_STATUS.PENDING_TRANSACTION
        : CONTRACT_STATUS.TERMINATED;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.contracts.update({
        where: { contract_id: contractId },
        data: {
          status: newStatus,
          note: `${contract.note || ""}\n[REQ-TERM] Approved by Tenant`.trim(),
          updated_at: new Date(),
        },
        include: {
          room_history: { include: { building: true } },
          tenant: { include: { user: true } },
        },
      });

      // Nếu sạch nợ -> Clear room luôn
      if (newStatus === CONTRACT_STATUS.TERMINATED) {
        await this._clearRoomAndTenant(
            tx,
            contract.room_id,
            contract.tenant_user_id,
            contractId
        );
      }

      return updated;
    });

    return this.formatContractResponse(result);
  }

  // ============================================
  //  AUTO RESOLVE PENDING TRANSACTION (Đã Fix)
  // ============================================
  async checkAndResolvePendingTransaction(contractId) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: { room_history: { include: { building: true } } },
    });

    if (!contract) throw new Error("Contract not found");

    // Chỉ xử lý nếu đang chờ thanh toán
    if (contract.status !== CONTRACT_STATUS.PENDING_TRANSACTION) {
      // Nếu đã xong rồi thì báo success luôn để frontend không báo lỗi
      if ([CONTRACT_STATUS.TERMINATED, CONTRACT_STATUS.EXPIRED].includes(contract.status)) {
        return { success: true, message: "Hợp đồng đã kết thúc." };
      }
      // Nếu đang active thì không làm gì
      return {
        success: false,
        message: `Trạng thái hợp đồng là ${contract.status}, không phải pending_transaction`,
      };
    }

    // --- FIX QUAN TRỌNG: Xóa Bill Nháp (Draft) trước khi check nợ ---
    // Bill nháp thường là dự thu tháng sau, không tính là nợ khi thanh lý
    await prisma.bills.deleteMany({
      where: {
        contract_id: contractId,
        status: 'draft'
      }
    });

    // Check bills (Lúc này chỉ còn Issued / Overdue / Partially Paid)
    const hasUnpaid = await this.hasUnpaidBills(contractId);

    if (hasUnpaid) {
      // Nếu vẫn còn nợ thật -> Báo lỗi cụ thể
      return {
        success: false,
        message: "Không thể đóng hợp đồng: Vẫn còn hóa đơn chưa thanh toán (Issued/Overdue).",
      };
    }

    // --- AUTOMATIC STATUS DETERMINATION ---
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(contract.end_date);
    endDate.setHours(0, 0, 0, 0);

    const finalStatus =
        today >= endDate ? CONTRACT_STATUS.EXPIRED : CONTRACT_STATUS.TERMINATED;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.contracts.update({
        where: { contract_id: contractId },
        data: {
          status: finalStatus,
          updated_at: new Date(),
          note: `${
              contract.note || ""
          }\n[AUTO] Bills cleared. Status updated to ${finalStatus}`.trim(),
        },
        include: {
          room_history: { include: { building: true } },
          tenant: { include: { user: true } },
        },
      });

      // Clean room & tenant
      await this._clearRoomAndTenant(
          tx,
          contract.room_id,
          contract.tenant_user_id,
          contractId
      );

      return updated;
    });

    console.log(`✓ Contract ${contractId} auto-resolved to ${finalStatus}`);
    return {
      success: true,
      message: `Đã hoàn tất thanh lý. Hợp đồng chuyển sang trạng thái: ${finalStatus}.`,
      data: this.formatContractResponse(result),
    };
  }

  /**
   * [LEGACY SUPPORT] - Complete Pending Transaction
   * Bây giờ chỉ gọi vào logic auto-resolve.
   * Không cần truyền finalStatus manual nữa.
   */
  async completePendingTransaction(
      contractId,
      _unusedFinalStatus,
      currentUser = null
  ) {
    // Kiểm tra quyền (Optional vì hàm checkAndResolvePendingTransaction đã check logic)
    if (currentUser) {
      const contract = await prisma.contracts.findUnique({
        where: { contract_id: contractId },
      });
      // Reuse existing permission check
      if (contract) await this.checkContractPermission(contract, currentUser);
    }

    const result = await this.checkAndResolvePendingTransaction(contractId);

    if (!result.success) {
      throw new Error(result.message);
    }

    return result.data;
  }


  // ============================================
  // HARD DELETE CONTRACT (UPDATED)
  // ============================================
  async hardDeleteContract(contractId, currentUser = null) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
    });

    if (!contract) throw new Error("Contract not found");

    // Chỉ OWNER được delete
    if (currentUser && currentUser.role !== "OWNER") {
      throw new Error("Only OWNER can permanently delete contracts");
    }

    // Chỉ xóa được EXPIRED, TERMINATED hoặc REJECTED
    if (
        ![CONTRACT_STATUS.EXPIRED, CONTRACT_STATUS.TERMINATED, CONTRACT_STATUS.REJECTED].includes(
            contract.status
        )
    ) {
      throw new Error("Only expired or terminated contracts can be deleted");
    }

    await prisma.$transaction(async (tx) => {
      // 1. Check và clear room nếu cần (Giữ nguyên)
      const room = await tx.rooms.findUnique({
        where: { room_id: contract.room_id },
      });

      if (room && room.current_contract_id === contractId) {
        await tx.rooms.update({
          where: { room_id: contract.room_id },
          data: { current_contract_id: null, status: "available" },
        });
      }

      // 2. Xóa room_tenants (Giữ nguyên)
      await tx.room_tenants.deleteMany({
        where: {
          room_id: contract.room_id,
          tenant_user_id: contract.tenant_user_id,
        },
      });

      // --- [NEW] 3. XỬ LÝ HÓA ĐƠN & ĐIỆN NƯỚC (FIX LỖI FK) ---

      // Lấy danh sách Bill ID thuộc hợp đồng này
      const billsToDelete = await tx.bills.findMany({
        where: { contract_id: contractId },
        select: { bill_id: true }
      });
      const billIds = billsToDelete.map(b => b.bill_id);

      if (billIds.length > 0) {
        // A. Ngắt liên kết Utility Readings (Điện/Nước) với Bill sắp xóa
        // Nếu không làm bước này, xóa Bill sẽ lỗi tiếp ở bảng utility_readings
        await tx.utility_readings.updateMany({
          where: { bill_id: { in: billIds } },
          data: { bill_id: null }
        });

        // B. Xóa tất cả Bills
        // (Prisma Schema đã có onDelete: Cascade cho bill_details/service_charges nên chúng sẽ tự bay màu)
        await tx.bills.deleteMany({
          where: { contract_id: contractId }
        });
      }

      // 4. Xóa Contract (Bây giờ đã an toàn)
      await tx.contracts.delete({
        where: { contract_id: contractId },
      });
    });

    // 5. Delete S3 file (Giữ nguyên)
    if (contract.s3_key) {
      try {
        await s3Service.deleteFile(contract.s3_key);
      } catch (error) {
        console.error("Failed to delete S3 file:", error);
      }
    }

    return { success: true, message: "Contract permanently deleted" };
  }

  // ============================================
  // AUTO-UPDATE EXPIRED CONTRACTS
  // ============================================
  async autoUpdateExpiredStatus(contract) {
    if (!contract || contract.status !== CONTRACT_STATUS.ACTIVE) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endDate = new Date(contract.end_date);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today) {
      // Kiểm tra ngày thu tiền điện nước
      const building = await prisma.buildings.findUnique({
        where: { building_id: contract.room_history?.building_id },
        select: { bill_due_day: true },
      });

      const utilityCollectionDate = building?.bill_due_day || 5; // Default ngày 5
      const currentDay = today.getDate();

      // Nếu contract kết thúc trước ngày thu tiền -> PENDING_TRANSACTION
      // để chờ chốt điện nước
      const hasUnpaid = await this.hasUnpaidBills(contract.contract_id);

      const newStatus =
          hasUnpaid || currentDay < utilityCollectionDate
              ? CONTRACT_STATUS.PENDING_TRANSACTION
              : CONTRACT_STATUS.EXPIRED;

      await prisma.$transaction(async (tx) => {
        await tx.contracts.update({
          where: { contract_id: contract.contract_id },
          data: {
            status: newStatus,
            updated_at: new Date(),
          },
        });

        if (newStatus === CONTRACT_STATUS.EXPIRED) {
          await this._clearRoomAndTenant(
              tx,
              contract.room_id,
              contract.tenant_user_id,
              contract.contract_id
          );
        }
      });

      console.log(
          `✓ Contract ${contract.contract_id} auto-updated to ${newStatus}`
      );
    }
  }
  async autoUpdateExpiredContracts() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const expiredContracts = await prisma.contracts.findMany({
        where: {
          end_date: { lt: today },
          status: { in: ["active", "pending"] },
          deleted_at: null,
        },
      });

      if (expiredContracts.length === 0) return 0;

      // Run in transaction for consistency (looping inside logic)
      // Note: UpdateMany doesn't support relation updates, so we iterate
      let count = 0;
      for (const contract of expiredContracts) {
        await this.autoUpdateExpiredStatus(contract); // Reuse the transactional logic above
        count++;
      }

      return count;
    } catch (error) {
      console.error("Error auto-updating expired contracts:", error);
      return 0;
    }
  }
  // ============================================
  // GET METHODS
  // ============================================
  async getContractById(contractId, currentUser) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } },
        contract_addendums: true,
      },
    });

    if (!contract) throw new Error("Contract not found");

    await this.autoUpdateExpiredStatus(contract);
    await this.checkContractPermission(contract, currentUser);

    return this.formatContractResponse(contract);
  }

  async getContracts(filters = {}, currentUser) {
    let {
      room_id,
      tenant_user_id,
      status,
      page = 1,
      limit = 20,
      start_date,
      end_date,
      building_id,
    } = filters;

    page = parseInt(page);
    limit = parseInt(limit);
    const skip = (page - 1) * limit;
    const where = {};

    // Role filter
    if (currentUser.role === "TENANT") {
      const residentRecords = await prisma.room_tenants.findMany({
        where: {
          tenant_user_id: currentUser.user_id,
          is_current: true, // Chỉ lấy phòng đang ở hiện tại
        },
        select: { room_id: true },
      });

      const residentRoomIds = residentRecords.map((r) => r.room_id);

      // 2. Xây dựng điều kiện OR để xử lý trường hợp "vừa là Primary phòng A, vừa là Secondary phòng B"
      where.OR = [

        { tenant_user_id: currentUser.user_id },


        {
          room_id: { in: residentRoomIds },      // Phòng đang ở
          status: CONTRACT_STATUS.ACTIVE,        // Chỉ xem Active
          tenant_user_id: { not: currentUser.user_id } // (Optional) Loại trừ cái đã match ở Case A để tránh duplicate logic
        }
      ];
    } else if (currentUser.role === "MANAGER") {
      const today = new Date();
      const managedBuildings = await prisma.building_managers.findMany({
        where: {
          user_id: currentUser.user_id,
        },
        select: { building_id: true },
      });

      if (managedBuildings.length === 0) {
        return { data: [], pagination: { total: 0, page, limit, pages: 0 } };
      }

      const buildingIds = managedBuildings.map((b) => b.building_id);
      where.room_history = { building_id: { in: buildingIds } };
    }

    // Other filters
    if (room_id) where.room_id = parseInt(room_id);
    if (tenant_user_id && currentUser.role !== "TENANT") {
      where.tenant_user_id = parseInt(tenant_user_id);
    }
    if (status) where.status = status;

    if (building_id) {
      const bId = parseInt(building_id);
      if (where.room_history) {
        where.room_history = { ...where.room_history, building_id: bId };
      } else {
        where.room_history = { building_id: bId };
      }
    }

    if (start_date || end_date) {
      where.start_date = {};
      if (start_date) where.start_date.gte = new Date(start_date);
      if (end_date) where.start_date.lte = new Date(end_date);
    }

    await this.autoUpdateExpiredContracts();

    const [contracts, total] = await Promise.all([
      prisma.contracts.findMany({
        where,
        include: {
          room_history: {
            select: {
              room_id: true,
              room_number: true,
              building_id: true,
              building: {
                select: {
                  building_id: true,
                  name: true,
                },
              },
            },
          },
          tenant: {
            include: {
              user: {
                select: {
                  user_id: true,
                  full_name: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
        },
        skip,
        take: limit,
        orderBy: { created_at: "desc" },
      }),
      prisma.contracts.count({ where }),
    ]);

    return {
      data: contracts.map((c) => this.formatContractResponse(c)),
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  // ============================================
  // DOWNLOAD CONTRACT
  // ============================================
  async downloadContract(contractId, currentUser) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: {
          include: { building: true },
        },
      },
    });

    if (!contract || contract.deleted_at) {
      throw new Error("Contract not found");
    }

    await this.checkContractPermission(contract, currentUser);

    if (!contract.s3_key) {
      throw new Error("Contract file not found");
    }

    try {
      const downloadUrl = await s3Service.getDownloadUrl(
          contract.s3_key,
          contract.file_name || "contract.pdf",
          3600
      );

      return {
        contract_id: contractId,
        file_name: contract.file_name,
        download_url: downloadUrl,
        expires_in: 3600,
      };
    } catch (error) {
      throw new Error(`Failed to generate download URL: ${error.message}`);
    }
  }

  async downloadContractDirect(contractId, currentUser) {
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: {
          include: { building: true },
        },
      },
    });

    if (!contract || contract.deleted_at) {
      throw new Error("Contract not found");
    }

    await this.checkContractPermission(contract, currentUser);

    if (!contract.s3_key) {
      throw new Error("Contract file not found");
    }

    try {
      const fileBuffer = await s3Service.downloadFile(contract.s3_key);

      if (contract.checksum) {
        const isValid = s3Service.verifyChecksum(fileBuffer, contract.checksum);
        if (!isValid) {
          throw new Error("File integrity check failed");
        }
      }

      return {
        buffer: fileBuffer,
        file_name: contract.file_name || "contract.pdf",
        content_type: "application/pdf",
      };
    } catch (error) {
      throw new Error(`Failed to download contract file: ${error.message}`);
    }
  }
  async findPendingActionContract(tenantUserId) {
    if (!tenantUserId) return null;

    // Tìm hợp đồng thuộc về user này và có trạng thái "treo"
    const contract = await prisma.contracts.findFirst({
      where: {
        tenant_user_id: tenantUserId,
        status: {
          in: [
            CONTRACT_STATUS.PENDING,
            CONTRACT_STATUS.REQUESTED_TERMINATION
          ],
        },
        deleted_at: null,
      },
      include: {
        room_history: {
          include: {
            building: {
              select: { name: true, address: true }
            }
          }
        },

      },
      orderBy: {
        updated_at: 'desc', // Lấy cái mới nhất cần xử lý
      },
    });

    if (!contract) return null;

    // Format lại dữ liệu gọn gàng để trả về cho App hiển thị Popup
    return {
      contract_id: contract.contract_id,
      contract_number: contract.contract_number,
      status: contract.status,
      action_type: contract.status === CONTRACT_STATUS.PENDING ? 'SIGN_NEW' : 'APPROVE_TERMINATION',
      room_info: {
        room_number: contract.room_history?.room_number,
        building_name: contract.room_history?.building?.name,
        address: contract.room_history?.building?.address
      },
      dates: {
        start_date: contract.start_date,
        end_date: contract.end_date
      },
      note: contract.note // Lý do hủy thường nằm trong note
    };
  }
  // ============================================
  // PROCESS CONTRACT WITH AI
  // ============================================
  async processContractWithAI(fileBuffer, mimeType = "application/pdf") {
    try {
      const documentAIResult = await documentAIService.processContract(
          fileBuffer,
          mimeType
      );
      if (!documentAIResult.success)
        throw new Error("Document AI failed: " + documentAIResult.message);
      const extractedText =
          documentAIResult.firstPageText || documentAIResult.fullText;
      if (!extractedText?.trim()) throw new Error("No text extracted");

      const geminiResult = await geminiService.parseContractText(extractedText);
      if (!geminiResult.success)
        throw new Error("Gemini failed: " + geminiResult.rawResponse);

      const parsedData = geminiResult.data;
      const searchParams = {
        tenant_name: parsedData.tenant_name || null,
        tenant_phone: parsedData.tenant_phone || null,
        tenant_id_number: parsedData.tenant_id_number || null,
        room_number: parsedData.room_number || null,
      };

      if (!Object.values(searchParams).some((v) => v !== null)) {
        return {
          success: false,
          stage: "tenant_search",
          error: "No tenant info found in doc",
          parsed_data: parsedData,
          extracted_text: extractedText,
        };
      }

      const tenantMatch = await tenantService.findBestMatchTenant(searchParams);
      if (!tenantMatch) {
        return {
          success: false,
          stage: "tenant_not_found",
          error: "No tenant matched in DB",
          search_params: searchParams,
          parsed_data: parsedData,
          extracted_text: extractedText,
        };
      }

      console.log(
          `✓ Found tenant: ${tenantMatch.full_name} (ID: ${tenantMatch.user_id})`
      );

      let buildingId = null;
      if (tenantMatch.room?.room_id) {
        const roomInfo = await prisma.rooms.findUnique({
          where: { room_id: tenantMatch.room.room_id },
          select: { building_id: true },
        });
        if (roomInfo) buildingId = roomInfo.building_id;
      }

      // LOGIC QUAN TRỌNG: Ưu tiên Duration, nếu thiếu thì tính từ Start/End
      let durationMonths = null;
      if (parsedData.duration_months) {
        durationMonths = parseInt(parsedData.duration_months);
      } else if (parsedData.start_date && parsedData.end_date) {
        // Nếu AI không đọc được "X tháng", ta tính toán ngược lại
        durationMonths = this.calculateDurationFromDates(
            parsedData.start_date,
            parsedData.end_date
        );
      }

      // End Date sẽ được hàm createContract tính toán lại,
      // nhưng ta gửi xuống client để họ review (client có thể thấy End Date dự kiến)
      const estimatedEndDate = this.calculateEndDate(
          parsedData.start_date,
          durationMonths
      );

      const contractData = {
        room_id: tenantMatch.room?.room_id || null,
        tenant_user_id: tenantMatch.user_id,
        start_date: parsedData.start_date || null,
        end_date: estimatedEndDate
            ? estimatedEndDate.toISOString().split("T")[0]
            : null, // Info only for client view
        duration_months: durationMonths,
        rent_amount: parsedData.rent_amount || null,
        deposit_amount: parsedData.deposit_amount || null,
        penalty_rate: parsedData.penalty_rate || null,
        payment_cycle_months: parsedData.payment_cycle_months || 1,
        status: "pending",
        note: this._buildContractNote(parsedData, tenantMatch),
      };

      const validationErrors = this._validateContractData(
          contractData,
          parsedData
      );
      if (validationErrors.length > 0)
        console.warn("⚠ Validation warnings:", validationErrors);

      return {
        success: true,
        contract_data: contractData,
        tenant_info: {
          user_id: tenantMatch.user_id,
          full_name: tenantMatch.full_name,
          phone: tenantMatch.phone,
          email: tenantMatch.email,
          id_number: tenantMatch.id_number,
          room: { ...tenantMatch.room, building_id: buildingId },
          match_confidence:
              tenantMatch._match_metadata?.confidence_score || null,
        },
        parsed_data: parsedData,
        validation_warnings: validationErrors,
      };
    } catch (error) {
      console.error("✖ AI process error:", error.message);
      throw new Error(`AI processing failed: ${error.message}`);
    }
  }

  // ============================================
  // PERMISSION HELPERS
  // ============================================

  /**
   * Kiểm tra Manager có quyền truy cập building không
   */
  async checkManagerBuildingAccess(userId, buildingId) {
    const today = new Date();
    const managerBuilding = await prisma.building_managers.findFirst({
      where: {
        user_id: userId,
        building_id: buildingId,
      },
    });

    return !!managerBuilding;
  }

  /**
   * Kiểm tra quyền truy cập hợp đồng
   */
  async checkContractPermission(contract, currentUser) {
    // 1. Nếu là Manager/Owner -> Check building
    if (currentUser.role === "MANAGER") {
      const buildingId =
          contract.room_history?.building_id ||
          contract.room_history?.building?.building_id;

      if (!buildingId) throw new Error("Contract building information not found");

      const hasAccess = await this.checkManagerBuildingAccess(
          currentUser.user_id,
          buildingId
      );
      if (!hasAccess) throw new Error("You do not have permission to access this contract");
      return; // OK
    }

    // 2. Nếu là Tenant
    if (currentUser.role === "TENANT") {
      // Case A: Là người đứng tên (Primary) -> OK
      if (contract.tenant_user_id === currentUser.user_id) {
        return;
      }

      // Case B: Là Secondary Tenant (người ở cùng)
      // Logic: Phải đang ở trong phòng đó (is_current=true) VÀ Hợp đồng phải là ACTIVE
      const isResident = await prisma.room_tenants.findFirst({
        where: {
          room_id: contract.room_id,
          tenant_user_id: currentUser.user_id,
          is_current: true
        }
      });

      if (isResident) {
        if (contract.status === CONTRACT_STATUS.ACTIVE) {
          return; // OK
        } else {
          throw new Error("Residents can only view the currently active contract.");
        }
      }

      // Không thỏa mãn cả 2 case
      throw new Error("You do not have permission to access this contract");
    }
  }

// [File: contract.service.js]
// src/services/contract.service.js

  async forceTerminateContract(contractId, reason, files, currentUser, ipAddress = "unknown") {
    console.log(`--- [DEBUG] START Force Terminate Contract #${contractId} ---`);

    // 1. Kiểm tra Quyền
    if (!currentUser || currentUser.role !== "OWNER") {
      throw new Error("ACCESS DENIED: Chỉ có OWNER mới được quyền cưỡng chế hủy.");
    }

    // 2. Lấy thông tin hợp đồng
    const contract = await prisma.contracts.findUnique({
      where: { contract_id: contractId },
      include: {
        room_history: { include: { building: true } },
        tenant: { include: { user: true } }
      }
    });

    if (!contract) throw new Error("Không tìm thấy hợp đồng.");

    // 3. Logic Check Trạng thái
    console.log(`[DEBUG] Current Status: ${contract.status}`);
    if (contract.status !== CONTRACT_STATUS.REQUESTED_TERMINATION) {
      throw new Error("Chỉ được cưỡng chế khi hợp đồng đang ở trạng thái 'Yêu cầu chấm dứt' (requested_termination).");
    }

    // --- UPLOAD FILE ---
    if (!files || files.length === 0) {
      throw new Error("BẮT BUỘC: Vui lòng upload bằng chứng (ảnh/biên bản) để cưỡng chế.");
    }

    let bufferToUpload;
    let originalName = "evidence.pdf";
    const fileList = Array.isArray(files) ? files : [files];
    const isAllImages = fileList.every(f => f.mimetype.startsWith('image/'));

    if (isAllImages && fileList.length > 1) {
      try {
        bufferToUpload = await this._convertImagesToPdf(fileList);
        originalName = `evidence-merged-${Date.now()}.pdf`;
      } catch (err) {
        throw new Error("Lỗi khi gộp ảnh bằng chứng: " + err.message);
      }
    } else {
      bufferToUpload = fileList[0].buffer;
      originalName = fileList[0].originalname;
    }

    const uploadResult = await s3Service.uploadFile(
        bufferToUpload,
        originalName,
        'evidence'
    );

    console.log(`[DEBUG] Upload Success. S3 Key: ${uploadResult.s3_key}`);

    const evidenceTag = `[EVIDENCE_S3_KEY::${uploadResult.s3_key}]`;
    const evidenceNote = `
🛑 [FORCE TERMINATION]
- Lý do: ${reason}
- Người thực hiện: ${currentUser.full_name}
- Thời gian: ${new Date().toLocaleString('vi-VN')}
- File bằng chứng: ${uploadResult.file_name}
${evidenceTag}
`.trim();

    // --- CHECK BILLS ---
    // Xóa Bill Draft
    const deletedDrafts = await prisma.bills.deleteMany({
      where: {
        contract_id: contractId,
        status: 'draft'
      }
    });
    console.log(`[DEBUG] Deleted ${deletedDrafts.count} draft bills.`);

    const unpaidBillsList = await prisma.bills.findMany({
      where: {
        contract_id: contractId,
        status: { in: [ "issued", "partially_paid", "overdue"] },
        deleted_at: null,
      },
      select: {
        bill_id: true,
        bill_number: true,   // [FIX] Thay title bằng bill_number
        total_amount: true,  // [FIX] Thay amount bằng total_amount
        paid_amount: true,
        status: true,
        description: true    // Thêm description để dễ nhận diện
      }
    });

    const hasUnpaid = unpaidBillsList.length > 0;

    if (hasUnpaid) {
      console.log("!!! [DEBUG] FOUND UNPAID BILLS (Lý do không về TERMINATED):");
      console.table(unpaidBillsList); // Sẽ in ra bảng danh sách bill chưa trả trong Terminal
    } else {
      console.log("--- [DEBUG] NO UNPAID BILLS FOUND (Sạch nợ) ---");
    }

    const newStatus = hasUnpaid ? CONTRACT_STATUS.PENDING_TRANSACTION : CONTRACT_STATUS.TERMINATED;
    console.log(`[DEBUG] Final Status Decision: ${newStatus}`);

    // Log Audit
    const auditPayload = {
      event: "FORCE_TERMINATION",
      actor: { user_id: currentUser.user_id, role: currentUser.role, ip: ipAddress },
      target: { contract_id: contract.contract_id, contract_number: contract.contract_number },
      reason: reason,
      evidence_s3: uploadResult.s3_key,
      financial_status: hasUnpaid ? "HAS_DEBT" : "CLEAR",
      result_status: newStatus
    };
    auditLogger.logAuditAction(auditPayload).catch(console.error);

    // DB Update
    const result = await prisma.$transaction(async (tx) => {
      const updatedContract = await tx.contracts.update({
        where: { contract_id: contractId },
        data: {
          status: newStatus,
          end_date: newStatus === CONTRACT_STATUS.TERMINATED ? new Date() : contract.end_date,
          note: `${contract.note || ""}\n\n${evidenceNote}`,
          updated_at: new Date()
        },
        include: { room_history: true }
      });

      if (newStatus === CONTRACT_STATUS.TERMINATED) {
        await this._clearRoomAndTenant(tx, contract.room_id, contract.tenant_user_id, contractId);
      }
      return updatedContract;
    });

    console.log(`--- [DEBUG] END Force Terminate Success ---`);
    return {
      success: true,
      message: hasUnpaid
          ? "Đã chuyển sang trạng thái 'Chờ xử lý công nợ'. Vui lòng kiểm tra các hóa đơn (Issued/Overdue)."
          : "Đã chấm dứt hợp đồng và giải phóng phòng thành công.",
      data: this.formatContractResponse(result)
    };
  }
  // ============================================
  // PRIVATE HELPERS
  // ============================================

  /**
   * Xây dựng note cho contract từ parsed data
   */
  _buildContractNote(parsedData, tenantMatch) {
    const notes = ["🤖 Contract processed by AI"];
    if (parsedData.tenant_name)
      notes.push(`AI Name: ${parsedData.tenant_name}`);
    if (parsedData.tenant_phone)
      notes.push(`AI Phone: ${parsedData.tenant_phone}`);
    if (parsedData.tenant_id_number)
      notes.push(`AI ID: ${parsedData.tenant_id_number}`);
    if (parsedData.room_number)
      notes.push(`AI Room: ${parsedData.room_number}`);
    if (tenantMatch._match_metadata) {
      const conf = tenantMatch._match_metadata.confidence_score;
      notes.push(`Match conf: ${conf}/100`);
      if (conf < 70) notes.push("⚠️ Low confidence match");
    }
    return notes.join("\n");
  }

  /**
   * Validate contract data
   */
  _validateContractData(contractData, parsedData) {
    const errors = [];
    if (!contractData.room_id) errors.push("Missing room_id");
    if (!contractData.start_date) errors.push("Missing start_date");
    if (!contractData.duration_months) errors.push("Missing duration_months");

    if (!contractData.rent_amount || contractData.rent_amount <= 0)
      errors.push("Invalid rent_amount");
    return errors;
  }

  /**
   * Private: Clear room and close tenant history
   */
  async _clearRoomAndTenant(tx, roomId, tenantUserId, contractId) {
    // 1. Cập nhật Room -> Available
    // Chỉ update nếu contract hiện tại của room đúng là contract đang xử lý
    const room = await tx.rooms.findUnique({ where: { room_id: roomId } });
    if (room && room.current_contract_id === contractId) {
      await tx.rooms.update({
        where: { room_id: roomId },
        data: {
          current_contract_id: null,
          status: "available",
        },
      });
    }

    // 2. Đóng lịch sử thuê (Room Tenants)
    await tx.room_tenants.updateMany({
      where: {
        room_id: roomId,
        tenant_user_id: tenantUserId,
        is_current: true,
      },
      data: {
        is_current: false,
        moved_out_at: new Date(),
      },
    });
  }
  // ============================================
  // FORMAT RESPONSE
  // ============================================

  formatContractResponse(contract) {
    // Handle nested relations compatible with new Schema
    const room = contract.room_history || contract.rooms;
    const building = room?.building || room?.buildings;
    const tenant = contract.tenant || contract.tenants;
    const user = tenant?.user || tenant?.users;

    return {
      contract_id: contract.contract_id,
      contract_number: contract.contract_number,
      building_id: building?.building_id || room?.building_id || null,
      building_name: building?.name || null,
      room_id: contract.room_id,
      room_number: room?.room_number || null,
      tenant_user_id: contract.tenant_user_id,
      tenant_name: user?.full_name || null,
      tenant_email: user?.email || null,
      tenant_phone: user?.phone || null,
      tenant_id_number: tenant?.id_number || null,
      id_number: tenant?.id_number || null,
      start_date: contract.start_date,
      end_date: contract.end_date,
      duration_months: contract.duration_months,
      rent_amount: contract.rent_amount,
      deposit_amount: contract.deposit_amount,
      penalty_rate: contract.penalty_rate,
      payment_cycle_months: contract.payment_cycle_months,
      status: contract.status,
      s3_key: contract.s3_key,
      file_name: contract.file_name,
      checksum: contract.checksum,
      uploaded_at: contract.uploaded_at,
      has_file: !!contract.s3_key,
      note: contract.note,
      created_at: contract.created_at,
      updated_at: contract.updated_at,
      deleted_at: contract.deleted_at,
    };
  }
}

module.exports = new ContractService();