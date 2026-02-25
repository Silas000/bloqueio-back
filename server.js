const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000; // Render define a porta

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Banco em memória (vai resetar se o servidor reiniciar)
const dispositivos = [];
const comandosPendentes = {};

// Rotas (mesmas de antes)
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
    res.json({ success: true });
});

app.post('/api/desbloquear/:deviceId', (req, res) => {
    const { deviceId } = req.params;
    if (!comandosPendentes[deviceId]) comandosPendentes[deviceId] = [];
    comandosPendentes[deviceId].push({ tipo: 'DESBLOQUEAR', timestamp: Date.now() });
    res.json({ success: true });
});

app.get('/api/dispositivos', (req, res) => {
    const agora = new Date();
    dispositivos.forEach(d => {
        const diff = (agora - new Date(d.ultimoContato)) / 1000;
        d.status = diff < 60 ? 'online' : 'offline';
    });
    res.json(dispositivos);
});

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});