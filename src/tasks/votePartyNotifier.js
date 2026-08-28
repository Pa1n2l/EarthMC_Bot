import { fetchServerInfo } from '../api.js';
import mysql from 'mysql2/promise';

let hasNotified = false;
const VOTE_PARTY_FLAG = 1 << 0; // 1

export function startVotePartyTask(client, dbConfig, intervalMs = 180000) {
    setInterval(async () => {
        try {
            const info = await fetchServerInfo();
            const vp = info?.voteParty;
            if (!vp) return;

            const remaining = vp.numRemaining ?? 0;
            const threshold = 100;

            if (remaining <= threshold && !hasNotified) {
                hasNotified = true;

                const conn = await mysql.createConnection({
                    host: dbConfig.host,
                    port: dbConfig.port,
                    user: dbConfig.user,
                    password: dbConfig.password,
                    database: dbConfig.database,
                    ssl: { rejectUnauthorized: false }
                });

                // ビット演算で VoteParty 通知が ON のユーザーのみ抽出
                const [rows] = await conn.execute(
                    'SELECT discord_id FROM users WHERE discord_id IS NOT NULL AND (flags & ?) != 0',
                    [VOTE_PARTY_FLAG]
                );
                await conn.end();

                for (const row of rows) {
                    const user = await client.users.fetch(row.discord_id).catch(() => null);
                    if (user) {
                        await user.send(
                            `🎉 **VoteParty通知**\n` +
                            `残り票数が **${remaining}** 票になりました！（目標: ${vp.target} 票）\n` +
                            `まもなくVotePartyが開始されます！`
                        ).catch(() => null);
                    }
                }
            } 
            else if (remaining > threshold && hasNotified) {
                hasNotified = false;
            }
        } catch (error) {
            console.error('[VotePartyTask] エラー:', error.message);
        }
    }, intervalMs);
}