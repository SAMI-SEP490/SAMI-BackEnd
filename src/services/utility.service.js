// src/services/utility.service.js
// Updated: 2026-01-01

const prisma = require("../config/prisma");

class UtilityService {
  /**
   * Lấy danh sách chỉ số cũ của tất cả phòng trong tòa nhà để chuẩn bị nhập tháng mới
   * Dùng cho giao diện "Nhập chỉ số điện nước"
   */
  async getPreviousReadings(buildingId, billingMonth, billingYear) {
    // 1️⃣ Xác định tháng trước
    let prevMonth = billingMonth - 1;
    let prevYear = billingYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = billingYear - 1;
    }

    // 2️⃣ Lấy danh sách phòng
    const rooms = await prisma.rooms.findMany({
      where: { building_id: buildingId, is_active: true },
      select: { room_id: true, room_number: true },
    });

    const roomIds = rooms.map((r) => r.room_id);

    // 3️⃣ Lấy chỉ số tháng trước
    const prevReadings = await prisma.utility_readings.findMany({
      where: {
        room_id: { in: roomIds },
        billing_month: prevMonth,
        billing_year: prevYear,
      },
    });

    // 4️⃣ ⭐ Lấy chỉ số THÁNG HIỆN TẠI
    const currentReadings = await prisma.utility_readings.findMany({
      where: {
        room_id: { in: roomIds },
        billing_month: billingMonth,
        billing_year: billingYear,
      },
    });

    // 5️⃣ Map trả FE
    return rooms.map((room) => {
      const prev = prevReadings.find((r) => r.room_id === room.room_id);
      const curr = currentReadings.find((r) => r.room_id === room.room_id);

      return {
        room_id: room.room_id,
        room_number: room.room_number,

        old_electric: prev ? prev.curr_electric : 0,
        old_water: prev ? prev.curr_water : 0,

        // ⭐ QUAN TRỌNG
        new_electric: curr ? curr.curr_electric : null,
        new_water: curr ? curr.curr_water : null,
      };
    });
  }

  /**
   * Nhập/Cập nhật chỉ số điện nước cho nhiều phòng (Bulk Upsert)
   * Payload: { building_id, billing_month, billing_year, readings: [{ room_id, new_electric, new_water }] }
   */
  async recordMonthlyReadings(userId, data) {
    const { building_id, billing_month, billing_year, readings } = data;

    // 1. Lấy thông tin giá của tòa nhà
    const building = await prisma.buildings.findUnique({
      where: { building_id },
      select: { electric_unit_price: true, water_unit_price: true },
    });

    if (!building) throw new Error("Building not found");

    const electricPrice = Number(building.electric_unit_price || 0);
    const waterPrice = Number(building.water_unit_price || 0);

    const results = [];

    // 2. Xử lý từng phòng (Dùng transaction để đảm bảo an toàn)
    await prisma.$transaction(async (tx) => {
      for (const item of readings) {
        let prevMonth = billing_month - 1;
        let prevYear = billing_year;
        if (prevMonth === 0) {
          prevMonth = 12;
          prevYear -= 1;
        }

        const prevRecord = await tx.utility_readings.findUnique({
          where: {
            room_id_billing_month_billing_year: {
              room_id: item.room_id,
              billing_month: prevMonth,
              billing_year: prevYear,
            },
          },
        });

        const prevElectric =
          item.old_electric_override !== undefined
            ? item.old_electric_override
            : prevRecord
            ? prevRecord.curr_electric
            : 0;
        const prevWater =
          item.old_water_override !== undefined
            ? item.old_water_override
            : prevRecord
            ? prevRecord.curr_water
            : 0;

        // [BUSINESS LOGIC] State-dependent validation must stay here
        if (item.new_electric < prevElectric) {
          throw new Error(
            `Room ${item.room_id} Error: New Electric (${item.new_electric}) cannot be less than Old (${prevElectric})`
          );
        }
        if (item.new_water < prevWater) {
          throw new Error(
            `Room ${item.room_id} Error: New Water (${item.new_water}) cannot be less than Old (${prevWater})`
          );
        }

        // 3. Upsert vào DB
        // Nếu đã nhập rồi thì update, chưa thì create
        const record = await tx.utility_readings.upsert({
          where: {
            room_id_billing_month_billing_year: {
              room_id: item.room_id,
              billing_month,
              billing_year,
            },
          },
          update: {
            curr_electric: item.new_electric,
            curr_water: item.new_water,
            prev_electric: prevElectric,
            prev_water: prevWater,
            electric_price: electricPrice,
            water_price: waterPrice,
            created_by: userId,
            recorded_date: new Date(), // (tuỳ chọn)
          },
          create: {
            room_id: item.room_id,
            billing_month,
            billing_year,
            recorded_date: new Date(),
            prev_electric: prevElectric,
            curr_electric: item.new_electric,
            prev_water: prevWater,
            curr_water: item.new_water,
            electric_price: electricPrice,
            water_price: waterPrice,
            created_by: userId,
          },
        });

        results.push(record);
      }
    });

    return { success: true, processed: results.length };
  }
  /**
   * Lấy toàn bộ lịch sử điện nước của các phòng trong tòa nhà
   * (Tất cả các tháng TRƯỚC tháng/năm được truyền vào)
   */
  async getAllPreviousReadings(buildingId, billingMonth, billingYear) {
    return prisma.utility_readings.findMany({
      where: {
        room: {
          building_id: buildingId,
        },
        OR: [
          {
            billing_year: { lt: billingYear },
          },
          {
            billing_year: billingYear,
            billing_month: { lt: billingMonth },
          },
        ],
      },
      orderBy: [{ billing_year: "desc" }, { billing_month: "desc" }],
      include: {
        room: {
          select: {
            room_id: true,
            room_number: true,
          },
        },
      },
    });
  }
}

module.exports = new UtilityService();
