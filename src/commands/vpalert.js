import { SlashCommandBuilder, MessageFlags } from 'discord.js';

const VOTE_PARTY_FLAG = 1 << 0; // 1

export const data = new SlashCommandBuilder()
    .setName('vpalert')
    .setDescription('VotePartyのDM通知設定を変更します')
    .addStringOption(option =>
        option.setName('setting')
            .setDescription('通知のON/OFFを選択')
            .setRequired(true)
            .addChoices(
                { name: 'ON (有効化)', value: 'on' },
                { name: 'OFF (無効化)', value: 'off' }
            ));

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const setting = interaction.options.getString('setting');
    const discordId = interaction.user.id;

    try {
        const [rows] = await context.pool.execute(
            'SELECT mc_uuid, flags FROM users WHERE discord_id = ?',
            [discordId]
        );

        if (rows.length === 0) {
            return interaction.editReply('❌ 先に `/link` コマンドでアカウントを紐づけてください。');
        }

        const currentFlags = rows[0].flags || 0;
        let newFlags = currentFlags;

        if (setting === 'on') {
            newFlags = currentFlags | VOTE_PARTY_FLAG;
        } else {
            newFlags = currentFlags & ~VOTE_PARTY_FLAG;
        }

        await context.pool.execute(
            'UPDATE users SET flags = ? WHERE discord_id = ?',
            [newFlags, discordId]
        );

        const statusText = setting === 'on' ? '✅ **ON**' : '❌ **OFF**';
        await interaction.editReply(`VotePartyのDM通知設定を ${statusText} に変更しました。`);

    } catch (error) {
        console.error('[/vpalert] エラー:', error);
        await interaction.editReply('設定の更新中にエラーが発生しました。');
    }
}