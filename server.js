const express = require('express');
const util = require('minecraft-server-util');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// マイクラサーバーの設定
const MC_SERVER_IP = 'mc.azarasi.f5.si';
const MC_SERVER_PORT = 25664;

// 管理者用のブログ投稿パスワード
const ADMIN_PASSWORD = 'azarasi1234';

app.use(express.json());
app.use(express.static('public'));

// --- マイクラサーバーリアルタイム情報取得 API ---
app.get('/api/status', async (req, res) => {
    try {
        // Java Edition用のstatus取得（タイムアウトを4秒に設定）
        const status = await util.status(MC_SERVER_IP, MC_SERVER_PORT, {
            timeout: 4000,
            enableSRV: true
        });
        res.json({
            online: true,
            players: status.players.online,
            max: status.players.max,
            list: status.players.sample ? status.players.sample.map(p => p.name) : []
        });
    } catch (error) {
        console.error('MC Server Status Error:', error.message);
        res.json({ online: false, players: 0, max: 0, list: [] });
    }
});

// --- ブログデータ管理 ---
const blogsFile = path.join(__dirname, 'blogs.json');

if (!fs.existsSync(blogsFile)) {
    const defaultBlogs = [
        {
            id: 3,
            title: "ルール更新のお知らせ",
            excerpt: "コミュニティからのフィードバックを元に、ルールを更新しました。殺し合いの禁止と協力を重視する方針が強化されました。",
            content: "ルール更新のお知らせ\n\nコミュニティからのご指摘とご提案を受けて、サーバーのルールを更新しました。\n\n主な更新点：\n- PvP（殺し合い）をより明確に禁止\n- 協力プレイの重要性をルール化\n- 他のプレイヤーの建築物保護をより強化\n- コミュニティハラスメントの基準を明確化\n\n詳しくはルールページをご確認ください。質問があればDiscordでお気軽にどうぞ！",
            author: "運営チーム",
            date: "2026-08-22"
        },
        {
            id: 2,
            title: "最初の村が完成！",
            excerpt: "プレイヤーたちの協力により、最初の村が完成しました。スポーン地点から近い場所に、温かみのある集落が誕生しました。",
            content: "最初の村が完成しました！\n\n多くのプレイヤーの協力により、スポーン地点周辺に温かみのある集落が誕生しました。\n\n村には以下の施設が完備されています：\n- 共有のストレージ施設\n- レシピ確認用のテーブル\n- 醸造施設\n- スポーン地点周辺の照明\n\nこれからさらに発展していくでしょう。新しい施設の提案はDiscordで募集中です！",
            author: "建築チーム",
            date: "2026-08-20"
        },
        {
            id: 1,
            title: "サーバーがついに始まった！",
            excerpt: "長い準備期間を経て、Azarasi SMPが正式オープンしました。最初のプレイヤーが参加し、小さな集落作りが始まります。",
            content: "サーバーがついにオープンしました！\n\n長い準備期間を経て、ついにAzarasi SMPが公式にスタートしました。メンバーたちが集まり、初めてのマインクラフトセッションが始まります。\n\n現在、複数の建築プロジェクトが同時に進行中です。採掘チームは必要な資源を集めており、建築チームは公共施設の基礎を作っています。\n\nみんなで協力して、素敵な世界を作り上げましょう！",
            author: "運営チーム",
            date: "2026-08-15"
        }
    ];
    fs.writeFileSync(blogsFile, JSON.stringify(defaultBlogs, null, 2));
}

app.get('/api/blogs', (req, res) => {
    const blogs = JSON.parse(fs.readFileSync(blogsFile, 'utf8'));
    res.json(blogs);
});

app.post('/api/blogs', (req, res) => {
    const { title, excerpt, content, author, password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, message: 'パスワードが違います' });
    }

    if (!title || !excerpt || !content || !author) {
        return res.status(400).json({ success: false, message: 'すべてのフィールドを入力してください' });
    }

    const blogs = JSON.parse(fs.readFileSync(blogsFile, 'utf8'));
    const newBlog = {
        id: Date.now(),
        title,
        excerpt,
        content,
        author,
        date: new Date().toISOString().split('T')[0]
    };
    blogs.unshift(newBlog);
    fs.writeFileSync(blogsFile, JSON.stringify(blogs, null, 2));
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Azarasi SMP Web起動: http://localhost:${PORT}`);
});
