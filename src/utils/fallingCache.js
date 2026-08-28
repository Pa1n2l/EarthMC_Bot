import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';

const TOWNS_API_URL = process.env.TOWNS_API_URL || 'https://api.earthmc.net/v4/towns';
const PLAYERS_API_URL = process.env.PLAYERS_API_URL || 'https://api.earthmc.net/v4/players';
const CACHE_FILE_PATH = path.resolve(process.cwd(), 'falling_cache.json');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function chunkArray(array, size = 100) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// 429エラー時にデータを消失させず、リトライする仕組み
async function fetchInChunksWithProgress(url, items, label, delayMs = 80) {
    const chunks = chunkArray(items, 100);
    const totalChunks = chunks.length;
    const results = [];

    for (let i = 0; i < totalChunks; i++) {
        const chunk = chunks[i];
        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            try {
                const res = await axios.post(url, { query: chunk }, { timeout: 15000 });
                if (res.data) {
                    results.push(...res.data);
                    success = true;
                }
            } catch (err) {
                attempts++;
                if (err.response?.status === 429) {
                    console.warn(`[API制限] 429検知。2秒待機してリトライします... (${attempts}/3)`);
                    await sleep(2000);
                } else {
                    console.error(`[APIエラー] 詳細取得失敗: ${err.message}`);
                    break;
                }
            }
        }

        const progress = Math.floor(((i + 1) / totalChunks) * 100);
        console.log(`[FallingCache] ${label}: ${progress}% 完了 (${i + 1}/${totalChunks} チャンク)`);
        await sleep(delayMs);
    }
    return results;
}

/**
 * 【修正版】直近（最新）の 19:00:00 JST のタイムスタンプ(ms)を算出
 * - 現在時刻が「本日 19:00 以降」 -> 「本日 19:00:00 JST」を返す
 * - 現在時刻が「本日 19:00 未満」 -> 「昨日 19:00:00 JST」を返す
 */
function getLast19PMJST() {
    const now = new Date();

    // JST（日本時間）の日付文字列からJST基準のDateオブジェクトを生成
    const jstStr = now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
    const jstDate = new Date(jstStr);

    // 本日の JST 19:00:00 にセット
    jstDate.setHours(19, 0, 0, 0);

    // 現在時刻が本日の 19:00 未満の場合は、昨日の 19:00 を有効な境界値とする
    if (now.getTime() < jstDate.getTime()) {
        jstDate.setDate(jstDate.getDate() - 1);
    }

    return jstDate.getTime();
}

let cachedFallingTowns = [];
let lastUpdated = 0;

export async function buildFallingCache() {
    // 1. JSONキャッシュファイルの読み込み確認
    try {
        const fileData = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        const json = JSON.parse(fileData);

        const thresholdMs = getLast19PMJST();

        // キャッシュ更新日時が「直近の19:00 JST」以降であれば再利用
        if (json.lastUpdated && json.lastUpdated >= thresholdMs) {
            cachedFallingTowns = json.data || [];
            lastUpdated = json.lastUpdated;
            const updatedDateStr = new Date(lastUpdated).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
            console.log(`[FallingCache] 有効なJSONキャッシュを検出しました (${updatedDateStr})。再生成をスキップします。`);
            return cachedFallingTowns;
        }
        console.log('[FallingCache] 既存のJSONキャッシュが19:00以前の古いデータのため、再生成を行います...');
    } catch (err) {
        console.log('[FallingCache] キャッシュファイルが存在しないか壊れているため、新規作成します...');
    }

    // 2. キャッシュの新規構築処理
    try {
        console.log('[FallingCache] 0% : キャッシュ生成を開始します...');

        const listRes = await axios.get(TOWNS_API_URL, { timeout: 10000 });
        const allTowns = listRes.data;
        if (!Array.isArray(allTowns) || allTowns.length === 0) {
            console.log('[FallingCache] 100% : 町データが存在しませんでした。');
            return [];
        }

        console.log(`[FallingCache] 10% : 全街リスト取得完了 (${allTowns.length}件)。詳細を取得中...`);

        const townNames = allTowns.map(t => t.name);
        const detailedTowns = await fetchInChunksWithProgress(TOWNS_API_URL, townNames, '町詳細の取得', 80);

        console.log('[FallingCache] 50% : 町詳細取得完了。市長データを取得中...');

        const mayorNames = [...new Set(detailedTowns.map(t => t.mayor?.name).filter(Boolean))];
        const detailedPlayers = await fetchInChunksWithProgress(PLAYERS_API_URL, mayorNames, '市長データの取得', 80);

        console.log('[FallingCache] 90% : データ照合とフィルタリングを実行中...');

        const mayorOnlineMap = new Map();
        for (const p of detailedPlayers) {
            if (p.name && p.timestamps?.lastOnline) {
                mayorOnlineMap.set(p.name.toLowerCase(), p.timestamps.lastOnline);
            }
        }

        const NOW = Date.now();
        const DAY_MS = 24 * 60 * 60 * 1000;
        const newCache = [];

        for (const t of detailedTowns) {
            const mayorName = t.mayor?.name;
            if (!mayorName) continue;

            const lastOnlineMs = mayorOnlineMap.get(mayorName.toLowerCase());
            if (!lastOnlineMs) continue;

            // JSTベースでの安全な42日後（19:00:00）計算
            const lastOnlineJstStr = new Date(lastOnlineMs).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
            const deletionDate = new Date(lastOnlineJstStr);
            
            deletionDate.setDate(deletionDate.getDate() + 42);
            deletionDate.setHours(19, 0, 0, 0);

            let deletionTimeMs = deletionDate.getTime();
            if (deletionTimeMs < lastOnlineMs + (42 * DAY_MS)) {
                deletionTimeMs += DAY_MS;
            }

            if (deletionTimeMs <= NOW) continue;
            if (deletionTimeMs - NOW > 7 * DAY_MS) continue;

            const x = Math.round(t.coordinates?.spawn?.x || 0);
            const y = Math.round(t.coordinates?.spawn?.y || 0);
            const z = Math.round(t.coordinates?.spawn?.z || 0);

            newCache.push({
                name: t.name,
                nation: t.nation?.name || '無所属',
                mayor: mayorName,
                residents: t.stats?.numResidents || 0,
                plots: t.stats?.numTownBlocks || 0,
                balance: t.stats?.balance || 0,
                x, y, z,
                mapUrl: `https://map.earthmc.net/?worldname=earth&mapname=flat&zoom=4&x=${x}&y=${y}&z=${z}`,
                isCapital: !!t.status?.isCapital,
                isOpen: !!t.status?.isOpen,
                canOutsidersSpawn: !!t.status?.canOutsidersSpawn,
                pvp: !!t.perms?.flags?.pvp,
                lastOnlineSec: Math.floor(lastOnlineMs / 1000),
                deletionTimeMs: deletionTimeMs,
                deletionTimestampSec: Math.floor(deletionTimeMs / 1000),
                registered: t.timestamps?.registered || 0
            });
        }

        // 削除日時が近い順（残り時間が短い順）にソート
        newCache.sort((a, b) => a.deletionTimeMs - b.deletionTimeMs);

        cachedFallingTowns = newCache;
        lastUpdated = Date.now();

        // 3. JSONファイルへ書き出し
        const payload = {
            lastUpdated: lastUpdated,
            data: cachedFallingTowns
        };
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');

        console.log(`[FallingCache] 100% : キャッシュ更新＆JSON保存完了！ (該当町数: ${newCache.length}件)`);
        return cachedFallingTowns;

    } catch (error) {
        console.error('[FallingCache] エラー発生により中断:', error.message);
        return cachedFallingTowns;
    }
}

export function getFallingCache() {
    return cachedFallingTowns;
}