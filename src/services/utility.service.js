// src/services/utility.service.js
// Updated: 2026-01-20

const prisma = require("../config/prisma");
const { getVietnamDay } = require("../utils/datevn");

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

    return rooms.map((room) => {
      const prevRecord = prevReadings.find((r) => r.room_id === room.room_id);
      const currRecord = currentReadings.find(
        (r) => r.room_id === room.room_id,
      );

      // [FIX] Priority Logic for "Old Index":
      // 1. Current Record exists? Use its stored 'prev' value (This handles resets correctly)
      // 2. No Current Record? Use Previous Record's 'curr' value (Continuity)
      // 3. Fallback to 0

      let displayOldElectric = 0;
      let displayOldWater = 0;

      if (currRecord) {
        // If we already have a record, trust ITs history
        displayOldElectric = currRecord.prev_electric;
        displayOldWater = currRecord.prev_water;
      } else if (prevRecord) {
        // New entry: Default to continuing the chain
        displayOldElectric = prevRecord.curr_electric;
        displayOldWater = prevRecord.curr_water;
      }

      return {
        room_id: room.room_id,
        room_number: room.room_number,
        recorded_date: currRecord ? currRecord.recorded_date : null,

        old_electric: displayOldElectric,
        old_water: displayOldWater,

        new_electric: currRecord ? currRecord.curr_electric : null,
        new_water: currRecord ? currRecord.curr_water : null,

        // Return flags so UI knows if a reset happened (e.g. show a checked box)
        is_electric_reset: currRecord ? currRecord.is_electric_reset : false,
        is_water_reset: currRecord ? currRecord.is_water_reset : false,
      };
    });
  }

  /**
   * Nhập/Cập nhật chỉ số điện nước cho nhiều phòng (Bulk Upsert)
   * Payload: { building_id, billing_month, billing_year, readings: [{ room_id, new_electric, new_water }] }
   */
  async recordMonthlyReadings(userId, data) {
    const { building_id, billing_month, billing_year, readings } = data;

    // ===== DATE VALIDATION =====
    const today = getVietnamDay();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    if (
      billing_year > currentYear ||
      (billing_year === currentYear && billing_month > currentMonth)
    ) {
      throw new Error(
        `Cannot record utility readings for a future month (${billing_month}/${billing_year}).`,
      );
    }

    const recordDate = new Date(billing_year, billing_month - 1);
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    if (recordDate < threeMonthsAgo) {
      throw new Error(
        `Cannot record readings older than 3 months (${billing_month}/${billing_year}). Contact Admin if necessary.`,
      );
    }

    // ===== GET BUILDING PRICE =====
    const building = await prisma.buildings.findUnique({
      where: { building_id },
      select: { electric_unit_price: true, water_unit_price: true },
    });

    if (!building) throw new Error("Building not found");

    const electricPrice = Number(building.electric_unit_price || 0);
    const waterPrice = Number(building.water_unit_price || 0);

    const results = [];

    await prisma.$transaction(async (tx) => {
      for (const item of readings) {
        // ===== PREVIOUS MONTH =====
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

        let prevElectric = 0;
        let prevWater = 0;

        if (item.is_electric_reset) {
          prevElectric =
            item.old_electric_override !== undefined
              ? item.old_electric_override
              : 0;
        } else {
          prevElectric = prevRecord ? prevRecord.curr_electric : 0;
        }

        if (item.is_water_reset) {
          prevWater =
            item.old_water_override !== undefined ? item.old_water_override : 0;
        } else {
          prevWater = prevRecord ? prevRecord.curr_water : 0;
        }

        // ===== VALIDATION =====
        if (item.new_electric < prevElectric) {
          throw new Error(
            `Room ${item.room_id} Error: New Electric (${item.new_electric}) < Prev (${prevElectric}).`,
          );
        }

        if (item.new_water < prevWater) {
          throw new Error(
            `Room ${item.room_id} Error: New Water (${item.new_water}) < Prev (${prevWater}).`,
          );
        }

        // ===== UPSERT CURRENT MONTH =====
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
            is_electric_reset: item.is_electric_reset,
            is_water_reset: item.is_water_reset,
            electric_price: electricPrice,
            water_price: waterPrice,
            created_by: userId,
            recorded_date: getVietnamDay(),
          },
          create: {
            room_id: item.room_id,
            billing_month,
            billing_year,
            recorded_date: getVietnamDay(),
            prev_electric: prevElectric,
            curr_electric: item.new_electric,
            prev_water: prevWater,
            curr_water: item.new_water,
            is_electric_reset: item.is_electric_reset,
            is_water_reset: item.is_water_reset,
            electric_price: electricPrice,
            water_price: waterPrice,
            created_by: userId,
          },
        });

        results.push(record);

        // =====================================================
        // 🔥 NEW LOGIC: CASCADE UPDATE NEXT MONTH
        // =====================================================
        let nextMonth = billing_month + 1;
        let nextYear = billing_year;
        if (nextMonth === 13) {
          nextMonth = 1;
          nextYear += 1;
        }

        const nextRecord = await tx.utility_readings.findUnique({
          where: {
            room_id_billing_month_billing_year: {
              room_id: item.room_id,
              billing_month: nextMonth,
              billing_year: nextYear,
            },
          },
        });

        if (nextRecord) {
          await tx.utility_readings.update({
            where: { reading_id: nextRecord.reading_id },
            data: {
              prev_electric: nextRecord.is_electric_reset
                ? nextRecord.prev_electric
                : item.new_electric,
              prev_water: nextRecord.is_water_reset
                ? nextRecord.prev_water
                : item.new_water,
            },
          });
        }
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
