// src/services/gemini.service.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const {CONTRACT_PARSING_PROMPT} = require("../config/prompt");

/**
 * Service để xử lý PDF và parse thành JSON bằng Gemini API
 */
class GeminiService {
    constructor() {
        // Khởi tạo Gemini client
        this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
        this.model = this.genAI.getGenerativeModel({
            model: config.gemini.modelName || 'gemini-2.5-flash'
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

            const prompt = CONTRACT_PARSING_PROMPT(contractText);

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