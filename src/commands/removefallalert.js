import { SlashCommandBuilder, MessageFlags } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('removefallalert')
    .setDescription('設定した崩壊アラートを解除します')
    .addStringOption(opt => opt.setName('town').setDescription('解除する町名'))
    .addStringOption(opt => opt.setName('nation').setDescription('解除する国名'));

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const town = interaction.options.getString('town');
    const nation = interaction.options.getString('nation');
    const userId = interaction.user.id;

    if (!town && !nation) {
        return interaction.editReply('❌ `town` または `nation` のいずれかを指定してください。');
    }

    try {
        const pool = context.pool;
        let removedCount = 0;

        // 町のアラート解除
        if (town) {
            const [rows] = await pool.execute('SELECT user_ids FROM town_fall_alerts WHERE town_name = ?', [town]);
            if (rows.length > 0) {
                let users = typeof rows[0].user_ids === 'string' ? JSON.parse(rows[0].user_ids) : rows[0].user_ids;
                const initialLen = users.length;

                // オブジェクト配列から該当ユーザーを除外
                users = users.filter(u => u.UserID !== userId);

                if (users.length !== initialLen) {
                    removedCount++;
                    if (users.length === 0) {
                        await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [town]);
                    } else {
                        await pool.execute('UPDATE town_fall_alerts SET user_ids = ? WHERE town_name = ?', [JSON.stringify(users), town]);
                    }
                }
            }
        }

        // 国のアラート解除
        if (nation) {
            const [rows] = await pool.execute('SELECT user_ids FROM nation_fall_alerts WHERE nation_name = ?', [nation]);
            if (rows.length > 0) {
                let users = typeof rows[0].user_ids === 'string' ? JSON.parse(rows[0].user_ids) : rows[0].user_ids;
                const initialLen = users.length;

                // オブジェクト配列から該当ユーザーを除外
                users = users.filter(u => u.UserID !== userId);

                if (users.length !== initialLen) {
                    removedCount++;
                    if (users.length === 0) {
                        await pool.execute('DELETE FROM nation_fall_alerts WHERE nation_name = ?', [nation]);
                    } else {
                        await pool.execute('UPDATE nation_fall_alerts SET user_ids = ? WHERE nation_name = ?', [JSON.stringify(users), nation]);
                    }
                }
            }
        }

        if (removedCount > 0) {
            await interaction.editReply('✅ アラート設定の解除が完了しました。');
        } else {
            await interaction.editReply('⚠️ 指定された町または国の通知設定が見つかりませんでした。');
        }

    } catch (error) {
        console.error('[/removefallalert] エラー:', error);
        await interaction.editReply('アラート削除中にエラーが発生しました。');
    }
}