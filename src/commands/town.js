import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

const TOWNS_API_URL = 'https://api.earthmc.net/v4/towns';

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
    let text = arr.join(', ');
    if (text.length > maxLen) {
        text = text.substring(0, maxLen) + '...';
    }
    return text;
}

export const data = new SlashCommandBuilder()
    .setName('town')
    .setDescription('指定した町の詳細情報を表示します')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('検索したい町名')
            .setRequired(true));

export async function execute(interaction) {
    await interaction.deferReply();

    const townName = interaction.options.getString('name');

    try {
        const response = await axios.post(TOWNS_API_URL, { query: [townName] }, { timeout: 10000 });
        if (!response.data || response.data.length === 0) {
            return interaction.editReply(`町 \`${townName}\` のデータが見つかりませんでした。`);
        }
        const apiData = response.data[0];

        // 座標とMapリンク
        const spawnX = apiData.coordinates?.spawn?.x ?? 0;
        const spawnY = apiData.coordinates?.spawn?.y ?? 0;
        const spawnZ = apiData.coordinates?.spawn?.z ?? 0;
        
        const map2D = `https://map.earthmc.net/?world=minecraft_overworld&zoom=4&x=${Math.round(spawnX)}&z=${Math.round(spawnZ)}`;
        const map3D = `https://map.earthmc.net/?world=minecraft_overworld&renderer=3d&zoom=4&x=${Math.round(spawnX)}&z=${Math.round(spawnZ)}`;

        // スポーングラウンド（方向）
        const pitch = apiData.coordinates?.spawn?.pitch ?? 0;
        const yaw = apiData.coordinates?.spawn?.yaw ?? 0;

        // 信頼住民 & 無法者
        const trustedList = formatList(apiData.trusted?.map(t => t.name));
        const outlawsList = formatList(apiData.outlaws?.map(o => o.name));

        const embed = {
            color: 0x00AE86,
            fields: [
                {
                    name: '✅基本情報',
                    value: `町名　: ${apiData.name || 'なし'}\n` +
                           `設立者: ${apiData.founder || 'なし'}\n` +
                           `市長　: ${apiData.mayor?.name || 'なし'}\n` +
                           `国　　: ${apiData.nation?.name || 'なし'}\n` +
                           `首都　: ${formatBool(apiData.status?.isCapital)}\n`,
                    inline: true
                },
                {
                    name: '📊統計',
                    value: `町ブロック数　: ${(apiData.stats?.numTownBlocks ?? 0).toLocaleString()}\n` +
                           `最大ブロック数: ${(apiData.stats?.maxTownBlocks ?? 0).toLocaleString()}\n` +
                           `ボーナス　　　: ${(apiData.stats?.bonusBlocks ?? 0).toLocaleString()}\n` +
                           `住民数　　　　: ${(apiData.stats?.numResidents ?? 0).toLocaleString()}\n` +
                           `銀行　　　　　: ${(apiData.stats?.balance ?? 0).toLocaleString()}G`,
                    inline: true
                },
                {
                    name: '📜ステータス',
                    value: `公開　　　　 : ${formatBool(apiData.status?.isPublic)}\n` +
                           `オープン　　 : ${formatBool(apiData.status?.isOpen)}\n` +
                           `中立　　　　 : ${formatBool(apiData.status?.isNeutral)}\n` +
                           `崩壊　　　　 : ${formatBool(apiData.status?.isRuined)}\n` +
                           `売却中　　　 : ${formatBool(apiData.status?.isForSale)}\n` +
                           `オバクレ　　 : ${formatBool(apiData.status?.isOverclaimed)}\n` +
                           `外人ワープ　 : ${formatBool(apiData.status?.hasOutsiders)}\n` +
                           `同士討ち　　 : ${formatBool(apiData.status?.hasPvp)}\n` +
                           `モブ湧き　　 : ${formatBool(apiData.status?.hasMobs)}`,
                    inline: true
                },
                {
                    name: '📍 スポーン地点',
                    value: `**座標**: x=${spawnX}, y=${spawnY}, z=${spawnZ}\n` +
                           `**map**: 🗺️[2D](${map2D}) | 🌍[3D](${map3D})\n`,
                    inline: false
                },
                {
                    name: '📝その他情報',
                    value: `**Trusted**: \`\`\`\n${trustedList}\n\`\`\`\n` +
                           `**Outlaws**: \`\`\`\n${outlawsList}\n\`\`\``,
                    inline: false
                }
            ]
        };

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('[/town] コマンドエラー:', error);
        await interaction.editReply('町情報の取得中にエラーが発生しました。');
    }
}