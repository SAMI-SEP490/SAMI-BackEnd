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
    /**
     * Xử lý file PDF và lấy toàn bộ text từ trang đầu tiên
     * CHÚ Ý: Document AI sẽ xử lý toàn bộ PDF nhưng code chỉ trích xuất text trang đầu
     * @param {Buffer} fileBuffer - Nội dung file PDF
     * @param {string} mimeType - Loại file (mặc định: 'application/pdf')
     * @returns {Promise<object>} - Kết quả chứa text trang đầu tiên
     */
    async processContract(fileBuffer, mimeType = 'application/pdf') {
        const { projectId } = config.googleCloud;
        const { location, processorId } = config.documentai;

        if (!projectId || !location || !processorId) {
            throw new Error('Missing Document AI configuration (Project ID, Location, Processor ID)');
        }

        // Tạo processor resource name
        const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

        // Mã hóa file sang base64
        const encodedContent = fileBuffer.toString('base64');

        const request = {
            name: name,
            rawDocument: {
                content: encodedContent,
                mimeType: mimeType,
            }
            // CUSTOM_EXTRACTION_PROCESSOR sẽ xử lý toàn bộ PDF
            // Nhưng code sẽ chỉ lấy text từ trang đầu tiên
        };

        try {
            console.log(`Sending document to Document AI processor: ${name}`);
            const [result] = await documentAIClient.processDocument(request);
            console.log('Successfully received response from Document AI.');
            console.log('⚠️ Note: Extracting only first page text from result.');

            if (!result.document) {
                return {
                    success: false,
                    message: 'No document data returned from AI.'
                };
            }

            // Lấy text từ trang đầu tiên
            const firstPageText = this._extractFirstPageText(result.document);

            return {
                success: true,
                firstPageText: firstPageText,
                totalPages: result.document.pages ? result.document.pages.length : 0,
                fullText: result.document.text || '',
                extractedFromFirstPageOnly: true // Chỉ extract trang đầu
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