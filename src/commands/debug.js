import { 
    SlashCommandBuilder, 
    MessageFlags, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { loadAllCommands } from '../commandHandler.js';

export const data = new SlashCommandBuilder()
    .setName('debug')
    .setDescription('管理者専用の操作パネルを表示します');

export async function execute(interaction, args, context = {}) {
    const adminId = process.env.ADMIN_ID || process.env.ADMIN;

    if (interaction.user.id !== adminId) {
        return interaction.reply({
            content: '❌ このコマンドを実行する権限がありません。',
            flags: MessageFlags.Ephemeral
        });
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('debug_action_select')
        .setPlaceholder('実行する操作を選択してください')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('全モジュール/コマンド再読み込み')
                .setValue('reload_all'),
            new StringSelectMenuOptionBuilder()
                .setLabel('SQL直接実行 (Direct Query)')
                .setDescription('任意のSQL文を実行して結果を取得します')
                .setValue('raw_sql'),
            new StringSelectMenuOptionBuilder()
                .setLabel('DB管理ツール (GUI情報)')
                .setDescription('推奨GUIアプリと接続情報を確認します')
                .setValue('gui_info'),
            new StringSelectMenuOptionBuilder()
                .setLabel('DB接続テスト (Ping)')
                .setValue('db_ping'),
            new StringSelectMenuOptionBuilder()
                .setLabel('システムステータス確認')
                .setValue('system_status')
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = {
        title: '⚙️ 管理者制御パネル (Debug)',
        description: '以下のメニューから実行したい管理操作を選択してください。',
        color: 0x2b2d31,
        fields: [
            { name: 'Admin ID', value: `<@${adminId}>`, inline: true },
            { name: 'Node.js', value: process.version, inline: true }
        ]
    };

    const response = await interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    const collector = response.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async i => {
        if (i.user.id !== adminId) return;

        const selected = i.values[0];

        if (selected === 'reload_all') {
            await i.deferUpdate();
            await loadAllCommands();
            await i.followUp({ content: '✅ すべてのコマンドを再読み込みしました。', flags: MessageFlags.Ephemeral });
        } 
        else if (selected === 'raw_sql') {
            // モーダル等で入力させるか、接続情報から簡易実行
            await i.reply({
                content: '⚠️ Direct SQLは安全のため、`/alloc` または DBeaver / TablePlus などの外部GUIツール経由での実行を強く推奨します。',
                flags: MessageFlags.Ephemeral
            });
        }
        else if (selected === 'gui_info') {
            const host = process.env.DB_HOST || 'localhost';
            const port = process.env.DB_PORT || '3306';
            const db = process.env.DB_NAME || 'database';

            await i.reply({
                content: `🖥️ **Database Management GUI Info**\n` +
                         `推奨GUI管理アプリ: **DBeaver** / **TablePlus** / **phpMyAdmin**\n\n` +
                         `\`\`\`text\n` +
                         `Host: ${host}\n` +
                         `Port: ${port}\n` +
                         `Database: ${db}\n` +
                         `\`\`\``,
                flags: MessageFlags.Ephemeral
            });
        }
        else if (selected === 'db_ping') {
            await i.deferUpdate();
            try {
                await context.pool.query('SELECT 1');
                await i.followUp({ content: '✅ MySQL DB接続テスト成功！', flags: MessageFlags.Ephemeral });
            } catch (err) {
                await i.followUp({ content: `❌ DB接続エラー: \`${err.message}\``, flags: MessageFlags.Ephemeral });
            }
        }
        else if (selected === 'system_status') {
            const ram = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            await i.reply({
                content: `📊 Ping: ${i.client.ws.ping}ms | RAM: ${ram} MB`,
                flags: MessageFlags.Ephemeral
            });
        }
    });
}