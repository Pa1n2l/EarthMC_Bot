import axios from 'axios';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.resolve(process.cwd(), 'data/pursuitCache.json');

const PURSUITS_API_URL = 'https://api.earthmc.net/v4/pursuits';
const PLAYERS_API_URL = 'https://api.earthmc.net/v4/players';
const TOWNS_API_URL = 'https://api.earthmc.net/v4/towns';
const NATIONS_API_URL = 'https://api.earthmc.net/v4/nations';

// メモリ上のキャッシュデータ
export let pursuitCache = {
    PLAYER: null,
    TOWN: null,
    NATION: null,
    lastUpdated: null
};

// JSONファイルから初期データを読み込み
function loadCacheFromFile() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
            pursuitCache = JSON.parse(raw);
            console.log('[PursuitCache] ファイルから既存キャッシュを読み込みました');
        }
    } catch (err) {
        console.error('[PursuitCache] ファイル読み込みエラー:', err.message);
    }
}

// JSONファイルにデータを保存
function saveCacheToFile() {
    try {
        const dir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(pursuitCache, null, 2), 'utf-8');
    } catch (err) {
        console.error('[PursuitCache] ファイル保存エラー:', err.message);
    }
}

// Mojang APIを使用してUUIDからMCIDを取得するヘルパー関数
async function fetchMcidFromMojang(uuid) {
    try {
        // ハイフンを取り除いたUUID形式に変換
        const cleanUuid = uuid.replace(/-/g, '');
        const res = await axios.get(`https://sessionserver.mojang.com/session/minecraft/profile/${cleanUuid}`, { timeout: 3000 });
        if (res.data && res.data.name) {
            return res.data.name;
        }
    } catch (e) {
        // 取得失敗時はnull
    }
    return null;
}

// resolveNames 関数の修正部分
async function resolveNames(categoryData, type) {
    if (!categoryData || !categoryData.isActive) return null;

    const topEntries = categoryData.top || {};
    const positions = Object.keys(topEntries);
    if (positions.length === 0) return categoryData;

    const keyName = type.toLowerCase();
    const uuids = positions.map(pos => topEntries[pos][keyName]);

    let targetApiUrl = PLAYERS_API_URL;
    if (type === 'TOWN') targetApiUrl = TOWNS_API_URL;
    if (type === 'NATION') targetApiUrl = NATIONS_API_URL;

    const detailRes = await axios.post(targetApiUrl, { query: uuids }).catch(() => ({ data: [] }));
    const details = detailRes.data || [];

    const detailMap = new Map();
    details.forEach(item => {
        if (item.uuid) detailMap.set(item.uuid, item);
        else if (item.name) detailMap.set(item.name.toLowerCase(), item);
    });

    const getName = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && val.name) return val.name;
        return '';
    };

    const resolvedTop = {};
    for (const pos of positions) {
        const entry = topEntries[pos];
        const uuid = entry[keyName];
        const detail = detailMap.get(uuid);

        let entityName = getName(detail) || detail?.name || null;

        // PLAYER タイプの時に EarthMC API から名前が取れなかった場合、Mojang API で補完
        if (type === 'PLAYER' && !entityName) {
            entityName = await fetchMcidFromMojang(uuid);
        }

        resolvedTop[pos] = {
            ...entry,
            name: entityName || uuid, // どちらも失敗した場合はUUIDを表示
            town: getName(detail?.town) || getName(detail?.capital),
            nation: getName(detail?.nation)
        };
    }

    return {
        ...categoryData,
        top: resolvedTop
    };
}

// キャッシュ更新処理本体
export async function updatePursuitCache() {
    const apiKey = process.env.SSE_TOKEN;
    if (!apiKey) return;

    try {
        const res = await axios.post(
            PURSUITS_API_URL,
            { query: 'ALL', key: apiKey },
            { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        const data = res.data?.[0];
        if (!data) return;

        pursuitCache.PLAYER = await resolveNames(data.PLAYER, 'PLAYER');
        pursuitCache.TOWN = await resolveNames(data.TOWN, 'TOWN');
        pursuitCache.NATION = await resolveNames(data.NATION, 'NATION');
        pursuitCache.lastUpdated = new Date().toISOString();

        saveCacheToFile();
        console.log('[PursuitCache] キャッシュを更新して JSON に保存しました');
    } catch (error) {
        console.error('[PursuitCache] Error:', error.message);
    }
}

// タスク開始関数
export function startPursuitCacheTask() {
    // 起動時にまずファイルから復元
    loadCacheFromFile();

    // 起動時に初回更新（非同期）
    updatePursuitCache();

    // 1分ごとに定期更新
    cron.schedule('*/1 * * * *', () => {
        updatePursuitCache();
    });
}