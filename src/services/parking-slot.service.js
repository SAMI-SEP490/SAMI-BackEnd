const prisma = require('../config/prisma');

class ParkingSlotService {

    // Tạo parking slot
    async createParkingSlot(data) {
        const { building_id, slot_number, slot_type } = data;

        if (!building_id || !slot_number || !slot_type) {
            throw new Error('Vui lòng cung cấp đầy đủ thông tin');
        }

        const building = await prisma.buildings.findUnique({
            where: { building_id }
        });

        if (!building) {
            throw new Error('Không tìm thấy tòa nhà');
        }

        // 1. Check trùng slot_number trong building
        const existedSlot = await prisma.parking_slots.findFirst({
            where: {
                building_id,
                slot_number
            }
        });

        if (existedSlot) {
            throw new Error('Mã số chỗ đậu xe đã tồn tại trong tòa nhà này');
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
            throw new Error('Không tìm thấy chỗ đậu xe');
        }

        return slot;
    }

    // Cập nhật parking slot
    async updateParkingSlot(slotId, data) {
        const slot = await prisma.parking_slots.findUnique({
            where: { slot_id: slotId }
        });

        if (!slot) {
            throw new Error('Không tìm thấy chỗ đậu xe');
        }

        // ❌ Không cho đổi loại xe
        if (data.slot_type && data.slot_type !== slot.slot_type) {
            throw new Error('Không thể thay đổi loại chỗ đậu xe');
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
                throw new Error('Mã số chỗ đậu xe đã tồn tại trong tòa nhà này');
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
                throw new Error("Quản lý chưa được phân công tòa nhà");
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
            throw new Error('Không tìm thấy chỗ đậu xe');
        }

        if (slot.vehicles.length > 0) {
            throw new Error('Không thể xóa chỗ đậu xe có phương tiện đang đỗ');
        }

        await prisma.parking_slots.delete({
            where: { slot_id: slotId }
        });

        return { message: 'Đã xóa chỗ đậu xe thành công' };
    }
    async getAvailableSlotForRegistration(registrationId) {
  const registration = await prisma.vehicle_registrations.findUnique({
    where: { registration_id: Number(registrationId) },
    include: {
      requester: {
        select: {
          user_id: true,
          building_id: true  
        }
      }
    }
  });

  if (!registration) {
    throw new Error("Không tìm thấy đăng ký xe");
  }

  const buildingId = registration.requester.building_id;

  if (!buildingId) {
    throw new Error("Không tìm thấy tòa nhà của người thuê");
  }

  return prisma.parking_slots.findMany({
    where: {
      building_id: buildingId,
      slot_type: registration.vehicle_type,
      is_available: true
    },
    orderBy: { slot_number: "asc" }
  });
}
async getAvailableSlotsForVehicle(vehicleId) {
  const vehicle = await prisma.vehicles.findUnique({
    where: { vehicle_id: Number(vehicleId) },
    include: {
      registration: true,
      tenant: {
        select: {
          user_id: true,
          building_id: true   
        }
      }
    }
  });

  if (!vehicle) throw new Error("Không tìm thấy phương tiện");

  const buildingId = vehicle.tenant.building_id;

  if (!buildingId) throw new Error("Không tìm thấy tòa nhà của người thuê");
  return prisma.parking_slots.findMany({
    where: {
      building_id: buildingId,
      slot_type: vehicle.registration.vehicle_type,
      is_available: true
    },
    orderBy: { slot_number: "asc" }
  });
}

}

module.exports = new ParkingSlotService();
