// Updated: 2025-23-11
// by: MinhBH

const ChatbotService = require('../services/chatbot.service');

class ChatbotController {
    async chat(req, res, next) {
        try {
            const { prompt, conversation_id } = req.body;
            const tenantUserId = req.user.user_id;

            if (!prompt) {
                return res.status(400).json({ success: false, message: "Prompt is required" });
            }

            // 1. Get the stream from the service
            const dataStream = await ChatbotService.getChatStream(prompt, tenantUserId, conversation_id);

            // 2. Set Headers for Server-Sent Events (SSE)
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // 3. Pipe Dify's stream directly to the client
            // Dify already formats data as "data: {...}", which is exactly what SSE needs.
            dataStream.pipe(res);

            // 4. Handle stream end/error
            dataStream.on('end', () => {
                res.end();
            });

            dataStream.on('error', (err) => {
                console.error('Stream Error:', err);
                res.end(); // Close connection on error
            });

        } catch (err) {
            // Only hit if the initial connection failed
            next(err);
        }
    }

    /**
     * Get Opening Statement & Config
     */
    async getOpening(req, res, next) {
        try {
            const tenantUserId = req.user.user_id;
            const data = await ChatbotService.getChatbotParameters(tenantUserId);
            
            res.status(200).json({
                success: true,
                data: {
                    opening_statement: data.opening_statement,
                    suggested_questions: data.suggested_questions,
                    // You can pass other config if needed
                }
            });
        } catch (err) {
            next(err);
        }
    }

    /**
     * Get Suggested Questions for a specific message ID
     */
    async getSuggested(req, res, next) {
        try {
            const tenantUserId = req.user.user_id;
            const { messageId } = req.params;

            if (!messageId) {
                 return res.status(400).json({ success: false, message: "Message ID is required" });
            }

            const questions = await ChatbotService.getSuggestedQuestions(messageId, tenantUserId);
            
            res.status(200).json({
                success: true,
                data: questions
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ChatbotController();
