import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
    .setName('link')
    .setDescription('MinecraftアカウントとDiscordアカウントを紐付けます')
    .addStringOption(option =>
        option.setName('mcid')
            .setDescription('あなたのMinecraft ID')
            .setRequired(true));

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const mcid = interaction.options.getString('mcid');
    const discordId = interaction.user.id;
    const playersApiUrl = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';

    try {
        // APIからUUIDを取得
        const response = await axios.post(playersApiUrl, { query: [mcid] }, { timeout: 10000 });
        if (!response.data || response.data.length === 0) {
            return interaction.editReply(`プレイヤー \`${mcid}\` は見つかりませんでした。`);
        }
        const apiData = response.data[0];
        const uuid = apiData.uuid;

        // DBへUPSERT（挿入または更新）
        const pool = context.pool;
        await pool.execute(
            `INSERT INTO users (mc_uuid, discord_id) 
             VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE discord_id = ?`,
            [uuid, discordId, discordId]
        );

        await interaction.editReply(`✅ **${apiData.name}** (\`${uuid}\`) と Discord アカウントの紐付けが完了しました！`);

    } catch (error) {
        console.error('[/link] エラー:', error);
        await interaction.editReply('アカウントの紐付け処理中にエラーが発生しました。');
    }
}