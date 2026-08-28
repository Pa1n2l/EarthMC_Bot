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

        // 町のアラート解除
        if (town) {
            const [rows] = await pool.execute('SELECT user_ids FROM town_fall_alerts WHERE town_name = ?', [town]);
            if (rows.length > 0) {
                let users = typeof rows[0].user_ids === 'string' ? JSON.parse(rows[0].user_ids) : rows[0].user_ids;
                users = users.filter(id => id !== userId);

                if (users.length === 0) {
                    await pool.execute('DELETE FROM town_fall_alerts WHERE town_name = ?', [town]);
                } else {
                    await pool.execute('UPDATE town_fall_alerts SET user_ids = ? WHERE town_name = ?', [JSON.stringify(users), town]);
                }
            }
        }

        // 国のアラート解除（町指定が同時にあった場合は国側は維持）
        if (nation && !town) {
            const [rows] = await pool.execute('SELECT user_ids FROM nation_fall_alerts WHERE nation_name = ?', [nation]);
            if (rows.length > 0) {
                let users = typeof rows[0].user_ids === 'string' ? JSON.parse(rows[0].user_ids) : rows[0].user_ids;
                users = users.filter(id => id !== userId);

                if (users.length === 0) {
                    await pool.execute('DELETE FROM nation_fall_alerts WHERE nation_name = ?', [nation]);
                } else {
                    await pool.execute('UPDATE nation_fall_alerts SET user_ids = ? WHERE nation_name = ?', [JSON.stringify(users), nation]);
                }
            }
        }

        await interaction.editReply('✅ アラート解除処理が完了しました。');

    } catch (error) {
        console.error('[/removefallalert] エラー:', error);
        await interaction.editReply('アラート削除中にエラーが発生しました。');
    }
}