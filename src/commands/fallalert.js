import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import axios from 'axios';

const TOWNS_API_URL = process.env.TOWNS_API_URL || 'https://api.earthmc.net/v4/towns';

export const data = new SlashCommandBuilder()
    .setName('fallalert')
    .setDescription('町や国の崩壊通知（アラート）を設定します')
    .addStringOption(opt => opt.setName('town').setDescription('対象の町名'))
    .addStringOption(opt => opt.setName('nation').setDescription('対象の国名'))
    .addStringOption(opt => 
        opt.setName('alertday')
           .setDescription('通知を受け取るタイミング (デフォルト: 7day)')
           .addChoices(
               { name: '7日前', value: '7day' },
               { name: '3日前', value: '3day' },
               { name: '1日前', value: '1day' },
               { name: '12時間前', value: '12h' },
               { name: '6時間前', value: '6h' },
               { name: '1時間前', value: '1h' },
               { name: '30分前', value: '30m' }
           ));

/**
 * ユーザー設定の配列（JSON）に新しい設定を追加・更新するヘルパー関数
 */
function updateUserArray(rawUsers, userId, alertDay) {
    let users = [];
    if (rawUsers) {
        users = typeof rawUsers === 'string' ? JSON.parse(rawUsers) : rawUsers;
    }

    const index = users.findIndex(u => u.UserID === userId);
    if (index !== -1) {
        // 設定済みの場合は通知タイミングを更新（タイミングが変わった場合は lastNotified をリセット）
        const oldNotifyTime = users[index].NotifyTime;
        users[index] = {
            UserID: userId,
            NotifyTime: alertDay,
            lastNotified: oldNotifyTime === alertDay ? users[index].lastNotified : null
        };
    } else {
        // 新規追加
        users.push({
            UserID: userId,
            NotifyTime: alertDay,
            lastNotified: null
        });
    }

    return users;
}

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const town = interaction.options.getString('town');
    const nation = interaction.options.getString('nation');
    const alertday = interaction.options.getString('alertday') || '7day';
    const userId = interaction.user.id;

    if (!town && !nation) {
        return interaction.editReply('❌ `town` または `nation` のいずれかを必ず指定してください。');
    }

    let targetTown = town;

    // 町と国が両方指定された場合、その町が国に属しているか確認して重複排除
    if (town && nation) {
        try {
            const res = await axios.post(TOWNS_API_URL, { query: [town] });
            if (res.data?.[0]?.nation?.toLowerCase() === nation.toLowerCase()) {
                targetTown = null; // 国通知側にまとめて町側は登録スキップ
            }
        } catch (e) {}
    }

    try {
        const pool = context.pool;

        // 町のアラート登録
        if (targetTown) {
            const [rows] = await pool.execute('SELECT user_ids FROM town_fall_alerts WHERE town_name = ?', [targetTown]);
            const updatedUsers = updateUserArray(rows.length > 0 ? rows[0].user_ids : null, userId, alertday);

            await pool.execute(
                'INSERT INTO town_fall_alerts (town_name, user_ids) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_ids = ?',
                [targetTown, JSON.stringify(updatedUsers), JSON.stringify(updatedUsers)]
            );
        }

        // 国のアラート登録
        if (nation) {
            const [rows] = await pool.execute('SELECT user_ids FROM nation_fall_alerts WHERE nation_name = ?', [nation]);
            const updatedUsers = updateUserArray(rows.length > 0 ? rows[0].user_ids : null, userId, alertday);

            await pool.execute(
                'INSERT INTO nation_fall_alerts (nation_name, user_ids) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_ids = ?',
                [nation, JSON.stringify(updatedUsers), JSON.stringify(updatedUsers)]
            );
        }

        const msg = targetTown === null && town 
            ? `✅ \`${town}\` は \`${nation}\` に含まれているため、国アラート (\`${alertday}\`) にまとめて登録しました。`
            : `✅ アラート設定を保存しました。 (タイミング: \`${alertday}\`)`;

        await interaction.editReply(msg);

    } catch (error) {
        console.error('[/fallalert] エラー:', error);
        await interaction.editReply('アラート設定の保存中にエラーが発生しました。');
    }
}