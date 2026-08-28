import cron from 'node-cron';
import axios from 'axios';

const TOWNS_API_URL = process.env.TOWNS_API_URL || 'https://api.earthmc.net/v4/towns';
const PLAYERS_API_URL = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';

// NotifyTime の定義と優先順位（ミリ秒換算）
const NOTIFY_THRESHOLDS = {
    '7d':  7 * 24 * 60 * 60 * 1000,
    '3d':  3 * 24 * 60 * 60 * 1000,
    '1d':  1 * 24 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '6h':  6 * 60 * 60 * 1000,
    '3h':  3 * 60 * 60 * 1000,
    '1h':  1 * 60 * 60 * 1000,
    '30m': 30 * 60 * 1000
};

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export function startFallingNotifierTask(client, pool) {
    // 10分ごとに通知判定
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

            const targetTownNames = townAlerts.map(a => a.town_name);
            const townChunks = chunkArray(targetTownNames, 50);

            const townDetailReqs = townChunks.map(chunk =>
                axios.post(TOWNS_API_URL, { query: chunk }, { timeout: 10000 }).catch(() => ({ data: [] }))
            );
            const townDetailRes = await Promise.all(townDetailReqs);
            const detailedTowns = townDetailRes.flatMap(res => res.data || []);
            const townMap = new Map(detailedTowns.map(t => [t.name.toLowerCase(), t]));

            // 3. 市長のリストを抽出して取得
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

                // 街がすでに消滅している場合はDBから削除
                if (!townData) {
                    await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [townName]);
                    continue;
                }

                const mayorName = townData.mayor?.name;
                const lastOnline = mayorName ? mayorLastOnlineMap.get(mayorName.toLowerCase()) : null;
                if (!lastOnline) continue;

                const offlineDays = (NOW - lastOnline) / DAY_IN_MS;
                const daysLeft = 42 - offlineDays;
                const remainingMs = daysLeft * DAY_IN_MS; // 残り時間 (ミリ秒)

                let fallPrediction = '';
                if (daysLeft <= 0) {
                    fallPrediction = '本日中 (崩壊寸前)';
                } else if (daysLeft < 1) {
                    fallPrediction = `約 ${Math.ceil(daysLeft * 24)} 時間後`;
                } else {
                    fallPrediction = `約 ${Math.ceil(daysLeft)} 日後`;
                }

                let userSettings = typeof alert.user_ids === 'string' ? JSON.parse(alert.user_ids) : alert.user_ids;
                let updatedSettings = [];
                let isModified = false;

                for (const setting of userSettings) {
                    const userId = setting.UserID;
                    const notifyTime = setting.NotifyTime;
                    const lastNotified = setting.lastNotified;
                    const thresholdMs = NOTIFY_THRESHOLDS[notifyTime];

                    // 条件: 残り時間が指定以下 且つ まだその条件で通知を出していない場合
                    if (thresholdMs && remainingMs <= thresholdMs && lastNotified !== notifyTime) {
                        try {
                            const user = await client.users.fetch(userId);
                            await user.send(
                                `⚠️ **【町崩壊アラート】**\n` +
                                `街 **${townData.name}** の崩壊予測が指定のタイマー (**${notifyTime} 前**) に達しました！\n` +
                                `現在の崩壊予測: **${fallPrediction}**`
                            );

                            // 通知済みフラグを更新して保持
                            updatedSettings.push({
                                ...setting,
                                lastNotified: notifyTime
                            });
                            isModified = true;
                        } catch (dmError) {
                            if (dmError.code === 50007) {
                                // DM拒否設定などの場合は除外（isModifiedをtrueにする）
                                console.warn(`[FallingNotifier] <@${userId}> がDMを拒否しているため削除します。`);
                                isModified = true;
                            } else {
                                // 一時的なエラーの場合は変更なしで保持
                                updatedSettings.push(setting);
                            }
                        }
                    } else {
                        // 条件未到達 または 送信済みの場合はそのまま保持
                        updatedSettings.push(setting);
                    }
                }

                // 設定の更新・削除があった場合のみDBに保存
                if (isModified) {
                    if (updatedSettings.length === 0) {
                        await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [townName]);
                    } else {
                        await pool.execute(
                            'UPDATE town_fall_alerts SET user_ids = ? WHERE town_name = ?',
                            [JSON.stringify(updatedSettings), townName]
                        );
                    }
                }
            }

        } catch (error) {
            console.error('[FallingNotifier] タスク実行エラー:', error.message);
        }
    });
}