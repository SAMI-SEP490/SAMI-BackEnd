// Updated: 2025-05-12
// by: DatNB

const prisma = require("../config/prisma");
const redisClient = require("../config/redis");
const { hashPassword, comparePassword } = require("../utils/password");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../utils/jwt");
const { generateRandomToken } = require("../utils/tokens");
const { sendPasswordResetEmail, sendOTPEmail } = require("../utils/email");
const s3Service = require("./s3.service");
const config = require("../config");

class AuthService {
  async register(data) {
    const { email, password, phone, full_name, gender, birthday } = data;

    /* =======================
     VALIDATE INPUT CƠ BẢN
  ======================= */
    if (!email) {
      throw new Error("Email là bắt buộc");
    }

    if (!password) {
      throw new Error("Mật khẩu là bắt buộc");
    }

    if (!birthday) {
      throw new Error("Ngày sinh là bắt buộc");
    }

    /* =======================
     NORMALIZE & VALIDATE FULL NAME
     - Không chứa số
     - Chuẩn hóa khoảng trắng
     - Tự động viết hoa chữ cái đầu mỗi từ
  ======================= */
    let normalizedFullName = full_name;

    if (full_name) {
      // Không chứa số
      if (/\d/.test(full_name)) {
        throw new Error("Họ và tên không được chứa chữ số");
      }

      // Chuẩn hóa khoảng trắng
      normalizedFullName = full_name.trim().replace(/\s+/g, " ");

      // Viết hoa chữ cái đầu mỗi từ
      normalizedFullName = normalizedFullName
        .split(" ")
        .map((word) => {
          if (!word) return word;
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
    }

    /* =======================
     VALIDATE PHONE
     - 10 hoặc 11 số
     - Bắt đầu bằng 0
  ======================= */
    if (phone) {
      const phoneRegex = /^0\d{9,10}$/;
      if (!phoneRegex.test(phone)) {
        throw new Error(
          "Số điện thoại phải bắt đầu bằng số 0 và có 10 hoặc 11 chữ số",
        );
      }
    }

    /* =======================
     VALIDATE PASSWORD
  ======================= */
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

    if (!passwordRegex.test(password)) {
      throw new Error(
        "Mật khẩu phải có ít nhất 8 ký tự, bao gồm chữ hoa, chữ thường, số và ký tự đặc biệt",
      );
    }

    /* =======================
     VALIDATE TUỔI
  ======================= */
    const birthDate = new Date(birthday);
    const today = new Date();

    if (birthDate > today) {
      throw new Error("Ngày sinh không được vượt quá ngày hiện tại");
    }

    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    if (age < 18) {
      throw new Error("Người dùng phải đủ 18 tuổi trở lên");
    }

    if (age > 150) {
      throw new Error("Tuổi người dùng không hợp lệ");
    }

    /* =======================
     CHECK USER ĐÃ TỒN TẠI
  ======================= */
    const existingUser = await prisma.users.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
    });

    if (existingUser) {
      throw new Error("Email hoặc số điện thoại đã tồn tại");
    }

    /* =======================
     CREATE USER
  ======================= */
    const hashedPassword = await hashPassword(password);

    const user = await prisma.users.create({
      data: {
        email,
        password_hash: hashedPassword,
        phone,
        full_name: normalizedFullName,
        gender,
        birthday: birthDate,
        status: "Active",
        is_verified: false,
      },
    });

    /* =======================
     RESPONSE
  ======================= */
    return {
      id: user.user_id,
      email: user.email,
      phone: user.phone,
      full_name: user.full_name,
      status: user.status,
    };
  }

  async login(email, password) {
    // Find user by email or phone
    const user = await prisma.users.findFirst({
      where: {
        OR: [{ email }],
        deleted_at: null,
      },
    });

    if (!user) {
      throw new Error("Invalid credentials");
    }

    // Check if account is active
    if (user.status !== "Active") {
      throw new Error("Account is deactivated");
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);

    if (!isSecondary) {
      // --- [LOGIC MỚI: HỖ TRỢ ĐA HỢP ĐỒNG] ---

      // Định nghĩa các trạng thái "ĐƯỢC PHÉP VÀO APP"
      // (Bao gồm cả Pending để user còn vào ký hợp đồng)
      const allowedStatuses = [
        "active",
        "pending",
        "pending_transaction",
        "requested_termination"
      ];

      // Tìm xem user có BẤT KỲ hợp đồng nào đang "sống" không?
      const hasValidContract = await prisma.contracts.findFirst({
        where: {
          tenant_user_id: user.user_id,
          status: { in: allowedStatuses }, // Chỉ cần 1 cái nằm trong nhóm này là OK
          deleted_at: null,
        },
      });

      if (!hasValidContract) {
        // Nếu không có hợp đồng hợp lệ, kiểm tra xem có hợp đồng nào không (để báo lỗi chính xác)
        const anyContract = await prisma.contracts.findFirst({
          where: { tenant_user_id: user.user_id, deleted_at: null },
        });

        if (!anyContract) {
          throw new Error("Bạn chưa có hợp đồng thuê phòng nào.");
        } else {
          // Có hợp đồng nhưng toàn là Rejected/Terminated/Expired
          throw new Error("Tất cả hợp đồng của bạn đã kết thúc hoặc bị từ chối. Vui lòng liên hệ quản lý.");
        }
      }
    }
    if (!user.is_verified) {
      // Generate OTP
      const otp = this.generateOTP();

      // Store OTP in Redis with 10 minutes expiry
      const otpKey = `otp:${user.user_id}`;
      await redisClient.setex(otpKey, 600, otp); // 600 seconds = 10 minutes

      // Send OTP to email
      await sendOTPEmail(user.email, otp, user.full_name);

      return {
        requiresOTP: true,
        userId: user.user_id,
        email: user.email,
        message: "OTP has been sent to your email",
      };
    }

    // User is already verified, proceed with normal login
    return this.generateLoginResponse(user);
  }

  async verifyOTP(userId, otp) {
    // Get OTP from Redis
    const otpKey = `otp:${userId}`;
    const storedOTP = await redisClient.get(otpKey);

    if (!storedOTP) {
      throw new Error("OTP has expired or does not exist");
    }

    if (String(storedOTP).trim() !== String(otp).trim()) {
      throw new Error("Invalid OTP");
    }

    // OTP is valid, delete it from Redis
    await redisClient.del(otpKey);

    // Mark user as verified
    const user = await prisma.users.update({
      where: { user_id: userId },
      data: {
        is_verified: true,
        updated_at: new Date(),
      },
    });

    // Generate tokens and return login response
    return this.generateLoginResponse(user);
  }

  async resendOTP(userId) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    if (user.is_verified) {
      throw new Error("User is already verified");
    }

    // Check if there's a cooldown (prevent spam)
    const cooldownKey = `otp_cooldown:${userId}`;
    const cooldown = await redisClient.get(cooldownKey);

    if (cooldown) {
      throw new Error("Please wait before requesting another OTP");
    }

    // Generate new OTP
    const otp = this.generateOTP();

    // Store OTP in Redis with 10 minutes expiry
    const otpKey = `otp:${userId}`;
    await redisClient.setex(otpKey, 600, otp);

    // Set cooldown (60 seconds)
    await redisClient.setex(cooldownKey, 60, "1");

    // Send OTP to email
    await sendOTPEmail(user.email, otp, user.full_name);

    return {
      message: "OTP has been resent to your email",
    };
  }

  generateOTP() {
    // Generate 6-digit OTP
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  generateLoginResponse(user) {
    // Generate tokens
    const accessToken = generateAccessToken(user.user_id, user.role);
    const refreshToken = generateRefreshToken(user.user_id);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.user_id,
        email: user.email,
        phone: user.phone,
        full_name: user.full_name,
        gender: user.gender,
        birthday: user.birthday,
        avatar_url: user.avatar_url,
        status: user.status,
        role: user.role,
      },
    };
  }

  async refreshAccessToken(refreshToken) {
    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);

    if (!decoded) {
      throw new Error("Invalid refresh token");
    }

    // Note: Without refresh_tokens table, we can't validate stored tokens
    // We'll just verify the JWT signature and generate new access token

    // Find user
    const user = await prisma.users.findUnique({
      where: { user_id: decoded.userId },
    });

    if (!user || user.deleted_at) {
      throw new Error("User not found");
    }

    // Check if user is active
    if (user.status !== "Active") {
      throw new Error("Account is deactivated");
    }

    // Generate new access token
    const accessToken = generateAccessToken(user.user_id, user.role);

    return {
      accessToken,
      user: {
        id: user.user_id,
        email: user.email,
        phone: user.phone,
        full_name: user.full_name,
        status: user.status,
      },
    };
  }

  async logout(refreshToken) {
    // Note: Without refresh_tokens table, we can't invalidate tokens
    // Tokens will remain valid until they expire
    return true;
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Verify current password
    const isValidPassword = await comparePassword(
      currentPassword,
      user.password_hash,
    );

    if (!isValidPassword) {
      throw new Error("Current password is incorrect");
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.users.update({
      where: { user_id: userId },
      data: {
        password_hash: hashedPassword,
        updated_at: new Date(),
      },
    });

    return true;
  }

  async forgotPassword(email) {
    const user = await prisma.users.findFirst({
      where: {
        email,
        deleted_at: null,
      },
    });

    if (!user) {
      return {
        success: false,
        message: "Email does not exist in our system",
      };
    }

    // Check if account is active
    if (user.status !== "Active") {
      throw new Error("Account is deactivated");
      throw new Error("Account is deactivated");
      throw new Error("Account is deactivated");
    }

    // Check if there's a cooldown (prevent spam)
    const cooldownKey = `password_reset_cooldown:${user.user_id}`;
    const cooldown = await redisClient.get(cooldownKey);

    if (cooldown) {
      throw new Error(
        "Please wait before requesting another password reset OTP",
      );
    }

    // Generate OTP
    const otp = this.generateOTP();

    // Store OTP in Redis with 10 minutes expiry
    const otpKey = `password_reset_otp:${user.user_id}`;
    await redisClient.setex(otpKey, 600, otp); // 600 seconds = 10 minutes

    // Set cooldown (60 seconds)
    await redisClient.setex(cooldownKey, 60, "1");

    // Send OTP to email
    await sendPasswordResetEmail(user.email, otp, user.full_name);

    return {
      success: true,
      userId: user.user_id,
      email: user.email,
      message: "OTP has been sent to your email",
    };
  }

  async verifyPasswordResetOTP(userId, otp) {
    // Get OTP from Redis
    const otpKey = `password_reset_otp:${userId}`;
    const storedOTP = await redisClient.get(otpKey);

    if (!storedOTP) {
      throw new Error("OTP has expired or does not exist");
    }

    if (String(storedOTP).trim() !== String(otp).trim()) {
      throw new Error("Invalid OTP");
    }

    // OTP is valid, generate a temporary token for password reset
    const resetToken = generateRandomToken(32);

    // Store reset token in Redis with 15 minutes expiry
    const resetTokenKey = `password_reset_token:${userId}`;
    await redisClient.setex(resetTokenKey, 900, resetToken); // 900 seconds = 15 minutes

    // Delete the OTP as it's no longer needed
    await redisClient.del(otpKey);

    return {
      success: true,
      resetToken,
      userId,
      message: "OTP verified successfully. You can now reset your password",
    };
  }

  async resetPassword(userId, resetToken, newPassword) {
    // Verify reset token from Redis
    const resetTokenKey = `password_reset_token:${userId}`;
    console.log("Key to check:", resetTokenKey);
    const storedToken = await redisClient.get(resetTokenKey);
    console.log("Stored token from Redis:", storedToken);

    if (!storedToken) {
      throw new Error("Password reset token has expired or does not exist");
    }

    if (storedToken !== resetToken) {
      throw new Error("Invalid password reset token");
    }

    // Find user
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user || user.deleted_at) {
      throw new Error("User not found");
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password
    await prisma.users.update({
      where: { user_id: userId },
      data: {
        password_hash: hashedPassword,
        updated_at: new Date(),
      },
    });

    // Delete the reset token as it's been used
    await redisClient.del(resetTokenKey);

    // Also delete any cooldown
    const cooldownKey = `password_reset_cooldown:${userId}`;
    await redisClient.del(cooldownKey);

    return {
      success: true,
      message: "Password has been reset successfully",
    };
  }

  async resendPasswordResetOTP(userId) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user || user.deleted_at) {
      throw new Error("User not found");
    }

    if (user.status !== "Active") {
      throw new Error("Account is deactivated");
    }

    // Check if there's a cooldown (prevent spam)
    const cooldownKey = `password_reset_cooldown:${userId}`;
    const cooldown = await redisClient.get(cooldownKey);

    if (cooldown) {
      throw new Error("Please wait before requesting another OTP");
    }

    // Generate new OTP
    const otp = this.generateOTP();

    // Store OTP in Redis with 10 minutes expiry
    const otpKey = `password_reset_otp:${userId}`;
    await redisClient.setex(otpKey, 600, otp);

    // Set cooldown (60 seconds)
    await redisClient.setex(cooldownKey, 60, "1");

    // Send OTP to email
    await sendPasswordResetEmail(user.email, otp, user.full_name);

    return {
      message: "OTP has been resent to your email",
    };
  }

  async getUserProfile(userId) {
    const user = await prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        phone: true,
        full_name: true,
        gender: true,
        birthday: true,
        avatar_url: true,
        status: true,
        role: true,
        is_verified: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user || user.deleted_at) {
      throw new Error("User not found");
    }

    // Fetch role-specific information based on user's role
    let roleSpecificData = null;

    switch (user.role) {
      case "TENANT":
        roleSpecificData = await prisma.tenants.findUnique({
          where: { user_id: userId },
          select: {
            user_id: true,
            tenant_since: true,
            id_number: true,
            note: true,

            // Lấy thông tin user liên quan (ví dụ: phone, email)
            user: {
              select: {
                phone: true,
                email: true,
                full_name: true,
              },
            },

            // Phòng đang ở / từng ở (qua bảng trung gian)
            room_tenants_history: {
              select: {
                room: {
                  select: {
                    room_id: true,
                    room_number: true,
                    floor: true,
                    building: {
                      select: {
                        building_id: true,
                        name: true,
                        address: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });
        break;

      case "MANAGER":
        roleSpecificData = await prisma.building_managers.findFirst({
          where: { user_id: userId },
          select: {
            user_id: true,
            building_id: true,
            note: true,
            building: {
              select: {
                building_id: true,
                name: true,
                address: true,
                is_active: true,
                created_at: true,
              },
            },
          },
        });
        break;

      case "OWNER":
        // Hiện tại chưa có bảng building_owner
        roleSpecificData = null;
        break;

      case "USER":
      default:
        // No additional role-specific data for USER role
        roleSpecificData = null;
        break;
    }

    // Return combined user profile with role-specific data
    return {
      ...user,
      roleDetails: roleSpecificData,
    };
  }

  async updateProfile(userId, data, avatarFile = null) {
    const { full_name, gender, birthday, phone } = data;

    // Validate phone nếu có thay đổi
    if (phone) {
      const existingUserWithPhone = await prisma.users.findFirst({
        where: {
          phone: phone,
          user_id: { not: userId }, // Không phải chính user này
          deleted_at: null,
        },
      });

      if (existingUserWithPhone) {
        throw new Error("Phone number is already in use by another account");
      }
    }

    let avatar_url = undefined;

    // Nếu có file avatar được upload
    if (avatarFile) {
      try {
        // Upload ảnh lên S3 sử dụng method uploadAvatar mới
        const uploadResult = await s3Service.uploadAvatar(
          avatarFile.buffer,
          avatarFile.originalname,
        );

        console.log("S3 upload result:", uploadResult);
        avatar_url = uploadResult.url;
        console.log("Avatar URL to save:", avatar_url);

        // Xóa ảnh cũ nếu có (optional - để tránh rác trên S3)
        const currentUser = await prisma.users.findUnique({
          where: { user_id: userId },
          select: { avatar_url: true },
        });

        if (currentUser && currentUser.avatar_url) {
          // Extract s3_key from old URL
          const oldS3Key = s3Service.extractS3KeyFromUrl(
            currentUser.avatar_url,
          );
          if (oldS3Key && oldS3Key.startsWith("avatars/")) {
            // Chỉ xóa nếu là avatar (safety check)
            await s3Service.deleteFile(oldS3Key).catch((err) => {
              console.error("Failed to delete old avatar:", err);
              // Không throw error, tiếp tục update profile
            });
          }
        }
      } catch (error) {
        console.error("Error uploading avatar:", error);
        throw new Error("Failed to upload avatar image");
      }
    }

    // Chuẩn bị data để update (chỉ update những field được gửi lên)
    const updateData = {
      updated_at: new Date(),
    };

    if (full_name !== undefined) updateData.full_name = full_name;
    if (gender !== undefined) updateData.gender = gender;
    if (birthday !== undefined)
      updateData.birthday = birthday ? new Date(birthday) : null;
    if (phone !== undefined) updateData.phone = phone;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    // Update user profile
    const user = await prisma.users.update({
      where: { user_id: userId },
      data: updateData,
      select: {
        user_id: true,
        email: true,
        phone: true,
        full_name: true,
        gender: true,
        birthday: true,
        avatar_url: true,
        status: true,
      },
    });

    return user;
  }
}

module.exports = new AuthService();
