// src/services/utility.service.js
// Updated: 2026-01-01

const prisma = require('../config/prisma');

class UtilityService {

    /**
     * Lấy danh sách chỉ số cũ của tất cả phòng trong tòa nhà để chuẩn bị nhập tháng mới
     * Dùng cho giao diện "Nhập chỉ số điện nước"
     */
    async getPreviousReadings(buildingId, billingMonth, billingYear) {
        // Xác định tháng trước
        let prevMonth = billingMonth - 1;
        let prevYear = billingYear;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear = billingYear - 1;
        }

        // Lấy danh sách phòng đang active
        const rooms = await prisma.rooms.findMany({
            where: { building_id: buildingId, is_active: true },
            select: { room_id: true, room_number: true }
        });

        // Lấy chỉ số tháng trước của các phòng này
        const prevReadings = await prisma.utility_readings.findMany({
            where: {
                room_id: { in: rooms.map(r => r.room_id) },
                billing_month: prevMonth,
                billing_year: prevYear
            }
        });

        // Map data để trả về FE
        return rooms.map(room => {
            const reading = prevReadings.find(r => r.room_id === room.room_id);
            return {
                room_id: room.room_id,
                room_number: room.room_number,
                old_electric: reading ? reading.curr_electric : 0, // Số mới tháng trước là số cũ tháng này
                old_water: reading ? reading.curr_water : 0
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
            select: { electric_unit_price: true, water_unit_price: true }
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
                if (prevMonth === 0) { prevMonth = 12; prevYear -= 1; }

                const prevRecord = await tx.utility_readings.findUnique({
                    where: {
                        unique_room_utility_period: {
                            room_id: item.room_id,
                            billing_month: prevMonth,
                            billing_year: prevYear
                        }
                    }
                });

                const prevElectric = item.old_electric_override !== undefined ? item.old_electric_override : (prevRecord ? prevRecord.curr_electric : 0);
                const prevWater = item.old_water_override !== undefined ? item.old_water_override : (prevRecord ? prevRecord.curr_water : 0);

                // [BUSINESS LOGIC] State-dependent validation must stay here
                if (item.new_electric < prevElectric) {
                    throw new Error(`Room ${item.room_id} Error: New Electric (${item.new_electric}) cannot be less than Old (${prevElectric})`);
                }
                if (item.new_water < prevWater) {
                    throw new Error(`Room ${item.room_id} Error: New Water (${item.new_water}) cannot be less than Old (${prevWater})`);
                }

                // 3. Upsert vào DB
                // Nếu đã nhập rồi thì update, chưa thì create
                const record = await tx.utility_readings.upsert({
                    where: {
                        unique_room_utility_period: {
                            room_id: item.room_id,
                            billing_month: billing_month,
                            billing_year: billing_year
                        }
                    },
                    update: {
                        curr_electric: item.new_electric,
                        curr_water: item.new_water,
                        prev_electric: prevElectric, // Update lại phòng khi số cũ sai
                        prev_water: prevWater,
                        electric_price: electricPrice, // Snapshot giá tại thời điểm nhập
                        water_price: waterPrice,
                        created_by: userId,
                        created_at: new Date()
                    },
                    create: {
                        room_id: item.room_id,
                        billing_month: billing_month,
                        billing_year: billing_year,
                        recorded_date: new Date(),
                        prev_electric: prevElectric,
                        curr_electric: item.new_electric,
                        prev_water: prevWater,
                        curr_water: item.new_water,
                        electric_price: electricPrice,
                        water_price: waterPrice,
                        created_by: userId
                    }
                });
                results.push(record);
            }
        });

        return { success: true, processed: results.length };
    }
}

module.exports = new UtilityService();
