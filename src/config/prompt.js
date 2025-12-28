// src/resources/prompts.js

const CONTRACT_PARSING_PROMPT = (contractText) => `
Bạn là một AI chuyên phân tích hợp đồng thuê nhà. Hãy trích xuất các thông tin quan trọng từ hợp đồng ${contractText ? 'dưới đây' : 'trong file PDF'} và trả về dưới dạng JSON.

${contractText ? `\n--- NỘI DUNG HỢP ĐỒNG ---\n${contractText}\n--- KẾT THÚC ---\n` : ''}

Hãy trích xuất các thông tin sau (nếu có trong hợp đồng):

1. **tenant_name**: Tên người thuê (bên B/khách thuê)
2. **tenant_phone**: Số điện thoại người thuê
3. **tenant_id_number**: Số CMND/CCCD của người thuê
4. **room_number**: Số phòng/mã phòng (ví dụ: "101", "A-102", "Phòng 5")
5. **start_date**: Ngày bắt đầu hợp đồng (định dạng: YYYY-MM-DD)
6. **end_date**: Ngày kết thúc hợp đồng (định dạng: YYYY-MM-DD)
7. **rent_amount**: Giá thuê hàng tháng (chỉ lấy số, không kèm đơn vị)
8. **deposit_amount**: Tiền cọc/đặt cọc (chỉ lấy số, không kèm đơn vị)

LƯU Ý QUAN TRỌNG:
- Chỉ trả về JSON hợp lệ, KHÔNG thêm bất kỳ text giải thích nào
- Nếu không tìm thấy thông tin nào, đặt giá trị là null
- Với số tiền (rent_amount, deposit_amount): chỉ lấy số, không kèm đơn vị
- Với ngày tháng: định dạng YYYY-MM-DD
- KHÔNG bao gồm markdown code block (\`\`\`json), chỉ trả về JSON thuần

Ví dụ format JSON mong muốn:
{
  "tenant_name": "Nguyễn Văn A",
  "tenant_phone": "0123456789",
  "tenant_id_number": "001234567890",
  "room_number": "101",
  "start_date": "2024-01-01",
  "end_date": "2024-12-31",
  "rent_amount": 5000000,
  "deposit_amount": 10000000
}

Bây giờ hãy phân tích và trả về JSON:`;

module.exports = {
    CONTRACT_PARSING_PROMPT
};