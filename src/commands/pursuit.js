import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { pursuitCache } from '../utils/pursuitCache.js';

export const data = new SlashCommandBuilder()
    .setName('pursuit')
    .setDescription('EarthMCのpursuit情報を取得します')
    .addSubcommand(sub =>
        sub.setName('player')
            .setDescription('プレイヤーのpursuitを取得します')
            .addStringOption(opt => opt.setName('grep-player').setDescription('特定のプレイヤー名で絞り込み'))
            .addStringOption(opt => opt.setName('grep-town').setDescription('特定の町に所属するプレイヤーで絞り込み'))
            .addStringOption(opt => opt.setName('grep-nation').setDescription('特定の国に所属するプレイヤーで絞り込み'))
    )
    .addSubcommand(sub =>
        sub.setName('town')
            .setDescription('町のpursuitを取得します')
            .addStringOption(opt => opt.setName('grep-town').setDescription('特定の町名で絞り込み'))
            .addStringOption(opt => opt.setName('grep-nation').setDescription('特定の国に所属する町で絞り込み'))
    )
    .addSubcommand(sub =>
        sub.setName('nation')
            .setDescription('国のpursuitを取得します')
            .addStringOption(opt => opt.setName('grep-nation').setDescription('特定の国名で絞り込み'))
    );

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const typeKey = subcommand.toUpperCase();

    const pursuitData = pursuitCache[typeKey];
    if (!pursuitData || !pursuitData.isActive) {
        return interaction.reply({ 
            content: `ℹ️ 現在キャッシュされているアクティブな ${subcommand} pursuit はありません。`, 
            flags: MessageFlags.Ephemeral 
        });
    }

    const grepPlayer = interaction.options.getString('grep-player')?.toLowerCase();
    const grepTown = interaction.options.getString('grep-town')?.toLowerCase();
    const grepNation = interaction.options.getString('grep-nation')?.toLowerCase();

    const topEntries = pursuitData.top || {};
    const positions = Object.keys(topEntries);
    const results = [];

    for (const pos of positions) {
        const entry = topEntries[pos];
        
        // 安全に文字列化
        const entityName = String(entry.name || '');
        const townName = String(entry.town || '');
        const nationName = String(entry.nation || '');

        // 絞り込み判定（文字列安全比較）
        if (grepPlayer && !entityName.toLowerCase().includes(grepPlayer)) continue;
        if (grepTown && !townName.toLowerCase().includes(grepTown)) continue;
        if (grepNation && !nationName.toLowerCase().includes(grepNation)) continue;

        let metaText = '';
        if (subcommand === 'player' && (townName || nationName)) {
            metaText = ` (${townName || '無所属'}, ${nationName || '無所属'})`;
        } else if (subcommand === 'town' && nationName) {
            metaText = ` (${nationName})`;
        }

        results.push(`**#${pos}** \`${entityName}\`${metaText} - **${(entry.score || 0).toLocaleString()}** pt`);
    }

    if (results.length === 0) {
        return interaction.reply({ 
            content: '🔍 条件に合致するエントリーは見つかりませんでした。', 
            flags: MessageFlags.Ephemeral 
        });
    }

    const lastUpdatedText = pursuitCache.lastUpdated 
        ? new Date(pursuitCache.lastUpdated).toLocaleTimeString('ja-JP') 
        : '不明';

    const embed = new EmbedBuilder()
        .setTitle(`🏆 Pursuit: ${pursuitData.name}`)
        .setColor(0xF1C40F)
        .setDescription(results.slice(0, 15).join('\n'))
        .setFooter({ text: `最終更新: ${lastUpdatedText}` });

    await interaction.reply({ embeds: [embed] });
}