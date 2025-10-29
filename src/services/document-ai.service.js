// src/services/document-ai.service.js
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const config = require('../config'); // Lấy config từ file index.js

/**
 * Khởi tạo client Document AI.
 * Client nên được khởi tạo một lần và tái sử dụng.
 */
const clientOptions = {
    apiEndpoint: config.documentai.apiEndpoint,
    keyFilename: config.googleCloud.keyFilename
};
const documentAIClient = new DocumentProcessorServiceClient(clientOptions);
console.log(`Document AI Client initialized for endpoint: ${config.documentai.apiEndpoint}`);

class DocumentAIService {
    /**
     * Gửi file PDF đến Google Cloud Document AI để xử lý.
     * @param {Buffer} fileBuffer - Nội dung file dưới dạng Buffer.
     * @param {string} mimeType - Kiểu MIME của file (vd: 'application/pdf').
     * @returns {Promise<object>} - Một object chứa dữ liệu trích xuất hoặc lỗi.
     */
    async processContract(fileBuffer, mimeType = 'application/pdf') {
        const projectId = config.googleCloud.projectId;
        const location = config.documentai.location;
        const processorId = config.documentai.processorId;

        if (!projectId || !location || !processorId) {
            console.error('Missing Google Cloud or Document AI configuration (Project ID, Location, Processor ID)');
            throw new Error('Document AI service is not configured properly.');
        }

        // Tạo tên đầy đủ của processor resource
        const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

        // Mã hóa nội dung file sang base64
        const encodedContent = fileBuffer.toString('base64');

        const request = {
            name: name,
            rawDocument: {
                content: encodedContent,
                mimeType: mimeType,
            },
            // Bạn có thể thêm các tùy chọn xử lý nếu cần thiết
            // processOptions: {
            //   // Ví dụ: chỉ định trang cần xử lý
            //   // fromStart: 1,
            //   // toEnd: 5
            // }
        };

        try {
            console.log(`Sending document to Document AI processor: ${name}`);
            const [result] = await documentAIClient.processDocument(request);
            console.log('Successfully received response from Document AI.');

            if (!result.document) {
                console.warn('Document AI response did not contain a document object.');
                return { success: false, message: 'No document data returned from AI.', extractedData: {} };
            }

            // Gọi hàm helper để trích xuất và ánh xạ các trường cần thiết
            const extractedData = this._extractAndMapFields(result.document);

            return {
                success: true,
                // documentRaw: result.document, // Có thể trả về toàn bộ nếu frontend cần
                extractedData: extractedData
            };
        } catch (error) {
            console.error('Error calling Document AI API:', error.message);
            // Log thêm chi tiết lỗi nếu có thể
            if (error.details) console.error('Error details:', error.details);
            throw new Error(`Document AI processing failed: ${error.message}`);
        }
    }

    /**
     * [Helper - Private] Trích xuất các trường quan trọng từ Document AI response
     * và ánh xạ chúng sang cấu trúc dữ liệu mong muốn của ứng dụng.
     * @param {object} document - Đối tượng document trả về từ API.
     * @returns {object} - Object chứa các trường đã được ánh xạ.
     */
    _extractAndMapFields(document) {
        const fields = {};
        if (!document || !document.entities || !Array.isArray(document.entities)) {
            console.warn('No entities found in the Document AI response.');
            return fields;
        }

        // Lặp qua các thực thể (entities) được Document AI nhận dạng
        for (const entity of document.entities) {
            const type = entity.type; // Loại thực thể (vd: 'effective_date', 'party_name')
            const value = entity.mentionText.trim(); // Text được trích xuất
            const confidence = entity.confidence; // Độ tin cậy (0 đến 1)

            // Bỏ qua nếu không có type hoặc value
            if (!type || !value) continue;

            console.log(`Found entity: Type='${type}', Value='${value}', Confidence=${confidence}`);

            // === Logic Ánh xạ và Xử lý ===
            // (Đây là phần quan trọng cần tùy chỉnh dựa trên Processor và nhu cầu)
            switch (type) {
                case 'effective_date':
                case 'contract_date': // Thêm các alias có thể có
                    // Cố gắng chuẩn hóa ngày tháng (có thể cần thư viện như date-fns hoặc moment)
                    // Ví dụ đơn giản: Chỉ lấy nếu chưa có hoặc confidence cao hơn
                    if (!fields.startDate || (entity.confidence > (fields.startDateConfidence || 0))) {
                        fields.startDate = value; // Nên chuẩn hóa thành YYYY-MM-DD
                        fields.startDateConfidence = entity.confidence;
                    }
                    break;
                case 'expiration_date':
                case 'end_date':
                    if (!fields.endDate || (entity.confidence > (fields.endDateConfidence || 0))) {
                        fields.endDate = value; // Nên chuẩn hóa thành YYYY-MM-DD
                        fields.endDateConfidence = entity.confidence;
                    }
                    break;
                case 'rent_amount':
                case 'lease_amount':
                    if (!fields.rentAmount || (entity.confidence > (fields.rentAmountConfidence || 0))) {
                        // Cố gắng parse số tiền, loại bỏ ký tự tiền tệ, dấu phẩy
                        const numericValue = parseFloat(value.replace(/[^0-9.-]+/g, ""));
                        if (!isNaN(numericValue)) {
                            fields.rentAmount = numericValue;
                            fields.rentAmountConfidence = entity.confidence;
                        }
                    }
                    break;
                case 'deposit_amount':
                    if (!fields.depositAmount || (entity.confidence > (fields.depositAmountConfidence || 0))) {
                        const numericValue = parseFloat(value.replace(/[^0-9.-]+/g, ""));
                        if (!isNaN(numericValue)) {
                            fields.depositAmount = numericValue;
                            fields.depositAmountConfidence = entity.confidence;
                        }
                    }
                    break;
                case 'party_name': // Document AI có thể trả về nhiều 'party_name'
                    // Cần logic để xác định đâu là tenant, đâu là landlord (khó)
                    // Ví dụ đơn giản: Lưu tất cả vào một mảng
                    if (!fields.parties) fields.parties = [];
                    fields.parties.push({ name: value, confidence: entity.confidence });
                    // Tạm thời lấy tên đầu tiên làm tenant (CẦN CẢI THIỆN)
                    if (!fields.tenantName && value) {
                        fields.tenantName = value;
                        fields.tenantNameConfidence = entity.confidence;
                    }
                    break;
                case 'address': // Có thể có nhiều địa chỉ
                    if (!fields.address || (entity.confidence > (fields.addressConfidence || 0))) {
                        fields.address = value;
                        fields.addressConfidence = entity.confidence;
                    }
                    break;
                // Thêm các case khác cho các trường bạn cần: 'term_length', 'renewal_option', v.v.
                default:
                    // Lưu các trường không xác định khác nếu cần
                    // if (!fields.other) fields.other = {};
                    // fields.other[type] = value;
                    break;
            }
        }

        // Xóa các trường confidence nếu không cần trả về client
        delete fields.startDateConfidence;
        delete fields.endDateConfidence;
        delete fields.rentAmountConfidence;
        delete fields.depositAmountConfidence;
        delete fields.tenantNameConfidence;
        delete fields.addressConfidence;

        console.log('Mapped Fields:', fields);
        return fields;
    }
}

// Xuất một instance duy nhất của service
module.exports = new DocumentAIService();