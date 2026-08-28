import 'dotenv/config';
import { fetchServerInfo } from '../api.js';

let hasNotified = false;
const VOTE_PARTY_FLAG = 1 << 0; // 1

// 第2引数を pool に変更
export function startVotePartyTask(client, pool, intervalMs = 60000) {
    setInterval(async () => {
        try {
            const info = await fetchServerInfo();
            const vp = info?.voteParty;
            if (!vp) return;

            const remaining = vp.numRemaining ?? 0;
            const threshold = Number(process.env.VPNOTHIFY_THRESHOLD) || 100;

            if (remaining <= threshold && !hasNotified) {
                hasNotified = true;

                // 既存のプール(pool)からクエリを直接実行
                const [rows] = await pool.execute(
                    'SELECT discord_id FROM users WHERE discord_id IS NOT NULL AND (flags & ?) != 0',
                    [VOTE_PARTY_FLAG]
                );

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
                // VotePartyがリセット（達成後）されたらフラグを戻す
                hasNotified = false;
            }
        } catch (error) {
            console.error('[VotePartyTask] エラー:', error.message);
        }
    }, intervalMs);
}