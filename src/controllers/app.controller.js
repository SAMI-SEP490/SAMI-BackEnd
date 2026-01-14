// src/controllers/app.controller.js
const config = require('../config');

class AppController {

    /**
     * TRAMPOLINE PAGE
     * This page is loaded by the Email Client (Chrome/Safari).
     * It immediately redirects the browser to the App via Deep Link.
     */
    async openAppRedirect(req, res) {
        // You can pass a specific path via query param, e.g., ?path=bills/123
        const path = req.query.path || 'dashboard';
        const deepLink = `${config.app.deepLinkScheme}${path}`;
        
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Opening SAMI...</title>
                <style>
                    body { font-family: -apple-system, sans-serif; text-align: center; padding: 40px 20px; background: #f8f9fa; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh;}
                    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #333; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    h3 { color: #333; margin-bottom: 10px; }
                    p { color: #666; margin-bottom: 30px; font-size: 14px; }
                    .btn { background: #333; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: background 0.2s; }
                    .btn:hover { background: #555; }
                    .debug { margin-top: 50px; font-size: 12px; color: #bbb; }
                </style>
            </head>
            <body>
                <div class="loader"></div>
                <h3>Đang mở ứng dụng SAMI...</h3>
                <p>Nếu ứng dụng không tự động mở, vui lòng nhấn nút bên dưới.</p>
                
                <a href="${deepLink}" class="btn">Mở Ứng Dụng</a>

                <div class="debug">Target: ${deepLink}</div>

                <script>
                    // 1. Attempt Auto-Redirect immediately
                    window.location.replace("${deepLink}");

                    // 2. Fallback logic could go here (e.g. detect if app didn't open)
                    // But for now, we rely on the button.
                </script>
            </body>
            </html>
        `;
        
        res.send(html);
    }
}

module.exports = new AppController();
