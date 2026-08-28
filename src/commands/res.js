import { SlashCommandBuilder } from 'discord.js';
import axios from 'axios';

const PLAYERS_API_URL = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';
const TOWNS_API_URL = process.env.TOWNS_API_URL || 'https://api.earthmc.net/v4/towns';
const NATIONS_API_URL = process.env.NATIONS_API_URL || 'https://api.earthmc.net/v4/nations';
const MAP_BASE_URL = process.env.MAP_BASE_URL || 'https://map.earthmc.net/';

const WEEK_HEADER = '--- 日 月 火 水 木 金 土';
const STAGES = [
    { threshold: 480, mark: '💮' },
    { threshold: 300, mark: '✳️' },
    { threshold: 180, mark: '❇️' },
    { threshold: 120, mark: '🟩' },
    { threshold: 60,  mark: '🟨' },
    { threshold: 30,  mark: '🟧' },
    { threshold: 1,   mark: '🟥' },
    { threshold: 0,   mark: '⬛' }
];

function generateActivityMap(countsArray) {
    const safeCounts = Array.isArray(countsArray) ? countsArray : new Array(35).fill(0);
    let result = WEEK_HEADER + '\n';
    let currentWeek = [];
    const weekLabels = ["５", "４", "３", "２", "現"];

    for (let i = 0; i < 35; i++) {
        const minutes = (safeCounts[i] || 0) * 5;
        const stage = STAGES.find(s => minutes >= s.threshold);
        currentWeek.push(stage ? stage.mark : '⬛');

        if ((i + 1) % 7 === 0) {
            const weekIndex = Math.floor(i / 7);
            result += `${weekLabels[weekIndex]}: ${currentWeek.join(' ')}\n`;
            currentWeek = [];
        }
    }
    return result.trim();
}

function formatPerms(permArray) {
    if (!Array.isArray(permArray)) return '❌ ❌ ❌ ❌';
    return permArray.map(b => b ? '⭕' : '❌').join(' ');
}

async function fetchCoordinates(townName, nationName) {
    try {
        if (townName) {
            const res = await axios.post(TOWNS_API_URL, { query: [townName] }, { timeout: 5000 });
            if (res.data?.[0]?.coordinates?.spawn) {
                const { x, z } = res.data[0].coordinates.spawn;
                return { x: Math.round(x), z: Math.round(z) };
            }
        }
        if (nationName) {
            const res = await axios.post(NATIONS_API_URL, { query: [nationName] }, { timeout: 5000 });
            if (res.data?.[0]?.coordinates?.spawn) {
                const { x, z } = res.data[0].coordinates.spawn;
                return { x: Math.round(x), z: Math.round(z) };
            }
        }
    } catch (e) {}
    return null;
}

export const data = new SlashCommandBuilder()
    .setName('res')
    .setDescription('EarthMCのプレイヤー詳細情報を表示します')
    .addStringOption(option =>
        option.setName('mcid')
            .setDescription('検索したいMCID')
            .setRequired(false))
    .addUserOption(option =>
        option.setName('user')
            .setDescription('検索したいDiscordユーザー')
            .setRequired(false));

export async function execute(interaction, args, context = {}) {
    await interaction.deferReply();

    let targetMcid = interaction.options.getString('mcid');
    const targetUser = interaction.options.getUser('user');

    // 引数がない場合、または user のみ指定された場合、DBからUUIDを探す
    if (!targetMcid) {
        const discordIdSearch = targetUser ? targetUser.id : interaction.user.id;
        if (context.pool) {
            const [rows] = await context.pool.execute(
                'SELECT mc_uuid FROM users WHERE discord_id = ?',
                [discordIdSearch]
            );
            if (rows.length > 0) {
                targetMcid = rows[0].mc_uuid;
            }
        }
    }

    if (!targetMcid) {
        return interaction.editReply('❌ 対象のMCIDを指定するか、`/link` で自分のアカウントを紐づけてください。');
    }

    try {
        const response = await axios.post(PLAYERS_API_URL, { query: [targetMcid] }, { timeout: 10000 });
        if (!response.data || response.data.length === 0) {
            return interaction.editReply(`プレイヤー \`${targetMcid}\` のデータが見つかりませんでした。`);
        }
        const apiData = response.data[0];

        const coords = await fetchCoordinates(apiData.town?.name, apiData.nation?.name);
        const mapUrl = coords 
            ? `${MAP_BASE_URL}?world=minecraft_overworld&zoom=4&x=${coords.x}&z=${coords.z}`
            : MAP_BASE_URL;

        let countsArray = new Array(35).fill(0);
        let linkedDiscordId = null;

        if (context.pool) {
            const [rows] = await context.pool.execute(
                'SELECT counts, discord_id FROM users WHERE mc_uuid = ? LIMIT 1',
                [apiData.uuid]
            );
            if (rows.length > 0) {
                linkedDiscordId = rows[0].discord_id;
                if (rows[0].counts) {
                    countsArray = typeof rows[0].counts === 'string' ? JSON.parse(rows[0].counts) : rows[0].counts;
                }
            }
        }

        const rawName = apiData.formattedName || apiData.name || targetMcid;
        const formattedName = rawName.replace(/<[^>]+>/g, '').replace(/§[0-9a-fk-orx]/gi, '').trim();

        const townRanks = apiData.ranks?.townRanks?.join(', ') || 'なし';
        const nationRanks = apiData.ranks?.nationRanks?.join(', ') || 'なし';
        
        let friendList = Array.isArray(apiData.friends) 
            ? apiData.friends.map(f => f.name).join(', ') || 'なし'
            : 'なし';

        if (friendList.length > 950) friendList = friendList.substring(0, 950) + '... (省略)';

        let titlePrefix = '';
        if (apiData.status?.isKing) titlePrefix = '👑 ';
        else if (apiData.status?.isMayor) titlePrefix = '🏛️ ';

        const activityMap = generateActivityMap(countsArray);
        const joinedTownTs = apiData.timestamps?.joinedTownAt ? `<t:${Math.floor(apiData.timestamps.joinedTownAt / 1000)}:F>` : '未所属';
        const lastOnlineTs = apiData.timestamps?.lastOnline ? `<t:${Math.floor(apiData.timestamps.lastOnline / 1000)}:R>` : '不明';
        const registeredDate = apiData.timestamps?.registered ? new Date(apiData.timestamps.registered).toLocaleDateString('ja-JP') : '不明';

        const embed = {
            title: `${titlePrefix}${formattedName}`,
            timestamp: new Date().toISOString(),
            thumbnail: { url: `https://vzge.me/bust/${apiData.name}.png` },
            color: apiData.status?.isOnline ? 0x2ecc71 : 0xe74c3c,
            fields: [
                { name: '🏠 所属', value: `町: ${apiData.town ? `[${apiData.town.name}](${mapUrl})` : 'なし'}\n国: ${apiData.nation ? `[${apiData.nation.name}](${mapUrl})` : 'なし'}`, inline: true },
                { name: '✅ 基本情報', value: `オンライン: ${apiData.status?.isOnline ? '🟢' : '🔴'}\n所持金: ${(apiData.stats?.balance ?? 0).toLocaleString()} G\nDiscord: ${linkedDiscordId ? `<@${linkedDiscordId}>` : '未連携'}`, inline: true },
                { name: '📊 活動状況', value: `📆 登録: ${registeredDate}\n🏠 所属: ${joinedTownTs}\n⏰ 最終: ${lastOnlineTs}`, inline: true },
                { name: '🛡 権限', value: `   友 国 同 外\n建築: ${formatPerms(apiData.perms?.build)}\n破壊: ${formatPerms(apiData.perms?.destroy)}\n操作: ${formatPerms(apiData.perms?.switch)}\n使用: ${formatPerms(apiData.perms?.itemUse)}`, inline: true },
                { name: '🎗 ランク', value: `町: ${townRanks}\n国: ${nationRanks}`, inline: true },
                { name: `🧑‍🤝‍🧑 フレンド (${apiData.stats?.numFriends ?? 0}人)`, value: `\`\`\`\n${friendList}\n\`\`\``, inline: false },
                { name: '📈 アクティビティ', value: `${activityMap}`, inline: false }
            ]
        };

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('[/res] エラー:', error);
        await interaction.editReply('コマンドの実行中にエラーが発生しました。');
    }
}