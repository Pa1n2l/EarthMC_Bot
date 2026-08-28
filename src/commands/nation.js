import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

const NATIONS_API_URL = 'https://api.earthmc.net/v4/nations';

/**
 * 真偽値を ✅ ❌ に変換
 */
function formatBool(val) {
    return val ? '✅' : '❌';
}

/**
 * リストをカンマ区切りの文字列に整形（長すぎる場合は省略）
 */
function formatList(arr, maxLen = 900) {
    if (!Array.isArray(arr) || arr.length === 0) return 'なし';
    let text = arr.map(item => typeof item === 'object' ? item.name : item).join(', ');
    if (text.length > maxLen) {
        text = text.substring(0, maxLen) + '...';
    }
    return text;
}

export const data = new SlashCommandBuilder()
    .setName('nation')
    .setDescription('指定した国の詳細情報を表示します')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('検索したい国名')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply();

    const nationName = interaction.options.getString('name');

    try {
        const response = await axios.post(NATIONS_API_URL, { query: [nationName] }, { timeout: 10000 });
        if (!response.data || response.data.length === 0) {
            return interaction.editReply(`国 \`${nationName}\` のデータが見つかりませんでした。`);
        }
        const apiData = response.data[0];

        // 座標とMapリンク
        const spawnX = apiData.coordinates?.spawn?.x ?? 0;
        const spawnY = apiData.coordinates?.spawn?.y ?? 0;
        const spawnZ = apiData.coordinates?.spawn?.z ?? 0;
        
        const map2D = `https://map.earthmc.net/?world=minecraft_overworld&zoom=4&x=${Math.round(spawnX)}&z=${Math.round(spawnZ)}`;
        const map3D = `https://map.earthmc.net/?world=minecraft_overworld&renderer=3d&zoom=4&x=${Math.round(spawnX)}&z=${Math.round(spawnZ)}`;

        // 各種リスト整形
        const alliesList = formatList(apiData.allies);
        const enemiesList = formatList(apiData.enemies);
        const townsList = formatList(apiData.towns);

        const embed = {
            color: 0x3498db,
            fields: [
                {
                    name: '✅基本情報',
                    value: `国名 : ${apiData.name || 'なし'}\n` +
                           `国王 : ${apiData.king?.name || 'なし'}\n` +
                           `首都 : ${apiData.capital?.name || 'なし'}\n`,
                    inline: true
                },
                {
                    name: '📊統計',
                    value: `町数　　: ${(apiData.stats?.numTowns ?? 0).toLocaleString()}\n` +
                           `住民数　: ${(apiData.stats?.numResidents ?? 0).toLocaleString()}\n` +
                           `ブロック: ${(apiData.stats?.numTownBlocks ?? 0).toLocaleString()}\n` +
                           `同盟国数: ${(apiData.stats?.numAllies ?? 0).toLocaleString()}\n` +
                           `銀行　　: ${(apiData.stats?.balance ?? 0).toLocaleString()}G`,
                    inline: true
                },
                {
                    name: '📜ステータス',
                    value: `公開　　　: ${formatBool(apiData.status?.isPublic)}\n` +
                           `オープン　: ${formatBool(apiData.status?.isOpen)}\n` +
                           `中立　　　: ${formatBool(apiData.status?.isNeutral)}`,
                    inline: true
                },
                {
                    name: '📍 首都スポーン地点',
                    value: `**座標**: x=${spawnX}, y=${spawnY}, z=${spawnZ}\n` +
                           `**map**: 🗺️[2D](${map2D}) | 🌍[3D](${map3D})\n`,
                    inline: false
                },
                {
                    name: '📝その他情報',
                    value: `**Allies (同盟国)**: \`\`\`\n${alliesList}\n\`\`\`\n` +
                           `**Enemies (敵対国)**: \`\`\`\n${enemiesList}\n\`\`\`\n` +
                           `**Towns (所属町)**: \`\`\`\n${townsList}\n\`\`\``,
                    inline: false
                }
            ]
        };

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[/nation] コマンドエラー:', error);
        await interaction.editReply('国情報の取得中にエラーが発生しました。');
    }
}