const prisma = require('../config/prisma');

class ParkingSlotService {

    // Tạo parking slot
    async createParkingSlot(data) {
        const { building_id, slot_number, slot_type } = data;

        if (!building_id || !slot_number || !slot_type) {
            throw new Error('Missing required fields');
        }

        const building = await prisma.buildings.findUnique({
            where: { building_id }
        });

        if (!building) {
            throw new Error('Building not found');
        }

        // 1. Check trùng slot_number trong building
        const existedSlot = await prisma.parking_slots.findFirst({
            where: {
                building_id,
                slot_number
            }
        });

        if (existedSlot) {
            throw new Error('Slot number already exists in this building');
        }

        // 2. Đếm số slot hiện tại theo loại
        const currentCount = await prisma.parking_slots.count({
            where: {
                building_id,
                slot_type
            }
        });

        // 3. Check quota theo loại xe
        if (slot_type === 'two_wheeler') {
            if (building.max_2_wheel_slot !== null && currentCount >= building.max_2_wheel_slot) {
                throw new Error('Đã đạt số lượng slot tối đa cho xe 2 bánh');
            }
        }

        if (slot_type === 'four_wheeler') {
            if (building.max_4_wheel_slot !== null && currentCount >= building.max_4_wheel_slot) {
                throw new Error('Đã đạt số lượng slot tối đa cho xe 4 bánh');
            }
        }

        // 4. Tạo slot
        return prisma.parking_slots.create({
            data: {
                building_id,
                slot_number,
                slot_type,
                is_available: true
            }
        });
    }

    // Lấy danh sách parking slot
    async getParkingSlots(query) {
        const { building_id, is_available } = query;
        const where = {};

        if (building_id) {
            where.building_id = parseInt(building_id);
        }

        if (is_available !== undefined) {
            where.is_available = is_available === 'true';
        }

        return prisma.parking_slots.findMany({
            where,
            orderBy: {
                slot_number: 'asc'
            }
        });
    }

    // Lấy parking slot theo ID
    async getParkingSlotById(slotId) {
        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: slotId }
        });

        if (!slot) {
            throw new Error('Parking slot not found');
        }

        return slot;
    }

    // Cập nhật parking slot
    async updateParkingSlot(slotId, data) {
        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: slotId }
        });

        if (!slot) {
            throw new Error('Parking slot not found');
        }

        // ❌ Không cho đổi loại xe
        if (data.slot_type && data.slot_type !== slot.slot_type) {
            throw new Error('Cannot change parking slot type');
        }

        // Check trùng số slot trong building
        if (data.slot_number && data.slot_number !== slot.slot_number) {
            const duplicated = await prisma.parking_slots.findFirst({
                where: {
                    building_id: slot.building_id,
                    slot_number: data.slot_number,
                    NOT: { slot_id: slotId }
                }
            });

            if (duplicated) {
                throw new Error('Slot number already exists in this building');
            }
        }

        return prisma.parking_slots.update({
            where: { slot_id: slotId },
            data
        });
    }
   async getBuildingsForParking(user) {
  const where = {};

  if (user.role === "MANAGER") {
    const managerBuilding = await prisma.building_managers.findFirst({
      where: {
        user_id: user.user_id,
      },
      select: {
        building_id: true,
      },
    });

    if (!managerBuilding) {
      throw new Error("Manager has no building assigned");
    }

    where.building_id = managerBuilding.building_id;
  }

  return prisma.buildings.findMany({
    where,
    select: {
      building_id: true,
      name: true,
      max_2_wheel_slot: true,
      max_4_wheel_slot: true,
    },
    orderBy: { name: "asc" },
  });
}
    // Xóa parking slot
    async deleteParkingSlot(slotId) {
        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: slotId },
            include: { vehicles: true }
        });

        if (!slot) {
            throw new Error('Parking slot not found');
        }

        if (slot.vehicles.length > 0) {
            throw new Error('Cannot delete parking slot with assigned vehicles');
        }

        await prisma.parking_slots.delete({
            where: { slot_id: slotId }
        });

        return { message: 'Parking slot deleted successfully' };
    }
}

module.exports = new ParkingSlotService();
