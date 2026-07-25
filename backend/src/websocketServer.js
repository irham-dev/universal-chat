const WebSocket = require('ws');
const { GoogleGenAI } = require('@google/genai');

const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const initWebSocketServer = (db) => {
    const wss = new WebSocket.Server({ port: 3001 });
    console.log('WebSocket ready di port --> 3001');

    const rawApiKey = process.env.GEMINI_API_KEY || '';
    const cleanApiKey = rawApiKey.trim();
    
    const ai = new GoogleGenAI({ apiKey: cleanApiKey });

    wss.on('connection', (ws) => {
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                let sessionId = data.sessionId;
                const username = data.username;
                
                let selectedModel = ALLOWED_MODELS.includes(data.model) ? data.model : 'gemini-2.5-flash';

                if (!sessionId) {
                    sessionId = `session_${Date.now()}_${Math.floor(Math.random() * 900) + 100}`;
                    const judul = data.text.split(' ').slice(0, 5).join(' ');
                    
                    await new Promise((resolve, reject) => {
                        db.run("INSERT INTO chat_sessions (id_session, judul, username) VALUES (?, ?, ?)", [sessionId, judul, username], (err) => {
                            if (err) reject(err); else resolve();
                        });
                    });
                    
                    ws.send(JSON.stringify({ type: 'session_created', sessionId: sessionId, judul: judul }));
                }

                await new Promise((resolve, reject) => {
                    db.run("INSERT INTO chat_messages (id_session, peran, konten) VALUES (?, ?, ?)", [sessionId, "user", data.text], (err) => {
                        if (err) reject(err); else resolve();
                    });
                });

                ws.send(JSON.stringify({ type: 'start' }));

                const historyRows = await new Promise((resolve, reject) => {
                    db.all("SELECT peran, konten FROM chat_messages WHERE id_session = ? ORDER BY id_chat ASC", [sessionId], (err, rows) => {
                        if (err) reject(err); else resolve(rows || []);
                    });
                });

                const contents = historyRows.map(row => ({
                    role: row.peran === 'user' ? 'user' : 'model',
                    parts: [{ text: row.konten }]
                }));

                const responseStream = await ai.models.generateContentStream({
                    model: selectedModel,
                    contents: contents
                });

                let fullAiResponse = "";

                for await (const chunk of responseStream) {
                    const chunkText = chunk.text;
                    if (chunkText) {
                        fullAiResponse += chunkText;
                        ws.send(JSON.stringify({ type: 'stream', text: chunkText }));
                    }
                }

                db.run("INSERT INTO chat_messages (id_session, peran, konten) VALUES (?, ?, ?)", [sessionId, "assistant", fullAiResponse]);

                ws.send(JSON.stringify({ type: 'end' }));
            } catch (error) {
                console.error("Error dari Google:", error.message);
                ws.send(JSON.stringify({ type: 'error', text: `⚠️ Error: ${error.message}` }));
            }
        });
    });
};

module.exports = initWebSocketServer;