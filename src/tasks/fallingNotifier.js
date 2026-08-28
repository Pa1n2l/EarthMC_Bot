import cron from 'node-cron';
import axios from 'axios';

const TOWNS_API_URL = process.env.TOWNS_API_URL || 'https://api.earthmc.net/v4/towns';
const PLAYERS_API_URL = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export function startFallingNotifierTask(client, pool) {
    // 10分ごとに通知チェック
    cron.schedule('*/10 * * * *', async () => {
        if (!pool) return;

        try {
            // 1. 全町のリストを取得
            const listResponse = await axios.get(TOWNS_API_URL, { timeout: 10000 });
            const allTowns = listResponse.data;
            if (!Array.isArray(allTowns) || allTowns.length === 0) return;

            // 2. DBからアラート設定一覧を取得
            const [townAlerts] = await pool.execute('SELECT * FROM town_fall_alerts');
            if (townAlerts.length === 0) return;

            // アラート対象になっている町名のみ抽出して 50件ずつPOST取得
            const targetTownNames = townAlerts.map(a => a.town_name);
            const townChunks = chunkArray(targetTownNames, 50);

            const townDetailReqs = townChunks.map(chunk =>
                axios.post(TOWNS_API_URL, { query: chunk }, { timeout: 10000 }).catch(() => ({ data: [] }))
            );
            const townDetailRes = await Promise.all(townDetailReqs);
            const detailedTowns = townDetailRes.flatMap(res => res.data || []);
            const townMap = new Map(detailedTowns.map(t => [t.name.toLowerCase(), t]));

            // 3. 市長のリストを抽出して 50件ずつPOST取得
            const mayorNames = [...new Set(detailedTowns.map(t => t.mayor?.name).filter(Boolean))];
            const mayorChunks = chunkArray(mayorNames, 50);

            const playerDetailReqs = mayorChunks.map(chunk =>
                axios.post(PLAYERS_API_URL, { query: chunk }, { timeout: 10000 }).catch(() => ({ data: [] }))
            );
            const playerDetailRes = await Promise.all(playerDetailReqs);
            const detailedPlayers = playerDetailRes.flatMap(res => res.data || []);

            const mayorLastOnlineMap = new Map();
            for (const p of detailedPlayers) {
                if (p.name && p.timestamps?.lastOnline) {
                    mayorLastOnlineMap.set(p.name.toLowerCase(), p.timestamps.lastOnline);
                }
            }

            // 4. 各アラートの計算と送信処理
            const NOW = Date.now();
            const DAY_IN_MS = 24 * 60 * 60 * 1000;

            for (const alert of townAlerts) {
                const townName = alert.town_name;
                const townData = townMap.get(townName.toLowerCase());

                // 街がすでに消滅（Fall）している場合はDBから自動削除
                if (!townData) {
                    await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [townName]);
                    continue;
                }

                const mayorName = townData.mayor?.name;
                const lastOnline = mayorName ? mayorLastOnlineMap.get(mayorName.toLowerCase()) : null;

                let fallPrediction = '不明';
                if (lastOnline) {
                    const offlineDays = (NOW - lastOnline) / DAY_IN_MS;
                    const daysLeft = 42 - offlineDays;

                    if (daysLeft <= 0) {
                        fallPrediction = '本日中 (崩壊寸前)';
                    } else if (daysLeft < 1) {
                        fallPrediction = `${Math.floor(daysLeft * 24)}時間前`;
                    } else {
                        fallPrediction = `${Math.floor(daysLeft)}日前`;
                    }
                }

                const alertMessage = `街 ${townData.name} の崩壊予測が ${fallPrediction} です。`;

                let userIds = typeof alert.user_ids === 'string' ? JSON.parse(alert.user_ids) : alert.user_ids;
                const validUserIds = [];

                // DM送信と不在ユーザーの自動除外
                for (const userId of userIds) {
                    try {
                        const user = await client.users.fetch(userId);
                        await user.send(alertMessage);
                        validUserIds.push(userId);
                    } catch (dmError) {
                        console.warn(`[FallingNotifier] <@${userId}> への送信失敗（不在/DM拒否）。リストから除外します。`);
                    }
                }

                // 送信結果をDBへ反映
                if (validUserIds.length !== userIds.length) {
                    if (validUserIds.length === 0) {
                        await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [townName]);
                    } else {
                        await pool.execute(
                            'UPDATE town_fall_alerts SET user_ids = ? WHERE town_name = ?',
                            [JSON.stringify(validUserIds), townName]
                        );
                    }
                }
            }

        } catch (error) {
            console.error('[FallingNotifier] タスク実行エラー:', error.message);
        }
    });
}