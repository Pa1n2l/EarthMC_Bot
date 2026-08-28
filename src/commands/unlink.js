import { SlashCommandBuilder, MessageFlags } from 'discord.js';

export const data = new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('DiscordアカウントとMinecraft IDの紐付けを解除します');

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const [result] = await context.pool.execute(
            'UPDATE users SET mc_uuid = NULL WHERE discord_id = ?',
            [interaction.user.id]
        );

        if (result.affectedRows === 0) {
            return interaction.editReply('❌ 紐付けされているアカウントが見つかりませんでした。');
        }

        await interaction.editReply('✅ アカウントの紐付けを解除しました。');
    } catch (error) {
        console.error('[/unlink] エラー:', error);
        await interaction.editReply('処理中にエラーが発生しました。');
    }
}