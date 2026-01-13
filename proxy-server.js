/**
 * AI检测代理服务器
 * 用于解决浏览器跨域限制
 * 
 * 使用方法：
 * 1. 安装依赖：npm install express cors node-fetch
 * 2. 运行服务：node proxy-server.js
 * 3. 在网页中使用本地代理
 */

const express = require('express');
const cors = require('cors');
const https = require('https');

// 禁用SSL证书验证（解决公司网络代理问题）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const PORT = 3456;

// 自定义HTTPS Agent，跳过证书验证
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// 启用CORS
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 通义千问VL代理
app.post('/api/tongyi', async (req, res) => {
    try {
        const { apiKey, imageUrl, prompt } = req.body;
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', {
            method: 'POST',
            agent: httpsAgent,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen-vl-plus',
                input: {
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { image: imageUrl },
                                { text: prompt }
                            ]
                        }
                    ]
                }
            })
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('通义千问API错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// OpenAI代理
app.post('/api/openai', async (req, res) => {
    try {
        const { apiKey, imageUrl, prompt } = req.body;
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            agent: httpsAgent,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageUrl } }
                        ]
                    }
                ],
                max_tokens: 200
            })
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('OpenAI API错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// Gemini代理
app.post('/api/gemini', async (req, res) => {
    try {
        const { apiKey, imageBase64, prompt } = req.body;
        
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            agent: httpsAgent,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: imageBase64
                                }
                            }
                        ]
                    }
                ]
            })
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Gemini API错误:', error);
        res.status(500).json({ error: error.message });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'AI代理服务运行中' });
});

app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🤖 AI检测代理服务器已启动                                  ║
║                                                            ║
║   地址: http://localhost:${PORT}                             ║
║                                                            ║
║   现在可以在网页中使用AI检测功能了！                          ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
    `);
});
