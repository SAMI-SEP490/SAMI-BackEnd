// src/services/gemini.service.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

/**
 * Service để xử lý PDF và parse thành JSON bằng Gemini API
 */
class GeminiService {
    constructor() {
        // Khởi tạo Gemini client
        this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
        this.model = this.genAI.getGenerativeModel({
            model: config.gemini.modelName || 'gemini-1.5-flash-latest'
        });
        console.log(`Gemini Service initialized with model: ${config.gemini.modelName || 'gemini-1.5-flash-latest'}`);
    }

    /**
     * Parse text từ hợp đồng thành JSON
     * @param {string} contractText - Text của hợp đồng (từ Document AI)
     * @returns {Promise<object>} - JSON chứa thông tin đã parse
     */
    async parseContractText(contractText) {
        try {
            console.log('Sending text to Gemini for parsing...');

            const prompt = this._buildPrompt(contractText);

            const result = await this.model.generateContent(prompt);
            const response = result.response;
            const text = response.text();

            console.log('Received response from Gemini');

            // Parse JSON từ response
            const jsonData = this._extractJSON(text);

            return {
                success: true,
                data: jsonData,
                rawResponse: text
            };

        } catch (error) {
            console.error('Error calling Gemini API:', error.message);
            throw new Error(`Gemini parsing failed: ${error.message}`);
        }
    }

    /**
     * Đọc PDF trực tiếp và parse thành JSON (không cần Document AI)
     * @param {Buffer} pdfBuffer - Buffer của file PDF
     * @param {string} mimeType - MIME type của file
     * @returns {Promise<object>} - JSON chứa thông tin đã parse
     */
    async parsePDFDirect(pdfBuffer, mimeType = 'application/pdf') {
        try {
            console.log('Sending PDF directly to Gemini...');

            // Convert buffer sang base64
            const base64Data = pdfBuffer.toString('base64');

            const prompt = this._buildPrompt('');

            const imageParts = [
                {
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType
                    }
                }
            ];

            const result = await this.model.generateContent([prompt, ...imageParts]);
            const response = result.response;
            const text = response.text();

            console.log('Received response from Gemini');

            // Parse JSON từ response
            const jsonData = this._extractJSON(text);

            return {
                success: true,
                data: jsonData,
                rawResponse: text,
                method: 'direct_pdf'
            };

        } catch (error) {
            console.error('Error calling Gemini API with PDF:', error.message);
            throw new Error(`Gemini PDF parsing failed: ${error.message}`);
        }
    }

    /**
     * Tự động chọn phương pháp tốt nhất
     * @param {Buffer} pdfBuffer - Buffer của PDF
     * @param {string} extractedText - Text đã extract từ Document AI (optional)
     * @returns {Promise<object>} - Kết quả parse
     */
    async parseContract(pdfBuffer, extractedText = null) {
        // Nếu có text từ Document AI rồi → dùng text
        if (extractedText && extractedText.length > 100) {
            console.log('Using extracted text from Document AI');
            return await this.parseContractText(extractedText);
        }

        // Nếu không có text → đọc PDF trực tiếp
        console.log('Using direct PDF parsing');
        return await this.parsePDFDirect(pdfBuffer);
    }

    /**
     * [Private] Tạo prompt cho Gemini
     * @param {string} contractText - Text của hợp đồng
     * @returns {string} - Prompt đầy đủ
     */
    _buildPrompt(contractText) {
        const prompt = `
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
- Với số tiền (rent_amount, deposit_amount): chỉ lấy số, không kèm đơn vị, dấu phẩy, dấu chấm (ví dụ: 5000000 thay vì "5.000.000 VND")
- Với ngày tháng: định dạng YYYY-MM-DD (ví dụ: "2024-01-01")
- Với room_number: chỉ lấy số/mã phòng, không thêm từ "Phòng" hay "Room"
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
  "deposit_amount": 10000000,
}

Bây giờ hãy phân tích và trả về JSON:`;

        return prompt;
    }

    /**
     * [Private] Extract JSON từ response của Gemini
     * @param {string} responseText - Response text từ Gemini
     * @returns {object} - Parsed JSON object
     */
    _extractJSON(responseText) {
        try {
            // Loại bỏ markdown code block nếu có
            let jsonText = responseText.trim();

            // Xóa ```json và ``` nếu có
            jsonText = jsonText.replace(/```json\s*/g, '');
            jsonText = jsonText.replace(/```\s*/g, '');

            // Tìm JSON object trong text
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonText = jsonMatch[0];
            }

            // Parse JSON
            const parsed = JSON.parse(jsonText);
            console.log('Successfully parsed JSON from Gemini response');

            return parsed;

        } catch (error) {
            console.error('Failed to parse JSON from response:', error.message);
            console.error('Response text:', responseText);

            // Trả về object rỗng nếu parse lỗi
            return {
                error: 'Failed to parse JSON',
                rawResponse: responseText
            };
        }
    }
}

// Export singleton instance
module.exports = new GeminiService();