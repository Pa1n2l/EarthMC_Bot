import { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags 
} from 'discord.js';
import { getFallingCache } from '../utils/fallingCache.js';

export const data = new SlashCommandBuilder()
    .setName('falling')
    .setDescription('崩壊が近い町の一覧を表示します')
    .addStringOption(option =>
        option.setName('sort')
            .setDescription('並び替え順を選択')
            .setRequired(false)
            .addChoices(
                { name: 'アルファベット順', value: 'alphabetical' },
                { name: '設立日順', value: 'founded' },
                { name: '住民数順', value: 'residents' },
                { name: 'プロット数順 (規模)', value: 'size' },
                { name: '残高順', value: 'balance' },
                { name: '首都優先', value: 'capital' },
                { name: 'オープン状態優先', value: 'open' }
            ))
    .addStringOption(option =>
        option.setName('nation')
            .setDescription('特定の国家（Nation）で絞り込みます（例: Japan）')
            .setRequired(false)
    );

export async function execute(interaction) {
    await interaction.deferReply();

    const sortOption = interaction.options.getString('sort') || 'default';
    const targetNation = interaction.options.getString('nation')?.trim();

    // 1. メモリ内のキャッシュからデータを取得 (APIリクエストなし)
    const cachedTowns = getFallingCache();

    if (!cachedTowns || cachedTowns.length === 0) {
        return interaction.editReply('🌲 現在、崩壊予定の町データ（キャッシュ）が存在しないか、読み込み中です。');
    }

    // 2. 国家（Nation）での絞り込み
    let townsList = [...cachedTowns];
    if (targetNation) {
        const query = targetNation.toLowerCase();
        townsList = townsList.filter(t => t.nation && t.nation.toLowerCase().includes(query));
    }

    if (townsList.length === 0) {
        const msg = targetNation 
            ? `🌲 国家「**${targetNation}**」に属する崩壊予定の町は見つかりませんでした。`
            : '🌲 崩壊予定の町は見つかりませんでした。';
        return interaction.editReply(msg);
    }

    // 3. 指定された条件でソート
    townsList.sort((a, b) => {
        switch (sortOption) {
            case 'alphabetical': return a.name.localeCompare(b.name);
            case 'founded': return b.registered - a.registered;
            case 'residents': return b.residents - a.residents;
            case 'size': return b.plots - a.plots;
            case 'balance': return b.balance - a.balance;
            case 'capital': return (b.isCapital ? 1 : 0) - (a.isCapital ? 1 : 0);
            case 'open': return (b.isOpen ? 1 : 0) - (a.isOpen ? 1 : 0);
            default: return a.deletionTimeMs - b.deletionTimeMs; // デフォルト: 崩壊予定日時が近い順
        }
    });

    // 4. ページネーション設定 (1ページあたり5件)
    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(townsList.length / ITEMS_PER_PAGE);
    let currentPage = 1;

    const generateEmbedAndButtons = (page) => {
        const start = (page - 1) * ITEMS_PER_PAGE;
        const currentItems = townsList.slice(start, start + ITEMS_PER_PAGE);

        let descText = '';
        currentItems.forEach((t, index) => {
            const itemNum = start + index + 1;

            const capIcon = t.isCapital ? '⭕' : '❌';
            const openIcon = t.isOpen ? '⭕' : '❌';
            const spawnIcon = t.canOutsidersSpawn ? '⭕' : '❌';
            const pvpIcon = t.pvp ? '⭕' : '❌';

            descText += `**${itemNum}. ${t.name}** (${t.nation})\n`;
            descText += `崩壊予定: <t:${t.deletionTimestampSec}:R> (<t:${t.deletionTimestampSec}:f>) 座標: [${t.x}, ${t.y}, ${t.z}](${t.mapUrl})\n`;
            descText += `市長: \`${t.mayor}\` (最終オンライン: <t:${t.lastOnlineSec}:R>)\n`;
            descText += `👤住民: ${t.residents}人 💎プロット: ${t.plots} 💰残高: ${t.balance}G\n`;
            descText += `${capIcon}首都 ${openIcon}オープン ${spawnIcon}外人スポーン ${pvpIcon}PVP\n\n`;
        });

        const titleNationStr = targetNation ? ` [${targetNation}]` : '';
        const embed = {
            title: `[${townsList.length}] 崩壊注意の町リスト${titleNationStr} | Page ${page}/${totalPages}`,
            description: descText.trim(),
            color: 0xf1c40f
        };

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('first').setLabel('<<').setStyle(ButtonStyle.Danger).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('prev').setLabel('<').setStyle(ButtonStyle.Success).setDisabled(page === 1),
            new ButtonBuilder().setCustomId('next').setLabel('>').setStyle(ButtonStyle.Success).setDisabled(page === totalPages),
            new ButtonBuilder().setCustomId('last').setLabel('>>').setStyle(ButtonStyle.Danger).setDisabled(page === totalPages)
        );

        return { embeds: [embed], components: [buttons] };
    };

    // 初回レスポンス送信
    const response = await interaction.editReply(generateEmbedAndButtons(currentPage));
    const collector = response.createMessageComponentCollector({ time: 120000 });

    collector.on('collect', async i => {
        if (i.user.id !== interaction.user.id) {
            return i.reply({ content: '別のユーザーの操作です。', flags: MessageFlags.Ephemeral });
        }

        if (i.customId === 'first') currentPage = 1;
        else if (i.customId === 'prev') currentPage--;
        else if (i.customId === 'next') currentPage++;
        else if (i.customId === 'last') currentPage = totalPages;

        await i.update(generateEmbedAndButtons(currentPage));
    });

    collector.on('end', async () => {
        // タイムアウト時にボタンを無効化
        const disabledButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('first').setLabel('<<').setStyle(ButtonStyle.Danger).setDisabled(true),
            new ButtonBuilder().setCustomId('prev').setLabel('<').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('next').setLabel('>').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('last').setLabel('>>').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        await interaction.editReply({ components: [disabledButtons] }).catch(() => {});
    });
}