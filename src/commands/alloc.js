import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
    .setName('alloc')
    .setDescription('【管理者用】MCIDとDiscordユーザーを強制紐づけします')
    .addStringOption(option =>
        option.setName('mcid')
            .setDescription('対象のMinecraft ID')
            .setRequired(true))
    .addUserOption(option =>
        option.setName('user')
            .setDescription('対象のDiscordユーザー')
            .setRequired(true));

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const adminId = process.env.ADMIN_ID || process.env.ADMIN;
    
    // DB上の権限チェックも並行して実施
    let isDbAdmin = false;
    if (context.pool) {
        const [rows] = await context.pool.execute(
            'SELECT permission FROM users WHERE discord_id = ?',
            [interaction.user.id]
        );
        if (rows.length > 0 && rows[0].permission >= 10) isDbAdmin = true;
    }

    if (interaction.user.id !== adminId && !isDbAdmin) {
        return interaction.editReply('❌ このコマンドを実行する管理者権限がありません。');
    }

    const mcid = interaction.options.getString('mcid');
    const targetUser = interaction.options.getUser('user');
    const playersApiUrl = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';

    try {
        const response = await axios.post(playersApiUrl, { query: [mcid] }, { timeout: 10000 });
        if (!response.data || response.data.length === 0) {
            return interaction.editReply(`プレイヤー \`${mcid}\` が見つかりませんでした。`);
        }
        const uuid = response.data[0].uuid;

        await context.pool.execute(
            `INSERT INTO users (mc_uuid, discord_id) 
             VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE discord_id = ?`,
            [uuid, targetUser.id, targetUser.id]
        );

        await interaction.editReply(`✅ **${response.data[0].name}** (\`${uuid}\`) を <@${targetUser.id}> に割り当てました。`);
    } catch (error) {
        console.error('[/alloc] エラー:', error);
        await interaction.editReply('割り当て処理中にエラーが発生しました。');
    }
}