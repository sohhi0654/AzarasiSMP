const express = require('express');
const util = require('minecraft-server-util');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

// RenderのWeb ServiceはPORT環境変数で指定されたHTTPポートを使用します。
const PORT = Number(process.env.PORT) || 10000;
const MC_HOST = process.env.MC_HOST || 'mc.azarasi.f5.si';
const MC_PORT = Number(process.env.MC_PORT) || 25664;
const MC_TIMEOUT_MS = Number(process.env.MC_TIMEOUT_MS) || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'azarasi1234';

const PORT_TARGETS = [
    { key: 'smp_voice', label: 'SMP Simple Voice Chat', port: 24640, protocol: 'udp', check: 'udp-probe' },
    { key: 'lobby_voice', label: 'ロビー Simple Voice Chat', port: 1100, protocol: 'udp', check: 'udp-probe' },
    { key: 'bedrock', label: 'Bedrock', port: 19520, protocol: 'udp', check: 'bedrock' }
];

// 静的ファイルの提供
app.use(express.static(__dirname));

// ------------------------------------
// Discord Botのセットアップ
// ------------------------------------
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CONTACT_CHANNEL_ID = process.env.CONTACT_CHANNEL_ID || '1334457867012669440';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log(`✅ Discord Bot ログイン完了: ${client.user.tag}`);
});

if (DISCORD_TOKEN) {
    client.login(DISCORD_TOKEN).catch(err => {
        console.error('❌ Discord Botのログインに失敗しました:', err);
    });
} else {
    console.warn('⚠️ DISCORD_TOKENが環境変数に設定されていません。');
}

// ------------------------------------
// データベース(JSONファイル)の準備
// ------------------------------------
const blogsFile = path.join(__dirname, 'blogs.json');
if (!fs.existsSync(blogsFile)) {
    fs.writeFileSync(blogsFile, '[]');
}

const contactsFile = path.join(__dirname, 'contacts.json');
if (!fs.existsSync(contactsFile)) {
    fs.writeFileSync(contactsFile, '[]');
}

// ------------------------------------
// APIエンドポイント
// ------------------------------------

// Renderのヘルスチェック用。Minecraftサーバーの停止ではWebサイトを落としません。
app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true, service: 'azarasi-web' });
});

// Minecraft Java EditionのTCPステータスを定期取得し、稼働時間を集計します。
const monitor = {
    startedAt: Date.now(),
    currentOnline: null,
    currentStateSince: null,
    onlineMs: 0,
    offlineMs: 0,
    history: [],
    latest: null
};
let pollingPromise = null;

function recordJavaState(online, now) {
    if (monitor.currentOnline === null) {
        monitor.currentOnline = online;
        monitor.currentStateSince = now;
    } else if (monitor.currentOnline !== online) {
        const elapsed = Math.max(0, now - monitor.currentStateSince);
        if (monitor.currentOnline) monitor.onlineMs += elapsed;
        else monitor.offlineMs += elapsed;
        monitor.currentOnline = online;
        monitor.currentStateSince = now;
    }

    monitor.history.push({ at: new Date(now).toISOString(), online });
    if (monitor.history.length > 120) monitor.history.shift();
}

function getMonitorMetrics(now = Date.now()) {
    const currentDuration = monitor.currentStateSince === null ? 0 : Math.max(0, now - monitor.currentStateSince);
    const onlineMs = monitor.onlineMs + (monitor.currentOnline === true ? currentDuration : 0);
    const offlineMs = monitor.offlineMs + (monitor.currentOnline === false ? currentDuration : 0);
    const totalMs = onlineMs + offlineMs;

    return {
        current: monitor.currentOnline === true ? 'online' : monitor.currentOnline === false ? 'offline' : 'unknown',
        currentStateSince: monitor.currentStateSince ? new Date(monitor.currentStateSince).toISOString() : null,
        currentDurationMs: currentDuration,
        onlineMs,
        offlineMs,
        uptimePercent: totalMs ? Number((onlineMs / totalMs * 100).toFixed(2)) : 0,
        history: monitor.history
    };
}

async function pollJavaStatus() {
    if (pollingPromise) return pollingPromise;
    pollingPromise = (async () => {
        const checkedAt = new Date().toISOString();
        const startedAt = Date.now();
        try {
            const result = await util.status(MC_HOST, MC_PORT, { timeout: MC_TIMEOUT_MS });
            const sample = Array.isArray(result.players?.sample) ? result.players.sample : [];
            const now = Date.now();
            recordJavaState(true, now);
            monitor.latest = {
                online: true,
                host: MC_HOST,
                port: MC_PORT,
                protocol: 'tcp',
                latencyMs: now - startedAt,
                checkedAt,
                players: Number(result.players?.online) || 0,
                max: Number(result.players?.max) || 0,
                list: sample.map(player => typeof player === 'string' ? player : player.name).filter(Boolean),
                monitor: getMonitorMetrics(now)
            };
        } catch (error) {
            const now = Date.now();
            console.warn(`Minecraftステータス取得失敗 (${MC_HOST}:${MC_PORT}): ${error.message}`);
            recordJavaState(false, now);
            monitor.latest = {
                online: false,
                host: MC_HOST,
                port: MC_PORT,
                protocol: 'tcp',
                latencyMs: now - startedAt,
                checkedAt,
                players: 0,
                max: 0,
                list: [],
                monitor: getMonitorMetrics(now)
            };
        }
    })().finally(() => {
        pollingPromise = null;
    });
    return pollingPromise;
}

app.get('/api/status', async (req, res) => {
    await pollJavaStatus();
    res.json({ ...monitor.latest, monitor: getMonitorMetrics() });
});

// Render上でサイトが動作している間も、15秒ごとにオンライン状態を記録します。
setInterval(() => { pollJavaStatus().catch(() => {}); }, 15000);
pollJavaStatus().catch(() => {});

function udpProbe(host, port, timeout) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const socket = dgram.createSocket('udp4');
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            socket.close();
            resolve({ ...result, latencyMs: Date.now() - startedAt });
        };
        socket.once('error', error => finish({ online: false, reason: error.code || 'udp_error' }));
        socket.connect(port, host, () => {
            // Simple Voice Chatは未知のUDPパケットへ応答しないことがあるため、
            // Renderから送信できたことを「送信OK」として返します。
            socket.send(Buffer.from([0]), error => {
                if (error) finish({ online: false, reason: error.code || 'send_error' });
                else finish({ online: true, state: 'probe_sent', confidence: 'udp_send' });
            });
        });
        setTimeout(() => finish({ online: false, state: 'no_response', reason: 'timeout' }), timeout);
    });
}

async function checkPortTarget(target) {
    const base = {
        key: target.key,
        label: target.label,
        host: MC_HOST,
        port: target.port,
        protocol: target.protocol,
        checkedAt: new Date().toISOString()
    };

    try {
        let result;
        if (target.check === 'bedrock') {
            const startedAt = Date.now();
            const bedrock = await util.statusBedrock(MC_HOST, target.port, { timeout: MC_TIMEOUT_MS });
            result = {
                online: true,
                latencyMs: Date.now() - startedAt,
                players: Number(bedrock.players?.online) || 0,
                max: Number(bedrock.players?.max) || 0,
                version: bedrock.version?.name || ''
            };
        } else {
            result = await udpProbe(MC_HOST, target.port, MC_TIMEOUT_MS);
        }
        return { ...base, ...result };
    } catch (error) {
        return { ...base, online: false, reason: error.code || error.message || 'check_failed' };
    }
}

// Renderからmc.azarasi.f5.siの3ポートを個別に確認します。
app.get('/api/ports', async (req, res) => {
    const results = await Promise.all(PORT_TARGETS.map(checkPortTarget));
    res.json({ host: MC_HOST, ports: results, checkedAt: new Date().toISOString() });
});

// ブログ取得
app.get('/api/blogs', (req, res) => {
    try {
        const blogs = JSON.parse(fs.readFileSync(blogsFile, 'utf8'));
        res.json(blogs);
    } catch (e) {
        res.status(500).json([]);
    }
});

// ブログ投稿 (要パスワード)
app.post('/api/blogs', (req, res) => {
    const { password, title, excerpt, content, author } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'パスワードが違います' });
    }

    try {
        const blogs = JSON.parse(fs.readFileSync(blogsFile, 'utf8'));
        const newBlog = {
            id: Date.now(),
            title,
            excerpt,
            content,
            author,
            date: new Date().toISOString()
        };
        blogs.unshift(newBlog);
        fs.writeFileSync(blogsFile, JSON.stringify(blogs, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: '保存に失敗しました' });
    }
});

// 新しいお問い合わせを受け取る (ユーザーから送信)
app.post('/api/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    try {
        const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
        const newContactId = Date.now().toString();
        const newContact = {
            id: newContactId,
            name: name || '名無し',
            email: email || '',
            subject: subject || '無題',
            message: message || '',
            date: new Date().toISOString(),
            status: 'pending',
            reply: ''
        };

        contacts.unshift(newContact);
        fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));

        // Discordへ通知
        if (client.isReady()) {
            const channel = await client.channels.fetch(CONTACT_CHANNEL_ID);
            if (channel) {
                await channel.send(
                    `🔔 **サイトから新しいお問い合わせが届きました**\n` +
                    `**【確認用ID】** ${newContactId}\n` +
                    `**【送信者】** ${newContact.name}\n` +
                    `**【件名】** ${newContact.subject}\n` +
                    `**【メッセージ】**\n${newContact.message}`
                );
            }
        }

        res.json({ success: true, id: newContactId });
    } catch (e) {
        console.error('お問い合わせの処理中にエラー:', e);
        res.status(500).json({ success: false });
    }
});

// ユーザーが自分の問い合わせ＆返信を確認するAPI
app.get('/api/contact/check/:id', (req, res) => {
    const contactId = req.params.id;
    try {
        const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
        const target = contacts.find(c => c.id === contactId);

        if (!target) {
            return res.json({ success: false });
        }

        res.json({
            success: true,
            contact: {
                subject: target.subject,
                message: target.message,
                status: target.status,
                reply: target.reply,
                date: target.date
            }
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// お問い合わせ一覧を取得 (管理者用・要パスワード)
app.post('/api/admin/contacts', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'パスワードが違います' });
    }

    try {
        const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
        res.json({ success: true, contacts });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// お問い合わせへの返信 (管理者用・要パスワード)
app.post('/api/admin/reply', async (req, res) => {
    const { password, id, replyMessage } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'パスワードが違います' });
    }

    try {
        const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
        const contactIndex = contacts.findIndex(c => c.id === id);

        if (contactIndex === -1) {
            return res.status(404).json({ success: false, message: '質問が見つかりません' });
        }

        contacts[contactIndex].status = 'replied';
        contacts[contactIndex].reply = replyMessage;
        fs.writeFileSync(contactsFile, JSON.stringify(contacts, null, 2));

        // Discordへ返信
        if (client.isReady()) {
            const channel = await client.channels.fetch(CONTACT_CHANNEL_ID);
            if (channel) {
                await channel.send(
                    `✅ **管理者からのお問い合わせ返信**\n` +
                    `**【宛先】** ${contacts[contactIndex].name} さん (${contacts[contactIndex].subject})\n` +
                    `**【返信内容】**\n${replyMessage}`
                );
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('返信の処理中にエラー:', e);
        res.status(500).json({ success: false });
    }
});

// Renderからの到達性を確保するため、全インターフェースで待ち受けます。
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HTTP server is running on 0.0.0.0:${PORT}`);
    console.log(`🎮 Minecraft status target: ${MC_HOST}:${MC_PORT} (TCP)`);
});
