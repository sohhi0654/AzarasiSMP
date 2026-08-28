const express = require('express');
const util = require('minecraft-server-util');
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
app.use(express.json());

// 静的ファイルの提供 (index.html や bg.png があるフォルダを指定)
app.use(express.static(__dirname));

const ADMIN_PASSWORD = 'azarasi1234';

// ------------------------------------
// Discord Botのセットアップ
// ------------------------------------
// Renderの環境変数からトークンを安全に読み込みます
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CONTACT_CHANNEL_ID = '1334457867012669440';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log(`✅ Discord Bot ログイン完了: ${client.user.tag}`);
});

// トークンが設定されている場合のみログインを試みる
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

// Minecraftサーバーステータス取得
app.get('/api/status', async (req, res) => {
    try {
        const result = await util.status('mc.azarasi.f5.si', 25664, { timeout: 5000 });
        res.json({
            online: true,
            players: result.players.online,
            max: result.players.max,
            list: result.players.sample ? result.players.sample.map(p => p.name) : []
        });
    } catch (e) {
        res.json({ online: false });
    }
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
        // 先頭に追加 (新しいものが上に来るように)
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
        const newContact = {
            id: Date.now().toString(),
            name: name || '名無し',
            email: email || '',
            subject: subject || '無題',
            message: message || '',
            date: new Date().toISOString(),
            status: 'pending', // pending, replied
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
                    `**【送信者】** ${newContact.name}\n` +
                    `**【件名】** ${newContact.subject}\n` +
                    `**【メッセージ】**\n${newContact.message}`
                );
            }
        }

        res.json({ success: true });
    } catch (e) {
        console.error('お問い合わせの処理中にエラー:', e);
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

        // Discordへ返信内容を送信
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


// サーバーの起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
