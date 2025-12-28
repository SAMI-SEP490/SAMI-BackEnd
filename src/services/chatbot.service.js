// Updated: 2025-23-11
// by: MinhBH

const axios = require('axios');
const config = require('../config'); // Import Config

class ChatbotService {

    /**
     * Streams the user's prompt to Dify and returns the raw stream.
     */
    async getChatStream(userQuestion, tenantUserId, conversationId = null) {
        // --- CHECK ENV via Config ---
        if (!config.dify.apiKey || !config.dify.apiUrl) {
             console.warn("⚠️ Dify API keys missing in config.");
             throw new Error("AI Chatbot service is currently unavailable.");
        }

        // 1. Construct Payload dynamically
        const payload = {
            query: userQuestion,
            inputs: {
                // Convert to String to be safe, Dify variables are strings
                tenant_user_id: String(tenantUserId) 
            },
            user: `user-${tenantUserId}`,
            response_mode: "streaming",
        };

        // 2. Only attach conversation_id if it is NOT null/undefined
        // Sending "conversation_id": null causes Dify 400 Error
        if (conversationId) {
            payload.conversation_id = conversationId;
        }

        try {
            // Use config.dify.apiUrl and config.dify.apiKey
            const response = await axios.post(config.dify.apiUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${config.dify.apiKey}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream' 
            });
            
            // Return the raw stream object
            return response.data;

        } catch (error) {
            // --- IMPROVED ERROR LOGGING ---
            if (error.response) {
                // The server responded with a status code out of 2xx range
                // We need to read the stream to see the error message
                // Since responseType is 'stream', data is a stream, not JSON
                console.error("Dify API Error Status:", error.response.status);
                
                // Try to read the error stream chunks to see the message
                try {
                    for await (const chunk of error.response.data) {
                        console.error("Dify Error Body:", chunk.toString());
                    }
                } catch (e) {
                    console.error("Could not read error stream");
                }
            } else {
                console.error("Dify Connection Error:", error.message);
            }
            
            throw new Error("Failed to connect to AI service.");
        }
    }

    /**
     * Get the "Opening Statement" and initial suggestions from Dify configuration.
     */
    async getChatbotParameters(tenantUserId) {
        try {
            // Clean URL from config
            const response = await axios.get(`${config.dify.apiUrl.replace('/chat-messages', '')}/parameters`, {
                headers: {
                    'Authorization': `Bearer ${config.dify.apiKey}`
                },
                params: {
                    user: `user-${tenantUserId}` 
                }
            });
            
            // Returns: { opening_statement: "Hello...", suggested_questions: [...], ... }
            return response.data; 

        } catch (error) {
            console.error("Dify Parameters Error:", error.response?.data || error.message);
            throw new Error("Failed to fetch chatbot parameters.");
        }
    }

    /**
     * Get suggested follow-up questions for a specific message.
     */
    async getSuggestedQuestions(messageId, tenantUserId) {
        try {
            const baseUrl = config.dify.apiUrl.replace('/chat-messages', '');
            const url = `${baseUrl}/messages/${messageId}/suggested`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${config.dify.apiKey}`
                },
                params: {
                    user: `user-${tenantUserId}`
                }
            });

            // Returns: { data: [ "Question 1", "Question 2" ], result: "success" }
            return response.data.data;

        } catch (error) {
            console.error("Dify Suggested Questions Error:", error.response?.data || error.message);
            // Return empty array on error to avoid breaking UI
            return [];
        }
    }
}

module.exports = new ChatbotService();
