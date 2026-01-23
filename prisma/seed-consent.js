// ============================================
// scripts/seed-consent.js
// Script để seed dữ liệu consent versions ban đầu
// ============================================

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function seedConsentVersions() {
    try {
        console.log('🌱 Seeding consent versions...\n');

        // ============================================================
        // 1. Terms of Service
        // ============================================================
        const tosContent = `
ĐIỀU KHOẢN SỬ DỤNG DỊCH VỤ

Cập nhật lần cuối: ${new Date().toLocaleDateString('vi-VN')}

1. CHẤP NHẬN ĐIỀU KHOẢN
   Bằng việc đăng ký và sử dụng dịch vụ cho thuê phòng của chúng tôi, bạn đồng ý tuân thủ 
   các điều khoản và điều kiện được quy định trong văn bản này.

2. QUYỀN VÀ NGHĨA VỤ CỦA NGƯỜI THUÊ
   2.1. Quyền lợi:
        - Được sử dụng phòng theo đúng mục đích đã thỏa thuận
        - Được hưởng đầy đủ các dịch vụ theo hợp đồng
        - Được bảo vệ quyền riêng tư cá nhân

   2.2. Nghĩa vụ:
        - Thanh toán tiền thuê đúng hạn
        - Giữ gìn vệ sinh chung
        - Tuân thủ nội quy tòa nhà
        - Báo cáo kịp thời các sự cố

3. THANH TOÁN
   - Tiền thuê phải được thanh toán vào ngày đầu tiên của mỗi tháng
   - Phí phạt sẽ được áp dụng cho mỗi ngày trễ hạn
   - Tiền đặt cọc sẽ được hoàn trả sau khi kết thúc hợp đồng

4. CHÍNH SÁCH HỦY BỎ
   - Thông báo trước ít nhất 30 ngày nếu muốn chấm dứt hợp đồng
   - Vi phạm điều khoản này sẽ bị mất tiền đặt cọc

5. TRÁCH NHIỆM
   Người thuê chịu trách nhiệm về mọi thiệt hại gây ra cho tài sản trong thời gian thuê.

6. ĐIỀU KHOẢN CHUNG
   - Mọi tranh chấp sẽ được giải quyết theo pháp luật Việt Nam
   - Điều khoản này có thể được cập nhật, thay đổi mà không cần thông báo trước
        `.trim();

        const tosHash = crypto.createHash('sha256').update(tosContent).digest('hex');

        const tos = await prisma.consent_versions.upsert({
            where: {
                consent_type_version_number: {
                    consent_type: 'TERM_OF_SERVICE',
                    version_number: 'v1.0'
                }
            },
            update: {},
            create: {
                consent_type: 'TERM_OF_SERVICE',
                version_number: 'v1.0',
                content: tosContent,
                content_hash: tosHash,
                is_active: true,
            },
        });
        console.log('✅ Created Terms of Service v1.0');

        // ============================================================
        // 2. Privacy Policy
        // ============================================================
        const privacyContent = `
CHÍNH SÁCH BẢO MẬT

Cập nhật lần cuối: ${new Date().toLocaleDateString('vi-VN')}

1. THU THẬP THÔNG TIN
   Chúng tôi thu thập các thông tin sau:
   - Thông tin cá nhân: Họ tên, ngày sinh, giới tính
   - Thông tin liên lạc: Email, số điện thoại, địa chỉ
   - Thông tin định danh: CMND/CCCD, hộ chiếu
   - Thông tin thanh toán: Thông tin tài khoản ngân hàng (nếu có)

2. MỤC ĐÍCH SỬ DỤNG THÔNG TIN
   Thông tin của bạn được sử dụng để:
   - Quản lý hợp đồng thuê phòng
   - Liên lạc về các vấn đề liên quan đến dịch vụ
   - Xử lý thanh toán
   - Đảm bảo an ninh và tuân thủ pháp luật

3. BẢO VỆ THÔNG TIN
   - Thông tin được mã hóa và lưu trữ an toàn
   - Chỉ nhân viên có thẩm quyền mới được truy cập
   - Không chia sẻ thông tin với bên thứ ba ngoại trừ theo yêu cầu pháp luật

4. QUYỀN CỦA BẠN
   Bạn có quyền:
   - Yêu cầu xem thông tin cá nhân
   - Yêu cầu chỉnh sửa thông tin không chính xác
   - Yêu cầu xóa thông tin (trong một số trường hợp)
   - Rút lại sự đồng ý (có thể ảnh hưởng đến dịch vụ)

5. THỜI GIAN LƯU TRỮ
   Thông tin sẽ được lưu trữ:
   - Trong suốt thời gian hợp đồng còn hiệu lực
   - 5 năm sau khi kết thúc hợp đồng (theo quy định pháp luật)

6. COOKIES VÀ CÔNG NGHỆ TƯƠNG TỰ
   Chúng tôi sử dụng cookies để cải thiện trải nghiệm người dùng và phân tích website.

7. LIÊN HỆ
   Nếu có thắc mắc về chính sách bảo mật, vui lòng liên hệ:
   - Email: support@example.com
   - Hotline: 1900-xxxx
        `.trim();

        const privacyHash = crypto.createHash('sha256').update(privacyContent).digest('hex');

        const privacy = await prisma.consent_versions.upsert({
            where: {
                consent_type_version_number: {
                    consent_type: 'PRIVACY_POLICY',
                    version_number: 'v1.0'
                }
            },
            update: {},
            create: {
                consent_type: 'PRIVACY_POLICY',
                version_number: 'v1.0',
                content: privacyContent,
                content_hash: privacyHash,
                is_active: true,
            },
        });
        console.log('✅ Created Privacy Policy v1.0');

        // ============================================================
        // 3. Contract Signing
        // ============================================================
        const contractContent = `
ĐIỀU KHOẢN KÝ KẾT HỢP ĐỒNG ĐIỆN TỬ

1. XÁC NHẬN PHÁP LÝ
   Bằng việc thực hiện thao tác ký kết điện tử này, bạn xác nhận:
   - Đã đọc, hiểu rõ và đồng ý với toàn bộ điều khoản trong Hợp đồng thuê.
   - Các thông tin cá nhân cung cấp là chính xác, đầy đủ và trung thực.
   - Bạn có đủ năng lực hành vi dân sự để thực hiện giao dịch này.
   - Hợp đồng điện tử sau khi ký kết có giá trị làm chứng cứ trong trường hợp xảy ra tranh chấp.

2. TRÁCH NHIỆM BẢO MẬT
   - Bạn có trách nhiệm bảo mật thiết bị và mã xác thực (OTP) dùng để ký kết.
   - Mọi giao dịch phát sinh từ tài khoản của bạn được coi là do chính bạn thực hiện.

3. LƯU TRỮ VÀ TRA CỨU
   - Hợp đồng đã ký sẽ được gửi về email của bạn và lưu trữ an toàn trên hệ thống.
   - Bạn có thể truy cập và tải về bản sao hợp đồng bất cứ lúc nào.
        `.trim();

        const contractHash = crypto.createHash('sha256').update(contractContent).digest('hex');

        const contract = await prisma.consent_versions.upsert({
            where: {
                consent_type_version_number: {
                    consent_type: 'CONTRACT_SIGNING',
                    version_number: 'v1.0'
                }
            },
            update: {},
            create: {
                consent_type: 'CONTRACT_SIGNING',
                version_number: 'v1.0',
                content: contractContent,
                content_hash: contractHash,
                is_active: true,
            },
        });
        console.log('✅ Created Contract Signing v1.0');

        // ============================================================
        // 4. Contract Termination (Mới thêm)
        // ============================================================
        const terminationContent = `
ĐIỀU KHOẢN VÀ XÁC NHẬN CHẤM DỨT HỢP ĐỒNG

1. NGUYÊN TẮC CHẤM DỨT
   Việc chấm dứt hợp đồng thuê phải tuân thủ các quy định đã nêu trong Hợp đồng thuê nhà và pháp luật hiện hành.

2. NGHĨA VỤ CỦA BÊN THUÊ KHI CHẤM DỨT
   - Bàn giao lại mặt bằng/phòng ốc nguyên trạng như khi nhận (trừ hao mòn tự nhiên).
   - Thanh toán đầy đủ các khoản tiền thuê, điện, nước, dịch vụ còn nợ tính đến ngày bàn giao.
   - Hoàn trả chìa khóa, thẻ từ và các tài sản khác thuộc sở hữu của Bên cho thuê.

3. QUY ĐỊNH VỀ TIỀN CỌC
   - Tiền cọc sẽ được hoàn trả sau khi trừ các chi phí sửa chữa hư hỏng (nếu có) và các khoản nợ tồn đọng.
   - Trường hợp chấm dứt trước hạn không đúng quy định (như không báo trước), tiền cọc có thể bị tịch thu theo điều khoản Hợp đồng.

4. XÁC NHẬN ĐIỆN TỬ
   Bằng việc xác nhận này, bạn đồng ý:
   - Chấm dứt hiệu lực của Hợp đồng thuê hiện tại.
   - Các biên bản bàn giao và thanh lý sẽ được lập và ký kết để hoàn tất thủ tục.
        `.trim();

        const terminationHash = crypto.createHash('sha256').update(terminationContent).digest('hex');

        const termination = await prisma.consent_versions.upsert({
            where: {
                consent_type_version_number: {
                    consent_type: 'CONTRACT_TERMINATION',
                    version_number: 'v1.0'
                }
            },
            update: {},
            create: {
                consent_type: 'CONTRACT_TERMINATION',
                version_number: 'v1.0',
                content: terminationContent,
                content_hash: terminationHash,
                is_active: true,
            },
        });
        console.log('✅ Created Contract Termination v1.0');

        // ============================================================
        // 5. Contract Addendum (Mới thêm)
        // ============================================================
        const addendumContent = `
ĐIỀU KHOẢN KÝ KẾT PHỤ LỤC HỢP ĐỒNG

1. MỐI QUAN HỆ VỚI HỢP ĐỒNG GỐC
   - Phụ lục này là một bộ phận không thể tách rời của Hợp đồng thuê nhà đã ký kết.
   - Các điều khoản không được đề cập trong Phụ lục này vẫn giữ nguyên hiệu lực theo Hợp đồng gốc.

2. NỘI DUNG ĐIỀU CHỈNH
   Bạn xác nhận đồng ý với các thay đổi được ghi nhận trong Phụ lục này, bao gồm nhưng không giới hạn ở:
   - Gia hạn thời gian thuê.
   - Điều chỉnh giá thuê hoặc phí dịch vụ.
   - Thay đổi số lượng người ở hoặc điều khoản sử dụng.

3. NGUYÊN TẮC ÁP DỤNG
   Trong trường hợp có sự mâu thuẫn giữa nội dung của Phụ lục này và Hợp đồng gốc, nội dung trong Phụ lục này sẽ được ưu tiên áp dụng.

4. HIỆU LỰC
   Phụ lục có hiệu lực kể từ ngày được hai bên xác nhận ký kết điện tử thành công.
        `.trim();

        const addendumHash = crypto.createHash('sha256').update(addendumContent).digest('hex');

        const addendum = await prisma.consent_versions.upsert({
            where: {
                consent_type_version_number: {
                    consent_type: 'CONTRACT_ADDENDUM',
                    version_number: 'v1.0'
                }
            },
            update: {},
            create: {
                consent_type: 'CONTRACT_ADDENDUM',
                version_number: 'v1.0',
                content: addendumContent,
                content_hash: addendumHash,
                is_active: true,
            },
        });
        console.log('✅ Created Contract Addendum v1.0');


        console.log('\n✅ Seeding completed successfully!');
        console.log('\nCreated versions:');
        console.log(`- Terms of Service: ${tos.version_id}`);
        console.log(`- Privacy Policy: ${privacy.version_id}`);
        console.log(`- Contract Signing: ${contract.version_id}`);
        console.log(`- Contract Termination: ${termination.version_id}`);
        console.log(`- Contract Addendum: ${addendum.version_id}`);

    } catch (error) {
        console.error('❌ Error seeding consent versions:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Chạy script
seedConsentVersions()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });

module.exports = { seedConsentVersions };