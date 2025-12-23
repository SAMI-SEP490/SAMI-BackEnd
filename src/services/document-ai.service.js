// src/services/document-ai.service.js
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const config = require('../config');

// Khởi tạo client
const clientOptions = {
    apiEndpoint: config.documentai.apiEndpoint,
    keyFilename: config.googleCloud.keyFilename
};
const documentAIClient = new DocumentProcessorServiceClient(clientOptions);
console.log(`Document AI Client initialized for endpoint: ${config.documentai.apiEndpoint}`);

class DocumentAIService {
    async processContract(fileBuffer, mimeType = 'application/pdf') {
        const { projectId } = config.googleCloud;
        const { location, processorId } = config.documentai;

        if (!projectId || !location || !processorId) {
            throw new Error('Missing Document AI configuration');
        }

        const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

        // --- BẮT ĐẦU ĐOẠN CODE TỐI ƯU ---
        let contentToSend;

        try {
            // Chỉ cắt trang nếu là PDF
            if (mimeType === 'application/pdf') {
                console.log('Optimizing PDF: Extracting first page only...');

                // 1. Load PDF từ buffer gốc
                const pdfDoc = await PDFDocument.load(fileBuffer);

                // 2. Tạo một PDF mới
                const newPdf = await PDFDocument.create();

                // 3. Copy trang đầu tiên (index 0) từ file gốc
                const [firstPage] = await newPdf.copyPages(pdfDoc, [0]);
                newPdf.addPage(firstPage);

                // 4. Xuất ra base64 trực tiếp để gửi đi
                contentToSend = await newPdf.saveAsBase64();
                console.log('PDF optimized: Sending 1 page instead of ' + pdfDoc.getPageCount());
            } else {
                // Nếu là ảnh (JPEG/PNG) thì gửi nguyên
                contentToSend = fileBuffer.toString('base64');
            }
        } catch (error) {
            console.warn('PDF optimization failed, falling back to original file:', error.message);
            contentToSend = fileBuffer.toString('base64');
        }
        // --- KẾT THÚC ĐOẠN CODE TỐI ƯU ---

        const request = {
            name: name,
            rawDocument: {
                content: contentToSend, // Dùng content đã tối ưu
                mimeType: mimeType,
            },
            // Mẹo nhỏ: Tắt human review nếu có để phản hồi nhanh hơn (nếu processor có bật)
            skipHumanReview: true
        };

        try {
            console.log(`Sending document to Document AI processor: ${name}`);

            // Đo thời gian xử lý
            const startTime = Date.now();
            const [result] = await documentAIClient.processDocument(request);
            const endTime = Date.now();
            console.log(`Document AI processed in ${(endTime - startTime) / 1000}s`);

            if (!result.document) {
                return { success: false, message: 'No document data returned from AI.' };
            }

            // Logic lấy text giữ nguyên, nhưng giờ document chỉ có 1 trang nên nó sẽ chạy rất nhanh
            const firstPageText = result.document.text || '';

            return {
                success: true,
                firstPageText: firstPageText, // Text này giờ chính là toàn bộ text của file đã cắt
                totalPages: 1, // Vì mình đã cắt còn 1
                fullText: firstPageText,
                extractedFromFirstPageOnly: true
            };
        } catch (error) {
            console.error('Error calling Document AI API:', error.message);
            throw new Error(`Document AI processing failed: ${error.message}`);
        }
    }

    /**
     * Trích xuất text từ trang đầu tiên
     * @param {object} document - Document object từ Document AI
     * @returns {string} - Text của trang đầu tiên
     */
    _extractFirstPageText(document) {
        if (!document.pages || document.pages.length === 0) {
            console.warn('No pages found in document');
            return '';
        }

        const firstPage = document.pages[0];
        let pageText = '';

        // Lấy text từ các paragraph/token trong trang đầu
        if (firstPage.paragraphs && firstPage.paragraphs.length > 0) {
            firstPage.paragraphs.forEach(paragraph => {
                const layout = paragraph.layout;
                if (layout && layout.textAnchor && layout.textAnchor.textSegments) {
                    layout.textAnchor.textSegments.forEach(segment => {
                        const startIndex = parseInt(segment.startIndex) || 0;
                        const endIndex = parseInt(segment.endIndex) || 0;
                        pageText += document.text.substring(startIndex, endIndex) + '\n';
                    });
                }
            });
        } else if (firstPage.tokens && firstPage.tokens.length > 0) {
            // Nếu không có paragraph, lấy từ tokens
            firstPage.tokens.forEach(token => {
                const layout = token.layout;
                if (layout && layout.textAnchor && layout.textAnchor.textSegments) {
                    layout.textAnchor.textSegments.forEach(segment => {
                        const startIndex = parseInt(segment.startIndex) || 0;
                        const endIndex = parseInt(segment.endIndex) || 0;
                        pageText += document.text.substring(startIndex, endIndex) + ' ';
                    });
                }
            });
        } else {
            // Fallback: lấy text dựa trên page break
            console.log('Using fallback method to extract first page text');
            const fullText = document.text || '';
            // Giả sử mỗi trang cách nhau bởi form feed hoặc lấy ~3000 ký tự đầu
            const pageBreakIndex = fullText.indexOf('\f');
            if (pageBreakIndex > -1) {
                pageText = fullText.substring(0, pageBreakIndex);
            } else {
                // Lấy khoảng 3000 ký tự đầu tiên như xấp xỉ trang 1
                pageText = fullText.substring(0, 3000);
            }
        }

        console.log(`Extracted first page text (${pageText.length} characters)`);
        return pageText.trim();
    }
}

module.exports = new DocumentAIService();